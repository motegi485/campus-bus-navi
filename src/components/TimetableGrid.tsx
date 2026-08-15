import type { ScheduleEntry, RouteKey } from '../types/timetable'
import { parseHHmmToMinutes } from '../utils/parseTime'

interface Props {
  schedule: ScheduleEntry[]
  route: RouteKey
  /** ハイライトする便の発車時刻（次発）。未指定ならハイライトしない */
  currentDeparture?: string
  /**
   * 過去判定の基準（0時からの分）。
   * null は「この時刻表は今日のものではない」の意味で、過去のグレーアウトを行わない。
   * 週間ダイヤの日別ビューが当日以外を描くときに使う。
   */
  nowMinutes: number | null
}

/**
 * 発車時刻のグリッド。
 *
 * ホームの「本日の全時刻表」（FullTimetable）と、週間ダイヤの日別ビューが共用する。
 * 見出しや開閉トグルは持たず、時刻の並びだけを担当する。
 */
export function TimetableGrid({ schedule, route, currentDeparture, nowMinutes }: Props) {
  const isCampus = route === 'campus_to_station'
  const activeBg = isCampus ? '#d1fae5' : '#ede9fe'
  const activeText = isCampus ? '#065f46' : '#4f46e5'

  return (
    <div className="grid grid-cols-3 bp:grid-cols-6 gap-[7px]">
      {schedule.map((bus, i) => {
        const depMin = parseHHmmToMinutes(bus.departure)
        // 不正な departure はパース失敗 → 過去扱いせずグレー（中立）で表示
        const isPast = nowMinutes !== null && depMin !== null && depMin <= nowMinutes
        const isCurrent = bus.departure === currentDeparture
        return (
          <div
            key={bus.departure + i}
            className="py-2 px-1 rounded-[10px] text-center"
            style={{
              background: isCurrent
                ? activeBg
                : isPast
                ? 'var(--past-bg)'
                : 'var(--bg-card2)',
            }}
          >
            <p
              className="text-[14px] font-bold"
              style={{
                color: isCurrent
                  ? activeText
                  : isPast
                  ? 'var(--past-text)'
                  : 'var(--text-primary)',
              }}
            >
              {bus.departure}
            </p>
            {bus.note && (
              <p
                className="text-[10px] mt-0.5"
                style={{ color: isCurrent ? activeText : 'var(--text-muted)' }}
              >
                {bus.note}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
