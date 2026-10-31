/**
 * 実際の workerd で、Pages middleware → 名前付き RPC → Durable Object（SQLite）の計数を接続する。
 * Wrangler 同梱の Miniflare / esbuild を使用し、外部接続・D1・秘密情報は使わない。
 *
 * 固定窓は分の境界でリセットされるため、各検査の前に分の残りが足りなければ次の分まで待つ。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const IP_MESSAGE = 'リクエストが多すぎます'
const DAILY_MESSAGE = '本日の受付上限に達しました'
const PASSED = 'D1 処理の手前まで通過'

const common = {
  bundle: true,
  write: false,
  format: 'esm' as const,
  platform: 'browser' as const,
  target: 'es2022',
  external: ['cloudflare:workers'],
  logLevel: 'silent' as const,
}

async function bundleSource(sourcefile: string, contents: string): Promise<string> {
  const result = await build({
    ...common,
    stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), sourcefile, loader: 'ts', contents },
  })
  return result.outputFiles![0].text
}

let workerScript = ''
let pagesScript = ''
let oldPagesScript = ''
let oldWorkerScript = ''
let throwingDoScript = ''
let cleanupScript = ''

const noOutbound = () => { throw new Error('テスト中の外部通信は禁止') }

function vars(all = '5', mutation = '2', daily = '1000'): Record<string, string> {
  return {
    API_RATE_LIMIT_PER_MINUTE: all,
    API_MUTATION_RATE_LIMIT_PER_MINUTE: mutation,
    API_MUTATION_DAILY_LIMIT: daily,
  }
}

/**
 * 本番と同じ binding 名の Worker。throwingScript を渡すと DO を例外を投げるクラスへ差し替える。
 * throwing='daily' なら日次 DO だけを差し替え、シャードは本物の SQLite DO のまま使う。
 */
function rateWorker(name: string, bindings: Record<string, string>, throwingScript?: string, throwing: 'both' | 'daily' = 'both') {
  const durableObject = (className: string, throwingClass: string, replace: boolean) => throwingScript === undefined || !replace
    ? { className, useSQLite: true }
    : { className: throwingClass, scriptName: throwingScript, useSQLite: true }
  return {
    name,
    modules: true,
    script: workerScript,
    compatibilityDate: '2025-01-01',
    bindings,
    durableObjects: {
      API_RATE_SHARDS: durableObject('ApiRateLimitShard', 'ThrowingShard', throwing === 'both'),
      API_DAILY_MUTATIONS: durableObject('ApiDailyMutationBudget', 'ThrowingDaily', true),
    },
    outboundService: noOutbound,
  }
}

function pagesWorker(name: string, target: string, script = pagesScript) {
  return {
    name,
    modules: true,
    script,
    compatibilityDate: '2025-01-01',
    serviceBindings: { API_RATE_LIMITER: { name: target, entrypoint: 'ApiRateLimiter' } },
    outboundService: noOutbound,
  }
}

function plainWorker(name: string, script: string) {
  return { name, modules: true, script, compatibilityDate: '2025-01-01', outboundService: noOutbound }
}

function createRuntime(workers: unknown[], resourcePersistencePath?: string): Miniflare {
  return new Miniflare(convertV4MiniflareOptions({
    host: '127.0.0.1',
    ...(resourcePersistencePath === undefined ? {} : { resourcePersistencePath }),
    workers,
  } as Parameters<typeof convertV4MiniflareOptions>[0]))
}

async function send(runtime: Miniflare, worker: string, ip: string | undefined, method = 'GET', path = '/api/status') {
  const fetcher = await runtime.getWorker(worker)
  const query = ip === undefined ? '' : `?testIp=${encodeURIComponent(ip)}`
  const response = await fetcher.fetch(`https://app.example.test${path}${query}`, { method })
  return {
    status: response.status,
    retryAfter: response.headers.get('Retry-After'),
    cacheControl: response.headers.get('Cache-Control'),
    text: await response.text(),
  }
}

/** 分（と UTC 日）の残りが needSeconds 未満なら、次の境界まで待つ */
async function waitForFreshWindow(needSeconds: number): Promise<void> {
  const now = Date.now()
  const leftInMinute = 60_000 - (now % 60_000)
  const leftInDay = 86_400_000 - (now % 86_400_000)
  let wait = 0
  if (leftInMinute < needSeconds * 1000) wait = leftInMinute + 250
  if (leftInDay < needSeconds * 1000) wait = Math.max(wait, leftInDay + 250)
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
}

