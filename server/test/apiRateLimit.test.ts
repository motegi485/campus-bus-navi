/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it, vi } from 'vitest'
import { ApiRateLimiter } from '../src/apiRateLimit'
import {
  API_DAILY_MUTATIONS_NAME, apiRateShardName, checkApiRateLimit, decideApiRateLimit, isRateLimitFailure, normalizeClientIp,
  rateLimitKey, readMutationUsage, type ApiRateLimitEnv, type DailyCache,
} from '../src/apiRateLimitPolicy'

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

describe('rateLimitKey（IPv6 は /64 単位）', () => {
  it.each([
    ['192.0.2.10', 'ip:192.0.2.10'],
    ['2001:db8:1:2:aaaa::1', 'ip6net:2001:db8:1:2::/64'],
    ['2001:db8:1:2::ffff', 'ip6net:2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:0:0:0:1', 'ip6net:2001:db8:1:2::/64'],
    ['2001:db8:1:3::1', 'ip6net:2001:db8:1:3::/64'],
    ['2001:db8::1', 'ip6net:2001:db8:0:0::/64'],
    ['fe80::1', 'ip6net:fe80:0:0:0::/64'],
    ['::ffff:c000:20a', 'ip:192.0.2.10'],
    ['::ffff:0:0', 'ip:0.0.0.0'],
    // ::/64 内（ループバック・IPv4-translated など）は無関係な利用者を束ねないよう /128 のまま
    ['::1', 'ip6:0:0:0:0:0:0:0:1'],
    ['::', 'ip6:0:0:0:0:0:0:0:0'],
    ['::ffff:0:c000:20a', 'ip6:0:0:0:0:ffff:0:c000:20a'],
  ])('%s → %s', (input, expected) => {
    expect(rateLimitKey(input)).toBe(expected)
  })

  it('normalizeClientIp を通した値は表記違いでも同じキーになる', () => {
    const key = (ip: string) => rateLimitKey(normalizeClientIp(ip)!)
    expect(key('2001:DB8:1:2::1')).toBe(key('2001:0db8:0001:0002:0000:0000:0000:0001'))
    expect(key('::ffff:192.0.2.10')).toBe('ip:192.0.2.10')
  })

  it('8 hextet にならない値は例外にする（許可に倒さない）', () => {
    for (const bad of ['1:2:3:4:5:6:7:8:9', '2001::db8::1', '1:2:3', 'g::1', '12345::1']) {
      expect(() => rateLimitKey(bad), bad).toThrow('rate-limit-input-unavailable')
    }
  })
})

/** 偽の DO namespace。名前 → スタブを記録し、呼出しを検査できるようにする */
function fakeEnvironment() {
  const hit = vi.fn(async (_key: string, _isMutation: boolean, _all: number, _mutation: number): Promise<unknown> =>
    ({ allowed: true, retryAfter: 0 }))
  const consume = vi.fn(async (_limit: number): Promise<unknown> => ({ allowed: true, retryAfter: 0 }))
  const usage = vi.fn(async (): Promise<unknown> => ({ day: '2026-11-01', used: 12 }))
  const shardNames: string[] = []
  const dailyNames: string[] = []
  const API_RATE_SHARDS = {
    idFromName: vi.fn((name: string) => { shardNames.push(name); return { name } }),
    get: vi.fn((_id: unknown) => ({ hit })),
  }
  const API_DAILY_MUTATIONS = {
    idFromName: vi.fn((name: string) => { dailyNames.push(name); return { name } }),
    get: vi.fn((_id: unknown) => ({ consume, usage })),
  }
  const env = {
    API_RATE_SHARDS, API_DAILY_MUTATIONS,
    API_RATE_LIMIT_PER_MINUTE: '600',
    API_MUTATION_RATE_LIMIT_PER_MINUTE: '300',
    API_MUTATION_DAILY_LIMIT: '1300',
  }
  return { env, hit, consume, usage, shardNames, dailyNames, value: env as unknown as ApiRateLimitEnv }
}

