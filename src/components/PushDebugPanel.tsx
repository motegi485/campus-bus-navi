import { useState } from 'react'
import type { RouteKey } from '../types/timetable'
import { usePushSubscription } from '../hooks/usePushSubscription'
import { usePressable } from '../hooks/usePressable'
import { tapFeedback } from '../utils/haptics'

/**
 * ⚠️ 検証用の一時パネル。段階 6 で正式な通知設定 UI に置き換えて削除する。
 *
 * 目的は 1 つだけ ──「実機で購読を作り、その JSON を取り出す」。
 * iPhone にはコンソールが無いため、画面の上でこれができないと段階 2
 * （ペイロードなし push が Safari で動くか）の検証が始められない。
 *
 * VAPID 公開鍵は .env.local の VITE_VAPID_PUBLIC_KEY から読む。未設定なら
 * 入力欄を出す（端末ごとに .env を用意せず、その場で貼れるようにするため）。
 */

/** 検証中だけ使う下書き置き場。正式版では消える */
const KEY_DRAFT_STORAGE = 'campusBusNaviVapidKeyDraft'

const ENV_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

const STATUS_TEXT: Record<string, { label: string; detail: string; tone: 'ok' | 'warn' | 'ng' }> = {
  unsupported: {
    label: '非対応',
    detail: 'このブラウザは Web Push に対応していません。',
    tone: 'ng',
  },
  'ios-needs-install': {
    label: 'ホーム画面への追加が必要',
    detail: 'iPhone / iPad では、共有 →「ホーム画面に追加」してから、そのアイコンで開いてください。Safari のタブでは通知は届きません。',
    tone: 'warn',
  },
  denied: {
    label: '通知が拒否されています',
    detail: 'ブラウザの設定でこのサイトの通知を許可してから、もう一度お試しください。',
    tone: 'ng',
  },
  idle: {
    label: '未購読',
    detail: '下のボタンを押すと通知の許可を求めます。',
    tone: 'warn',
  },
  subscribed: {
    label: '購読中',
    detail: '下の購読情報を PC へ送って、テスト送信に使ってください。',
    tone: 'ok',
  },
}

const TONE_COLOR: Record<'ok' | 'warn' | 'ng', string> = {
  ok: '#047857',
  warn: '#b45309',
  ng: '#b91c1c',
}

export function PushDebugPanel({ route }: { route: RouteKey }) {
  const { status, subscriptionJson, error, busy, subscribe, unsubscribe } = usePushSubscription()
  const [keyInput, setKeyInput] = useState(() => {
    if (ENV_PUBLIC_KEY) return ENV_PUBLIC_KEY
    try {
      return localStorage.getItem(KEY_DRAFT_STORAGE) ?? ''
    } catch {
      return ''
    }
  })
  const [copied, setCopied] = useState(false)
  const press = usePressable(busy)

  const info = STATUS_TEXT[status] ?? STATUS_TEXT.idle
  const canSubscribe = status === 'idle' && keyInput.trim().length > 0

  const handleSubscribe = () => {
    tapFeedback(10)
    try {
      localStorage.setItem(KEY_DRAFT_STORAGE, keyInput.trim())
    } catch {
      // 保存できなくても購読はできる
    }
    void subscribe(keyInput, { route })
  }

  /**
   * ファイルとして保存する。こちらを主にしている。
   *
   * クリップボード経由だと、ユーザーが次に別のもの（送信コマンドなど）をコピーした
   * 時点で購読情報が消える。ファイルなら手順の順序に関係なく残る。
   */
  const handleDownload = () => {
    if (!subscriptionJson) return
    tapFeedback(10)
    const url = URL.createObjectURL(new Blob([subscriptionJson], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'subscription.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleCopy = async () => {
    if (!subscriptionJson) return
    tapFeedback(10)
    try {
      await navigator.clipboard.writeText(subscriptionJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードが使えない環境では、下のテキストを手で選択してもらう
      setCopied(false)
    }
  }

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>発車リマインダー（検証中）</div>
        <div style={{ fontSize: 12, color: TONE_COLOR[info.tone], fontWeight: 700, marginTop: 4 }}>{info.label}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>{info.detail}</div>
      </div>

      {/* 公開鍵。環境変数で入っていれば入力欄は出さない */}
      {status === 'idle' && !ENV_PUBLIC_KEY && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>VAPID 公開鍵</span>
          <input
            type="text"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            placeholder="公開鍵を貼り付け"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{
              width: '100%', padding: '9px 11px', borderRadius: 10,
              border: '1px solid var(--chip-border)', background: 'var(--bg-input)',
              color: 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace',
            }}
          />
        </label>
      )}

      {status === 'idle' && (
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={!canSubscribe || busy}
          {...press.pressHandlers}
          style={{
            padding: '11px 14px', borderRadius: 12, border: 'none',
            background: canSubscribe ? 'linear-gradient(135deg,#0d9966,#34d399)' : 'var(--bg-input)',
            color: canSubscribe ? '#fff' : 'var(--text-muted)',
            fontSize: 14, fontWeight: 700, cursor: canSubscribe ? 'pointer' : 'default',
            font: 'inherit', fontFamily: 'inherit',
            transform: press.pressed ? 'scale(.98)' : 'scale(1)',
            transition: 'transform .12s ease-out',
          }}
        >
          {busy ? '処理中...' : '通知を購読する'}
        </button>
      )}

      {status === 'subscribed' && subscriptionJson && (
        <>
          <textarea
            readOnly
            value={subscriptionJson}
            onFocus={e => e.currentTarget.select()}
            rows={5}
            style={{
              width: '100%', padding: '9px 11px', borderRadius: 10,
              border: '1px solid var(--chip-border)', background: 'var(--bg-input)',
              color: 'var(--text-primary)', fontSize: 11, fontFamily: 'monospace',
              resize: 'vertical', lineHeight: 1.5,
            }}
          />
          <button
            type="button"
            onClick={handleDownload}
            style={{
              padding: '11px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg,#0d9966,#34d399)', color: '#fff',
              fontSize: 14, fontWeight: 700, cursor: 'pointer', font: 'inherit', fontFamily: 'inherit',
            }}
          >
            subscription.json を保存
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                flex: 1, padding: '9px', borderRadius: 12,
                border: '1px solid var(--chip-border)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', font: 'inherit', fontFamily: 'inherit',
              }}
            >
              {copied ? '✓ コピーしました' : 'コピー（予備）'}
            </button>
            <button
              type="button"
              onClick={() => { tapFeedback(10); void unsubscribe() }}
              disabled={busy}
              style={{
                padding: '9px 14px', borderRadius: 12,
                border: '1px solid var(--chip-border)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', font: 'inherit', fontFamily: 'inherit',
              }}
            >
              解除
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
            保存ボタンを使ってください。コピーは、あとで別のものをコピーすると消えてしまいます。
          </p>
        </>
      )}

      {error && (
        <p style={{ fontSize: 12, color: '#b91c1c', lineHeight: 1.6, margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  )
}
