import { useEffect, useRef, type CSSProperties } from 'react'
import type { NextBusInfo } from '../types/timetable'
import { BellIcon } from './BellIcon'
import { formatWaitLabel, formatGaugeCenter } from '../utils/findNextBus'
import { fs } from '../utils/fontScale'

interface Props {
  next: NextBusInfo
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

/**
 * 円形ゲージが減り始める上限（分）。
 * ゲージは「前便の発車〜次発の発車」の実間隔（headwayMinutes）を満タンとして
 * 残り時間の割合を塗るが、間隔がこれより長い便（休業日ダイヤの 80〜155 分など）は
 * 残り 60 分以上のあいだ満タンのまま止まり、59 分から減り始める。
 * 始発（前便なし）は間隔が定義できないので、同じくこの値を満タン基準にする。
 * 中央の数字が 60 分以上で「N時間」表示に切り替わるのと境界を揃えている。
 */
const GAUGE_CAP_MINUTES = 60

export function NextBusCard({ remaining, next, reminded = false }: Props) {
  // remaining === 1 のとき、次発が本日の最終便
  const isLastBus = remaining === 1

  const gaugeMax = Math.min(next.headwayMinutes ?? GAUGE_CAP_MINUTES, GAUGE_CAP_MINUTES)
  const fraction = Math.max(0, Math.min(1, next.minutesUntil / gaugeMax))
  const gaugeDeg = Math.round(fraction * 360)

  // 毎分の 1 目盛ぶんの減少だけを CSS transition で滑らかに動かす。
  // 便の切替（0→満タン）、バックグラウンド復帰で数分飛ぶ、ルート切替は即時に描く
  // （巻き戻しや高速回転に見せないため）。前回の描画を ref に持ち、同じ便で
  // 1.5 目盛以内の減少のときだけアニメ対象とする。
  const prevGauge = useRef<{ departure: string; deg: number } | null>(null)
  const prev = prevGauge.current
  const stepDeg = 360 / gaugeMax
  const drop = prev ? prev.deg - gaugeDeg : 0
  const animate =
    prev !== null &&
    prev.departure === next.entry.departure &&
    drop > 0 &&
    drop <= stepDeg * 1.5
  useEffect(() => {
    prevGauge.current = { departure: next.entry.departure, deg: gaugeDeg }
  })

  const waitLabel = formatWaitLabel(next.minutesUntil)
  const center = formatGaugeCenter(next.minutesUntil)

  return (
    <div style={{ borderRadius: 22, background: 'var(--next-card-bg)', padding: '16px 18px' }}>
      {/* 見出し行: 左「次のバス」（＋通知の印）／右に本日の残数バッジ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <p style={{ margin: 0, fontSize: fs(15), fontWeight: 800, letterSpacing: '.06em', color: 'var(--slot-current-fg)' }}>
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
                fontSize: fs(11), fontWeight: 800,
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
            fontSize: fs(12), fontWeight: 800, color: 'var(--slot-current-fg)',
          }}
        >
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--route-solid)', display: 'inline-block' }} />
          {isLastBus ? '最終便' : `残り${remaining}本`}
        </span>
      </div>

      <div className="flex items-center justify-between gap-[14px] mt-3">
        <div className="min-w-0">
          <p
            className="font-black leading-none"
            style={{ margin: 0, fontSize: fs(52), color: 'var(--next-time-fg)', letterSpacing: '-2.6px' }}
          >
            {next.entry.departure}
          </p>
          <p style={{ margin: '9px 0 0', fontSize: fs(20), fontWeight: 800, color: 'var(--route-toggle-inactive-fg)', letterSpacing: '-.3px' }}>
            {waitLabel}
          </p>
        </div>

        {/* 円形ゲージ。残り時間の割合を --gauge-deg に渡し、conic-gradient の塗りと
            transition は index.css の .next-gauge 側で持つ
            （改修たたき台と同じく 12 時位置から時計回り）。 */}
        <div
          aria-hidden="true"
          className={animate ? 'next-gauge' : 'next-gauge next-gauge-jump'}
          style={{
            flexShrink: 0,
            width: fs(104), height: fs(104), borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            '--gauge-deg': `${gaugeDeg}deg`,
          } as CSSProperties}
        >
          <div
            style={{
              width: fs(80), height: fs(80), borderRadius: '50%', background: 'var(--bg-card)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {/* 中央の 2 行。60 分以上は「1時間 / 30分後」のように時間・分へ分け、
                下の「あと1時間30分」と語を揃える（formatGaugeCenter）。
                端数ありの時間表示だけ数字を一回り小さくして単位「時間」を添える。 */}
            {center.primaryUnit ? (
              <span style={{ fontSize: fs(28), fontWeight: 900, color: 'var(--next-time-fg)', lineHeight: 1, letterSpacing: '-1px', whiteSpace: 'nowrap' }}>
                {center.primary}
                <span style={{ fontSize: fs(13), fontWeight: 800, letterSpacing: 0, marginLeft: 1 }}>{center.primaryUnit}</span>
              </span>
            ) : (
              <span style={{ fontSize: fs(34), fontWeight: 900, color: 'var(--next-time-fg)', lineHeight: 1, letterSpacing: '-1.5px' }}>
                {center.primary}
              </span>
            )}
            <span style={{ fontSize: fs(11.5), fontWeight: 700, color: 'var(--next-gauge-sub-fg)', marginTop: 2, whiteSpace: 'nowrap' }}>
              {center.unit}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
