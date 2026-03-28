import type { NextBusInfo, RouteKey } from '../types/timetable'
import type { FontSize } from '../types/timetable'

interface Props {
  next: NextBusInfo | null
  route: RouteKey
  fontSize: FontSize
}

const FONT_SIZE_MAP: Record<FontSize, { time: string; text: string }> = {
  small:  { time: 'text-5xl', text: 'text-xl' },
  medium: { time: 'text-[60px]', text: 'text-[26px]' },
  large:  { time: 'text-7xl', text: 'text-[31px]' },
}

export function NextBusCard({ next, route, fontSize }: Props) {
  const isCampus = route === 'campus_to_station'
  const gradientClass = isCampus
    ? 'bg-gradient-to-br from-[#0d9966] to-[#34d399]'
    : 'bg-gradient-to-br from-[#6c63d5] to-[#a78bfa]'
  const endedGradient = 'linear-gradient(135deg, #374151, #4b5563)'

  const fs = FONT_SIZE_MAP[fontSize]

  if (!next) {
    return (
      <div
        className="rounded-[22px] px-6 py-[22px] text-white relative overflow-hidden"
        style={{ background: endedGradient }}
      >
        <Decoration />
        <p className="text-[11px] font-bold tracking-widest uppercase text-white/75 mb-2">
          次のバス
        </p>
        <p className={`${fs.time} font-black text-white tracking-tight leading-none mb-2`}>
          --:--
        </p>
        <p className="text-[17px] text-white/90 font-semibold">
          <b className="font-black text-white text-[22px]">本日の運行は終了しました</b>
        </p>
      </div>
    )
  }

  return (
    <div className={`${gradientClass} rounded-[22px] px-6 py-[22px] text-white relative overflow-hidden`}>
      <Decoration />
      <p className="text-[11px] font-bold tracking-widest uppercase text-white/75 mb-[5px]">
        次のバス
      </p>
      <div className="flex items-baseline gap-3 mb-[7px]">
        <p className={`${fs.time} font-black text-white tracking-tight leading-none`}>
          {next.entry.departure}
        </p>
        {next.entry.note && (
          <span className="text-sm text-white/80 bg-white/20 px-2 py-0.5 rounded-lg font-bold">
            {next.entry.note}
          </span>
        )}
      </div>
      <p className="text-[17px] text-white/90 font-medium">
        {next.minutesUntil >= 60 ? (
          <>
            あと{' '}
            <b className="font-black text-white text-[22px]">{Math.floor(next.minutesUntil / 60)}</b>
            {' '}時間{' '}
            {next.minutesUntil % 60 > 0 && (
              <>
                <b className="font-black text-white text-[22px]">{next.minutesUntil % 60}</b>
                {' '}分
              </>
            )}
          </>
        ) : (
          <>
            あと{' '}
            <b className="font-black text-white text-[22px]">{next.minutesUntil}</b>
            {' '}分
          </>
        )}
      </p>
    </div>
  )
}

function Decoration() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        right: '-24px',
        top: '-24px',
        width: '120px',
        height: '120px',
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.09)',
      }}
    />
  )
}
