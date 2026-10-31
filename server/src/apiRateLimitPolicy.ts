import { nextUtcDayStartMs, parseLimit, shardIndex } from './apiRateLimitWindow.js'

/** Pages と Worker の双方で使う、Cloudflare の実クライアント IP の検査。 */
export function normalizeClientIp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 45 || value.trim() !== value) return null
  if (/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) {
    return value.split('.').every(part => Number(part) <= 255) ? value : null
  }
  if (!value.includes(':') || !/^[\da-fA-F:.]+$/.test(value)) return null
  try {
    // URL パーサで IPv6 を検査・正規化する。省略形や大文字の違いでキーを増やさせない。
    const hostname = new URL(`http://[${value}]/`).hostname
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : null
  } catch {
    return null
  }
}

/** IPv6 の表記を 8 個の hextet（先頭の 0 を落とした小文字の 16 進）へ展開する。形が合わなければ null */
function expandIpv6(value: string): string[] | null {
  const halves = value.toLowerCase().split('::')
  if (halves.length > 2) return null
  const split = (part: string) => (part === '' ? [] : part.split(':'))
  const head = split(halves[0])
  let hextets = head
  if (halves.length === 2) {
    const tail = split(halves[1])
    const fill = 8 - head.length - tail.length
    if (fill < 1) return null
    hextets = [...head, ...Array<string>(fill).fill('0'), ...tail]
  }
  if (hextets.length !== 8 || !hextets.every(h => /^[0-9a-f]{1,4}$/.test(h))) return null
  return hextets.map(h => parseInt(h, 16).toString(16))
}

/**
 * レート制限のキー。引数は normalizeClientIp を通した値。
 *
 * - IPv4 は従来どおり 1 アドレス（`ip:a.b.c.d`）
 * - IPv6 は /64（先頭 4 hextet）ごと。1 つの /64 の中でアドレスを使い分けても同じ枠を数える
 *   （携帯は通常 1 端末に 1 つの /64、家庭回線は /56〜/48 が割り当てられるので、/128 単位だと
 *   アドレスを変えるだけで上限を回避できた）
 * - IPv4-mapped（::ffff:a.b.c.d）は IPv4 と同じキー。同じ接続元を表記の違いで二重に数えない
 * - ::/64 内のそれ以外（::1 など特殊用途）は /128 のまま。1 つの /64 に束ねると無関係な利用者を巻き込む
 */
export function rateLimitKey(normalized: string): string {
  if (!normalized.includes(':')) return `ip:${normalized}`
  // URL パーサの出力は 16 進のみ（::ffff:192.0.2.10 → ::ffff:c000:20a）なので、:: の展開だけでよい
  const h = expandIpv6(normalized)
  if (h === null) throw new Error('rate-limit-input-unavailable')
  if (h.slice(0, 5).every(x => x === '0') && h[5] === 'ffff') {
    const octets = [h[6], h[7]].flatMap(x => {
      const n = parseInt(x, 16)
      return [n >> 8, n & 255]
    })
    return `ip:${octets.join('.')}`
  }
  if (h.slice(0, 4).every(x => x === '0')) return `ip6:${h.join(':')}`
  return `ip6net:${h.slice(0, 4).join(':')}::/64`
}

/*
 * ---- Durable Object による計数（server/src/apiRateLimitStore.ts） ----
 *
 * このファイルは Pages（functions/api/_middleware.ts の normalizeClientIp）からも読まれるため、
 * cloudflare:workers を import しない。DO のスタブは構造的な型で受ける。
 */

/**
 * 新 Worker の判定（decideApiRateLimit と下位の parseLimit 等）が投げる失敗の符号。
 * Workers RPC は例外の message を呼出し側へ渡すので、middleware はこれで「新 Worker の判定の失敗」を
 * 「旧 Worker（checkDetailed が無い）や RPC 自体の失敗」と区別し、前者では check へ戻らない
 * （シャードへ書いた後の日次 DO の失敗で check へ戻ると、同じ要求を 2 回数えてしまう）。
 * 符号を足すときはここにも加える（apiRateLimit.test.ts で照合している）。
 */
