import type { NextBusInfo, RouteKey } from '../types/timetable'
import type { FontSize } from '../types/timetable'

interface Props {
  next: NextBusInfo | null
  route: RouteKey
  fontSize: FontSize
  /** 本日の残り運行本数（次発を含む）。next が null のときは未使用 */
  remaining: number
}

const FONT_SIZE_MAP: Record<FontSize, { time: string; text: string }> = {
  small:  { time: 'text-5xl', text: 'text-xl' },
  medium: { time: 'text-[60px]', text: 'text-[26px]' },
  large:  { time: 'text-7xl', text: 'text-[31px]' },
}

export function NextBusCard({ next, route, fontSize, remaining }: Props) {
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
        <p className="text-[13px] font-bold tracking-widest uppercase text-white/75 mb-2">
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

  // remaining === 1 のとき、次発が本日の最終便
  const isLastBus = remaining === 1

  return (
    <div className={`${gradientClass} rounded-[22px] px-6 py-[22px] text-white relative overflow-hidden`}>
      <Decoration />

      {/* 見出し行: 左「次のバス」／右に本日の残数バッジ */}
      <div className="flex items-center justify-between mb-[5px]">
        <p className="text-[13px] font-bold tracking-widest uppercase text-white/75">
          次のバス
        </p>
        <span className="inline-flex items-center gap-1.5 bg-white/20 dark:bg-black/25 rounded-full px-[13px] py-[5px] text-[14px] font-extrabold whitespace-nowrap">
          <BusIcon />
          {isLastBus ? '最終便' : `残り${remaining}本`}
        </span>
      </div>

      {/* 発車時刻（「最終」ピルは右上バッジと重複するため表示しない） */}
      <p className={`${fs.time} font-black text-white tracking-tight leading-none mb-[7px]`}>
        {next.entry.departure}
      </p>

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

function BusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="11" rx="2.5" />
      <path d="M3 11h18" />
      <circle cx="7.5" cy="18.5" r="1.4" />
      <circle cx="16.5" cy="18.5" r="1.4" />
    </svg>
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
