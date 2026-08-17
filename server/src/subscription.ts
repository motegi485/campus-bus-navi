/**
 * API に届く値の検証と、D1 の行との変換。
 *
 * すべて外部入力なので、型を信じずに 1 項目ずつ検査する
 * （フロントの useSettings.ts が localStorage に対して行っているのと同じ規律）。
 *
 * 端末の購読（subscriptions）と、当日の便ごとのリマインド（reminders）は別物。
 * 前者は設定画面のトグルが作り、後者は時刻表の選択モードが作る。
 */

import type { RouteKey } from '../../src/types/timetable'
import { VALID_LEAD_MINUTES, parseHHmmToMinutes, type ReminderRow } from './schedule.js'
import { isAllowedPushHost, isIpLiteral } from './pushProviders.js'

const VALID_ROUTES: RouteKey[] = ['campus_to_station', 'station_to_campus']

/** 端末の購読。設定画面のトグルをオンにしたときに送られる */
export interface SubscribeRequest {
  endpoint: string
  p256dh: string
  auth: string
}

/** 当日の便ごとのリマインド指定。時刻表の選択モードから送られる */
export interface ReminderRequest {
  endpoint: string
  dateKey: string
  route: RouteKey
  /** 指定された便（"HH:mm"）。空配列なら「その日の指定をすべて解除」を意味する */
  departures: string[]
  leadMinutes: number
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** 同じ日に指定できる便の上限。誤操作や悪意で行が増え続けるのを防ぐ */
export const MAX_DEPARTURES_PER_DAY = 12

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * push エンドポイントとして受け入れてよい URL か。
 *
 * 保存した endpoint へは配信 Worker が VAPID 署名付きの POST を送る（send.ts）。
 * したがってこの検査は「サーバから外向きに叩いてよい宛先か」の判断そのものであり、
 * scheme が https かどうかでは足りない（任意の第三者サーバを指定できてしまう）。
 *
 * 次をすべて満たすものだけを通す:
 *   - https で、長さが妥当
 *   - ホストが既知の push サービス（pushProviders.ts の許可リスト）
 *   - IP リテラルでない（許可リストで既に落ちるが、意図を明示する）
 *   - 資格情報（user:pass@）を含まない
 *   - フラグメントを含まない … HTTP 送信時に落ちるため、`#a` と `#b` で
 *     「別 ID・同一宛先」の行を無限に作れる（同じ宛先への送信を増幅できる）
 */
export function isValidEndpoint(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username !== '' || url.password !== '') return false
  if (url.hash !== '') return false
  if (isIpLiteral(url.hostname)) return false
  return isAllowedPushHost(url.hostname)
}

/** 実在する日付を表す "YYYY-MM-DD" か。書式だけでは 2026-02-30 を通してしまう */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

export function parseSubscribeRequest(input: unknown): ParseResult<SubscribeRequest> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'リクエストの形式が不正です' }
  const body = input as Record<string, unknown>

  if (!isValidEndpoint(body.endpoint)) return { ok: false, error: 'endpoint が不正です' }
  if (!isNonEmptyString(body.p256dh) || body.p256dh.length > 256) return { ok: false, error: 'p256dh が不正です' }
  if (!isNonEmptyString(body.auth) || body.auth.length > 256) return { ok: false, error: 'auth が不正です' }

  return { ok: true, value: { endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth } }
}

/**
 * 便の指定を検証する。
 *
 * `todayKey` は呼び出し側が求めた JST の当日（"YYYY-MM-DD"）。
 * **当日以外を受理しない**のは、リマインドが当日限りという仕様そのものであると同時に、
 * 無認証 API から未来日を無限に登録して D1 の日次書き込み枠を枯渇させる経路を塞ぐため。
 * 当日だけに閉じると、1 購読が持てる行は「2 ルート × MAX_DEPARTURES_PER_DAY」で頭打ちになる。
 */
export function parseReminderRequest(input: unknown, todayKey: string): ParseResult<ReminderRequest> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'リクエストの形式が不正です' }
  const body = input as Record<string, unknown>

  if (!isValidEndpoint(body.endpoint)) return { ok: false, error: 'endpoint が不正です' }
  if (!isValidDateKey(body.dateKey)) {
    return { ok: false, error: 'dateKey は実在する "YYYY-MM-DD" でなければなりません' }
  }
  if (body.dateKey !== todayKey) {
    return {
      ok: false,
      error: '通知を設定できるのは当日ぶんだけです。日付が変わった直後は、画面が新しい日付に切り替わってからもう一度お試しください',
    }
  }

  const route = body.route as RouteKey
  if (!VALID_ROUTES.includes(route)) return { ok: false, error: 'route が不正です' }

  const leadMinutes = Number(body.leadMinutes)
  if (!VALID_LEAD_MINUTES.includes(leadMinutes)) return { ok: false, error: 'leadMinutes が不正です' }

  if (!Array.isArray(body.departures)) return { ok: false, error: 'departures が不正です' }
  if (body.departures.length > MAX_DEPARTURES_PER_DAY) {
    return { ok: false, error: `1 日に指定できる便は ${MAX_DEPARTURES_PER_DAY} 件までです` }
  }
  for (const departure of body.departures) {
    if (parseHHmmToMinutes(departure as string) === null) {
      return { ok: false, error: 'departures には "HH:mm" 形式の時刻のみ指定できます' }
    }
  }
  // 同じ便を二度渡されても行は増えないが、無駄な書き込みを避けるためここで畳む
  const departures = Array.from(new Set(body.departures as string[]))

  return { ok: true, value: { endpoint: body.endpoint, dateKey: body.dateKey, route, departures, leadMinutes } }
}

/** endpoint から決定的な ID を作る。再購読時に同じ行を上書きするための鍵 */
export async function subscriptionId(endpoint: string): Promise<string> {
  return sha256Hex(endpoint)
}

/** リマインド 1 件の ID。同じ便を二度指定しても行が増えないよう決定的に作る */
export async function reminderId(params: {
  subscriptionId: string
  dateKey: string
  route: RouteKey
  departure: string
}): Promise<string> {
  return sha256Hex(`${params.subscriptionId}|${params.dateKey}|${params.route}|${params.departure}`)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** D1 の結合結果を、送信判定が使う形へ変換する */
export function toReminderRow(record: Record<string, unknown>): ReminderRow {
  return {
    id: String(record.id),
    endpoint: String(record.endpoint),
    dateKey: String(record.date_key),
    route: record.route as RouteKey,
    departure: String(record.departure),
    leadMinutes: Number(record.lead_minutes),
  }
}
