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
