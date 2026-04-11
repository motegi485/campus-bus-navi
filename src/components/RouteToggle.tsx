import type { RouteKey } from '../types/timetable'

interface Props {
  route: RouteKey
  onChange: (route: RouteKey) => void
}

const OPTIONS: { key: RouteKey; label: string; icon: string }[] = [
  { key: 'campus_to_station', label: '大学発', icon: '' },
  { key: 'station_to_campus', label: '松永発', icon: '' },
]

export function RouteToggle({ route, onChange }: Props) {
  return (
    <div className="flex bg-white/20 rounded-[13px] p-[3px] gap-[2px] mt-4 md:w-[64%] md:mx-auto">
      {OPTIONS.map((opt) => {
        const active = route === opt.key
        const colorClass = opt.key === 'campus_to_station'
          ? 'text-emerald-600'
          : 'text-indigo-600'
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={[
              'flex-1 rounded-[10px] py-[9px] px-[6px] flex items-center justify-center gap-[5px]',
              'text-[13px] font-semibold transition-all duration-200 select-none',
              active ? 'bg-white shadow-md' : 'text-white/70',
            ].join(' ')}
          >
            <span className="text-[14px] leading-none pointer-events-none">{opt.icon}</span>
            <span className={[
              'font-bold text-[13px] pointer-events-none',
              active ? colorClass : '',
            ].join(' ')}>
              {opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
