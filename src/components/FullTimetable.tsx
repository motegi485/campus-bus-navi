import { useState } from 'react'
import type { ScheduleEntry, RouteKey } from '../types/timetable'

interface Props {
  schedule: ScheduleEntry[]
  route: RouteKey
  currentDeparture?: string
  nowMinutes: number
}

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function FullTimetable({ schedule, route, currentDeparture, nowMinutes }: Props) {
  const [open, setOpen] = useState(false)

  const isCampus = route === 'campus_to_station'
  const activeBg = isCampus ? '#d1fae5' : '#ede9fe'
  const activeText = isCampus ? '#065f46' : '#4f46e5'

  return (
    <div className="bg-[var(--bg-card)] rounded-[20px] p-[18px] transition-[background] duration-300">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between select-none"
      >
        <span className="text-[11px] text-[var(--text-muted)] font-bold tracking-widest uppercase">
          本日の全時刻表
        </span>
        <div className="flex items-center gap-1 bg-[var(--bg-input)] rounded-[20px] px-[10px] py-1 text-[12px] font-semibold text-[var(--text-secondary)]">
          <svg
            className="text-[9px]"
            style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform 0.22s', width: '9px', height: '9px' }}
            fill="currentColor"
            viewBox="0 0 10 6"
          >
            <path d="M0 0l5 6 5-6z" />
          </svg>
          <span>{open ? '閉じる' : '表示する'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-[7px]">
          {schedule.map((bus, i) => {
            const isPast = toMin(bus.departure) <= nowMinutes
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
      )}
    </div>
  )
}
