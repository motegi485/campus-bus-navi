/// <reference types="@cloudflare/workers-types" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRateLimitShard } from '../src/apiRateLimitStore'

const NOW = Date.UTC(2026, 10, 1, 3, 0, 0)
const CLEANUP_DELAY_MS = 10 * 60_000
const KEY = 'a'.repeat(64)

/**
 * storage の障害と呼出し順だけを差し替える。SQL の実行・原子性の検査ではない。
 * 実際の SQLite と同時要求は rateLimitRuntime.test.ts が検査する。
 */
function fixture() {
  const exec = vi.fn((query: string, ..._args: unknown[]) => ({
    toArray: () => [] as Record<string, number>[],
    one: () => ({ n: query.startsWith('SELECT COUNT') ? 1 : 0 }),
  }))
  const getAlarm = vi.fn(async (): Promise<number | null> => null)
  const setAlarm = vi.fn(async (_at: number): Promise<void> => undefined)
  const storage = { sql: { exec }, getAlarm, setAlarm }
  const shard = new ApiRateLimitShard({ storage } as unknown as DurableObjectState, {})
  const writes = () => exec.mock.calls.filter(([query]) => query.startsWith('INSERT INTO counters'))
  return { shard, exec, getAlarm, setAlarm, writes }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => { vi.useRealTimers() })

describe('IP 由来キーの保存と掃除予約', () => {
  it('最初のハッシュ保存より前に掃除を予約する', async () => {
    const f = fixture()
    expect(await f.shard.hit(KEY, false, 600, 300)).toEqual({ allowed: true, retryAfter: 0 })
    expect(f.setAlarm).toHaveBeenCalledExactlyOnceWith(NOW + CLEANUP_DELAY_MS)
    const writeIndex = f.exec.mock.calls.findIndex(([query]) => query.startsWith('INSERT INTO counters'))
    expect(f.setAlarm.mock.invocationCallOrder[0]).toBeLessThan(f.exec.mock.invocationCallOrder[writeIndex])
  })

  it('退避前からある alarm は延長せず、同じ instance では予約を重ねない', async () => {
    const f = fixture()
    f.getAlarm.mockResolvedValue(NOW + 1_000)
    await f.shard.hit(KEY, false, 600, 300)
    await f.shard.hit(KEY, false, 600, 300)
    expect(f.getAlarm).toHaveBeenCalledOnce()
    expect(f.setAlarm).not.toHaveBeenCalled()
    expect(f.writes()).toHaveLength(2)
  })

  it.each(['getAlarm', 'setAlarm'] as const)('%s が失敗したら、ハッシュを保存せず汎用の例外を返す', async method => {
    const f = fixture()
    f[method].mockRejectedValueOnce(new Error(`storage failed ${KEY}`))
    await expect(f.shard.hit(KEY, false, 600, 300)).rejects.toThrow(/^rate-limit-counter-failed$/)
    expect(f.writes()).toHaveLength(0)
  })

  it('初回の予約に失敗しても、次の要求では再予約してから保存する', async () => {
    const f = fixture()
    f.setAlarm.mockRejectedValueOnce(new Error('unavailable'))
    await expect(f.shard.hit(KEY, false, 600, 300)).rejects.toThrow()
    expect(await f.shard.hit(KEY, false, 600, 300)).toEqual({ allowed: true, retryAfter: 0 })
    expect(f.getAlarm).toHaveBeenCalledTimes(2)
    expect(f.setAlarm).toHaveBeenCalledTimes(2)
    expect(f.writes()).toHaveLength(1)
  })

  it('予約の待機中に分を跨いだら、新しい窓で計数する', async () => {
    const f = fixture()
    f.getAlarm.mockImplementationOnce(async () => {
      vi.setSystemTime(NOW + 60_000)
      return null
    })
    await f.shard.hit(KEY, false, 600, 300)
    expect(f.writes()[0].slice(1)).toEqual([KEY, NOW + 60_000, 1, 0])
  })
})

describe('掃除の例外後の再予約', () => {
  it.each(['DELETE FROM counters', 'SELECT COUNT'] as const)('%s の失敗でも、次の要求で alarm を確かめ直す', async failingQuery => {
    const f = fixture()
    await f.shard.hit(KEY, false, 600, 300)
    const normalExec = f.exec.getMockImplementation()!
    f.exec.mockImplementation((query, ...args) => {
      if (query.startsWith(failingQuery)) throw new Error('storage unavailable')
      return normalExec(query, ...args)
    })
    await expect(f.shard.alarm()).rejects.toThrow('storage unavailable')
    f.exec.mockImplementation(normalExec)
    await f.shard.hit(KEY, false, 600, 300)
    expect(f.getAlarm).toHaveBeenCalledTimes(2)
    expect(f.setAlarm).toHaveBeenCalledTimes(2)
  })

  it('alarm 内で再予約が失敗しても、次の要求で再予約する', async () => {
    const f = fixture()
    await f.shard.hit(KEY, false, 600, 300)
    f.setAlarm.mockRejectedValueOnce(new Error('unavailable'))
    await expect(f.shard.alarm()).rejects.toThrow('unavailable')
    await f.shard.hit(KEY, false, 600, 300)
    expect(f.getAlarm).toHaveBeenCalledTimes(2)
    expect(f.setAlarm).toHaveBeenCalledTimes(3)
  })

  it('行が残らなければ再予約せず、次の要求で予約し直す', async () => {
    const f = fixture()
    await f.shard.hit(KEY, false, 600, 300)
    f.exec.mockReturnValue({ toArray: () => [], one: () => ({ n: 0 }) })
    await f.shard.alarm()
    expect(f.setAlarm).toHaveBeenCalledOnce()
    await f.shard.hit(KEY, false, 600, 300)
    expect(f.getAlarm).toHaveBeenCalledTimes(2)
    expect(f.setAlarm).toHaveBeenCalledTimes(2)
  })
})
