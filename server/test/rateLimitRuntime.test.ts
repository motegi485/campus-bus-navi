/**
 * 実際の workerd で、Pages middleware → 名前付き RPC → native RateLimit を接続する。
 * Wrangler 同梱の Miniflare / esbuild を使用し、外部接続・D1・秘密情報は使わない。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { fileURLToPath } from 'node:url'

let runtime: Miniflare | undefined

beforeAll(async () => {
  const common = {
    bundle: true,
    write: false,
    format: 'esm' as const,
    platform: 'browser' as const,
    target: 'es2022',
    external: ['cloudflare:workers'],
    logLevel: 'silent' as const,
  }
  const worker = await build({
    ...common,
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  })
  const caller = await build({
    ...common,
    stdin: {
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      sourcefile: 'local-rate-limit-caller.ts',
      loader: 'ts',
      contents: `
        import { onRequest } from './functions/api/_middleware.ts'
        export default {
          async fetch(request, env) {
            // テストだけの入力。実 middleware が読む CF ヘッダを明示して経路を再現する。
            const ip = new URL(request.url).searchParams.get('testIp')
            const headers = new Headers(request.headers)
            if (ip === null) headers.delete('CF-Connecting-IP')
            else headers.set('CF-Connecting-IP', ip)
            return onRequest({
              request: new Request(request, { headers }), env,
              next: async () => new Response('D1 処理の手前まで通過'),
            })
          },
        }
      `,
    },
  })
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: '127.0.0.1',
    workers: [
      {
        name: 'pages-test',
        modules: true,
        script: caller.outputFiles![0].text,
        compatibilityDate: '2025-01-01',
        serviceBindings: {
          API_RATE_LIMITER: { name: 'rate-test', entrypoint: 'ApiRateLimiter' },
        },
        outboundService: () => { throw new Error('テスト中の外部通信は禁止') },
      },
      {
        name: 'rate-test',
        modules: true,
        script: worker.outputFiles![0].text,
        compatibilityDate: '2025-01-01',
        ratelimits: {
          // 本番と同じ binding 名。少ない要求で両方の制限へ到達させる。
          API_RATE_LIMIT: { namespace_id: '1', simple: { limit: 5, period: 60 } },
          API_MUTATION_RATE_LIMIT: { namespace_id: '2', simple: { limit: 2, period: 60 } },
        },
        outboundService: () => { throw new Error('テスト中の外部通信は禁止') },
      },
    ],
  }))
  await runtime.ready
}, 30_000)

afterAll(async () => { await runtime?.dispose() }, 30_000)

async function request(ip?: string, method = 'GET') {
  const query = ip === undefined ? '' : `?testIp=${encodeURIComponent(ip)}`
  return runtime!.dispatchFetch(`https://app.example.test/api/status${query}`, { method })
}

describe('native RateLimit と名前付き RPC の接続', () => {
  it('同じ IP の超過を 429 にし、別 IP の正常な要求を通す', async () => {
    const statuses: number[] = []
    // 分の境界で一度リセットされても制限動作を観測できる件数。
    for (let i = 0; i < 12; i++) {
      const response = await request('198.51.100.41')
      statuses.push(response.status)
      await response.text()
    }
    expect(statuses[0]).toBe(200)
    expect(statuses).toContain(429)
    const nextIp = await request('198.51.100.42')
    expect(nextIp.status).toBe(200)
    expect(await nextIp.text()).toBe('D1 処理の手前まで通過')
  })

  it('変更系は全体の上限より先に制限され、読取りは残る', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const response = await request('198.51.100.43', 'POST')
      statuses.push(response.status)
      if (response.status === 429) {
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(response.headers.get('Retry-After')).toBe('60')
      }
      await response.text()
    }
    expect(statuses[0]).toBe(200)
    expect(statuses).toContain(429)
    const read = await request('198.51.100.43')
    expect(read.status).toBe(200)
    await read.text()
  })

  it('接続元 IP が無い・不正なら D1 側へ進めず 503 にする', async () => {
    for (const ip of [undefined, 'not-an-ip']) {
      const response = await request(ip)
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('D1 処理の手前まで通過')
    }
  })
})
