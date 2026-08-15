import { useCallback, useEffect, useState } from 'react'
import type { RouteKey } from '../types/timetable'
import { isIOS, isStandalone } from '../utils/platform'

/**
 * Web Push の購読を扱うフック。
 *
 * 通知許可は**必ずユーザー操作を起点に**要求する（subscribe() を呼んだときだけ）。
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
  /** 未購読。ここから購読できる */
  | 'idle'
  /** 購読済み */
  | 'subscribed'

/** push-sw.js へ渡す表示設定。D1 は「いつ送るか」、これは「何を表示するか」を持つ */
export interface PushDisplaySettings {
  route: RouteKey
}

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

/** 表示設定を保存する。失敗しても購読自体は成立するので、例外は外へ出さない */
async function saveDisplaySettings(settings: PushDisplaySettings): Promise<void> {
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

/**
 * base64url の VAPID 公開鍵を、pushManager.subscribe が要求するバイト列に変換する。
 * 返り値を Uint8Array<ArrayBuffer> と明示するのは、既定の Uint8Array が TS 5.7 以降
 * Uint8Array<ArrayBufferLike> に広がり BufferSource に渡せなくなるため。
 */
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

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('idle')
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        setSubscription(existing)
        setStatus(existing ? 'subscribed' : 'idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('idle')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = useCallback(async (publicKey: string, display: PushDisplaySettings) => {
    setError(null)
    const unavailable = detectUnavailable()
    if (unavailable) {
      setStatus(unavailable)
      return
    }
    if (!publicKey.trim()) {
      setError('VAPID 公開鍵が設定されていません')
      return
    }

    setBusy(true)
    try {
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
        applicationServerKey: publicKeyToBytes(publicKey.trim()),
      })

      await saveDisplaySettings(display)
      setSubscription(created)
      setStatus('subscribed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()
      setSubscription(null)
      setStatus('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    status,
    /** 購読情報の JSON。サーバへ送る値そのもの */
    subscriptionJson: subscription ? JSON.stringify(subscription.toJSON()) : null,
    error,
    busy,
    subscribe,
    unsubscribe,
  }
}
