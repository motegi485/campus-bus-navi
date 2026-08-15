import { useEffect, useRef } from 'react'
import { usePressable } from '../hooks/usePressable'
import { usePushSubscription, type PushStatus } from '../hooks/usePushSubscription'
import type { ReminderSettings } from '../hooks/useReminderSettings'
import { tapFeedback } from '../utils/haptics'

/**
 * 設定画面の「通知」セクション。
 *
 * 通知の到達条件を誤解させないことが最優先（提案書 M-3）。立てる約束は 1 つだけ:
 *   「登録した端末に、最終便の N 分前に通知が届く。アプリを閉じていてもよい」
 *
 * iOS ではホーム画面に追加した PWA でしか届かないため、そうでない環境には
 * トグルを出さずに理由を説明する（届かないものを操作させない）。
 */

interface Props {
  reminder: ReminderSettings
  /** 選択サブスクリーンを開く。行の見た目・作法は他の設定行と揃える */
  onOpenSelect: (key: 'reminderRoute' | 'reminderLead' | 'reminderDays') => void
  routeLabel: string
  leadLabel: string
  daysLabel: string
}

/** 状態ごとの見出しと説明。tone は文字色に対応する */
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
    detail: 'オンにすると、最終便の発車前にこの端末へ通知が届きます。アプリを閉じていても届きます。',
    tone: 'warn',
  },
  subscribed: {
    label: 'オン',
    detail: '最終便の発車前に、この端末へ通知が届きます。',
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
        width: 46,
        height: 27,
        borderRadius: 20,
        flexShrink: 0,
        background: on ? '#10b981' : 'var(--bg-input)',
        border: on ? 'none' : '1px solid var(--chip-border)',
        position: 'relative',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.22s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 22 : 3,
          width: 21,
          height: 21,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(15,23,42,.3)',
          transition: 'left 0.22s cubic-bezier(.4,0,.2,1)',
        }}
      />
    </span>
  )
}

function DetailRow({ title, value, onClick }: { title: string; value: string; onClick: () => void }) {
  const { pressed, pressHandlers } = usePressable()
  return (
    <button
      type="button"
      onClick={onClick}
      {...pressHandlers}
      aria-label={`${title}（現在: ${value}）`}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px',
        width: '100%', textAlign: 'left',
        background: pressed ? 'var(--row-active)' : 'transparent',
        border: 'none', borderTop: '.5px solid var(--border)',
        cursor: 'pointer',
        transition: pressed ? 'none' : 'background 0.3s',
        font: 'inherit', color: 'inherit',
      }}
    >
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
      <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>{value}</span>
      <span aria-hidden="true" style={{ fontSize: 13, color: 'var(--text-muted)' }}>›</span>
    </button>
  )
}

export function ReminderSection({ reminder, onOpenSelect, routeLabel, leadLabel, daysLabel }: Props) {
  const { status, error, busy, enable, disable, syncSettings } = usePushSubscription(reminder)
  const info = STATUS_TEXT[status]
  const isOn = status === 'subscribed'
  const canToggle = status === 'idle' || status === 'subscribed'
  const { pressed, pressHandlers } = usePressable(!canToggle || busy)

  // 設定を変えたらサーバへ反映する。初回マウントでは送らない（購読していない場合もあるため）
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    void syncSettings()
  }, [reminder, syncSettings])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!canToggle || busy) return
          tapFeedback(10)
          void (isOn ? disable() : enable())
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

      {/* 通知の内容に関わる設定。オンのときだけ意味を持つので、オフのときは畳む */}
      {isOn && (
        <>
          <DetailRow title="ルート" value={routeLabel} onClick={() => onOpenSelect('reminderRoute')} />
          <DetailRow title="通知するタイミング" value={leadLabel} onClick={() => onOpenSelect('reminderLead')} />
          <DetailRow title="通知する曜日" value={daysLabel} onClick={() => onOpenSelect('reminderDays')} />
        </>
      )}

      {error && (
        <p
          role="alert"
          style={{
            fontSize: 12, color: 'var(--icon-red-fg)', lineHeight: 1.6,
            margin: 0, padding: '0 16px 14px',
          }}
        >
          {error}
        </p>
      )}
    </>
  )
}
