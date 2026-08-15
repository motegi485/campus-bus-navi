import type { DiagramType } from '../types/timetable'

// 種別の判定そのものは UI から独立した純関数として utils にある（server/ とも共有する）。
// 既存の import 元を壊さないよう、ここから再エクスポートする。
export { resolveDiagramType } from '../utils/diagramType'

interface Props {
  type: DiagramType
}

const BADGE_MAP: Record<DiagramType, { label: string; bg: string; color: string }> = {
  weekday:          { label: '授業日ダイヤ',          bg: 'rgba(59,130,246,0.82)', color: '#fff' },
  holiday:          { label: '休業日ダイヤ',          bg: 'rgba(239,68,68,0.82)',  color: '#fff' },
  vacation:         { label: '長期休暇ダイヤ',        bg: 'rgba(234,179,8,0.88)',  color: '#fff' },
  vacation_weekday: { label: '長期休暇ダイヤ（平日）', bg: 'rgba(234,179,8,0.88)',  color: '#fff' },
  vacation_holiday: { label: '長期休暇ダイヤ（休日）', bg: 'rgba(202,138,4,0.9)',   color: '#fff' },
  event:            { label: 'イベント日ダイヤ',       bg: 'rgba(249,115,22,0.85)', color: '#fff' },
  closed:           { label: '運休日',                bg: 'rgba(107,114,128,0.85)', color: '#fff' },
  special:          { label: '特別ダイヤ',            bg: 'rgba(168,85,247,0.85)', color: '#fff' },
}

/**
 * ダイヤ種別の代表色を返す。
 *
 * バッジ以外の表現（週間ダイヤの帯の色分けなど）から参照する用。BADGE_MAP を
 * 唯一の定義元にしておくことで、色を写し取った第二の定義が生まれないようにする。
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
