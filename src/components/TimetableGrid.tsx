import type { ScheduleEntry } from '../types/timetable'
import { parseHHmmToMinutes } from '../utils/parseTime'
import { BellIcon } from './BellIcon'

interface Props {
  schedule: ScheduleEntry[]
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
  /**
   * 未来便セルの背景色。既定は --bg-card2（週間ダイヤの日別ビューが白い
   * .section-card の上に直接置くため）。全時刻表シートは改修デザイン（§20 C1）
   * どおり --bg-card（白）を渡す。地も白なので、輪郭は --row-card-border の
   * 1px（下の border）が作る。
   */
  futureBg?: string
}

/**
 * 発車時刻のグリッド。
 *
 * ホームの「本日の全時刻表」（FullTimetableSheet）と、週間ダイヤの日別ビューが共用する。
 * 見出しや開閉トグルは持たず、時刻の並びだけを担当する。
 *
 * ルートは prop で受け取らない。現在便のハイライトも選択セルの塗りもルート色だが、
 * どちらも index.css の [data-route] が切り替えるトークン経由で届く（App.tsx が
 * アプリシェルに data-route を付けている）。ここで route を分岐すると二重管理になる。
 */
export function TimetableGrid({
  schedule,
  currentDeparture,
  nowMinutes,
  marked,
  selectMode = false,
  selected,
  onToggle,
  futureBg = 'var(--bg-card2)',
}: Props) {
  const activeBg = 'var(--slot-current-bg)'
  const activeText = 'var(--slot-current-fg)'
  // 選択セルは白文字を載せる塗りなので、テーマで反転しないトークンを使う
  const selectedBg = 'var(--route-selected-bg)'
  const selectedRing = 'var(--route-selected-ring)'

  return (
    <div className="grid grid-cols-3 gap-[7px]">
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
          : futureBg
        const color = isSelected
          ? '#ffffff'
          : isCurrent
          ? activeText
          : isPast
          ? 'var(--past-text)'
          : 'var(--text-primary)'
        const border = isSelected
          ? 'none'
          : `1px solid ${isCurrent ? activeBg : isPast ? 'var(--past-bg)' : 'var(--row-card-border)'}`
        // 現在便だけルート色のリングを足す（過去/未来と混同しないための2つ目の手掛かり）
        const ring = isCurrent && !isSelected ? '0 0 0 1.5px var(--route-solid)' : 'none'

        const content = (
          <>
            <span className="text-[calc(16px*var(--font-scale))] font-extrabold" style={{ color, letterSpacing: '-.3px' }}>
              {bus.departure}
            </span>
            {/*
              備考（現状は「最終」のみ）。行として下に積むとそのマスだけ縦に伸び、
              最下段だけ高さが違って見えるため、高さに影響しない小さなラベルとして
              左上の角に重ねる（改修たたき台どおり、地色を持たない素のラベル）。
            */}
            {bus.note && (
              <span
                className="absolute top-[3px] left-[5px] text-[calc(9px*var(--font-scale))] font-bold leading-none"
                style={{ color: 'var(--text-muted)' }}
              >
                {bus.note}
              </span>
            )}
            {/* 通知を設定済みの印。選択モード中は選択状態のほうが情報として新しいので出さない。
                以前は 10px をマスの角の外側（top:-3 / right:-2）に掛けていたが、小さすぎて
                見落とされたため、マスの内側の右上に 14px で置く（備考ラベルは左上なので重ならない） */}
            {isMarked && !selectMode && (
              <span
                aria-hidden="true"
                className="absolute flex"
                style={{ top: 4, right: 6, color: 'var(--route-accent-fg)' }}
              >
                <BellIcon width={14} height={14} />
              </span>
            )}
          </>
        )

        const boxClass = 'relative rounded-[12px] flex items-center justify-center text-center'

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
                minHeight: 46,
                background,
                border,
                font: 'inherit',
                cursor: selectable ? 'pointer' : 'default',
                opacity: selectable ? 1 : 0.45,
                boxShadow: isSelected ? `0 0 0 2px ${selectedRing}` : ring,
              }}
            >
              {content}
            </button>
          )
        }

        return (
          <div key={bus.departure + i} className={boxClass} style={{ minHeight: 46, background, border, boxShadow: ring }}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
