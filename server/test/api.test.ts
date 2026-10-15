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

function invoke(handler: ApiHandler, request: Request, db = database()) {
  return handler({ request, env: { DB: db } } as unknown as Parameters<ApiHandler>[0])
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
    const response = await invoke(getStatus, new Request(`${ORIGIN}/api/status`), db)
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
