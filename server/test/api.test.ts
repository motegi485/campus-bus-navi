/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as subscribe, onRequestDelete as removeSubscription } from '../../functions/api/subscribe'
import { onRequestPost as unsubscribe } from '../../functions/api/unsubscribe'
import { onRequestGet as getReminders, onRequestPost as saveReminders } from '../../functions/api/reminders'
import { onRequestGet as getStatus } from '../../functions/api/status'
import { onRequestGet as getVapidKey } from '../../functions/api/vapid-key'
import { MAX_JSON_BODY_BYTES } from '../src/apiRequest'
import { toJst } from '../src/schedule'

const ORIGIN = 'https://app.example.test'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-endpoint'

function database() {
  const statement = {
    bind: vi.fn(function () { return statement }),
    run: vi.fn(async () => ({ success: true })),
    first: vi.fn(async (): Promise<unknown> => ({ known: 1 })),
    all: vi.fn(async () => ({ results: [{ route: 'station_to_campus', departure: '08:10', lead_minutes: 10 }] })),
  }
  return {
    prepare: vi.fn(() => statement),
    batch: vi.fn(async () => []),
    statement,
  }
}

type ApiHandler = typeof subscribe

const WEEKDAY_RULES = {
  default_rules: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map(d => [d, 'timetable_weekday'])),
  overrides: {} as Record<string, string>,
}

function weekdayTimetable(id = 'timetable_weekday') {
  const route = (times: string[]) => ({
    origin: 'o', destination: 'd', bus_stop_name: 'b', bus_stop_coords: { lat: 0, lng: 0 },
    schedule: times.map(departure => ({ departure, note: '' })),
  })
  return { id, name: id, routes: { station_to_campus: route(['08:10', '12:00']), campus_to_station: route(['17:10']) } }
}

/**
 * Pages の ASSETS（同じデプロイの静的ファイル）のモック。
 * files のキーは URL のパス。値が Response なら毎回 clone して返す。関数なら呼んだ結果を返す。
 */
function assets(files: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/data/calendar_rules.json': WEEKDAY_RULES,
    '/data/timetables/timetable_weekday.json': weekdayTimetable(),
    '/data/timetables/timetable_closed.json': weekdayTimetable('timetable_closed'),
    ...files,
  }
  return {
    fetch: vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const entry = table[url.pathname]
      if (typeof entry === 'function') return (entry as () => Promise<Response>)()
      if (entry instanceof Response) return entry.clone()
      if (entry === undefined) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify(entry), { headers: { 'Content-Type': 'application/json' } })
    }),
  }
}

function invoke(handler: ApiHandler, request: Request, db = database(), env: Record<string, unknown> = {}) {
  return handler({ request, env: { DB: db, ASSETS: assets(), ...env } } as unknown as Parameters<ApiHandler>[0])
}

