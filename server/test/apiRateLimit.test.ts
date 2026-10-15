/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it, vi } from 'vitest'
import { ApiRateLimiter } from '../src/apiRateLimit'
import { checkApiRateLimit, normalizeClientIp, type ApiRateLimitEnv } from '../src/apiRateLimitPolicy'

function bindings() {
  return {
    API_RATE_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
    API_MUTATION_RATE_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
  }
}

describe('実クライアント IP の検査', () => {
  it.each([
    ['192.0.2.10', '192.0.2.10'], ['255.255.255.255', '255.255.255.255'],
    ['2001:0DB8:0:0:0:0:0:1', '2001:db8::1'], ['2001:db8::1', '2001:db8::1'],
    ['::1', '::1'], ['::ffff:192.0.2.10', '::ffff:c000:20a'],
  ])('%s を %s に正規化する', (input, expected) => {
    expect(normalizeClientIp(input)).toBe(expected)
  })

  it.each([null, undefined, '', 'unknown', 'localhost', '192.0.2', '256.0.0.1', '192.000.2.1',
    '192.0.2.1:443', '[2001:db8::1]', '2001:db8::1%eth0', '2001::db8::1', ' ::1', '::1 ',
    '2001:db8::1/path', '2001:db8::1?x=1', 'a'.repeat(46),
  ])('不正な IP %s を拒否する', input => {
    expect(normalizeClientIp(input)).toBeNull()
  })
})

describe('native binding を呼ぶ制限判定', () => {
  it('読取りは合計枠だけを消費する', async () => {
    const env = bindings()
    expect(await checkApiRateLimit(env, '192.0.2.10', false)).toBe(true)
    expect(env.API_RATE_LIMIT.limit).toHaveBeenCalledWith({ key: 'ip:192.0.2.10' })
    expect(env.API_MUTATION_RATE_LIMIT.limit).not.toHaveBeenCalled()
  })

  it('変更は合計枠と変更枠の両方を消費する', async () => {
    const env = bindings()
    expect(await checkApiRateLimit(env, '2001:0DB8:0:0:0:0:0:1', true)).toBe(true)
    expect(env.API_RATE_LIMIT.limit).toHaveBeenCalledWith({ key: 'ip:2001:db8::1' })
    expect(env.API_MUTATION_RATE_LIMIT.limit).toHaveBeenCalledWith({ key: 'ip:2001:db8::1' })
  })

  it('合計超過時は変更枠の呼出しまで進まない', async () => {
    const env = bindings()
    env.API_RATE_LIMIT.limit.mockResolvedValue({ success: false })
    expect(await checkApiRateLimit(env, '192.0.2.10', true)).toBe(false)
    expect(env.API_MUTATION_RATE_LIMIT.limit).not.toHaveBeenCalled()
  })

  it('変更枠だけの超過でも false にする', async () => {
    const env = bindings()
    env.API_MUTATION_RATE_LIMIT.limit.mockResolvedValue({ success: false })
    expect(await checkApiRateLimit(env, '192.0.2.10', true)).toBe(false)
  })

  it.each(['API_RATE_LIMIT', 'API_MUTATION_RATE_LIMIT'] as const)('%s 欠落は許可に変えない', async name => {
    const env = bindings()
    delete (env as Partial<ApiRateLimitEnv>)[name]
    await expect(checkApiRateLimit(env, '192.0.2.10', false)).rejects.toThrow('rate-limit-binding-unavailable')
  })

  it.each(['API_RATE_LIMIT', 'API_MUTATION_RATE_LIMIT'] as const)('%s 障害の詳細にある IP を例外へ漏らさない', async name => {
    const env = bindings()
    env[name].limit.mockRejectedValue(new Error('native unavailable for ip:192.0.2.10'))
    await expect(checkApiRateLimit(env, '192.0.2.10', true)).rejects.toThrow(/^rate-limit-binding-failed$/)
  })

  it('native binding の不正な応答を false とも成功とも取り違えない', async () => {
    const env = bindings()
    env.API_RATE_LIMIT.limit.mockResolvedValue({ success: 'true' } as unknown as { success: boolean })
    await expect(checkApiRateLimit(env, '192.0.2.10', false)).rejects.toThrow('rate-limit-result-unavailable')
  })

  it('RPC からの不正な引数は native binding を呼ばず拒否する', async () => {
    const env = bindings()
    await expect(checkApiRateLimit(env, 'invalid-client-value', false)).rejects.toThrow('rate-limit-input-unavailable')
    await expect(checkApiRateLimit(env, '192.0.2.10', 'false' as unknown as boolean)).rejects.toThrow('rate-limit-input-unavailable')
    expect(env.API_RATE_LIMIT.limit).not.toHaveBeenCalled()
  })

  it('名前付きクラスが環境を制限判定へ渡す（Node 単体用の入口 stub）', async () => {
    const env = bindings()
    const entrypoint = new ApiRateLimiter({} as ExecutionContext, env)
    expect(await entrypoint.check('192.0.2.10', true)).toBe(true)
    expect(env.API_RATE_LIMIT.limit).toHaveBeenCalledOnce()
    expect(env.API_MUTATION_RATE_LIMIT.limit).toHaveBeenCalledOnce()
  })
})