export const RATE_LIMIT_FAILURE_CODES: readonly string[] = [
  'rate-limit-counter-failed',
  'rate-limit-result-unavailable',
  'rate-limit-config-unavailable',
  'rate-limit-binding-unavailable',
  'rate-limit-input-unavailable',
]

/** message が RATE_LIMIT_FAILURE_CODES のどれかに完全一致する例外か */
export function isRateLimitFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && RATE_LIMIT_FAILURE_CODES.includes(message)
}

/** DO に渡すキーの接頭辞。変えると全キーが変わる（窓の途中の数えが失われる） */
const COUNTER_KEY_PREFIX = 'api-rate:v1:'
export const API_DAILY_MUTATIONS_NAME = 'api-daily-mutations:v1'
export function apiRateShardName(index: number): string {
  return `api-rate:v1:shard-${index}`
}

interface DurableObjectNamespaceLike<Stub> {
  idFromName(name: string): unknown
  get(id: never): Stub
}

export interface ApiRateShardStub {
  hit(key: string, isMutation: boolean, allLimit: number, mutationLimit: number): Promise<unknown> | unknown
}

export interface ApiDailyMutationStub {
  consume(limit: number): Promise<unknown> | unknown
  usage(): Promise<unknown> | unknown
}

export interface ApiRateLimitEnv {
  API_RATE_SHARDS: DurableObjectNamespaceLike<ApiRateShardStub>
  API_DAILY_MUTATIONS: DurableObjectNamespaceLike<ApiDailyMutationStub>
  /** IP ごとの全要求の上限（件/60 秒） */
  API_RATE_LIMIT_PER_MINUTE: string
  /** IP ごとの変更系の上限（件/60 秒） */
  API_MUTATION_RATE_LIMIT_PER_MINUTE: string
  /** 全利用者を合わせた変更系の上限（件/UTC 日）。解除の 2 経路は数えない */
  API_MUTATION_DAILY_LIMIT: string
}

export type ApiRateLimitVerdict = 'allow' | 'ip' | 'daily'

export interface ApiRateLimitDecision {
  verdict: ApiRateLimitVerdict
  /** allow は 0、ip は 1〜60、daily は 1〜86400（秒） */
  retryAfter: number
}

/** 日次の拒否を isolate 内に覚えておく入れ物。上限到達後に日次 DO を呼び続けないため */
export interface DailyCache {
  closedUntil: number
}

export interface ApiRateLimitDeps {
  now?: () => number
  dailyCache?: DailyCache
}

interface ApiRateLimitConfig {
  allPerMinute: number
  mutationPerMinute: number
  dailyMutations: number
}

function readConfig(env: ApiRateLimitEnv): ApiRateLimitConfig {
  return {
    allPerMinute: parseLimit(env?.API_RATE_LIMIT_PER_MINUTE),
    mutationPerMinute: parseLimit(env?.API_MUTATION_RATE_LIMIT_PER_MINUTE),
    dailyMutations: parseLimit(env?.API_MUTATION_DAILY_LIMIT),
  }
}

function hasNamespace(value: unknown): boolean {
  const ns = value as Partial<DurableObjectNamespaceLike<unknown>> | undefined
  return typeof ns?.idFromName === 'function' && typeof ns?.get === 'function'
}

/** 設定 → binding の順に検査する。どちらも DO を呼ぶ前に行う */
function readReadyConfig(env: ApiRateLimitEnv): ApiRateLimitConfig {
  const config = readConfig(env)
  if (!hasNamespace(env.API_RATE_SHARDS) || !hasNamespace(env.API_DAILY_MUTATIONS)) {
    throw new Error('rate-limit-binding-unavailable')
  }
  return config
}

function stubOf<Stub>(namespace: DurableObjectNamespaceLike<Stub>, name: string): Stub {
  try {
    return namespace.get(namespace.idFromName(name) as never)
  } catch {
    throw new Error('rate-limit-counter-failed')
  }
}

