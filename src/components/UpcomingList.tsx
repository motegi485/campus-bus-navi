import type { ScheduleEntry, RouteKey, FontSize } from '../types/timetable'

interface Props {
  buses: ScheduleEntry[]
  route: RouteKey
  nowMinutes: number
  fontSize: FontSize
}

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small:  'text-xl',
  medium: 'text-[26px]',
  large:  'text-[31px]',
}

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function formatDiff(diff: number): string {
  if (diff >= 60) {
    const h = Math.floor(diff / 60)
    const m = diff % 60
    return m === 0 ? `${h}時間後` : `${h}時間 ${m}分後`
  }
  return `${diff}分後`
}

export function UpcomingList({ buses, route, nowMinutes, fontSize }: Props) {
  if (buses.length === 0) return null

  const isCampus = route === 'campus_to_station'
  const badgeClass = isCampus
    ? 'bg-emerald-100 text-emerald-800'
    : 'bg-violet-100 text-violet-800'
  const diffColor = isCampus ? 'text-emerald-500' : 'text-violet-500'
  const fs = FONT_SIZE_MAP[fontSize]

  return (
    <div className="bg-[var(--bg-card)] rounded-[20px] p-[18px] transition-[background] duration-300">
      <p className="text-[11px] text-[var(--text-muted)] font-bold mb-3 tracking-widest uppercase">
        今後の発車時刻
      </p>
      <div className="flex flex-col">
        {buses.map((bus, i) => {
          const diff = toMin(bus.departure) - nowMinutes
          return (
            <div
              key={bus.departure + i}
              className="flex items-center justify-between py-3 border-b border-[var(--border)] last:border-none last:pb-0"
            >
              <div className="flex items-center gap-[10px]">
                <span className={`${fs} font-bold text-[var(--text-primary)] tracking-tight transition-[font-size] duration-200`}>
                  {bus.departure}
                </span>
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
