import type { DiagramType } from '../types/timetable'

// 種別の判定そのものは UI から独立した純関数として utils にある（server/ とも共有する）。
// 既存の import 元を壊さないよう、ここから再エクスポートする。
export { resolveDiagramType } from '../utils/diagramType'

interface Props {
  type: DiagramType
}

/**
 * バッジの配色。
 *
 * **不透明かつ濃色**にしてある。以前は半透明（alpha 0.82〜0.9）で、白面へ合成すると
 * 13px の白文字に対して 1.78〜3.66:1 しかなく、WCAG AA の通常文字 4.5:1 を全種別で
 * 割っていた（13px bold は large text の基準にも届かない）。合成後の値は面の色に
 * 依存するため、面が 2 種類（--bg-card / --bg-card2）あることも安定しない原因だった。
 *
 * 実測（白文字に対する比。ライト・ダーク共通で面に依存しない）:
 *   weekday 6.70 / holiday 6.47 / vacation 4.92 / vacation_holiday 6.85 /
 *   event 5.18 / closed 7.56 / special 6.98
 *
 * 配色を変えるときは、必ずこの比を測り直して 4.5:1 以上を保つこと。
 * 詳細は docs/design-decisions.md の「色のコントラスト」を参照。
 */
const BADGE_MAP: Record<DiagramType, { label: string; bg: string; color: string }> = {
  weekday:          { label: '授業日ダイヤ',          bg: '#1d4ed8', color: '#fff' },
  holiday:          { label: '休業日ダイヤ',          bg: '#b91c1c', color: '#fff' },
  vacation:         { label: '長期休暇ダイヤ',        bg: '#a16207', color: '#fff' },
  vacation_weekday: { label: '長期休暇ダイヤ（平日）', bg: '#a16207', color: '#fff' },
  vacation_holiday: { label: '長期休暇ダイヤ（休日）', bg: '#854d0e', color: '#fff' },
  event:            { label: 'イベント日ダイヤ',       bg: '#c2410c', color: '#fff' },
  closed:           { label: '運休日',                bg: '#4b5563', color: '#fff' },
  special:          { label: '特別ダイヤ',            bg: '#7e22ce', color: '#fff' },
}

/**
 * ダイヤ種別の代表色を返す。
 *
 * バッジ以外の表現（週間ダイヤの帯の色分けなど）から参照する用。BADGE_MAP を
 * 唯一の定義元にしておくことで、色を写し取った第二の定義が生まれないようにする。
 *
 * 参照先（WeekStrip の 5px の帯）は文字を載せない装飾なので、文字コントラストの
 * 要件は掛からない。種別の識別は同じ行の日付・曜日とバッジ本体が担う。
 */
export function badgeColor(type: DiagramType): string {
  return BADGE_MAP[type].bg
}

export function DayBadge({ type }: Props) {
  const { label, bg, color } = BADGE_MAP[type]
  return (
    <span
      className="text-[13px] font-bold px-[9px] py-[3px] rounded-[20px] flex items-center gap-1"
      style={{ background: bg, color }}
    >
      <span style={{ fontSize: '7px' }}>●</span>
      {label}
    </span>
  )
}
