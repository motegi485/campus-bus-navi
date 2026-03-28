import dayjs from 'dayjs'
import type { CalendarRules } from '../types/timetable'

/**
 * JST の日付オブジェクトを受け取り、適用すべき時刻表 ID を返す
 * 優先順位: overrides（特定日）> default_rules（曜日）
 */
export function resolveCalendar(
  rules: CalendarRules,
  jstDate: dayjs.Dayjs
): string {
  const dateStr = jstDate.format('YYYY-MM-DD')

  // 1. 特定日付の上書きルールを最優先
  if (rules.overrides[dateStr]) {
    return rules.overrides[dateStr]
  }

  // 2. 曜日ルール (0=日曜, 1=月曜, ..., 6=土曜)
  const dayOfWeek = String(jstDate.day())
  return rules.default_rules[dayOfWeek] ?? 'timetable_weekday'
}
