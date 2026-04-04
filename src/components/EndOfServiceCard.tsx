import type { ScheduleEntry } from '../types/timetable'

interface Props {
  tomorrowFirstBus: ScheduleEntry | null
  tomorrowTimetableName?: string
}

export function EndOfServiceCard({ tomorrowFirstBus, tomorrowTimetableName }: Props) {
  return (
    <div
      className="rounded-[22px] px-6 py-[22px] text-white"
      style={{ background: 'linear-gradient(135deg, #374151, #4b5563)' }}
    >
      <p className="text-[13px] font-bold tracking-widest uppercase text-white/75 mb-[5px]">
        次のバス
      </p>
      <p className="text-[60px] font-black text-white tracking-tight leading-none mb-[7px]">
        --:--
      </p>
      <p className="text-[17px] text-white/90 font-semibold mb-4">
        本日の運行は終了しました
      </p>

      {tomorrowFirstBus && (
        <div className="bg-white/15 rounded-[16px] p-4">
          <p className="text-[10px] font-bold tracking-widest uppercase text-white/60 mb-1">
            明日の始発
          </p>
          {tomorrowTimetableName && (
            <p className="text-[11px] text-white/50 mb-1">{tomorrowTimetableName}</p>
          )}
          <p className="text-[38px] font-black text-white tracking-tight leading-none">
            {tomorrowFirstBus.departure}
          </p>
          {tomorrowFirstBus.note && (
            <p className="text-[13px] text-white/70 mt-1">{tomorrowFirstBus.note}</p>
          )}
        </div>
      )}
    </div>
  )
}
