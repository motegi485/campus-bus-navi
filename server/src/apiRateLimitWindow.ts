/**
 * API レート制限の判定に使う純関数（Worker・DO・Node のどこでも動く）。
 *
 * - IP ごとの計数は、分の境界に揃えた 60 秒の固定窓。境界をまたぐと最大で上限の 2 倍まで
 *   通りうるが、計数を 1 行・1 回の書込みで済ませるためにこれを許容する
 * - 全利用者を合わせた変更系の 1 日の上限は UTC 日（= JST 9:00 リセット）で数える
 */

export const WINDOW_MS = 60_000
const DAY_MS = 86_400_000

/** IP 由来キーを振り分ける DO の数。変えるとキーの置き場所が変わり、窓の途中の数えが失われる */
export const API_RATE_SHARD_COUNT = 4

export interface WindowCounts {
  /** 窓の開始時刻（ms、分の境界） */
  windowStart: number
  all: number
  mutation: number
}

export interface WindowLimits {
  all: number
  mutation: number
}

export type IpDecision =
  | { allowed: true; next: WindowCounts }
  // 拒否時は書く値を返さない（拒否した要求で数えを進めない）
  | { allowed: false; retryAfter: number }

export function decideIpWindow(
  stored: WindowCounts | null,
  nowMs: number,
  isMutation: boolean,
  limits: WindowLimits
): IpDecision {
  const windowStart = nowMs - (nowMs % WINDOW_MS)
  const base = stored?.windowStart === windowStart ? stored : { windowStart, all: 0, mutation: 0 }
  const retryAfter = Math.max(1, Math.ceil((windowStart + WINDOW_MS - nowMs) / 1000))
  if (base.all >= limits.all || (isMutation && base.mutation >= limits.mutation)) return { allowed: false, retryAfter }
  return {
    allowed: true,
    next: { windowStart, all: base.all + 1, mutation: base.mutation + (isMutation ? 1 : 0) },
  }
}

/** UTC の日付（YYYY-MM-DD） */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

/** 次の 00:00 UTC（ms） */
export function nextUtcDayStartMs(nowMs: number): number {
  return nowMs - (nowMs % DAY_MS) + DAY_MS
}

/** 次の 00:00 UTC までの秒数（1〜86400） */
export function secondsUntilNextUtcDay(nowMs: number): number {
  return Math.min(86_400, Math.max(1, Math.ceil((nextUtcDayStartMs(nowMs) - nowMs) / 1000)))
}

export type DailyDecision =
  | { allowed: true; used: number; reachedLimit: boolean }
  | { allowed: false; retryAfter: number }

/** 当日の消費数 count に 1 を足してよいか。reachedLimit はちょうど上限に達した 1 回だけ true */
export function decideDailyBudget(count: number, limit: number, nowMs: number): DailyDecision {
  if (count >= limit) return { allowed: false, retryAfter: secondsUntilNextUtcDay(nowMs) }
  const used = count + 1
  return { allowed: true, used, reachedLimit: used === limit }
}

/** 設定値（wrangler.toml の vars）を正の整数として読む。10 進の素直な表記以外は設定不正 */
export function parseLimit(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) throw new Error('rate-limit-config-unavailable')
  return Number(value)
}

/** DO に渡すキー（SHA-256 の 16 進）の形 */
export function isCounterKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** 正の安全な整数か（DO の引数・RPC の戻り値の検査用） */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** ハッシュの先頭 8 桁を整数にしてシャードを選ぶ */
export function shardIndex(hashHex: string, shards = API_RATE_SHARD_COUNT): number {
  if (!isCounterKey(hashHex)) throw new Error('rate-limit-input-unavailable')
  return parseInt(hashHex.slice(0, 8), 16) % shards
}
