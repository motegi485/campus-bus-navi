import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

// useJSTClock と同じ拡張。単独で import されても動くようここでも呼ぶ（冪等）
dayjs.extend(utc)
dayjs.extend(timezone)

const JST = 'Asia/Tokyo'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 取得時刻を「3時間前に取得（8/17 07:12）」の形にする。
 *
 * 相対だけでは何時のデータか特定できず、絶対だけでは古さが直感的に分からないため併記する。
 * now を引数で受けるので useJSTClock の 1 分更新に自動で追従する（独自タイマーは持たない）。
 *
 * 端末時計が巻き戻るなどして差分が負になった場合は null を返す。
 * 呼び出し側は行ごと描画しないこと（推測するより出さない）。
 */
export function formatFetchedAt(fetchedAt: number, now: dayjs.Dayjs): string | null {
  const diff = now.valueOf() - fetchedAt
  if (!Number.isFinite(diff) || diff < 0) return null

  let relative: string
  if (diff < MINUTE) {
    relative = 'たった今取得'
  } else if (diff < HOUR) {
    relative = `${Math.floor(diff / MINUTE)}分前に取得`
  } else if (diff < DAY) {
    relative = `${Math.floor(diff / HOUR)}時間前に取得`
  } else {
    relative = `${Math.floor(diff / DAY)}日前に取得`
  }

  // epoch ms から直接組み立てる（文字列を再 parse しない）
  const absolute = dayjs(fetchedAt).tz(JST).format('M/D HH:mm')
  return `${relative}（${absolute}）`
}
