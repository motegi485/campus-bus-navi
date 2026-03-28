import type { DiagramType } from '../types/timetable'

interface Props {
  type: DiagramType
}

const BADGE_MAP: Record<DiagramType, { label: string; bg: string; color: string }> = {
  class:   { label: '授業日ダイヤ',   bg: 'rgba(59,130,246,0.82)',  color: '#fff' },
  holiday: { label: '休業日ダイヤ',   bg: 'rgba(239,68,68,0.82)',   color: '#fff' },
  vacation:{ label: '長期休暇ダイヤ', bg: 'rgba(234,179,8,0.88)',   color: '#fff' },
  event:   { label: 'イベント日ダイヤ',bg: 'rgba(249,115,22,0.85)', color: '#fff' },
}

/**
 * 時刻表IDからダイヤ種別を推定するユーティリティ
 * 実際の運用では calendar_rules.json のオーバーライドキーの存在や
 * name フィールドで判断するロジックを拡張してください
 */
export function resolveDiagramType(timetableId: string): DiagramType {
  if (timetableId.includes('holiday')) return 'holiday'
  if (timetableId.includes('vac')) return 'vacation'
  if (timetableId.includes('event')) return 'event'
  return 'class'
}

export function DayBadge({ type }: Props) {
  const { label, bg, color } = BADGE_MAP[type]
  return (
    <span
      className="text-[13px] font-bold px-[9px] py-[3px] rounded-[20px] flex items-center gap-1"
      style={{ background: bg, color }}
    >
      <span style={{ fontSize: '9px' }}>●</span>
      {label}
    </span>
  )
}
