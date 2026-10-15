import { privateJson } from '../../server/src/apiRequest.js'
import { normalizeClientIp } from '../../server/src/apiRateLimitPolicy.js'

interface Env {
  API_RATE_LIMITER?: {
    check(ip: string, isMutation: boolean): Promise<boolean>
  }
}

function unavailable(): Response {
  const response = privateJson({ error: '現在 API を利用できません。しばらくしてからやり直してください' }, 503)
  response.headers.set('Retry-After', '60')
  return response
}

/** /api/ の全メソッドを D1 より前で検査する。欠落時に素通りする経路は持たない。 */
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  // X-Forwarded-For 等のクライアントが指定できる値へはフォールバックしない。
  const ip = normalizeClientIp(request.headers.get('CF-Connecting-IP'))
  if (ip === null) return unavailable()
  try {
    if (typeof env.API_RATE_LIMITER?.check !== 'function') return unavailable()
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())
    const allowed = await env.API_RATE_LIMITER.check(ip, isMutation)
    if (allowed === false) {
      const response = privateJson({ error: 'リクエストが多すぎます。少し待ってからやり直してください' }, 429)
      response.headers.set('Retry-After', '60')
      return response
    }
    if (allowed !== true) return unavailable()
  } catch {
    // RPC/native binding の障害や不正な応答を、許可として扱わない。IP はログにも残さない。
    return unavailable()
  }
  return next()
}