function secondsUntilNextUtcDay(nowMs: number): number {
  return Math.ceil((86_400_000 - (nowMs % 86_400_000)) / 1000)
}

let runtime: Miniflare | undefined

beforeAll(async () => {
  workerScript = (await build({
    ...common,
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  })).outputFiles![0].text
  // 新 middleware（functions/api/_middleware.ts）をそのまま使う呼出し側
  pagesScript = await bundleSource('local-rate-limit-caller.ts', `
    import { onRequest } from './functions/api/_middleware.ts'
    export default {
      async fetch(request, env) {
        // テストだけの入力。実 middleware が読む CF ヘッダを明示して経路を再現する。
        const url = new URL(request.url)
        const ip = url.searchParams.get('testIp')
        const headers = new Headers(request.headers)
        if (ip === null) headers.delete('CF-Connecting-IP')
        else headers.set('CF-Connecting-IP', ip)
        url.search = ''
        return onRequest({
          request: new Request(url, { method: request.method, headers }), env,
          next: async () => new Response('${PASSED}'),
        })
      },
    }
  `)
  // 旧 middleware の代役: check(ip, isMutation) だけを呼ぶ
  oldPagesScript = await bundleSource('old-pages-caller.ts', `
    export default {
      async fetch(request, env) {
        const ip = new URL(request.url).searchParams.get('testIp')
        const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        const allowed = await env.API_RATE_LIMITER.check(ip, isMutation)
        if (allowed === false) return new Response('limited', { status: 429, headers: { 'Retry-After': '60' } })
        return allowed === true ? new Response('${PASSED}') : new Response('invalid', { status: 503 })
      },
    }
  `)
  // 旧 Worker の代役: check だけを持ち、3 回目から false
  oldWorkerScript = await bundleSource('old-worker.ts', `
    import { WorkerEntrypoint } from 'cloudflare:workers'
    let count = 0
    export class ApiRateLimiter extends WorkerEntrypoint {
      async check(_ip, _isMutation) { count += 1; return count <= 2 }
    }
    export default { fetch: () => new Response('unused', { status: 404 }) }
  `)
  // DO の障害の代役。例外の文言に IP を含めても応答へ漏れないことを確かめる
  throwingDoScript = await bundleSource('throwing-do.ts', `
    import { DurableObject } from 'cloudflare:workers'
    export class ThrowingShard extends DurableObject {
      hit() { throw new Error('shard overloaded 198.51.100.77') }
    }
    export class ThrowingDaily extends DurableObject {
      consume() { throw new Error('daily overloaded 198.51.100.77') }
      usage() { throw new Error('daily overloaded 198.51.100.77') }
    }
    export default { fetch: () => new Response('unused', { status: 404 }) }
  `)
  // 実際の SQL と alarm の掃除を調べるための入口。判定と掃除は実クラスをそのまま使う。
  cleanupScript = await bundleSource('cleanup-probe.ts', `
    import { ApiRateLimitShard } from './server/src/apiRateLimitStore.ts'
    export class CleanupProbe extends ApiRateLimitShard {
      age(key) {
        const now = Date.now()
        this.ctx.storage.sql.exec('UPDATE counters SET window_start = ? WHERE key = ?', now - now % 60000 - 60000, key)
      }
      async snapshot() {
        return { rows: this.ctx.storage.sql.exec('SELECT key FROM counters ORDER BY key').toArray(), alarm: await this.ctx.storage.getAlarm() }
      }
      async runCleanup() {
        // システムが alarm を発火した状態を模擬する。時刻の到来や本番の配信遅延の検査ではない。
        await this.ctx.storage.deleteAlarm()
        await this.alarm()
      }
    }
    export default {
      async fetch(request, env) {
        const url = new URL(request.url)
        const shard = env.SHARD.get(env.SHARD.idFromName('cleanup-probe'))
        const key = url.searchParams.get('key')
        if (url.pathname === '/hit') await shard.hit(key, false, 5, 2)
        if (url.pathname === '/age') await shard.age(key)
        if (url.pathname === '/cleanup') await shard.runCleanup()
        return Response.json(await shard.snapshot())
      },
    }
  `)

  runtime = createRuntime([
    {
      ...plainWorker('cleanup-probe', cleanupScript),
      durableObjects: { SHARD: { className: 'CleanupProbe', useSQLite: true } },
    },
    pagesWorker('pages-test', 'rate-test'),
    rateWorker('rate-test', vars()),
    pagesWorker('pages-daily', 'rate-daily'),
    rateWorker('rate-daily', vars('50', '50', '3')),
    pagesWorker('pages-dailyconcurrent', 'rate-dailyconcurrent'),
    rateWorker('rate-dailyconcurrent', vars('50', '50', '3')),
    pagesWorker('pages-broken', 'rate-broken'),
    rateWorker('rate-broken', vars(), 'throwing-do'),
    pagesWorker('pages-dailybroken', 'rate-dailybroken'),
    rateWorker('rate-dailybroken', vars(), 'throwing-do', 'daily'),
    {
      // DO クラスは定義する側の Worker でも宣言しないと、scriptName で参照できない
      ...plainWorker('throwing-do', throwingDoScript),
      durableObjects: {
        SELF_SHARD: { className: 'ThrowingShard', useSQLite: true },
        SELF_DAILY: { className: 'ThrowingDaily', useSQLite: true },
      },
    },
    pagesWorker('pages-badconfig', 'rate-badconfig'),
    rateWorker('rate-badconfig', vars('x')),
    pagesWorker('pages-oldworker', 'old-rate'),
    plainWorker('old-rate', oldWorkerScript),
    pagesWorker('old-pages', 'rate-compat', oldPagesScript),
    rateWorker('rate-compat', vars()),
  ])
  await runtime.ready
}, 60_000)

