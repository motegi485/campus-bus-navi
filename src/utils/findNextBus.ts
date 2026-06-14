import dayjs from 'dayjs'
import type { ScheduleEntry, NextBusInfo } from '../types/timetable'
import { parseHHmmToMinutes } from './parseTime'

/**
 * JST現在時刻と時刻表リストから次発バスを返す
 * 全便通過（運行終了）の場合は null を返す
 * 不正な departure フォーマットの便はスキップする
 */
export function findNextBus(
  schedule: ScheduleEntry[],
  now: dayjs.Dayjs
): NextBusInfo | null {
  const nowMinutes = now.hour() * 60 + now.minute()

  for (let i = 0; i < schedule.length; i++) {
    const depMinutes = parseHHmmToMinutes(schedule[i].departure)
    if (depMinutes === null) {
      console.warn(`不正な departure をスキップしました: "${schedule[i].departure}"`)
      continue
    }
    if (depMinutes > nowMinutes) {
      return {
        entry: schedule[i],
        minutesUntil: depMinutes - nowMinutes,
        index: i,
      }
    }
  }
  return null
}

/**
 * 現在時刻以降に残っている運行本数を返す（次発を含む）。
 * findNextBus と同じ判定（depMinutes > nowMinutes）で数えるため、
 * findNextBus が次発を返す状況では必ず 1 以上になる（次発自身を含む）。
 * 不正な departure フォーマットの便はカウントしない。運行終了後は 0。
 */
export function countRemainingBuses(
  schedule: ScheduleEntry[],
  now: dayjs.Dayjs
): number {
  const nowMinutes = now.hour() * 60 + now.minute()
  let count = 0
  for (let i = 0; i < schedule.length; i++) {
    const depMinutes = parseHHmmToMinutes(schedule[i].departure)
    if (depMinutes === null) continue
    if (depMinutes > nowMinutes) count++
  }
  return count
}

/**
 * 次発の後に続く直近 n 本を返す（次発は含まない）
 */
export function findUpcomingBuses(
  schedule: ScheduleEntry[],
  nextIndex: number,
  count = 4
): ScheduleEntry[] {
  return schedule.slice(nextIndex + 1, nextIndex + 1 + count)
}

/**
 * 時刻表の最初の便（翌日始発）を返す
 */
export function findFirstBus(schedule: ScheduleEntry[]): ScheduleEntry | null {
  return schedule.length > 0 ? schedule[0] : null
}