const NOW = Date.parse('2026-11-01T13:00:00Z')
function deps(now = NOW, dailyCache: DailyCache = { closedUntil: 0 }) {
  return { now: () => now, dailyCache }
}

describe('DO を呼ぶ制限判定', () => {
  it('GET はシャードだけを呼び、日次は呼ばない', async () => {
    const f = fakeEnvironment()
    expect(await decideApiRateLimit(f.value, '192.0.2.10', false, false, deps())).toEqual({ verdict: 'allow', retryAfter: 0 })
    expect(f.hit).toHaveBeenCalledOnce()
    expect(f.hit.mock.calls[0].slice(1)).toEqual([false, 600, 300])
    expect(f.consume).not.toHaveBeenCalled()
  })

  it('変更系はシャード → 日次の順に呼ぶ', async () => {
    const f = fakeEnvironment()
    const order: string[] = []
    f.hit.mockImplementation(async () => { order.push('shard'); return { allowed: true, retryAfter: 0 } })
    f.consume.mockImplementation(async () => { order.push('daily'); return { allowed: true, retryAfter: 0 } })
    expect(await decideApiRateLimit(f.value, '192.0.2.10', true, true, deps())).toEqual({ verdict: 'allow', retryAfter: 0 })
    expect(order).toEqual(['shard', 'daily'])
    expect(f.hit.mock.calls[0].slice(1)).toEqual([true, 600, 300])
    expect(f.consume).toHaveBeenCalledWith(1300)
    expect(f.dailyNames).toEqual([API_DAILY_MUTATIONS_NAME])
  })

  it('シャードが拒否したら日次を呼ばず ip を返す（retryAfter はそのまま）', async () => {
    const f = fakeEnvironment()
    f.hit.mockResolvedValue({ allowed: false, retryAfter: 17 })
    expect(await decideApiRateLimit(f.value, '192.0.2.10', true, true, deps())).toEqual({ verdict: 'ip', retryAfter: 17 })
    expect(f.consume).not.toHaveBeenCalled()
  })

  it('countsTowardDaily=false（解除経路）は変更系でも日次を呼ばない', async () => {
    const f = fakeEnvironment()
    expect(await decideApiRateLimit(f.value, '192.0.2.10', true, false, deps())).toEqual({ verdict: 'allow', retryAfter: 0 })
    expect(f.hit.mock.calls[0][1]).toBe(true)
    expect(f.consume).not.toHaveBeenCalled()
  })

  it('日次が拒否したら daily と次の 00:00 UTC までの秒数を返す', async () => {
    const f = fakeEnvironment()
    f.consume.mockResolvedValue({ allowed: false, retryAfter: 39600 })
    expect(await decideApiRateLimit(f.value, '192.0.2.10', true, true, deps())).toEqual({ verdict: 'daily', retryAfter: 39600 })
  })

  it('日次の拒否は isolate 内に覚え、日が変わるまで日次 DO を呼ばない', async () => {
    const f = fakeEnvironment()
    const cache: DailyCache = { closedUntil: 0 }
    f.consume.mockResolvedValue({ allowed: false, retryAfter: 39600 })
    await decideApiRateLimit(f.value, '192.0.2.10', true, true, deps(NOW, cache))
    expect(cache.closedUntil).toBe(Date.parse('2026-11-02T00:00:00Z'))

    // 1 時間後: 日次 DO は呼ばれないが、IP ごとの数えは続ける
    const later = NOW + 3600_000
    expect(await decideApiRateLimit(f.value, '192.0.2.11', true, true, deps(later, cache)))
      .toEqual({ verdict: 'daily', retryAfter: 36000 })
    expect(f.consume).toHaveBeenCalledOnce()
    expect(f.hit).toHaveBeenCalledTimes(2)

    // 次の UTC 日になれば再び日次 DO に問い合わせる
    f.consume.mockResolvedValue({ allowed: true, retryAfter: 0 })
    expect(await decideApiRateLimit(f.value, '192.0.2.11', true, true, deps(Date.parse('2026-11-02T00:00:01Z'), cache)))
      .toEqual({ verdict: 'allow', retryAfter: 0 })
    expect(f.consume).toHaveBeenCalledTimes(2)
  })

  it('日次キャッシュは DO の retryAfter より長くしない（時計のずれで丸 1 日閉じない）', async () => {
    const f = fakeEnvironment()
    const cache: DailyCache = { closedUntil: 0 }
    f.consume.mockResolvedValue({ allowed: false, retryAfter: 1 })
    // Worker の時計は日付を跨いだ直後、DO の時計は跨ぐ直前だった場合
    const now = Date.parse('2026-11-02T00:00:00.100Z')
    await decideApiRateLimit(f.value, '192.0.2.10', true, true, deps(now, cache))
    expect(cache.closedUntil).toBe(now + 1000)
  })

  it('キャッシュ中の GET は日次と無関係に通す', async () => {
    const f = fakeEnvironment()
    const cache: DailyCache = { closedUntil: NOW + 3600_000 }
    expect(await decideApiRateLimit(f.value, '192.0.2.10', false, false, deps(NOW, cache))).toEqual({ verdict: 'allow', retryAfter: 0 })
  })

  it('DO に渡すキーは 64 桁の 16 進で、IP 文字列を含まない', async () => {
    const f = fakeEnvironment()
    await decideApiRateLimit(f.value, '192.0.2.10', false, false, deps())
    const key = f.hit.mock.calls[0][0]
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('192.0.2.10')
    expect(f.shardNames[0]).toMatch(/^api-rate:v1:shard-[0-3]$/)
    expect(JSON.stringify(f.shardNames)).not.toContain('192.0.2.10')
  })

  it('キーは SHA-256("api-rate:v1:" + rateLimitKey) で、/64 と IPv4-mapped は同じキーになる', async () => {
    const f = fakeEnvironment()
    await decideApiRateLimit(f.value, '2001:db8:1:2:aaaa::1', false, false, deps())
    await decideApiRateLimit(f.value, '2001:db8:1:2:bbbb:cccc:dddd:eeee', false, false, deps())
    await decideApiRateLimit(f.value, '::ffff:192.0.2.10', false, false, deps())
    await decideApiRateLimit(f.value, '192.0.2.10', false, false, deps())
    const keys = f.hit.mock.calls.map(call => call[0])
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).toBe(keys[3])
    expect(keys[0]).not.toBe(keys[2])
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('api-rate:v1:ip:192.0.2.10'))
    const expected = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    expect(keys[3]).toBe(expected)
    expect(f.shardNames[3]).toBe(apiRateShardName(parseInt(expected.slice(0, 8), 16) % 4))
  })

  it.each([
    ['シャードの例外', 'hit'], ['日次の例外', 'consume'],
  ] as const)('%s は rate-limit-counter-failed で、IP を文言に出さない', async (_name, method) => {
    const f = fakeEnvironment()
    f[method].mockRejectedValue(new Error('overloaded for 192.0.2.10'))
    const error = await decideApiRateLimit(f.value, '192.0.2.10', true, true, deps()).catch(e => e as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('rate-limit-counter-failed')
  })

  it('stub の取得自体が投げても rate-limit-counter-failed', async () => {
    const f = fakeEnvironment()
    f.env.API_RATE_SHARDS.get.mockImplementation(() => { throw new Error('no stub 192.0.2.10') })
    await expect(decideApiRateLimit(f.value, '192.0.2.10', false, false, deps())).rejects.toThrow(/^rate-limit-counter-failed$/)
  })

  it.each([
    undefined, null, {}, { allowed: 'true' }, { allowed: false }, { allowed: false, retryAfter: 0 },
    { allowed: false, retryAfter: 61 }, { allowed: false, retryAfter: 1.5 }, { allowed: false, retryAfter: '10' },
  ])('シャードの不正な戻り値 %j は rate-limit-result-unavailable', async raw => {
    const f = fakeEnvironment()
    f.hit.mockResolvedValue(raw)
    await expect(decideApiRateLimit(f.value, '192.0.2.10', true, true, deps())).rejects.toThrow('rate-limit-result-unavailable')
    expect(f.consume).not.toHaveBeenCalled()
  })

  it.each([
    undefined, { allowed: 1 }, { allowed: false }, { allowed: false, retryAfter: 0 }, { allowed: false, retryAfter: 86401 },
  ])('日次の不正な戻り値 %j は rate-limit-result-unavailable', async raw => {
    const f = fakeEnvironment()
    f.consume.mockResolvedValue(raw)
    await expect(decideApiRateLimit(f.value, '192.0.2.10', true, true, deps())).rejects.toThrow('rate-limit-result-unavailable')
  })

  it.each([
    ['API_RATE_LIMIT_PER_MINUTE', 'x'], ['API_MUTATION_RATE_LIMIT_PER_MINUTE', '0'],
    ['API_MUTATION_DAILY_LIMIT', ''], ['API_MUTATION_DAILY_LIMIT', undefined],
  ] as const)('設定 %s=%s が不正なら DO を呼ばずに throw', async (name, value) => {
    const f = fakeEnvironment()
    ;(f.env as Record<string, unknown>)[name] = value
    await expect(decideApiRateLimit(f.value, '192.0.2.10', true, true, deps())).rejects.toThrow('rate-limit-config-unavailable')
    expect(f.env.API_RATE_SHARDS.idFromName).not.toHaveBeenCalled()
    expect(f.hit).not.toHaveBeenCalled()
  })

  it.each(['API_RATE_SHARDS', 'API_DAILY_MUTATIONS'] as const)('%s が欠落していれば DO を呼ばずに throw', async name => {
    const f = fakeEnvironment()
    delete (f.env as Partial<typeof f.env>)[name]
    await expect(decideApiRateLimit(f.value, '192.0.2.10', false, false, deps())).rejects.toThrow('rate-limit-binding-unavailable')
    expect(f.hit).not.toHaveBeenCalled()
  })

  it('RPC からの不正な引数は DO を呼ばず拒否する', async () => {
    const f = fakeEnvironment()
    await expect(decideApiRateLimit(f.value, 'invalid-client-value', false, false, deps())).rejects.toThrow('rate-limit-input-unavailable')
    await expect(decideApiRateLimit(f.value, '192.0.2.10', 'false' as unknown as boolean, false, deps())).rejects.toThrow('rate-limit-input-unavailable')
    await expect(decideApiRateLimit(f.value, '192.0.2.10', true, 1 as unknown as boolean, deps())).rejects.toThrow('rate-limit-input-unavailable')
    expect(f.hit).not.toHaveBeenCalled()
  })

  // middleware はこの判定で「新 Worker の失敗」と「旧 Worker（メソッド無し）」を分ける。投げる符号と一覧がずれないこと
  it('判定が投げる失敗はすべて isRateLimitFailure が新 Worker の失敗と認める', async () => {
    const failures: Array<(f: ReturnType<typeof fakeEnvironment>) => Promise<unknown>> = [
      f => { f.consume.mockRejectedValue(new Error('daily overloaded')); return decideApiRateLimit(f.value, '192.0.2.10', true, true, deps()) },
      f => { f.hit.mockResolvedValue({}); return decideApiRateLimit(f.value, '192.0.2.10', false, false, deps()) },
      f => { f.env.API_RATE_LIMIT_PER_MINUTE = 'x'; return decideApiRateLimit(f.value, '192.0.2.10', false, false, deps()) },
      f => { delete (f.env as Partial<typeof f.env>).API_RATE_SHARDS; return decideApiRateLimit(f.value, '192.0.2.10', false, false, deps()) },
      f => decideApiRateLimit(f.value, 'invalid-client-value', false, false, deps()),
    ]
    const messages: string[] = []
    for (const run of failures) {
      const error = await run(fakeEnvironment()).then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      messages.push((error as Error).message)
      expect(isRateLimitFailure(error), (error as Error).message).toBe(true)
    }
    expect(new Set(messages).size).toBe(5)
    expect(isRateLimitFailure(new Error('method not found'))).toBe(false)
    expect(isRateLimitFailure(new Error('rate-limit-counter-failed: extra'))).toBe(false)
    expect(isRateLimitFailure('rate-limit-counter-failed')).toBe(false)
    expect(isRateLimitFailure(undefined)).toBe(false)
  })

  it('checkApiRateLimit（旧 Pages 互換）は allow だけを true にする', async () => {
    const f = fakeEnvironment()
    expect(await checkApiRateLimit(f.value, '192.0.2.10', true, deps())).toBe(true)
    expect(f.consume).toHaveBeenCalledOnce()
    f.hit.mockResolvedValue({ allowed: false, retryAfter: 10 })
    expect(await checkApiRateLimit(f.value, '192.0.2.10', false, deps())).toBe(false)
    f.hit.mockResolvedValue({ allowed: true, retryAfter: 0 })
    f.consume.mockResolvedValue({ allowed: false, retryAfter: 100 })
    expect(await checkApiRateLimit(f.value, '192.0.2.10', true, deps())).toBe(false)
  })
})

