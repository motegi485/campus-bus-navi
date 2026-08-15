/**
 * 購読リクエストの検証と、D1 の行との変換。
 *
 * 受け取る値はすべて外部入力なので、型を信じずに 1 項目ずつ検査する
 * （フロントの useSettings.ts が localStorage に対して行っているのと同じ規律）。
 */

import type { RouteKey } from '../../src/types/timetable'
import { EVERYDAY_MASK, parseHHmmToMinutes, type ReminderMode, type SubscriptionRow } from './schedule.js'

const VALID_ROUTES: RouteKey[] = ['campus_to_station', 'station_to_campus']
const VALID_MODES: ReminderMode[] = ['last_bus', 'fixed_time']
const VALID_LEADS = [5, 10, 15, 20]

/** 購読の申し込み。フロントの usePushSubscription が送る形 */
export interface SubscribeRequest {
  endpoint: string
  p256dh: string
  auth: string
  route: RouteKey
  mode: ReminderMode
  departure: string | null
  leadMinutes: number
  daysMask: number
}

export type ParseResult = { ok: true; value: SubscribeRequest } | { ok: false; error: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * push エンドポイントとして受け入れてよい URL か。
 * https 以外を弾くのは、任意の URL を送りつけてサーバから外部へ
 * リクエストさせられる（SSRF）のを防ぐため。
 */
function isValidEndpoint(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.length > 2048) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function parseSubscribeRequest(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'リクエストの形式が不正です' }
  const body = input as Record<string, unknown>

  if (!isValidEndpoint(body.endpoint)) return { ok: false, error: 'endpoint が不正です' }
  if (!isNonEmptyString(body.p256dh) || body.p256dh.length > 256) return { ok: false, error: 'p256dh が不正です' }
  if (!isNonEmptyString(body.auth) || body.auth.length > 256) return { ok: false, error: 'auth が不正です' }

  const route = body.route as RouteKey
  if (!VALID_ROUTES.includes(route)) return { ok: false, error: 'route が不正です' }

  const mode = body.mode as ReminderMode
  if (!VALID_MODES.includes(mode)) return { ok: false, error: 'mode が不正です' }

  let departure: string | null = null
  if (mode === 'fixed_time') {
    if (!isNonEmptyString(body.departure) || parseHHmmToMinutes(body.departure) === null) {
      return { ok: false, error: 'departure は "HH:mm" 形式でなければなりません' }
    }
    departure = body.departure
  }

  const leadMinutes = Number(body.leadMinutes)
  if (!VALID_LEADS.includes(leadMinutes)) return { ok: false, error: 'leadMinutes が不正です' }

  // 曜日マスクは 7 ビット。0（どの曜日にも送らない）は購読の意味がないので拒む
  const daysMask = Number(body.daysMask)
  if (!Number.isInteger(daysMask) || daysMask <= 0 || daysMask > EVERYDAY_MASK) {
    return { ok: false, error: 'daysMask が不正です' }
  }

  return {
    ok: true,
    value: { endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth, route, mode, departure, leadMinutes, daysMask },
  }
}

/** endpoint から決定的な ID を作る。再購読時に同じ行を上書きするための鍵 */
export async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** D1 の行を、送信判定が使う形へ変換する */
export function toSubscriptionRow(record: Record<string, unknown>): SubscriptionRow {
  return {
    id: String(record.id),
    endpoint: String(record.endpoint),
    route: record.route as RouteKey,
    mode: record.mode as ReminderMode,
    departure: record.departure === null || record.departure === undefined ? null : String(record.departure),
    leadMinutes: Number(record.lead_minutes),
    daysMask: Number(record.days_mask),
    lastSentOn: record.last_sent_on === null || record.last_sent_on === undefined ? null : String(record.last_sent_on),
  }
}
