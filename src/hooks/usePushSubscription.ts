import { useCallback, useEffect, useState } from 'react'
import { isIOS, isStandalone } from '../utils/platform'
import { clearPushMirror } from '../utils/pushMirror'

/**
 * 端末の購読（通知の根幹の許可）を扱うフック。
 *
 * 設定画面のトグルがこれを操作する。オンにすると通知許可を取り、push 購読を作り、
 * サーバへ登録する。**ここが有効になって初めて、時刻表から便ごとのリマインドを
 * 指定できる**（順序はサーバ側でも守られていて、未登録の端末からの指定は 409 になる）。
 *
 * 「どの便に何分前」は useDepartureReminders が扱う。ここは端末の登録だけ。
 *
 * 通知許可は**必ずユーザー操作を起点に**要求する（enable() を呼んだときだけ）。
 * iOS Safari のタブでは Notification / PushManager 自体が未定義のことがあるため、
 * すべての参照を typeof で守る。
 */

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

async function readError(response: Response): Promise<string> {
  const detail = await response.json().catch(() => null)
  return (detail as { error?: string } | null)?.error ?? `HTTP ${response.status}`
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('idle')
  const [endpoint, setEndpoint] = useState<string | null>(null)
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
        setEndpoint(existing?.endpoint ?? null)
        setStatus(existing ? 'subscribed' : 'idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('idle')
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** 通知をオンにする。ユーザーがトグルを押した文脈でのみ呼ぶこと */
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

      // ここが唯一の許可要求
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

      const json = created.toJSON()
      let response: Response
      try {
        response = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
        })
      } catch (e) {
        // 通信そのものが失敗した場合も、端末だけ購読済みの状態を残さない
        await created.unsubscribe().catch(() => undefined)
        throw e
      }
      if (!response.ok) {
        // サーバに登録できていないのに端末の購読だけ残ると、次回起動時に
        // getSubscription() が見つけて「通知オン」と表示し、D1 未登録を隠してしまう。
        // 作ったばかりの購読を巻き戻してから失敗させる
        await created.unsubscribe().catch(() => undefined)
        throw new Error(await readError(response))
      }

      setEndpoint(created.endpoint)
      setStatus('subscribed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  /** 通知をオフにする。設定した便のリマインドもすべて消える（一括解除） */
  const disable = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      if (existing) {
        // サーバの行を先に消す。端末側の解除だけだと D1 に失効した購読が残り、
        // 配信のたびに無駄なサブリクエストを使う
        const response = await fetch('/api/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        })
        // fetch は 4xx / 5xx では reject しない。ok を見ずに端末だけ解除すると、
        // 画面は「オフ」なのに D1 に購読とリマインドが残り、README の
        // 「オフにすると預かっている情報はすべて削除されます」と食い違う
        if (!response.ok) throw new Error(await readError(response))
        await existing.unsubscribe()
      }
      // サーバ側を消せたので、端末に写していた予約も残さない
      await clearPushMirror()
      setEndpoint(null)
      setStatus('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  return { status, endpoint, error, busy, enable, disable }
}