/** DO の例外（過負荷・枠超過を含む）は文言を捨てて投げ直す。IP やハッシュを RPC の例外・ログへ渡さない */
async function callCounter(call: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    return await call()
  } catch {
    throw new Error('rate-limit-counter-failed')
  }
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** DO の戻り値を検査する。allowed=false の retryAfter が範囲外なら不正 */
function parseCounterResult(raw: unknown, maxRetryAfter: number): { allowed: true } | { allowed: false; retryAfter: number } {
  const result = raw as { allowed?: unknown; retryAfter?: unknown } | null | undefined
  if (result?.allowed === true) return { allowed: true }
  if (result?.allowed === false && isIntegerIn(result.retryAfter, 1, maxRetryAfter)) {
    return { allowed: false, retryAfter: result.retryAfter }
  }
  throw new Error('rate-limit-result-unavailable')
}

async function counterKey(normalized: string): Promise<string> {
  const data = new TextEncoder().encode(COUNTER_KEY_PREFIX + rateLimitKey(normalized))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

const isolateDailyCache: DailyCache = { closedUntil: 0 }

/**
 * IP ごとの窓 → （変更系で countsTowardDaily なら）日次の順に判定する。
 * throw は設定不備・障害で、呼出し側（middleware）は 503 にする。IP 自体を例外やログへ含めない。
 */
export async function decideApiRateLimit(
  env: ApiRateLimitEnv,
  ip: string,
  isMutation: boolean,
  countsTowardDaily: boolean,
  deps: ApiRateLimitDeps = {}
): Promise<ApiRateLimitDecision> {
  const normalized = normalizeClientIp(ip)
  if (normalized === null || typeof isMutation !== 'boolean' || typeof countsTowardDaily !== 'boolean') {
    throw new Error('rate-limit-input-unavailable')
  }
  const config = readReadyConfig(env)
  const now = deps.now ?? Date.now
  const cache = deps.dailyCache ?? isolateDailyCache

  const key = await counterKey(normalized)
  const shard = stubOf(env.API_RATE_SHARDS, apiRateShardName(shardIndex(key)))
  const ipResult = parseCounterResult(
    await callCounter(() => shard.hit(key, isMutation, config.allPerMinute, config.mutationPerMinute)),
    60
  )
  if (!ipResult.allowed) return { verdict: 'ip', retryAfter: ipResult.retryAfter }
  if (!(isMutation && countsTowardDaily)) return { verdict: 'allow', retryAfter: 0 }

  const checkedAt = now()
  if (cache.closedUntil > checkedAt) {
    return { verdict: 'daily', retryAfter: Math.min(86_400, Math.max(1, Math.ceil((cache.closedUntil - checkedAt) / 1000))) }
  }
  const daily = stubOf(env.API_DAILY_MUTATIONS, API_DAILY_MUTATIONS_NAME)
  const dailyResult = parseCounterResult(await callCounter(() => daily.consume(config.dailyMutations)), 86_400)
  if (dailyResult.allowed) return { verdict: 'allow', retryAfter: 0 }
  // DO の時計と isolate の時計がずれていても、DO が示した秒数より長くは閉じない
  cache.closedUntil = Math.min(checkedAt + dailyResult.retryAfter * 1000, nextUtcDayStartMs(checkedAt))
  return { verdict: 'daily', retryAfter: dailyResult.retryAfter }
}

/** 旧 Pages（check だけを呼ぶ）向け。false は ip・daily のどちらの超過も含む */
export async function checkApiRateLimit(
  env: ApiRateLimitEnv,
  ip: string,
  isMutation: boolean,
  deps: ApiRateLimitDeps = {}
): Promise<boolean> {
  return (await decideApiRateLimit(env, ip, isMutation, isMutation, deps)).verdict === 'allow'
}

export interface MutationUsage {
  day: string
  used: number
  limit: number
}

/** /api/status 用。日次 DO の読取りだけを行い、上限を添えて返す */
export async function readMutationUsage(env: ApiRateLimitEnv): Promise<MutationUsage> {
  const config = readReadyConfig(env)
  const daily = stubOf(env.API_DAILY_MUTATIONS, API_DAILY_MUTATIONS_NAME)
  const raw = (await callCounter(() => daily.usage())) as { day?: unknown; used?: unknown } | null | undefined
  if (typeof raw?.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) || !isIntegerIn(raw.used, 0, Number.MAX_SAFE_INTEGER)) {
    throw new Error('rate-limit-result-unavailable')
  }
  return { day: raw.day, used: raw.used, limit: config.dailyMutations }
}
