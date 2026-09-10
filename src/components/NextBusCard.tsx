import type { NextBusInfo, FontSize } from '../types/timetable'
import { BellIcon } from './BellIcon'
import { formatWaitLabel } from '../utils/findNextBus'

interface Props {
  next: NextBusInfo
  fontSize: FontSize
  /** 本日の残り運行本数（次発を含む） */
  remaining: number
  /**
   * この便に発車前の通知を設定済みか。
   * 「本日の全時刻表」のベル印（TimetableGrid）と同じ情報を、次発にも出す。
   * 設定した便が次発へ上がってきたときに、印だけが消えたように見えないようにするため。
   * 改修たたき台の静的モックには存在しないが、実データに基づく実用機能として残す
   * （ターン2チャットでの確定指示）。
   */
  reminded?: boolean
}

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small:  'text-5xl',
  medium: 'text-[52px]',
  large:  'text-6xl',
}

/**
 * 円形ゲージの満タン相当分数。実際の運行間隔（10〜30分台）を大きく外れない
 * 目安値で、正確な運行間隔から算出しているわけではない（見た目の目安）。
 * 改修たたき台のサンプル値（残り5分 / .17turn ≒ 5/30）と同じ前提。
 */
const GAUGE_MAX_MINUTES = 30

export function NextBusCard({ fontSize, remaining, next, reminded = false }: Props) {
  const fs = FONT_SIZE_MAP[fontSize]

  // remaining === 1 のとき、次発が本日の最終便
  const isLastBus = remaining === 1

  const fraction = Math.max(0, Math.min(1, next.minutesUntil / GAUGE_MAX_MINUTES))
  const gaugeDeg = Math.round(fraction * 360)

  const waitLabel = formatWaitLabel(next.minutesUntil)

  return (
    <div style={{ borderRadius: 22, background: 'var(--next-card-bg)', padding: '16px 18px' }}>
      {/* 見出し行: 左「次のバス」（＋通知の印）／右に本日の残数バッジ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '.06em', color: 'var(--slot-current-fg)' }}>
            次のバス
          </p>
          {reminded && (
            <span
              role="img"
              aria-label="この便は発車前の通知を設定済みです"
              className="inline-flex items-center gap-1 whitespace-nowrap"
              style={{
                marginLeft: 8, padding: '3px 8px', borderRadius: 9999,
                background: 'var(--bg-card)', color: 'var(--slot-current-fg)',
                fontSize: 11, fontWeight: 800,
              }}
            >
              <BellIcon width={10} height={10} /> 通知
            </span>
          )}
        </div>
        <span
          className="inline-flex items-center whitespace-nowrap"
          style={{
            gap: 6, background: 'var(--bg-card)', borderRadius: 9999, padding: '6px 12px',
            fontSize: 12, fontWeight: 800, color: 'var(--slot-current-fg)',
          }}
        >
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--route-solid-campus)', display: 'inline-block' }} />
          {isLastBus ? '最終便' : `残り${remaining}本`}
        </span>
      </div>

      <div className="flex items-center justify-between gap-[14px] mt-3">
        <div className="min-w-0">
          <p
            className={`${fs} font-black leading-none`}
            style={{ margin: 0, color: 'var(--next-time-fg)', letterSpacing: '-2.6px' }}
          >
            {next.entry.departure}
          </p>
          <p style={{ margin: '9px 0 0', fontSize: 20, fontWeight: 800, color: 'var(--route-toggle-inactive-fg)', letterSpacing: '-.3px' }}>
            {waitLabel}
          </p>
        </div>

        {/* 円形ゲージ。残り時間に応じて conic-gradient の角度を更新する
            （改修たたき台と同じく 12 時位置から時計回り）。 */}
        <div
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: 104, height: 104, borderRadius: '50%',
            background: `conic-gradient(var(--route-solid-campus) 0deg ${gaugeDeg}deg, var(--gauge-track) ${gaugeDeg}deg 360deg)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 80, height: 80, borderRadius: '50%', background: 'var(--bg-card)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 34, fontWeight: 900, color: 'var(--next-time-fg)', lineHeight: 1, letterSpacing: '-1.5px' }}>
              {next.minutesUntil}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--next-gauge-sub-fg)', marginTop: 2 }}>分後</span>
          </div>
        </div>
      </div>
    </div>
  )
}
