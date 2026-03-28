import dayjs from 'dayjs'
import type { ScheduleEntry, NextBusInfo } from '../types/timetable'

/**
 * JST現在時刻と時刻表リストから次発バスを返す
 * 全便通過（運行終了）の場合は null を返す
 */
export function findNextBus(
  schedule: ScheduleEntry[],
  now: dayjs.Dayjs
): NextBusInfo | null {
  const nowMinutes = now.hour() * 60 + now.minute()

  for (let i = 0; i < schedule.length; i++) {
    const [h, m] = schedule[i].departure.split(':').map(Number)
    const depMinutes = h * 60 + m
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
