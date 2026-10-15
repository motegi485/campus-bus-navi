/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { ApiRateLimiter, ReminderSender, type Env } from '../src/index'

function environment() {
  const statement = {
    bind: vi.fn(function () { return statement }),
    all: vi.fn(async () => ({ results: [] })),
    run: vi.fn(async () => ({ meta: { changes: 0 } })),
  }
  const DB = { prepare: vi.fn((_sql: string) => statement) }
  const SENDER = { idFromName: vi.fn(), get: vi.fn() }
  return {
    DB, SENDER, statement,
    value: { DB, SENDER, SITE_ORIGIN: 'https://app.example.test' } as unknown as Env,
  }
}

function run(env: Env) {
  return worker.scheduled({} as ScheduledController, env, {} as ExecutionContext)
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('配信 Worker の既存入口を維持する', () => {
  it('公開 fetch を新設せず、Cron と DO・名前付き RPC を export する', () => {
    expect(Object.hasOwn(worker, 'fetch')).toBe(false)
    expect(worker.scheduled).toBeTypeOf('function')
    expect(ReminderSender).toBeTypeOf('function')
    expect(ApiRateLimiter).toBeTypeOf('function')
  })

  it('対象 0 件なら静的 fetch も送信 DO も呼ばない', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T17:01:00+09:00'))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const env = environment()
    await run(env.value)
    expect(env.statement.all).toHaveBeenCalledOnce()
    expect(env.statement.run).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(env.SENDER.get).not.toHaveBeenCalled()
  })

  it('毎時 00 分の掃除は対象 0 件でも行い、配信先は呼ばない', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T17:00:00+09:00'))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const env = environment()
    await run(env.value)
    expect(env.DB.prepare.mock.calls[0][0]).toContain('DELETE FROM reminders WHERE date_key < ?')
    expect(env.statement.run).toHaveBeenCalledOnce()
    expect(env.statement.all).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(env.SENDER.get).not.toHaveBeenCalled()
  })

  it('D1 の対象抽出に失敗した Cron は成功扱いにしない', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T17:01:00+09:00'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const env = environment()
    env.statement.all.mockRejectedValue(new Error('D1 unavailable'))
    await expect(run(env.value)).rejects.toThrow('D1 unavailable')
    expect(env.SENDER.get).not.toHaveBeenCalled()
  })
})
