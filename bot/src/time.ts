/**
 * JST 固定の日時ユーティリティ（NFR-6）。
 * 素の `new Date()` 比較は使わず、日付判定はすべてここを経由する。
 *
 * ※要件定義 §7.1 のファイル一覧には無いが、「すべての日付判定を JST に統一する」という
 *   NFR-6 を1箇所に閉じ込めるために追加した小モジュール。
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

export const TZ = 'Asia/Tokyo'

/** 現在時刻（JST） */
export function nowJst(): dayjs.Dayjs {
  return dayjs().tz(TZ)
}

/** 今日の日付（JST・YYYY-MM-DD） */
export function todayJst(): string {
  return nowJst().format('YYYY-MM-DD')
}

/** ISO8601（JST オフセット付き）。state / holidays.json の processed_at 等に使う */
export function nowIsoJst(): string {
  return nowJst().format('YYYY-MM-DDTHH:mm:ssZ')
}

/** YYYY-MM-DD を JST の Dayjs にする */
export function parseDate(date: string): dayjs.Dayjs {
  return dayjs.tz(date, 'YYYY-MM-DD', TZ)
}

export function formatDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 曜日番号（0=日 … 6=土） */
export function dayOfWeek(date: string): number {
  return parseDate(date).day()
}

/** start〜end（両端含む）の日付を列挙する */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  let cur = parseDate(start)
  const last = parseDate(end)
  // 異常な期間（1年超）は呼び出し側で弾くが、無限ループ防止のため上限を設ける
  for (let i = 0; i < 1000 && !cur.isAfter(last, 'day'); i++) {
    out.push(cur.format('YYYY-MM-DD'))
    cur = cur.add(1, 'day')
  }
  return out
}

/** a < b（日単位） */
export function isBefore(a: string, b: string): boolean {
  return parseDate(a).isBefore(parseDate(b), 'day')
}

/** a > b（日単位） */
export function isAfter(a: string, b: string): boolean {
  return parseDate(a).isAfter(parseDate(b), 'day')
}

export { dayjs }