afterAll(async () => { await runtime?.dispose() }, 30_000)

describe('実 SQLite のハッシュの掃除', () => {
  it('古い窓だけを削除し、現行の行があれば再予約し、空なら予約を終える', async () => {
    await waitForFreshWindow(15)
    const worker = await runtime!.getWorker('cleanup-probe')
    const probe = async (path: string) => {
      const response = await worker.fetch(`https://cleanup.example.test${path}`)
      expect(response.status).toBe(200)
      return await response.json() as { rows: { key: string }[]; alarm: number | null }
    }
    const oldKey = 'b'.repeat(64)
    const currentKey = 'c'.repeat(64)
    await probe(`/hit?key=${oldKey}`)
    await probe(`/age?key=${oldKey}`)
    await probe(`/hit?key=${currentKey}`)
    const afterCleanup = await probe('/cleanup')
    expect(afterCleanup.rows).toEqual([{ key: currentKey }])
    expect(afterCleanup.alarm).toBeGreaterThan(Date.now())
    await probe(`/age?key=${currentKey}`)
    expect(await probe('/cleanup')).toEqual({ rows: [], alarm: null })
    const next = await probe(`/hit?key=${oldKey}`)
    expect(next.rows).toEqual([{ key: oldKey }])
    expect(next.alarm).toBeGreaterThan(Date.now())
  }, 90_000)
})

describe('Durable Object による IP ごとの計数', () => {
  it('同じ IP の同時 30 要求でも、上限 5 件だけを許可する', async () => {
    await waitForFreshWindow(15)
    const results = await Promise.all(Array.from({ length: 30 }, () => send(runtime!, 'pages-test', '198.51.100.44')))
    expect(results.filter(r => r.status === 200)).toHaveLength(5)
    expect(results.filter(r => r.status === 429)).toHaveLength(25)
  }, 90_000)

  it('同じ IP の 1〜5 回目は 200、6 回目は 429 で、別 IP は 200', async () => {
    await waitForFreshWindow(10)
    const results = []
    for (let i = 0; i < 6; i++) results.push(await send(runtime!, 'pages-test', '198.51.100.41'))
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200, 200, 429])
    const limited = results[5]
    expect(limited.text).toContain(IP_MESSAGE)
    expect(limited.cacheControl).toBe('no-store')
    const retryAfter = Number(limited.retryAfter)
    expect(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60).toBe(true)
    const nextIp = await send(runtime!, 'pages-test', '198.51.100.42')
    expect(nextIp.status).toBe(200)
    expect(nextIp.text).toBe(PASSED)
  }, 90_000)

  // 修正前の攻撃: /128 ごとの枠だったので、同じ /64 のアドレスを 1 回ずつ使い分けると全件 200 で通った
  it('同じ /64 の別アドレスを使い分けても 6 回目で 429 になり、別の /64 は通る', async () => {
    await waitForFreshWindow(10)
    const statuses: number[] = []
    for (let i = 1; i <= 6; i++) statuses.push((await send(runtime!, 'pages-test', `2001:db8:1:2::${i.toString(16)}`)).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
    const otherNet = await send(runtime!, 'pages-test', '2001:db8:1:3::1')
    expect(otherNet.status).toBe(200)
    expect(otherNet.text).toBe(PASSED)
  }, 90_000)

  it('変更系は 3 回目で 429 になっても、同じ IP の GET は通る', async () => {
    await waitForFreshWindow(10)
    const results = []
    for (let i = 0; i < 3; i++) results.push(await send(runtime!, 'pages-test', '198.51.100.43', 'POST'))
    expect(results.map(r => r.status)).toEqual([200, 200, 429])
    expect(results[2].cacheControl).toBe('no-store')
    expect(results[2].text).toContain(IP_MESSAGE)
    const read = await send(runtime!, 'pages-test', '198.51.100.43')
    expect(read.status).toBe(200)
  }, 90_000)

  it('接続元 IP が無い・不正なら D1 側へ進めず 503 にする', async () => {
    for (const ip of [undefined, 'not-an-ip']) {
      const response = await send(runtime!, 'pages-test', ip)
      expect(response.status).toBe(503)
      expect(response.text).not.toContain(PASSED)
    }
  })
})

