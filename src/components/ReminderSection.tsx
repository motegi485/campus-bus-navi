import { usePressable } from '../hooks/usePressable'
import type { PushStatus } from '../hooks/usePushSubscription'
import { tapFeedback } from '../utils/haptics'

/**
 * 設定画面の「通知」セクション。
 *
 * ここは**通知の根幹の許可**だけを扱う。オンにすると通知許可を取り、この端末を
 * 登録する。どの便に何分前かは、ホーム画面の「本日の全時刻表」で指定する。
 *
 * オフにすると、設定済みの便のリマインドもすべて消える（一括解除）。
 *
 * 到達条件を誤解させないことが最優先（提案書 M-3）。iOS ではホーム画面に追加した
 * PWA でしか届かないため、そうでない環境にはトグルを出さずに理由を説明する
 * （届かないものを操作させない）。
 */

interface Props {
  status: PushStatus
  busy: boolean
  error: string | null
  onEnable: () => void
  onDisable: () => void
}

const STATUS_TEXT: Record<PushStatus, { label: string; detail: string; tone: 'ok' | 'warn' | 'ng' }> = {
  unsupported: {
    label: 'この環境では利用できません',
    detail: 'お使いのブラウザは通知に対応していません。',
    tone: 'ng',
  },
  'ios-needs-install': {
    label: 'ホーム画面への追加が必要です',
    detail:
      'iPhone・iPad では、Safari の共有ボタンから「ホーム画面に追加」して、そのアイコンから開くと通知を受け取れます。',
    tone: 'warn',
  },
  denied: {
    label: '通知が拒否されています',
    detail: 'ブラウザの設定でこのサイトの通知を許可すると、受け取れるようになります。',
    tone: 'ng',
  },
  idle: {
    label: 'オフ',
    detail: 'オンにすると、「本日の全時刻表」から便を選んで発車前の通知を設定できるようになります。',
    tone: 'warn',
  },
  subscribed: {
    label: 'オン',
    detail:
      '「本日の全時刻表」を開いて便を選ぶと、発車前に通知が届きます。アプリを閉じていても届きます。オフにすると設定済みの通知もすべて解除されます。',
    tone: 'ok',
  },
}

/** 文字色。ライト・ダーク双方で本文面に対し AA を満たす値を使う */
const TONE_COLOR: Record<'ok' | 'warn' | 'ng', string> = {
  ok: 'var(--icon-green-fg)',
  warn: 'var(--text-secondary)',
  ng: 'var(--icon-red-fg)',
}

function Switch({ on, disabled }: { on: boolean; disabled: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 46, height: 27, borderRadius: 20, flexShrink: 0,
        background: on ? '#10b981' : 'var(--bg-input)',
        border: on ? 'none' : '1px solid var(--chip-border)',
        position: 'relative',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.22s',
      }}
    >
      <span
        style={{
          position: 'absolute', top: 3, left: on ? 22 : 3,
          width: 21, height: 21, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,.3)',
          transition: 'left 0.22s cubic-bezier(.4,0,.2,1)',
        }}
      />
    </span>
  )
}

export function ReminderSection({ status, busy, error, onEnable, onDisable }: Props) {
  const info = STATUS_TEXT[status]
  const isOn = status === 'subscribed'
  const canToggle = status === 'idle' || status === 'subscribed'
  const { pressed, pressHandlers } = usePressable(!canToggle || busy)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!canToggle || busy) return
          tapFeedback(10)
          isOn ? onDisable() : onEnable()
        }}
        {...pressHandlers}
        disabled={!canToggle || busy}
        aria-pressed={isOn}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
          width: '100%', textAlign: 'left',
          background: pressed ? 'var(--row-active)' : 'transparent',
          border: 'none',
          cursor: canToggle && !busy ? 'pointer' : 'default',
          transition: pressed ? 'none' : 'background 0.3s',
          font: 'inherit', color: 'inherit',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>発車リマインダー</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: TONE_COLOR[info.tone], marginTop: 3 }}>
            {busy ? '処理中...' : info.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
            {info.detail}
          </div>
        </div>
        {canToggle && <Switch on={isOn} disabled={busy} />}
      </button>

      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--icon-red-fg)', lineHeight: 1.6, margin: 0, padding: '0 16px 14px' }}>
          {error}
        </p>
      )}
    </>
  )
}
