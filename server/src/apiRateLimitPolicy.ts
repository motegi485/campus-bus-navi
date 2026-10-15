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

export interface ApiRateLimitEnv {
  API_RATE_LIMIT: Pick<RateLimit, 'limit'>
  API_MUTATION_RATE_LIMIT: Pick<RateLimit, 'limit'>
}

async function consumeLimit(binding: Pick<RateLimit, 'limit'>, key: string): Promise<boolean> {
  let result: { success: boolean }
  try {
    result = await binding.limit({ key })
  } catch {
    // native 側の例外にキーが含まれていても、RPC の例外やプラットフォームのログへ渡さない。
    throw new Error('rate-limit-binding-failed')
  }
  if (typeof result?.success !== 'boolean') throw new Error('rate-limit-result-unavailable')
  return result.success
}

/** false は超過、throw は設定不備・障害。IP 自体を例外やログへ含めない。 */
export async function checkApiRateLimit(env: ApiRateLimitEnv, ip: string, isMutation: boolean): Promise<boolean> {
  const normalized = normalizeClientIp(ip)
  if (normalized === null || typeof isMutation !== 'boolean') throw new Error('rate-limit-input-unavailable')
  if (typeof env.API_RATE_LIMIT?.limit !== 'function' || typeof env.API_MUTATION_RATE_LIMIT?.limit !== 'function') {
    throw new Error('rate-limit-binding-unavailable')
  }
  const key = `ip:${normalized}`
  if (!(await consumeLimit(env.API_RATE_LIMIT, key))) return false
  if (!isMutation) return true
  return consumeLimit(env.API_MUTATION_RATE_LIMIT, key)
}
