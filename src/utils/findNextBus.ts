import dayjs from 'dayjs'
import type { ScheduleEntry, NextBusInfo } from '../types/timetable'
import { parseHHmmToMinutes } from './parseTime'

/**
 * JST現在時刻と時刻表リストから次発バスを返す
 * 全便通過（運行終了）の場合は null を返す
 * 不正な departure フォーマットの便はスキップする
 *
 * headwayMinutes は「次発より厳密に早い直近の有効な便」からの間隔。
 * 同時刻の便が並ぶ場合（validate-data は警告のみで許容）に間隔 0 を返さないため、
 * 同時刻は前便候補にしない。始発など前便がなければ null。
 */
export function findNextBus(
  schedule: ScheduleEntry[],
  now: dayjs.Dayjs
): NextBusInfo | null {
  const nowMinutes = now.hour() * 60 + now.minute()
  // 最後に見た「異なる」有効な発車時刻（前便候補）
  let prevDepMinutes: number | null = null

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
        headwayMinutes:
          prevDepMinutes !== null && prevDepMinutes < depMinutes
            ? depMinutes - prevDepMinutes
            : null,
      }
    }
    if (prevDepMinutes === null || depMinutes > prevDepMinutes) {
      prevDepMinutes = depMinutes
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

/**
 * 残り分数の表示ラベル。「あと」を前置く形（次のバスカード・今後の発車時刻の
 * 先頭行で使う、改修たたき台の {row 0}.diff と同じ書式）。
 */
export function formatWaitLabel(minutesUntil: number): string {
  if (minutesUntil >= 60) {
    const h = Math.floor(minutesUntil / 60)
    const m = minutesUntil % 60
    return m === 0 ? `あと${h}時間` : `あと${h}時間${m}分`
  }
  return `あと${minutesUntil}分`
}

/**
 * 次のバスカードの円形ゲージ中央に出す 2 行表示の分割。
 * formatWaitLabel / formatDiffLabel と同じ分岐（60 分未満は分、それ以上は時間＋分）で
 * 語を揃え、「あと1時間30分」の横に「90分後」が並ぶ矛盾を避ける。
 *   - 60 分未満:           { primary: '5',  unit: '分後' }
 *   - ちょうど N 時間:     { primary: '2',  unit: '時間後' }
 *   - 端数あり:            { primary: '1', primaryUnit: '時間', unit: '30分後' }
 */
export interface GaugeCenterLabel {
  /** 上段の数字 */
  primary: string
  /** 上段の数字に添える単位（端数ありの時間表示のみ「時間」） */
  primaryUnit?: string
  /** 下段 */
  unit: string
}

export function formatGaugeCenter(minutesUntil: number): GaugeCenterLabel {
  if (minutesUntil >= 60) {
    const h = Math.floor(minutesUntil / 60)
    const m = minutesUntil % 60
    return m === 0
      ? { primary: `${h}`, unit: '時間後' }
      : { primary: `${h}`, primaryUnit: '時間', unit: `${m}分後` }
  }
  return { primary: `${minutesUntil}`, unit: '分後' }
}

/**
 * 残り分数の表示ラベル。「後」を後置する形（今後の発車時刻の2本目以降で使う、
 * 改修たたき台の diffLabel() と同じ書式）。
 */
export function formatDiffLabel(minutesUntil: number): string {
  if (minutesUntil >= 60) {
    const h = Math.floor(minutesUntil / 60)
    const m = minutesUntil % 60
    return m === 0 ? `${h}時間後` : `${h}時間${m}分後`
  }
  return `${minutesUntil}分後`
}
