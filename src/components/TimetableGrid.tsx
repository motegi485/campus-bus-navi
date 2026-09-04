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
  /**
   * 通知を設定済みの便（"HH:mm"）。ベル印を付ける。
   * 以下 3 つの prop は未指定なら従来どおりの描画になる。週間ダイヤの日別ビューは
   * 渡さないので、この機能の追加による影響を受けない。
   */
  marked?: ReadonlySet<string>
  /** 選択モード。マスがタップ可能になり、選択中の便が塗られる */
  selectMode?: boolean
  /** 選択モードで選ばれている便 */
  selected?: ReadonlySet<string>
  /** マスのタップ。選択モードのときだけ呼ばれる */
  onToggle?: (departure: string) => void
}

/**
 * 発車時刻のグリッド。
 *
 * ホームの「本日の全時刻表」（FullTimetable）と、週間ダイヤの日別ビューが共用する。
 * 見出しや開閉トグルは持たず、時刻の並びだけを担当する。
 */
export function TimetableGrid({
  schedule,
  route,
  currentDeparture,
  nowMinutes,
  marked,
  selectMode = false,
  selected,
  onToggle,
}: Props) {
  const isCampus = route === 'campus_to_station'
  const activeBg = isCampus ? 'var(--route-tint-campus-bg)' : 'var(--route-tint-station-bg)'
  const activeText = isCampus ? 'var(--route-tint-campus-fg)' : 'var(--route-tint-station-fg)'

  return (
    <div className="grid grid-cols-3 bp:grid-cols-6 gap-[7px]">
      {schedule.map((bus, i) => {
        const depMin = parseHHmmToMinutes(bus.departure)
        // 不正な departure はパース失敗 → 過去扱いせずグレー（中立）で表示
        const isPast = nowMinutes !== null && depMin !== null && depMin <= nowMinutes
        const isCurrent = bus.departure === currentDeparture
        const isMarked = marked?.has(bus.departure) ?? false
        const isSelected = selectMode && (selected?.has(bus.departure) ?? false)
        // 過ぎた便には通知を設定できない
        const selectable = selectMode && !isPast && depMin !== null

        const background = isSelected
          ? '#0d9966'
          : isCurrent
          ? activeBg
          : isPast
          ? 'var(--past-bg)'
          : 'var(--bg-card2)'
        const color = isSelected
          ? '#ffffff'
          : isCurrent
          ? activeText
          : isPast
          ? 'var(--past-text)'
          : 'var(--text-primary)'

        const content = (
          <>
            <p className="text-[14px] font-bold" style={{ color }}>
              {bus.departure}
            </p>
            {/*
              備考（現状は「最終」のみ）。行として下に積むとそのマスだけ縦に伸び、
              最下段だけ高さが違って見えるため、高さに影響しない小さなラベルとして
              左上の角に重ねる。
            */}
            {bus.note && (
              <span
                className="absolute top-[3px] left-[4px] px-[3px] py-[1px] rounded-[4px] text-[9px] font-bold leading-none"
                style={{
                  color: isSelected || isCurrent ? color : 'var(--text-muted)',
                  background: isSelected || isCurrent ? 'transparent' : 'var(--bg-input)',
                }}
              >
                {bus.note}
              </span>
            )}
            {/* 通知を設定済みの印。選択モード中は選択状態のほうが情報として新しいので出さない */}
            {isMarked && !selectMode && (
              <span
                aria-hidden="true"
                className="absolute text-[10px]"
                style={{ top: -4, right: -2 }}
              >
                🔔
              </span>
            )}
          </>
        )

        const boxClass = 'relative py-2 px-1 rounded-[10px] text-center'

        // 選択モードのときだけボタンにする。通常時は従来どおり div のままで、
        // 時刻表を読むだけの指が誤って予定を作らないようにする
        if (selectMode) {
          return (
            <button
              key={bus.departure + i}
              type="button"
              disabled={!selectable}
              onClick={() => selectable && onToggle?.(bus.departure)}
              aria-pressed={isSelected}
              aria-label={`${bus.departure} 発${isSelected ? '（通知を設定）' : ''}`}
              className={boxClass}
              style={{
                background,
                border: 'none',
                font: 'inherit',
                cursor: selectable ? 'pointer' : 'default',
                opacity: selectable ? 1 : 0.45,
                boxShadow: isSelected ? '0 0 0 2px rgba(13,153,102,.35)' : 'none',
              }}
            >
              {content}
            </button>
          )
        }

        return (
          <div key={bus.departure + i} className={boxClass} style={{ background }}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
