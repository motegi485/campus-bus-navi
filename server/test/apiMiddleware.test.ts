/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../functions/api/_middleware'

function context(options: {
  method?: string
  ip?: string | null
  forwardedIp?: string
  binding?: 'missing' | 'failure' | 'invalid' | 'limited'
} = {}) {
  const headers = new Headers()
  if (options.ip !== null) headers.set('CF-Connecting-IP', options.ip ?? '192.0.2.10')
  if (options.forwardedIp) headers.set('X-Forwarded-For', options.forwardedIp)
  const check = vi.fn(async (_ip: string, _isMutation: boolean): Promise<boolean> => {
    if (options.binding === 'failure') throw new Error('RPC detail containing 192.0.2.10')
    if (options.binding === 'invalid') return undefined as unknown as boolean
    return options.binding !== 'limited'
  })
  // next が D1 に触れる API 本体への境界になる。
  const next = vi.fn(async () => new Response('api-response', { status: 201 }))
  return {
    check, next,
    value: {
      request: new Request('https://app.example.test/api/reminders', { method: options.method ?? 'GET', headers }),
      env: options.binding === 'missing' ? {} : { API_RATE_LIMITER: { check } },
      next,
    } as unknown as Parameters<typeof onRequest>[0],
  }
}

describe('/api/ 共通 middleware', () => {
  it.each([
    ['GET', false], ['HEAD', false], ['OPTIONS', false],
    ['POST', true], ['PUT', true], ['PATCH', true], ['DELETE', true], ['REPORT', true],
  ])('%s も検査し、変更判定=%s で RPC に渡す', async (method, mutation) => {
    const ctx = context({ method })
    const response = await onRequest(ctx.value)
    expect(ctx.check).toHaveBeenCalledWith('192.0.2.10', mutation)
    expect(ctx.next).toHaveBeenCalledOnce()
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('api-response')
  })

  it('Cloudflare の IP を正規化し、X-Forwarded-For を無視する', async () => {
    const ctx = context({ ip: '2001:0DB8:0:0:0:0:0:1', forwardedIp: '192.0.2.99' })
    await onRequest(ctx.value)
    expect(ctx.check).toHaveBeenCalledWith('2001:db8::1', false)
  })

  it('超過時は API 本体へ進まず 429/no-store/Retry-After を返す', async () => {
    const ctx = context({ binding: 'limited', method: 'POST' })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(429)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it.each(['missing', 'failure', 'invalid'] as const)('%s は 503 とし障害を素通りさせない', async binding => {
    const ctx = context({ binding })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.text()).not.toContain('192.0.2.10')
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it.each([null, '', 'unknown', '256.0.0.1', 'example.test', '[::1]', '2001::db8::1'])(
    '実 IP=%s が欠落・不正なら XFF があっても RPC/D1 の手前で 503 にする', async ip => {
      const ctx = context({ ip, forwardedIp: '192.0.2.99' })
      const response = await onRequest(ctx.value)
      expect(response.status).toBe(503)
      expect(ctx.check).not.toHaveBeenCalled()
      expect(ctx.next).not.toHaveBeenCalled()
    }
  )

  it('許可後の API 本体の例外をレート制限障害へすり替えない', async () => {
    const ctx = context()
    ctx.next.mockRejectedValue(new Error('API handler failure'))
    await expect(onRequest(ctx.value)).rejects.toThrow('API handler failure')
  })
})

/** 新 Worker（checkDetailed あり）につないだときの経路 */
function detailedContext(options: {
  method?: string
  path?: string
  detailed?: () => Promise<unknown>
  check?: () => Promise<unknown>
} = {}) {
  const headers = new Headers({ 'CF-Connecting-IP': '192.0.2.10' })
  const checkDetailed = vi.fn(async (_ip: string, _isMutation: boolean, _countsTowardDaily: boolean): Promise<unknown> =>
    options.detailed ? options.detailed() : { verdict: 'allow', retryAfter: 0 })
  const check = vi.fn(async (_ip: string, _isMutation: boolean): Promise<unknown> =>
    options.check ? options.check() : true)
  const next = vi.fn(async () => new Response('api-response', { status: 201 }))
  return {
    checkDetailed, check, next,
    value: {
      request: new Request(`https://app.example.test${options.path ?? '/api/reminders'}`, { method: options.method ?? 'GET', headers }),
      env: { API_RATE_LIMITER: { check, checkDetailed } },
      next,
    } as unknown as Parameters<typeof onRequest>[0],
  }
}

describe('/api/ 共通 middleware（checkDetailed）', () => {
  it('allow なら check を呼ばずに API 本体へ進む', async () => {
    const ctx = detailedContext({ method: 'POST' })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(201)
    expect(ctx.checkDetailed).toHaveBeenCalledWith('192.0.2.10', true, true)
    expect(ctx.check).not.toHaveBeenCalled()
  })

  it('ip なら従来の文言で 429、Retry-After は窓の残り秒数', async () => {
    const ctx = detailedContext({ detailed: async () => ({ verdict: 'ip', retryAfter: 17 }) })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('17')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'リクエストが多すぎます。少し待ってからやり直してください' })
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it('daily なら専用の文言で 429、Retry-After は次の 00:00 UTC まで', async () => {
    const ctx = detailedContext({ method: 'POST', detailed: async () => ({ verdict: 'daily', retryAfter: 39600 }) })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('39600')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: '本日の受付上限に達しました。日本時間 9 時以降にお試しください' })
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it.each([
    ['verdict が想定外', { verdict: 'deny', retryAfter: 10 }],
    ['allow に retryAfter 5', { verdict: 'allow', retryAfter: 5 }],
    ['ip の retryAfter 0', { verdict: 'ip', retryAfter: 0 }],
    ['ip の retryAfter 1.5', { verdict: 'ip', retryAfter: 1.5 }],
    ['ip の retryAfter 61', { verdict: 'ip', retryAfter: 61 }],
    ['daily の retryAfter 90000', { verdict: 'daily', retryAfter: 90000 }],
    ['retryAfter 欠落', { verdict: 'ip' }],
    ['undefined', undefined],
    ['真偽値', true],
  ])('不正な戻り値（%s）は check を呼ばずに 503', async (_name, raw) => {
    const ctx = detailedContext({ detailed: async () => raw })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(ctx.check).not.toHaveBeenCalled()
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it('checkDetailed が例外（旧 Worker）なら check へ戻り、true なら通す', async () => {
    const ctx = detailedContext({ detailed: async () => { throw new Error('method not found') } })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(201)
    expect(ctx.check).toHaveBeenCalledWith('192.0.2.10', false)
  })

  it('check へ戻って false なら 429 / Retry-After 60', async () => {
    const ctx = detailedContext({
      detailed: async () => { throw new Error('method not found') },
      check: async () => false,
    })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it.each([
    ['例外', async () => { throw new Error('DO overloaded 192.0.2.10') }],
    ['不正値', async () => 'yes'],
  ])('check へ戻って %s なら 503', async (_name, check) => {
    const ctx = detailedContext({ detailed: async () => { throw new Error('x') }, check })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('192.0.2.10')
    expect(ctx.next).not.toHaveBeenCalled()
  })

  // 新 Worker は判定の途中（シャードへ書いた後の日次 DO の失敗など）で投げることがある。
  // ここで check へ戻ると同じ要求をシャードに 2 回数え、日次 DO も 2 回呼ぶので、503 で止める。
  it.each([
    'rate-limit-counter-failed',
    'rate-limit-result-unavailable',
    'rate-limit-config-unavailable',
    'rate-limit-binding-unavailable',
    'rate-limit-input-unavailable',
  ])('checkDetailed が新 Worker の失敗（%s）を投げたら check へ戻らず 503', async code => {
    const ctx = detailedContext({ method: 'POST', detailed: async () => { throw new Error(code) } })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(ctx.check).not.toHaveBeenCalled()
    expect(ctx.next).not.toHaveBeenCalled()
  })

  it.each([
    ['符号を含むだけの文言', 'rate-limit-counter-failed: extra'],
    ['前置きのある文言', 'Error: rate-limit-counter-failed'],
  ])('完全一致しない例外（%s）は旧 Worker と同じく check へ戻る', async (_name, message) => {
    const ctx = detailedContext({ detailed: async () => { throw new Error(message) } })
    const response = await onRequest(ctx.value)
    expect(response.status).toBe(201)
    expect(ctx.check).toHaveBeenCalledOnce()
  })

  it.each([
    ['DELETE', '/api/subscribe', true, false],
    ['POST', '/api/unsubscribe', true, false],
    ['POST', '/api/subscribe', true, true],
    ['POST', '/api/reminders', true, true],
    ['DELETE', '/api/reminders', true, true],
    ['GET', '/api/reminders', false, false],
    // 表記の揺れは日次に数える側（安全側）へ倒す
    ['DELETE', '/api/subscribe/', true, true],
    ['POST', '/api/unsubscribe/', true, true],
  ])('%s %s は isMutation=%s / countsTowardDaily=%s', async (method, path, mutation, daily) => {
    const ctx = detailedContext({ method, path })
    await onRequest(ctx.value)
    expect(ctx.checkDetailed).toHaveBeenCalledWith('192.0.2.10', mutation, daily)
  })

  it('小文字のメソッドでも解除経路を判定する', async () => {
    const ctx = detailedContext({ method: 'delete', path: '/api/subscribe' })
    await onRequest(ctx.value)
    expect(ctx.checkDetailed).toHaveBeenCalledWith('192.0.2.10', true, false)
  })
})
