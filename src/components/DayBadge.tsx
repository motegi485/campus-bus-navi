import type { DiagramType } from '../types/timetable'

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
 * 時刻表IDからダイヤ種別を推定するユーティリティ
 *
 * 時刻表ファイルの命名規約に対応:
 *   timetable_closed                   → closed           (運休日)
 *   timetable_special                  → special          (特別ダイヤ。時刻を出さず大学HPへ誘導)
 *   timetable_weekday                  → weekday          (授業日ダイヤ)
 *   timetable_holiday                  → holiday          (休業日ダイヤ)
 *   timetable_vacation_[季節]          → vacation         (長期休暇ダイヤ。平日/休日で分かれない単一表)
 *   timetable_vacation_[季節]_weekday  → vacation_weekday (長期休暇ダイヤ（平日）)
 *   timetable_vacation_[季節]_holiday  → vacation_holiday (長期休暇ダイヤ（休日）)
 *   timetable_event_[イベント名]       → event            (イベント日ダイヤ)
 *
 * 長期休暇IDは 'vacation' と 'holiday' の両方を含みうるため、
 * 'vacation' を 'holiday' より先に判定する順序が必須。
 * 'closed' と 'special' は他条件と重複しない前提だが、念のため先に判定する。
 */
export function resolveDiagramType(timetableId: string): DiagramType {
  if (timetableId.includes('closed')) return 'closed'
  if (timetableId.includes('special')) return 'special'
  if (timetableId.includes('event')) return 'event'
  if (timetableId.includes('vacation')) {
    if (timetableId.includes('holiday')) return 'vacation_holiday'
    if (timetableId.includes('weekday')) return 'vacation_weekday'
    return 'vacation'
  }
  if (timetableId.includes('holiday')) return 'holiday'
  return 'weekday'
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
