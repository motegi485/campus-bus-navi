import { describe, expect, it } from 'vitest'
import {
  API_RATE_SHARD_COUNT, WINDOW_MS, decideDailyBudget, decideIpWindow, nextUtcDayStartMs, parseLimit,
  secondsUntilNextUtcDay, shardIndex, utcDayKey, type WindowCounts,
} from '../src/apiRateLimitWindow'

const LIMITS = { all: 600, mutation: 300 }
// 分の境界ちょうど（2026-11-01T03:00:00Z）
const WS = Date.UTC(2026, 10, 1, 3, 0, 0)

function counts(all: number, mutation = 0, windowStart = WS): WindowCounts {
  return { windowStart, all, mutation }
}

describe('decideIpWindow（分の境界に揃えた 60 秒の固定窓）', () => {
  it('記録が無ければ 1 件目として数える', () => {
    expect(decideIpWindow(null, WS + 5_000, false, LIMITS)).toEqual({ allowed: true, next: counts(1, 0) })
    expect(decideIpWindow(null, WS + 5_000, true, LIMITS)).toEqual({ allowed: true, next: counts(1, 1) })
  })

  it('600 件目は通り、601 件目は拒否する（拒否時は書く値を返さない）', () => {
    expect(decideIpWindow(counts(599), WS + 10_000, false, LIMITS)).toEqual({ allowed: true, next: counts(600) })
    const rejected = decideIpWindow(counts(600), WS + 10_000, false, LIMITS)
    expect(rejected).toEqual({ allowed: false, retryAfter: 50 })
    expect('next' in rejected).toBe(false)
  })

  it('変更系の 301 件目は拒否しても、同じ窓の GET は通す', () => {
    const stored = counts(300, 300)
    expect(decideIpWindow(stored, WS + 1, true, LIMITS)).toEqual({ allowed: false, retryAfter: 60 })
    expect(decideIpWindow(stored, WS + 1, false, LIMITS)).toEqual({ allowed: true, next: counts(301, 300) })
  })

  it('全体の上限に達していれば変更系も拒否する', () => {
    expect(decideIpWindow(counts(600, 10), WS + 1, true, LIMITS)).toMatchObject({ allowed: false })
  })

  it('now = windowStart + 60000 で次の窓になり数え直す', () => {
    expect(decideIpWindow(counts(600, 300), WS + WINDOW_MS, true, LIMITS))
      .toEqual({ allowed: true, next: counts(1, 1, WS + WINDOW_MS) })
  })

  it('古い窓の記録は破棄する（数日前の行でも 1 件目から）', () => {
    expect(decideIpWindow(counts(600, 300, WS - 3 * WINDOW_MS), WS + 30_000, false, LIMITS))
      .toEqual({ allowed: true, next: counts(1, 0) })
  })

  it('retryAfter は窓の残り秒数（境界直前は 1、境界ちょうど・直後は 60）', () => {
    const full = counts(600)
    expect(decideIpWindow(full, WS + WINDOW_MS - 1, false, LIMITS)).toEqual({ allowed: false, retryAfter: 1 })
    expect(decideIpWindow(counts(600, 0, WS + WINDOW_MS), WS + WINDOW_MS, false, LIMITS))
      .toEqual({ allowed: false, retryAfter: 60 })
    expect(decideIpWindow(full, WS + 1, false, LIMITS)).toEqual({ allowed: false, retryAfter: 60 })
  })
})

describe('UTC 日の扱い（JST 9:00 リセット）', () => {
  it('utcDayKey は UTC の日付', () => {
    expect(utcDayKey(Date.parse('2026-11-01T08:59:59.999+09:00'))).toBe('2026-10-31')
    expect(utcDayKey(Date.parse('2026-11-01T09:00:00+09:00'))).toBe('2026-11-01')
  })

  it('secondsUntilNextUtcDay は 1〜86400', () => {
    expect(secondsUntilNextUtcDay(Date.parse('2026-10-31T23:59:59.999Z'))).toBe(1)
    expect(secondsUntilNextUtcDay(Date.parse('2026-11-01T00:00:00Z'))).toBe(86400)
    expect(secondsUntilNextUtcDay(Date.parse('2026-11-01T00:00:00.001Z'))).toBe(86400)
    expect(secondsUntilNextUtcDay(Date.parse('2026-11-01T23:00:00Z'))).toBe(3600)
  })

  it('nextUtcDayStartMs は次の 00:00 UTC', () => {
    expect(nextUtcDayStartMs(Date.parse('2026-11-01T13:45:00Z'))).toBe(Date.parse('2026-11-02T00:00:00Z'))
    expect(nextUtcDayStartMs(Date.parse('2026-11-01T00:00:00Z'))).toBe(Date.parse('2026-11-02T00:00:00Z'))
  })
})

describe('decideDailyBudget（全利用者を合わせた変更系の 1 日の上限）', () => {
  const now = Date.parse('2026-11-01T13:00:00Z')
  it('上限未満なら +1 を許可し、ちょうど上限に達した 1 回だけ reachedLimit', () => {
    expect(decideDailyBudget(0, 1300, now)).toEqual({ allowed: true, used: 1, reachedLimit: false })
    expect(decideDailyBudget(1299, 1300, now)).toEqual({ allowed: true, used: 1300, reachedLimit: true })
  })
  it('上限に達していれば次の 00:00 UTC までの秒数で拒否する', () => {
    expect(decideDailyBudget(1300, 1300, now)).toEqual({ allowed: false, retryAfter: 11 * 3600 })
  })
})

describe('parseLimit（設定値の解釈）', () => {
  it.each([['1', 1], ['600', 600], ['1300', 1300]])('%s → %i', (value, expected) => {
    expect(parseLimit(value)).toBe(expected)
  })

  it.each(['', '0', '-1', '1e3', ' 600', '600 ', '600.5', '0600', '+600', '0x10', 'x', '9'.repeat(20), undefined, null, 600, true])(
    '%s は設定不正として throw', value => {
      expect(() => parseLimit(value)).toThrow('rate-limit-config-unavailable')
    }
  )
})

describe('shardIndex（シャードの選択）', () => {
  const hex = (prefix: string) => prefix + '0'.repeat(64 - prefix.length)

  it('先頭 8 桁を整数にして剰余を取る（決定的）', () => {
    expect(shardIndex(hex('00000000'))).toBe(0)
    expect(shardIndex(hex('00000003'))).toBe(3)
    expect(shardIndex(hex('ffffffff'))).toBe(0xffffffff % API_RATE_SHARD_COUNT)
    expect(shardIndex(hex('12345678'))).toBe(shardIndex(hex('12345678')))
  })

  it('範囲は 0〜3', () => {
    for (let i = 0; i < 64; i++) {
      const n = shardIndex(hex((i * 2654435761 >>> 0).toString(16).padStart(8, '0')))
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(API_RATE_SHARD_COUNT)
    }
  })

  it('64 桁の小文字 16 進以外は throw する', () => {
    for (const bad of ['', 'abc', hex('ABCDEF00'), hex('0000000g'), hex('0') + '0']) {
      expect(() => shardIndex(bad), bad).toThrow()
    }
  })
})