describe('全利用者を合わせた変更系の 1 日の上限', () => {
  it('異なる IP の同時 30 要求でも、日次上限 3 件だけを許可する', async () => {
    await waitForFreshWindow(15)
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
      send(runtime!, 'pages-dailyconcurrent', `203.0.113.${10 + i}`, 'POST', '/api/reminders')))
    expect(results.filter(r => r.status === 200)).toHaveLength(3)
    const rejected = results.filter(r => r.status === 429)
    expect(rejected).toHaveLength(27)
    expect(rejected.every(r => r.text.includes(DAILY_MESSAGE))).toBe(true)
  }, 90_000)

  it('上限 3 なら 4 件目の変更系は専用文言の 429 で、GET と解除 2 経路は通る', async () => {
    await waitForFreshWindow(15)
    expect((await send(runtime!, 'pages-daily', '198.51.100.51', 'POST', '/api/reminders')).status).toBe(200)
    expect((await send(runtime!, 'pages-daily', '198.51.100.51', 'POST', '/api/subscribe')).status).toBe(200)
    expect((await send(runtime!, 'pages-daily', '198.51.100.52', 'POST', '/api/reminders')).status).toBe(200)

    const before = Date.now()
    const closed = await send(runtime!, 'pages-daily', '198.51.100.53', 'POST', '/api/reminders')
    const after = Date.now()
    expect(closed.status).toBe(429)
    expect(closed.text).toContain(DAILY_MESSAGE)
    expect(closed.text).not.toContain(IP_MESSAGE)
    expect(closed.cacheControl).toBe('no-store')
    const retryAfter = Number(closed.retryAfter)
    expect(retryAfter).toBeGreaterThanOrEqual(secondsUntilNextUtcDay(after) - 2)
    expect(retryAfter).toBeLessThanOrEqual(secondsUntilNextUtcDay(before) + 2)

    // 別 IP の変更系も同じ上限（isolate のキャッシュまたは日次 DO）で止まる
    expect((await send(runtime!, 'pages-daily', '198.51.100.54', 'POST', '/api/reminders')).text).toContain(DAILY_MESSAGE)
    // 読取りは日次の対象外
    expect((await send(runtime!, 'pages-daily', '198.51.100.53')).status).toBe(200)
    // 解除の 2 経路は日次上限の後も通す（IP ごとの制限だけ）
    const unsubscribe = await send(runtime!, 'pages-daily', '198.51.100.53', 'DELETE', '/api/subscribe')
    expect(unsubscribe.status).toBe(200)
    expect(unsubscribe.text).toBe(PASSED)
    expect((await send(runtime!, 'pages-daily', '198.51.100.53', 'POST', '/api/unsubscribe')).status).toBe(200)
  }, 90_000)
})

