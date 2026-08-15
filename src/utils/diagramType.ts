import type { DiagramType } from '../types/timetable'

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
 *
 * UI から独立した純関数としてここに置く。表示（DayBadge の配色）だけでなく、
 * push 配信サーバ（server/）も「運休日・特別ダイヤには送らない」判定で同じ規則を使う。
 * 命名規約の解釈をここ 1 箇所に集約し、フロントとサーバで食い違わないようにする。
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

/**
 * 発車時刻を知らせてよいダイヤか。
 * 運休日（便が無い）と特別ダイヤ（既定の形式で表現できず大学HPへ誘導する）では、
 * 存在しない便を知らせないために通知を送らない。
 */
export function hasDepartures(type: DiagramType): boolean {
  return type !== 'closed' && type !== 'special'
}
