import type { ScheduleEntry, RouteKey } from '../types/timetable'
import { parseHHmmToMinutes } from '../utils/parseTime'
import { BellIcon } from './BellIcon'

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
  // 選択モードの塗り。次発ハイライト（activeBg/activeText の淡い塗り）より強い単色塗りで
  // 「選択済み」を表すための専用色。値は --route-tint-campus-fg / --route-tint-station-fg の
  // ライト値と同一（白文字でそれぞれ 7.68:1 / 6.29:1、実測済み）を流用しており、
  // テーマに関わらず一定にする（ヘッダーのルートグラデーションと同じ方針）。
  const selectedBg = isCampus ? '#065f46' : '#4f46e5'
  const selectedRing = isCampus ? 'rgba(6,95,70,.35)' : 'rgba(79,70,229,.35)'

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
          ? selectedBg
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
                className="absolute"
                style={{ top: -3, right: -2, color: 'var(--accent-fg)' }}
              >
                <BellIcon width={10} height={10} />
              </span>
            )}
          </>
        )

        const boxClass = 'relative py-2 px-1 rounded-[10px] text-center'
        // 選択モードのマスはタップ操作なので高さ44px以上を確保する（備考ラベル・ベル印は
        // 絶対配置のためフレックスの外に出て、この変更の影響を受けない）
        const selectableBoxClass = 'relative min-h-[44px] px-1 rounded-[10px] text-center flex flex-col items-center justify-center'

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
              className={selectableBoxClass}
              style={{
                background,
                border: 'none',
                font: 'inherit',
                cursor: selectable ? 'pointer' : 'default',
                opacity: selectable ? 1 : 0.45,
                boxShadow: isSelected ? `0 0 0 2px ${selectedRing}` : 'none',
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
