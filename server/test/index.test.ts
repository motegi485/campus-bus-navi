/// <reference types="@cloudflare/workers-types" />

import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { ApiDailyMutationBudget, ApiRateLimitShard, ApiRateLimiter, ReminderSender, type Env } from '../src/index'

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
    // wrangler.toml の migration v2 が参照するクラス。export が消えると deploy できない
    expect(ApiRateLimitShard).toBeTypeOf('function')
    expect(ApiDailyMutationBudget).toBeTypeOf('function')
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

  /**
   * 修正前は LIMIT（server/src/index.ts の MAX_REMINDERS_PER_RUN = 2000）に達しても何も記録せず、
   * notify_at の遅い行が押し出されていても気づけなかった。SQL は変えず、件数だけで警告する。
   */
  describe('送信候補が 1 実行の上限に達したときの警告', () => {
    const rows = (count: number) => Array.from({ length: count }, (_, i) => ({
      id: `r${i}`, date_key: '2026-10-15', route: 'station_to_campus', departure: '17:10',
      lead_minutes: 10, endpoint: 'https://fcm.googleapis.com/fcm/send/x',
    }))

    function closedDayFetch() {
      // 運休日にして selectDue を no-departures で抜けさせる（DO は呼ばれない）
      return vi.fn(async (url: string) => new Response(JSON.stringify(
        url.endsWith('/data/calendar_rules.json')
          ? { default_rules: Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map(d => [d, 'timetable_closed'])), overrides: {} }
          : { id: 'timetable_closed', name: '', routes: {} }
      )))
    }

    it.each([
      [2000, 1],
      [1999, 0],
    ])('%i 件を引いたら console.warn を %i 回出す', async (count, warnings) => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T17:01:00+09:00'))
      vi.stubGlobal('fetch', closedDayFetch())
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const env = environment()
      env.statement.all.mockResolvedValue({ results: rows(count) } as never)
      await run(env.value)
      expect(warn).toHaveBeenCalledTimes(warnings)
      if (warnings > 0) expect(String(warn.mock.calls[0][0])).toContain('2000')
      // SQL の LIMIT は従来どおり 2000 を bind する
      expect(env.statement.bind).toHaveBeenCalledWith('2026-10-15', Date.parse('2026-10-15T17:01:00+09:00'), 2000)
      expect(env.SENDER.get).not.toHaveBeenCalled()
    })
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
