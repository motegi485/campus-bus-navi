import { useState } from 'react'
import type { ScheduleEntry, RouteKey } from '../types/timetable'
import { parseHHmmToMinutes } from '../utils/parseTime'
import { usePressable } from '../hooks/usePressable'
import { tapFeedback } from '../utils/haptics'

interface Props {
  schedule: ScheduleEntry[]
  route: RouteKey
  currentDeparture?: string
  nowMinutes: number
}

export function FullTimetable({ schedule, route, currentDeparture, nowMinutes }: Props) {
  const [open, setOpen] = useState(false)
  // 早期 return より前に呼ぶ（フックの呼び出し順を固定するため）
  const { pressed, pressHandlers } = usePressable()

  if (schedule.length === 0) return null

  const isCampus = route === 'campus_to_station'
  const activeBg = isCampus ? '#d1fae5' : '#ede9fe'
  const activeText = isCampus ? '#065f46' : '#4f46e5'

  return (
    <div className="bg-[var(--bg-card)] rounded-[20px] p-[18px] transition-[background] duration-300">
      <button
        onClick={() => { tapFeedback(8); setOpen(v => !v) }}
        {...pressHandlers}
        className="w-full flex items-center justify-between select-none"
      >
        <span className="text-[11px] text-[var(--text-muted)] font-bold tracking-widest uppercase">
          本日の全時刻表
        </span>
        <div
          className="flex items-center gap-[5px] rounded-[20px] px-3 py-[6px] text-[12px] font-bold"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--chip-text)',
            border: '1px solid var(--chip-border)',
            boxShadow: pressed
              ? 'inset 0 1px 2px var(--chip-rim)'
              : 'inset 0 1px 0 var(--chip-highlight), 0 1.5px 0 var(--chip-rim), 0 2px 4px rgba(15,23,42,.10)',
            transform: pressed ? 'translateY(1px)' : 'translateY(0)',
            transition: 'transform .12s ease-out, box-shadow .12s ease-out',
          }}
        >
          <svg
            style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform 0.22s', width: 9, height: 9 }}
            fill="currentColor" viewBox="0 0 10 6" aria-hidden="true"
          >
            <path d="M0 0l5 6 5-6z" />
          </svg>
          <span>{open ? '閉じる' : '表示する'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-3 bp:grid-cols-6 gap-[7px]">
          {schedule.map((bus, i) => {
            const depMin = parseHHmmToMinutes(bus.departure)
            // 不正な departure はパース失敗 → 過去扱いせずグレー（中立）で表示
            const isPast = depMin !== null && depMin <= nowMinutes
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
