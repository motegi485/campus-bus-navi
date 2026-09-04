import type { ScheduleEntry, RouteKey, FontSize } from '../types/timetable'
import { parseHHmmToMinutes } from '../utils/parseTime'
import { BellIcon } from './BellIcon'

interface Props {
  buses: ScheduleEntry[]
  route: RouteKey
  nowMinutes: number
  fontSize: FontSize
  /**
   * 発車前の通知を設定済みの便（"HH:mm"）。ベル印を付ける。
   * 未指定なら従来どおり印を出さない（週間ダイヤなど当日以外の文脈で使えるようにするため）。
   */
  marked?: ReadonlySet<string>
}

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small:  'text-xl',
  medium: 'text-[26px]',
  large:  'text-[31px]',
}

function formatDiff(diff: number): string {
  if (diff >= 60) {
    const h = Math.floor(diff / 60)
    const m = diff % 60
    return m === 0 ? `${h}時間後` : `${h}時間 ${m}分後`
  }
  return `${diff}分後`
}

export function UpcomingList({ buses, route, nowMinutes, fontSize, marked }: Props) {
  if (buses.length === 0) return null

  const isCampus = route === 'campus_to_station'
  const badgeClass = isCampus
    ? 'bg-[var(--route-tint-campus-bg)] text-[var(--route-tint-campus-fg)]'
    : 'bg-[var(--route-tint-station-bg)] text-[var(--route-tint-station-fg)]'
  const diffColor = isCampus
    ? 'text-[var(--route-tint-campus-fg)]'
    : 'text-[var(--route-tint-station-fg)]'
  const fs = FONT_SIZE_MAP[fontSize]

  return (
    <div className="section-card rounded-[20px]" style={{ padding: 'var(--card-pad-list)' }}>
      <p className="text-[11px] text-[var(--text-muted)] font-bold mb-3 tracking-widest uppercase">
        今後の発車時刻
      </p>
      <div className="flex flex-col">
        {buses.map((bus, i) => {
          const depMin = parseHHmmToMinutes(bus.departure)
          if (depMin === null) return null
          const diff = depMin - nowMinutes
          return (
            <div
              key={bus.departure + i}
              className="flex items-center justify-between py-3 border-b border-[var(--border)] last:border-none last:pb-0"
            >
              <div className="flex items-center gap-[10px]">
                <span className={`${fs} font-bold text-[var(--text-primary)] tracking-tight transition-[font-size] duration-200`}>
                  {bus.departure}
                </span>
                {/* 通知を設定済みの印。次のバスカード・全時刻表と同じベルで揃える */}
                {marked?.has(bus.departure) && (
                  <span role="img" aria-label="発車前の通知を設定済み" className="leading-none" style={{ color: 'var(--accent-fg)' }}>
                    <BellIcon width={12} height={12} />
                  </span>
                )}
                {bus.note && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-[7px] font-bold ${badgeClass}`}>
                    {bus.note}
                  </span>
                )}
              </div>
              <span className={`text-[13px] font-bold ${diffColor}`}>
                {formatDiff(diff)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