describe('readMutationUsage（/api/status 用）', () => {
  it('日次 DO の usage に上限を添えて返す', async () => {
    const f = fakeEnvironment()
    expect(await readMutationUsage(f.value)).toEqual({ day: '2026-11-01', used: 12, limit: 1300 })
    expect(f.consume).not.toHaveBeenCalled()
  })

  it.each([undefined, { day: '2026-11-01' }, { day: 'x', used: 1 }, { day: '2026-11-01', used: -1 }, { day: '2026-11-01', used: 1.5 }])(
    '不正な usage %j は throw', async raw => {
      const f = fakeEnvironment()
      f.usage.mockResolvedValue(raw)
      await expect(readMutationUsage(f.value)).rejects.toThrow('rate-limit-result-unavailable')
    }
  )
})

describe('名前付き RPC クラス（Node 単体用の入口 stub）', () => {
  it('checkDetailed / check / mutationUsage が環境を判定へ渡す', async () => {
    const f = fakeEnvironment()
    const entrypoint = new ApiRateLimiter({} as ExecutionContext, f.value)
    expect(await entrypoint.checkDetailed('192.0.2.10', true, false)).toEqual({ verdict: 'allow', retryAfter: 0 })
    expect(f.consume).not.toHaveBeenCalled()
    expect(await entrypoint.check('192.0.2.10', true)).toBe(true)
    expect(f.consume).toHaveBeenCalledOnce()
    // countsTowardDaily を省略した旧形式の呼出しは変更系なら日次に数える
    expect(await entrypoint.checkDetailed('192.0.2.10', true)).toEqual({ verdict: 'allow', retryAfter: 0 })
    expect(f.consume).toHaveBeenCalledTimes(2)
    expect(await entrypoint.mutationUsage()).toEqual({ day: '2026-11-01', used: 12, limit: 1300 })
  })

  it('check は ip / daily をどちらも false にする', async () => {
    const f = fakeEnvironment()
    const entrypoint = new ApiRateLimiter({} as ExecutionContext, f.value)
    f.hit.mockResolvedValueOnce({ allowed: false, retryAfter: 5 })
    expect(await entrypoint.check('192.0.2.10', false)).toBe(false)
  })
})