describe('障害時はフェイルクローズ（503）', () => {
  it.each(['GET', 'POST'])('DO の例外なら %s を 503 にし、本文に IP や例外の文言を出さない', async method => {
    const response = await send(runtime!, 'pages-broken', '198.51.100.77', method)
    expect(response.status).toBe(503)
    expect(response.retryAfter).toBe('60')
    expect(response.text).not.toContain('198.51.100.77')
    expect(response.text).not.toContain('overloaded')
    expect(response.text).not.toContain(PASSED)
  })

  // シャードに書いた後で日次 DO が投げる経路。middleware が check へ戻ると、同じ要求をシャードに 2 回数えていた
  it('シャードは成功し日次 DO だけが例外なら 503 で、その要求はシャードに 1 回だけ数える', async () => {
    await waitForFreshWindow(15)
    const ip = '198.51.100.79'
    const failed = await send(runtime!, 'pages-dailybroken', ip, 'POST', '/api/reminders')
    expect(failed.status).toBe(503)
    expect(failed.retryAfter).toBe('60')
    expect(failed.text).not.toContain(ip)
    expect(failed.text).not.toContain('overloaded')
    // 全体の上限 5: 失敗した POST が 1 回分なら GET は 4 回通り 5 回目で 429（2 回分なら 3 回で止まる）
    const reads: number[] = []
    for (let i = 0; i < 5; i++) reads.push((await send(runtime!, 'pages-dailybroken', ip)).status)
    expect(reads).toEqual([200, 200, 200, 200, 429])
  }, 90_000)

  it('日次 DO だけが例外のとき、変更系の IP 枠は 1 要求 1 回分だけ減る', async () => {
    await waitForFreshWindow(15)
    const ip = '198.51.100.80'
    // 変更系の上限 2: 1・2 回目は日次 DO の例外で 503、3 回目はシャードが拒否して 429（二重に数えると 2 回目で 429）
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) statuses.push((await send(runtime!, 'pages-dailybroken', ip, 'POST', '/api/reminders')).status)
    expect(statuses).toEqual([503, 503, 429])
  }, 90_000)

  it('設定値が正の整数でなければ 503', async () => {
    const response = await send(runtime!, 'pages-badconfig', '198.51.100.78')
    expect(response.status).toBe(503)
    expect(response.text).not.toContain('198.51.100.78')
  })
})

describe('新旧の組み合わせ（Pages と Worker は別デプロイ）', () => {
  it('新 middleware × 旧 Worker（check だけ）は check に戻って 200、false なら 429 / Retry-After 60', async () => {
    const statuses = []
    for (let i = 0; i < 3; i++) statuses.push(await send(runtime!, 'pages-oldworker', '198.51.100.61'))
    expect(statuses.map(r => r.status)).toEqual([200, 200, 429])
    expect(statuses[2].retryAfter).toBe('60')
    expect(statuses[2].text).toContain(IP_MESSAGE)
  })

  it('旧 middleware（check だけ）× 新 Worker は DO の数えで 6 回目に false → 429', async () => {
    await waitForFreshWindow(10)
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await send(runtime!, 'old-pages', '198.51.100.62')).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  }, 90_000)
})

describe('数えの永続性（SQLite に書く）', () => {
  // DO の SQLite に書いた数えが、ランタイムの再起動（DO の退避・再生成を含む）を越えて残ることを確かめる。
  // 注: Miniflare の native RateLimit 模擬も DO + SQLite で resourcePersistencePath に保存するため、
  // この検査は本番の native binding（拠点ごと・近似）との違いを再現するものではない。
  it('ランタイムを再起動しても数えが残り、6 回目は 429', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'campus-bus-navi-rate-'))
    const workers = () => [pagesWorker('pages-persist', 'rate-persist'), rateWorker('rate-persist', vars())]
    try {
      await waitForFreshWindow(30)
      let persisted = createRuntime(workers(), dir)
      try {
        await persisted.ready
        const statuses: number[] = []
        for (let i = 0; i < 5; i++) statuses.push((await send(persisted, 'pages-persist', '198.51.100.71')).status)
        expect(statuses).toEqual([200, 200, 200, 200, 200])
      } finally {
        await persisted.dispose()
      }
      persisted = createRuntime(workers(), dir)
      try {
        await persisted.ready
        const sixth = await send(persisted, 'pages-persist', '198.51.100.71')
        expect(sixth.status).toBe(429)
        expect(sixth.text).toContain(IP_MESSAGE)
      } finally {
        await persisted.dispose()
      }
    } finally {
      // 一時ディレクトリはこの検査が作ったもの。Windows で workerd の解放待ちになっても検査結果は変えない
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
    }
  }, 120_000)
})
