import { useCallback, useEffect, useRef, useState } from 'react'
import { isIOS, isStandalone } from '../utils/platform'
import type { ReminderSettings } from './useReminderSettings'

/**
 * Web Push の購読を扱うフック。
 *
 * 端末側で購読を作り、その内容をサーバ（/api/subscribe → D1）へ登録する。
 * 配信 Worker は D1 を見て送るので、ここで登録しないと通知は永久に来ない。
 *
 * 通知許可は**必ずユーザー操作を起点に**要求する（enable() を呼んだときだけ）。
 * 起動時に勝手にダイアログを出さない。
 *
 * iOS Safari のタブでは Notification / PushManager 自体が未定義のことがあるため、
 * すべての参照を typeof で守る。
 */

/** push-sw.js が読む表示設定の置き場。名前を変えるときは両方直すこと */
const IDB_NAME = 'campusBusNaviPush'
const IDB_STORE = 'settings'
const IDB_KEY = 'current'

export type PushStatus =
  /** ブラウザが Web Push に対応していない */
  | 'unsupported'
  /** iOS で、ホーム画面に追加せずに開いている（この状態では絶対に届かない） */
  | 'ios-needs-install'
  /** 通知許可が拒否済み。ブラウザ設定から戻すしかない */
  | 'denied'
  /** 未購読 */
  | 'idle'
  /** 購読済み */
  | 'subscribed'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(IDB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    request.onerror = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * push-sw.js が通知の文面を組み立てるのに使う設定を保存する。
 * ペイロードなし push なので、SW は「どのルートの話か」をここからしか知れない。
 */
async function saveDisplaySettings(settings: { route: string }): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(settings, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // 保存できなくても push は届く（push-sw.js が既定のルートで表示する）
  } finally {
    db.close()
  }
}

/** base64url の VAPID 公開鍵を、pushManager.subscribe が要求するバイト列に変換する */
function publicKeyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function detectUnavailable(): Exclude<PushStatus, 'idle' | 'subscribed'> | null {
  if (typeof window === 'undefined') return 'unsupported'
  // iOS はホーム画面追加が先。タブのままでは Notification が無いことも多いので先に判定する
  if (isIOS() && !isStandalone()) return 'ios-needs-install'
  if (typeof Notification === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined') return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return null
}

/** サーバへ購読を登録する。D1 に入って初めて配信 Worker の対象になる */
async function registerOnServer(subscription: PushSubscription, reminder: ReminderSettings): Promise<void> {
  const json = subscription.toJSON()
  const response = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      route: reminder.route,
      // 段階 6a では最終便のみ。任意の便の指定は D1 のスキーマ上は対応済み
      mode: 'last_bus',
      departure: null,
      leadMinutes: reminder.leadMinutes,
      daysMask: reminder.daysMask,
    }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    throw new Error((detail as { error?: string }).error ?? `HTTP ${response.status}`)
  }
}

async function unregisterOnServer(endpoint: string): Promise<void> {
  await fetch('/api/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
}

export function usePushSubscription(reminder: ReminderSettings) {
  const [status, setStatus] = useState<PushStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const subscriptionRef = useRef<PushSubscription | null>(null)

  // 起動時は「いま購読しているか」を読むだけ。許可の要求は一切しない
  useEffect(() => {
    const unavailable = detectUnavailable()
    if (unavailable) {
      setStatus(unavailable)
      return
    }
    let cancelled = false
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(existing => {
        if (cancelled) return
        subscriptionRef.current = existing
        setStatus(existing ? 'subscribed' : 'idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('idle')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async () => {
    setError(null)
    const unavailable = detectUnavailable()
    if (unavailable) {
      setStatus(unavailable)
      return
    }

    setBusy(true)
    try {
      // 公開鍵はサーバから取る。フロントに焼き込まないので、鍵を差し替えても再ビルドが要らない
      const keyResponse = await fetch('/api/vapid-key')
      if (!keyResponse.ok) throw new Error('サーバから鍵を取得できませんでした')
      const { publicKey } = (await keyResponse.json()) as { publicKey?: string }
      if (!publicKey) throw new Error('サーバに鍵が設定されていません')

      // ここが唯一の許可要求。ユーザーがボタンを押した文脈でのみ呼ばれる
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'idle')
        setError('通知が許可されませんでした')
        return
      }

      const registration = await navigator.serviceWorker.ready
      const created = await registration.pushManager.subscribe({
        // Chrome は必須。push を受けたら必ず通知を出すという約束（push-sw.js が守る）
        userVisibleOnly: true,
        applicationServerKey: publicKeyToBytes(publicKey),
      })

      await registerOnServer(created, reminder)
      await saveDisplaySettings({ route: reminder.route })

      subscriptionRef.current = created
      setStatus('subscribed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [reminder])

  const disable = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      if (existing) {
        // サーバの行を先に消す。端末側の解除だけだと D1 に失効した購読が残り、
        // 配信のたびに無駄なサブリクエストを使う
        await unregisterOnServer(existing.endpoint)
        await existing.unsubscribe()
      }
      subscriptionRef.current = null
      setStatus('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  /**
   * 設定変更をサーバへ反映する。購読していないときは何もしない。
   * /api/subscribe は endpoint のハッシュを主キーにしているので、同じ端末なら上書きになる。
   */
  const syncSettings = useCallback(async () => {
    if (status !== 'subscribed') return
    const current = subscriptionRef.current
    if (!current) return
    setError(null)
    try {
      await registerOnServer(current, reminder)
      await saveDisplaySettings({ route: reminder.route })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [status, reminder])

  return { status, error, busy, enable, disable, syncSettings }
}
