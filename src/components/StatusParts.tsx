import type { SVGProps } from 'react'
import { usePressable } from '../hooks/usePressable'
import { tapFeedback } from '../utils/haptics'
import type { DataStatus } from '../utils/deriveDataStatus'

/**
 * StatusCard（フルカード）と StatusBand（帯）で共有する部品。
 *
 * アイコンは AppIcons とは別に持つ。AppIcons はドロワー・設定のメニュー用で
 * 線幅 1.7 固定の設計ルールがあるが、状態表示は文字を読む前に区別が付くことが目的で
 * より太い線が要る。viewBox 24・currentColor・aria-hidden の作法は合わせている。
 */

function Glyph({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 取得失敗: 丸に感嘆符 */
function IconAlert(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5h.01" />
    </Glyph>
  )
}

/** 日付跨ぎ: カレンダー */
function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M12 14v3" />
    </Glyph>
  )
}

/** オフライン: 雲にスラッシュ */
function IconCloudOff(props: SVGProps<SVGSVGElement>) {
  return (
    <Glyph {...props}>
      <path d="M6.5 19a4.5 4.5 0 0 1-.5-8.97 6 6 0 0 1 10.2-3.2" />
      <path d="M18 10.1a4.5 4.5 0 0 1 .5 8.9H9" />
      <path d="M3 3l18 18" />
    </Glyph>
  )
}

/** 取得中スピナー（ローディング表示と同じ emerald-400） */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="取得中"
      className="rounded-full border-2 border-emerald-400 border-t-transparent animate-spin"
      style={{ width: size, height: size, display: 'block' }}
    />
  )
}

/**
 * 状態を表すアイコン。色は既存トークンのみを使い、新規の色を足さない。
 * いずれもライト・ダーク双方で非文字コントラスト 3:1 以上を満たす。
 */
export function StatusIcon({ status, size = 22 }: { status: DataStatus; size?: number }) {
  if (status === 'refetching-stale') {
    return (
      <span style={{ display: 'flex', lineHeight: 0 }}>
        <Spinner size={size - 6} />
      </span>
    )
  }

  const map: Partial<Record<DataStatus, { Icon: typeof IconAlert; color: string }>> = {
    'no-data': { Icon: IconAlert, color: '#ef4444' },
    'fetch-failed': { Icon: IconAlert, color: '#ef4444' },
    stale: { Icon: IconCalendar, color: 'var(--icon-amber-fg)' },
    offline: { Icon: IconCloudOff, color: 'var(--icon-slate-fg)' },
  }
  const entry = map[status]
  if (!entry) return null

  const { Icon, color } = entry
  return (
    <span style={{ display: 'flex', lineHeight: 0, color }}>
      <Icon width={size} height={size} />
    </span>
  )
}

interface RetryButtonProps {
  /** lg = フルカード内 / sm = 帯の中 */
  size: 'lg' | 'sm'
  refreshing: boolean
  onRetry: () => void
}

/**
 * 再試行ボタン。見た目は FullTimetable のチップと同じ材質で、新しい様式は作らない。
 *
 * 二重押下のガードは App の handleRefresh 先頭にあるものへ任せ、ここには書かない。
 * 無効表現に opacity を使わないのは、この文字サイズでコントラストが AA を割るため。
 * 代わりに文言を差し替え、影を押し込み側に固定する。
 */
export function RetryButton({ size, refreshing, onRetry }: RetryButtonProps) {
  const { pressed, pressHandlers } = usePressable(refreshing)
  const sunken = pressed || refreshing
  const lg = size === 'lg'

  return (
    <button
      type="button"
      onClick={() => {
        if (!refreshing) tapFeedback(10)
        onRetry()
      }}
      {...pressHandlers}
      disabled={refreshing}
      aria-busy={refreshing}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: lg ? 7 : 6,
        flexShrink: 0,
        fontSize: lg ? 13 : 11.5,
        fontWeight: 700,
        lineHeight: 1,
        padding: lg ? '11px 20px' : '8px 13px',
        borderRadius: lg ? 14 : 10,
        marginTop: lg ? 4 : 0,
        cursor: refreshing ? 'default' : 'pointer',
        background: 'var(--bg-input)',
        color: 'var(--chip-text)',
        border: '1px solid var(--chip-border)',
        boxShadow: sunken
          ? 'inset 0 1px 2px var(--chip-rim)'
          : 'inset 0 1px 0 var(--chip-highlight), 0 1.5px 0 var(--chip-rim), 0 2px 4px rgba(15,23,42,.10)',
        transform: sunken ? 'translateY(1px)' : 'translateY(0)',
        transition: 'transform .12s ease-out, box-shadow .12s ease-out',
      }}
    >
      {refreshing && <Spinner size={lg ? 13 : 11} />}
      {refreshing ? '再試行中...' : '再試行'}
    </button>
  )
}