function request(body: string, headers: Record<string, string> = {}, method = 'POST') {
  return new Request(`${ORIGIN}/api/test`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

const mutations = [
  ['subscribe', subscribe, () => ({ endpoint: ENDPOINT, p256dh: 'test-key', auth: 'test-auth' })],
  ['delete subscribe', removeSubscription, () => ({ endpoint: ENDPOINT })],
  ['unsubscribe', unsubscribe, () => ({ endpoint: ENDPOINT })],
  ['reminders', saveReminders, () => ({
    endpoint: ENDPOINT, dateKey: toJst(Date.now()).dateKey,
    route: 'station_to_campus', departures: ['08:10'], leadMinutes: 10,
  })],
] as const

afterEach(() => vi.restoreAllMocks())

describe.each(mutations)('%s の書込み境界', (_name, handler, validBody) => {
  it.each(['https://other.example.test', 'null'])(
    '別 Origin %s は本文を読まず D1 に触れず拒否する', async origin => {
      const db = database()
      const req = request(JSON.stringify(validBody()), { Origin: origin })
      const response = await invoke(handler, req, db)
      expect(response.status).toBe(403)
      expect(req.bodyUsed).toBe(false)
      expect(db.prepare).not.toHaveBeenCalled()
      expect(db.batch).not.toHaveBeenCalled()
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  )

  it('text/plain JSON の単純リクエストは書込み前に拒否する', async () => {
    const db = database()
    const response = await invoke(handler, request(JSON.stringify(validBody()), { 'Content-Type': 'text/plain' }), db)
    expect(response.status).toBe(415)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it.each(['null', '[]', 'true', '{broken'])('不正な JSON object %s は 400 になる', async raw => {
    const db = database()
    const response = await invoke(handler, request(raw), db)
    expect(response.status).toBe(400)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('Content-Length が無くても実本文を 8 KiB で止める', async () => {
    const db = database()
    const body = JSON.stringify({ ...validBody(), padding: 'x'.repeat(MAX_JSON_BODY_BYTES) })
    const response = await invoke(handler, request(body), db)
    expect(response.status).toBe(413)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it.each([undefined, ORIGIN])('正当な JSON は通り Origin=%s と互換を保つ', async origin => {
    const db = database()
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
    if (origin) headers.Origin = origin
    const response = await invoke(handler, request(JSON.stringify(validBody()), headers), db)
    expect(response.status).toBe(200)
    expect(db.prepare).toHaveBeenCalled()
    expect(db.statement.run.mock.calls.length + db.batch.mock.calls.length).toBeGreaterThan(0)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

describe('本文サイズとストリームの境界', () => {
  it('大きい Content-Length は読取り前に拒否する', async () => {
    const db = database()
    const req = request('{}', { 'Content-Length': String(MAX_JSON_BODY_BYTES + 1) })
    const response = await invoke(subscribe, req, db)
    expect(response.status).toBe(413)
    expect(req.bodyUsed).toBe(false)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('ちょうど 8 KiB は受理する', async () => {
    const base = JSON.stringify({ endpoint: ENDPOINT, p256dh: 'k', auth: 'a', padding: '' })
    const body = base.replace('"padding":""', `"padding":"${'x'.repeat(MAX_JSON_BODY_BYTES - base.length)}"`)
    expect(new TextEncoder().encode(body)).toHaveLength(MAX_JSON_BODY_BYTES)
    expect((await invoke(subscribe, request(body))).status).toBe(200)
  })

  it('小さい Content-Length で偽装された分割ストリームも上限で cancel する', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(2048).fill(32)) },
      cancel,
    })
    const req = new Request(`${ORIGIN}/api/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' },
      body: stream, duplex: 'half',
    } as RequestInit)
    const db = database()
    expect((await invoke(subscribe, req, db)).status).toBe(413)
    expect(cancel).toHaveBeenCalledOnce()
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('UTF-8 の途中で分割されても正常な JSON を読める', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ endpoint: ENDPOINT, p256dh: 'k', auth: 'a', memo: 'あ' }))
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) controller.close()
        else controller.enqueue(bytes.slice(offset, ++offset))
      },
    })
    const req = new Request(`${ORIGIN}/api/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
    } as RequestInit)
    expect((await invoke(subscribe, req)).status).toBe(200)
  })
})

describe('読取りとエラー応答', () => {
  it('不正な GET endpoint は D1 に触れず拒否する', async () => {
    const db = database()
    const response = await invoke(getReminders, new Request(`${ORIGIN}/api/reminders?endpoint=invalid&dateKey=2026-10-15`), db)
    expect(response.status).toBe(400)
    expect(db.prepare).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('正当な GET は予約を復元しキャッシュしない', async () => {
    const db = database()
    const response = await invoke(getReminders, new Request(`${ORIGIN}/api/reminders?endpoint=${encodeURIComponent(ENDPOINT)}&dateKey=2026-10-15`), db)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reminders: [{ route: 'station_to_campus', departure: '08:10', leadMinutes: 10 }] })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('D1 の内部例外は status 応答へ含めない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = database()
    db.statement.first.mockRejectedValue(new Error('internal-schema-and-driver-detail'))
    const response = await invoke(getStatus, statusRequest(`Bearer ${STATUS_TOKEN}`), db, { STATUS_TOKEN })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('internal-schema-and-driver-detail')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('公開鍵の正常応答だけは短い公開キャッシュを維持する', async () => {
    const response = await getVapidKey({ env: { VAPID_PUBLIC_KEY: 'public-test-key' } } as Parameters<typeof getVapidKey>[0])
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    const unavailable = await getVapidKey({ env: { VAPID_PUBLIC_KEY: '' } } as Parameters<typeof getVapidKey>[0])
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('Cache-Control')).toBe('no-store')
  })
})

/**
 * 修正前の攻撃: 時刻表に無い便（03:33 など）を予約すると、selectDue で送られないまま
 * sent_at が NULL で残り、送信窓のあいだ毎分 Cron の SQL に引かれて LIMIT の枠を占めた。
 */
describe('POST /api/reminders の便の実在検査', () => {
  const body = (departures: string[], dateKey = toJst(Date.now()).dateKey) =>
    JSON.stringify({ endpoint: ENDPOINT, dateKey, route: 'station_to_campus', departures, leadMinutes: 10 })

  it('時刻表に無い便は D1 に触れず 400（サーバの当日を返す）', async () => {
    const db = database()
    const response = await invoke(saveReminders, request(body(['03:33'])), db)
    expect(response.status).toBe(400)
    const json = await response.json() as { error: string; today: string }
    expect(json.today).toBe(toJst(Date.now()).dateKey)
    expect(json.error).toContain('時刻表に無い便')
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('実在する便と無い便が混ざっていても 400', async () => {
    const db = database()
    expect((await invoke(saveReminders, request(body(['08:10', '03:33'])), db)).status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('運休日（overrides で timetable_closed）は 400', async () => {
    const today = toJst(Date.now()).dateKey
    const db = database()
    const env = { ASSETS: assets({ '/data/calendar_rules.json': { ...WEEKDAY_RULES, overrides: { [today]: 'timetable_closed' } } }) }
    const response = await invoke(saveReminders, request(body(['08:10'])), db, env)
    expect(response.status).toBe(400)
    expect(env.ASSETS.fetch.mock.calls.map(([u]) => new URL(String(u)).pathname))
      .toEqual(['/data/calendar_rules.json', '/data/timetables/timetable_closed.json'])
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('過去便でも当日の時刻表に実在すれば受理する（時刻の前後は判定しない）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T23:00:00+09:00'))
    const db = database()
    const response = await invoke(saveReminders, request(body(['08:10'], '2026-10-16')), db)
    expect(response.status).toBe(200)
    expect(db.batch).toHaveBeenCalledOnce()
  })

  it('空配列（全解除）は時刻表を取りに行かず受理する', async () => {
    const db = database()
    const env = { ASSETS: assets() }
    const response = await invoke(saveReminders, request(body([])), db, env)
    expect(response.status).toBe(200)
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
    expect(db.batch).toHaveBeenCalledOnce()
  })

  it.each([
    ['calendar_rules が 404', { '/data/calendar_rules.json': new Response('nf', { status: 404 }) }],
    ['timetable が 404', { '/data/timetables/timetable_weekday.json': new Response('nf', { status: 404 }) }],
    ['SPA フォールバックの HTML', { '/data/calendar_rules.json': new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }) }],
    ['ASSETS の例外', { '/data/calendar_rules.json': async () => { throw new Error('assets down') } }],
    ['routes の無い timetable', { '/data/timetables/timetable_weekday.json': { id: 'timetable_weekday', name: 'x' } }],
  ])('%s なら 503 + Retry-After 60 で D1 に触れない', async (_name, files) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = database()
    const response = await invoke(saveReminders, request(body(['08:10'])), db, { ASSETS: assets(files) })
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).not.toContain('assets down')
    expect(db.prepare).not.toHaveBeenCalled()
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('calendar_rules が不正な ID を返したら timetable を取りに行かず 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const today = toJst(Date.now()).dateKey
    const db = database()
    const env = { ASSETS: assets({ '/data/calendar_rules.json': { ...WEEKDAY_RULES, overrides: { [today]: '../x' } } }) }
    const response = await invoke(saveReminders, request(body(['08:10'])), db, env)
    expect(response.status).toBe(503)
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
    expect(db.prepare).not.toHaveBeenCalled()
  })
})

const STATUS_TOKEN = 'test-status-token-0123456789abcdefghijklmn'

function statusRequest(authorization?: string) {
  const headers: Record<string, string> = {}
  if (authorization !== undefined) headers.Authorization = authorization
  return new Request(`${ORIGIN}/api/status`, { headers })
}

/**
 * 修正前の攻撃: 匿名の GET /api/status が毎回 subscriptions と reminders を全件集計し、
 * 1 IP あたり 600 件/分まで D1 の読み取りを消費させられた。
 */
describe('GET /api/status の合言葉', () => {
  it('STATUS_TOKEN が未設定なら D1 に触れず 503', async () => {
    const db = database()
    const response = await invoke(getStatus, statusRequest(`Bearer ${STATUS_TOKEN}`), db)
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('32 文字未満の STATUS_TOKEN は未設定扱いで 503', async () => {
    const short = STATUS_TOKEN.slice(0, 31)
    const db = database()
    const response = await invoke(getStatus, statusRequest(`Bearer ${short}`), db, { STATUS_TOKEN: short })
    expect(response.status).toBe(503)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it.each([
    ['Authorization なし', undefined],
    ['誤ったトークン', `Bearer ${STATUS_TOKEN.replace(/.$/, 'X')}`],
    ['Basic 形式', `Basic ${STATUS_TOKEN}`],
    ['間の空白が 2 つ', `Bearer  ${STATUS_TOKEN}`],
    ['短いトークン（前方一致）', `Bearer ${STATUS_TOKEN.slice(0, 10)}`],
    ['長いトークン', `Bearer ${STATUS_TOKEN}x`],
    ['トークンのみ', STATUS_TOKEN],
  ])('%s は D1 に触れず 401 + WWW-Authenticate: Bearer', async (_name, authorization) => {
    const db = database()
    const response = await invoke(getStatus, statusRequest(authorization), db, { STATUS_TOKEN })
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('正しいトークンでは集計を返す', async () => {
    const db = database()
    db.statement.first.mockResolvedValue({ devices: 3, today_total: 5, today_sent: 2, stale: 0, overdue: 0 })
    const response = await invoke(getStatus, statusRequest(`Bearer ${STATUS_TOKEN}`), db, { STATUS_TOKEN })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ devices: 3, remindersToday: 5, sentToday: 2, pendingToday: 3, warning: null })
    expect(db.prepare).toHaveBeenCalledOnce()
  })
})

describe('GET /api/status の mutationBudget（変更系の 1 日の利用数）', () => {
  function okDb() {
    const db = database()
    db.statement.first.mockResolvedValue({ devices: 1, today_total: 0, today_sent: 0, stale: 0, overdue: 0 })
    return db
  }

  it('Worker の binding が無ければ null で、全体は 200', async () => {
    const response = await invoke(getStatus, statusRequest(`Bearer ${STATUS_TOKEN}`), okDb(), { STATUS_TOKEN })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ mutationBudget: null, warning: null })
  })

  it('値があれば { day, used, limit } を返す', async () => {
    const mutationUsage = vi.fn(async () => ({ day: '2026-11-01', used: 100, limit: 1300 }))
    const response = await invoke(getStatus, statusRequest(`Bearer ${STATUS_TOKEN}`), okDb(),
      { STATUS_TOKEN, API_RATE_LIMITER: { mutationUsage } })
    expect(await response.json()).toMatchObject({ mutationBudget: { day: '2026-11-01', used: 100, limit: 1300 }, warning: null })
    expect(mutationUsage).toHaveBeenCalledOnce()
  })

  it('合言葉が誤っていれば Worker にも問い合わせない', async () => {
    const mutationUsage = vi.fn(async () => ({ day: '2026-11-01', used: 100, limit: 1300 }))
    const response = await invoke(getStatus, statusRequest('Bearer wrong'), okDb(), { STATUS_TOKEN, API_RATE_LIMITER: { mutationUsage } })
    expect(response.status).toBe(401)
    expect(mutationUsage).not.toHaveBeenCalled()
  })

  it.each([[1040, true], [1039, false], [1300, true]])('used=%i / 1300 で 80%% の警告=%s', async (used, warned) => {
    const mutationUsage = async () => ({ day: '2026-11-01', used, limit: 1300 })
    const response = await invoke(getStatus, statusRequest(`Bearer ${STATUS_TOKEN}`), okDb(),
      { STATUS_TOKEN, API_RATE_LIMITER: { mutationUsage } })
    const json = await response.json() as { warning: string | null }
    if (warned) expect(json.warning).toContain('本日の変更要求が上限の 80% を超えました')
    else expect(json.warning).toBeNull()
  })

  it.each([
    ['例外（旧 Worker のメソッド無しを含む）', async () => { throw new Error('method not found') }],
    ['不正値', async () => ({ day: '2026-11-01', used: '5', limit: 1300 })],
    ['limit が 0', async () => ({ day: '2026-11-01', used: 0, limit: 0 })],
  ])('%s なら mutationBudget は null で全体は落とさない', async (_name, mutationUsage) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await invoke(getStatus, statusRequest(`Bearer ${STATUS_TOKEN}`), okDb(),
      { STATUS_TOKEN, API_RATE_LIMITER: { mutationUsage } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ devices: 1, mutationBudget: null })
  })
})
