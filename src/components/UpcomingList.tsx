import type { ScheduleEntry, FontSize } from '../types/timetable'
import { parseHHmmToMinutes } from '../utils/parseTime'
import { formatWaitLabel, formatDiffLabel } from '../utils/findNextBus'
import { BellIcon } from './BellIcon'

interface Props {
  /**
   * 先頭が次発（NextBusCard と同じ便）、以降が続く便。
   * 改修たたき台の `tl` は5件だが、ユーザー指示によりアプリでは4件（次発+3件）に減らしている。
   */
  buses: ScheduleEntry[]
  nowMinutes: number
  fontSize: FontSize
  /**
   * 発車前の通知を設定済みの便（"HH:mm"）。ベル印を付ける。
   * 改修たたき台の静的モックには無いが、実用機能として残す（ターン2チャットでの確定指示）。
   */
  marked?: ReadonlySet<string>
}

const FONT_SIZE_MAP: Record<FontSize, number> = {
  small:  19,
  medium: 22,
  large:  26,
}

/**
 * 「今後の発車時刻」タイムライン（改修たたき台 1a）。
 * 先頭行は次発（NextBusCard と同じ便）を大きいルート色のドットで強調し、
 * 以降の便は小さいグレーのドットでつなぐ。見出しは呼び出し側（App.tsx）が持つ。
 */
export function UpcomingList({ buses, nowMinutes, fontSize, marked }: Props) {
  if (buses.length === 0) return null

  const timeSize = FONT_SIZE_MAP[fontSize]

  return (
    <div style={{ position: 'relative', paddingLeft: 2 }}>
      {buses.map((bus, i) => {
        const depMin = parseHHmmToMinutes(bus.departure)
        if (depMin === null) return null
        const diff = depMin - nowMinutes
        const isNext = i === 0
        const isLastRow = i === buses.length - 1

        return (
          <div key={bus.departure + i} style={{ display: 'flex', alignItems: 'stretch', gap: 16 }}>
            {/* ドット + 縦線の列 */}
            <div style={{ width: 16, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: 2, height: 19, background: isNext ? 'transparent' : 'var(--timeline-line)', flexShrink: 0, marginBottom: 3 }} />
              <span
                style={{
                  width: isNext ? 14 : 11, height: isNext ? 14 : 11, borderRadius: '50%', flexShrink: 0,
                  // 次発ドットはルート色。以前は --tab-active-fg を読んでいたが、
                  // あれはタブバーの選択色であって次発の色ではない（タブバーが
                  // 色を持たなくなった時点で意味が合わなくなる）
                  background: isNext ? 'var(--route-solid)' : 'var(--timeline-dot)',
                }}
              />
              <span style={{ flex: 1, width: 2, background: isLastRow ? 'transparent' : 'var(--timeline-line)', marginTop: 3 }} />
            </div>

            <div
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, padding: '11px 0', borderBottom: '1px solid var(--row-card-border)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: timeSize, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-.6px' }}>
                  {bus.departure}
                </p>
                {marked?.has(bus.departure) && (
                  <span role="img" aria-label="発車前の通知を設定済み" style={{ color: 'var(--route-accent-fg)', display: 'flex' }}>
                    <BellIcon width={12} height={12} />
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap', borderRadius: 9999, padding: '7px 12px',
                  color: isNext ? 'var(--slot-current-fg)' : 'var(--text-secondary)',
                  background: isNext ? 'var(--slot-current-bg)' : 'var(--past-bg)',
                }}
              >
                {isNext ? formatWaitLabel(diff) : formatDiffLabel(diff)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
