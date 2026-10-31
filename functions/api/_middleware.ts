import { privateJson } from '../../server/src/apiRequest.js'
import { isRateLimitFailure, normalizeClientIp } from '../../server/src/apiRateLimitPolicy.js'

interface Env {
  API_RATE_LIMITER?: {
    /** 新 Worker（Durable Object による計数）。旧 Worker には無く、RPC 呼出しが例外になる */
    checkDetailed?(ip: string, isMutation: boolean, countsTowardDaily: boolean): Promise<unknown>
    /** 旧 Worker・新 Worker の双方にある互換の入口 */
    check(ip: string, isMutation: boolean): Promise<unknown>
  }
}

type Decision = { verdict: 'allow' | 'ip' | 'daily'; retryAfter: number }

function unavailable(): Response {
  const response = privateJson({ error: '現在 API を利用できません。しばらくしてからやり直してください' }, 503)
  response.headers.set('Retry-After', '60')
  return response
}

function tooMany(message: string, retryAfter: number): Response {
  const response = privateJson({ error: message }, 429)
  response.headers.set('Retry-After', String(retryAfter))
  return response
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** checkDetailed の戻り値を厳密に検査する。不正なら null（503） */
function parseDecision(raw: unknown): Decision | null {
  const value = raw as { verdict?: unknown; retryAfter?: unknown } | null | undefined
  if (value?.verdict === 'allow' && value.retryAfter === 0) return { verdict: 'allow', retryAfter: 0 }
  if (value?.verdict === 'ip' && isIntegerIn(value.retryAfter, 1, 60)) return { verdict: 'ip', retryAfter: value.retryAfter }
  if (value?.verdict === 'daily' && isIntegerIn(value.retryAfter, 1, 86_400)) return { verdict: 'daily', retryAfter: value.retryAfter }
  return null
}

/**
 * 解除の 2 経路は全利用者の 1 日の上限に数えない（上限到達後も解除はできるようにする）。
 * 表記の揺れ（末尾スラッシュ等）は数える側（安全側）へ倒すため、pathname を完全一致で比べる。
 */
function isUnsubscribeRoute(method: string, pathname: string): boolean {
  return (method === 'DELETE' && pathname === '/api/subscribe') || (method === 'POST' && pathname === '/api/unsubscribe')
}

async function decide(
  limiter: NonNullable<Env['API_RATE_LIMITER']>,
  ip: string,
  isMutation: boolean,
  countsTowardDaily: boolean
): Promise<Decision | null> {
  // RPC スタブは任意の名前で typeof が function になるので、呼んで判定する
  if (typeof limiter.checkDetailed === 'function') {
    let raw: unknown
    let threw = false
    try {
      raw = await limiter.checkDetailed(ip, isMutation, countsTowardDaily)
    } catch (error) {
      // 新 Worker の判定自体の失敗（日次 DO の例外など）。シャードへ書いた後のこともあるので、
      // check へ戻って同じ要求を 2 回数えず 503 にする
      if (isRateLimitFailure(error)) return null
      threw = true
    }
    // 不正な戻り値は check へ戻らず 503（新 Worker の不具合を旧経路で覆い隠さない）
    if (!threw) return parseDecision(raw)
  }
  // 旧 Worker（checkDetailed が無い）または RPC 自体の失敗（符号を持たない例外）
  const allowed = await limiter.check(ip, isMutation)
  if (allowed === true) return { verdict: 'allow', retryAfter: 0 }
  if (allowed === false) return { verdict: 'ip', retryAfter: 60 }
  return null
}

/** /api/ の全メソッドを D1 より前で検査する。欠落時に素通りする経路は持たない。 */
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  // X-Forwarded-For 等のクライアントが指定できる値へはフォールバックしない。
  const ip = normalizeClientIp(request.headers.get('CF-Connecting-IP'))
  if (ip === null) return unavailable()
  let decision: Decision | null
  try {
    const limiter = env.API_RATE_LIMITER
    if (limiter === undefined || limiter === null) return unavailable()
    const method = request.method.toUpperCase()
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    const countsTowardDaily = isMutation && !isUnsubscribeRoute(method, new URL(request.url).pathname)
    decision = await decide(limiter, ip, isMutation, countsTowardDaily)
  } catch {
    // RPC / DO の障害や不正な応答を、許可として扱わない。IP はログにも残さない。
    return unavailable()
  }
  if (decision === null) return unavailable()
  if (decision.verdict === 'ip') return tooMany('リクエストが多すぎます。少し待ってからやり直してください', decision.retryAfter)
  if (decision.verdict === 'daily') return tooMany('本日の受付上限に達しました。日本時間 9 時以降にお試しください', decision.retryAfter)
  return next()
}
