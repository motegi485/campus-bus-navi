/**
 * API に届く値の検証（server/src/subscription.ts）。
 *
 * 守っている反例（2026-08-17 のレビュー由来）:
 *   - 任意の HTTPS URL を購読先にできると、公開 API から第三者宛の POST を反復させられる
 *   - fragment 違いは別 ID・同一宛先になるため、同じ宛先への送信を増幅できる
 *   - dateKey が書式検査だけだと、未来日を無限に登録して D1 の日次書込枠を枯渇させられる
 */

import { describe, it, expect } from 'vitest'
import {
  isValidDateKey,
  isValidEndpoint,
  parseReminderRequest,
  parseSubscribeRequest,
  MAX_DEPARTURES_PER_DAY,
} from '../src/subscription.js'
import { isAllowedPushHost, isIpLiteral } from '../src/pushProviders.js'
import { notifyAtEpochMs } from '../src/schedule.js'

const FCM = 'https://fcm.googleapis.com/fcm/send/abcdef123456'
const TODAY = '2026-08-17'

describe('isValidEndpoint', () => {
  it('既知の push サービスを受け入れる', () => {
    for (const url of [
      FCM,
      'https://android.googleapis.com/gcm/send/xyz',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QAbc123',
      'https://par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isValidEndpoint(url), url).toBe(true)
    }
  })

  it('許可していないホストを拒否する', () => {
    for (const url of [
      'https://example.com/push',
      'https://attacker.test/fcm/send/x',
      // 接尾辞の部分一致で通してはいけない
      'https://evil-fcm.googleapis.com.attacker.test/x',
      'https://notfcm.googleapis.com.example.org/x',
    ]) {
      expect(isValidEndpoint(url), url).toBe(false)
    }
  })

  it('https 以外を拒否する', () => {
    expect(isValidEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false)
    expect(isValidEndpoint('ftp://fcm.googleapis.com/x')).toBe(false)
  })

  it('資格情報つきの URL を拒否する', () => {
    expect(isValidEndpoint('https://user:pass@fcm.googleapis.com/fcm/send/x')).toBe(false)
    expect(isValidEndpoint('https://user@fcm.googleapis.com/fcm/send/x')).toBe(false)
  })

  it('fragment つきの URL を拒否する（同一宛先への増幅を防ぐ）', () => {
    expect(isValidEndpoint(`${FCM}#a`)).toBe(false)
    expect(isValidEndpoint(`${FCM}#b`)).toBe(false)
  })

  it('IP リテラルを拒否する', () => {
    expect(isValidEndpoint('https://127.0.0.1/push')).toBe(false)
    expect(isValidEndpoint('https://[::1]/push')).toBe(false)
    expect(isIpLiteral('10.0.0.1')).toBe(true)
    expect(isIpLiteral('[fd00::1]')).toBe(true)
    expect(isIpLiteral('fcm.googleapis.com')).toBe(false)
  })

  it('空・非文字列・長すぎる URL を拒否する', () => {
    expect(isValidEndpoint('')).toBe(false)
    expect(isValidEndpoint(null)).toBe(false)
    expect(isValidEndpoint(123)).toBe(false)
    expect(isValidEndpoint(`${FCM}${'x'.repeat(2048)}`)).toBe(false)
  })

  it('ホスト判定はドット境界で行う', () => {
    expect(isAllowedPushHost('fcm.googleapis.com')).toBe(true)
    expect(isAllowedPushHost('a.b.notify.windows.com')).toBe(true)
    expect(isAllowedPushHost('xfcm.googleapis.com')).toBe(false)
  })
})

describe('isValidDateKey', () => {
  it('実在する日付だけを受け入れる', () => {
    expect(isValidDateKey('2026-08-17')).toBe(true)
    expect(isValidDateKey('2028-02-29')).toBe(true) // 閏年
  })

  it('実在しない日付を拒否する', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('2026-13-01')).toBe(false)
    expect(isValidDateKey('2026-00-10')).toBe(false)
    expect(isValidDateKey('2027-02-29')).toBe(false)
  })

  it('書式が違うものを拒否する', () => {
    expect(isValidDateKey('2026-8-17')).toBe(false)
    expect(isValidDateKey('20260817')).toBe(false)
    expect(isValidDateKey(20260817)).toBe(false)
  })
})

describe('parseSubscribeRequest', () => {
  it('正しい形を受け入れる', () => {
    const result = parseSubscribeRequest({ endpoint: FCM, p256dh: 'k', auth: 'a' })
    expect(result.ok).toBe(true)
  })

  it('endpoint が許可外なら拒否する', () => {
    const result = parseSubscribeRequest({ endpoint: 'https://example.com/x', p256dh: 'k', auth: 'a' })
    expect(result).toEqual({ ok: false, error: 'endpoint が不正です' })
  })
})

describe('parseReminderRequest', () => {
  const base = {
    endpoint: FCM,
    dateKey: TODAY,
    route: 'station_to_campus',
    departures: ['08:10'],
    leadMinutes: 10,
  }

  it('当日ぶんを受け入れる', () => {
    const result = parseReminderRequest(base, TODAY)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.departures).toEqual(['08:10'])
  })

  it('当日以外を拒否する（未来日での書込枠の枯渇を防ぐ）', () => {
    for (const dateKey of ['2026-08-18', '2026-12-31', '2026-08-16', '2030-01-01']) {
      const result = parseReminderRequest({ ...base, dateKey }, TODAY)
      expect(result.ok, dateKey).toBe(false)
    }
  })

  it('実在しない日付を拒否する', () => {
    const result = parseReminderRequest({ ...base, dateKey: '2026-02-30' }, TODAY)
    expect(result).toEqual({ ok: false, error: 'dateKey は実在する "YYYY-MM-DD" でなければなりません' })
  })

  it('1 日に指定できる便数の上限を守る', () => {
    const departures = Array.from({ length: MAX_DEPARTURES_PER_DAY + 1 }, (_, i) => `0${i % 10}:0${i % 10}`)
    const result = parseReminderRequest({ ...base, departures }, TODAY)
    expect(result.ok).toBe(false)
  })

  it('不正な route / leadMinutes / departures を拒否する', () => {
    expect(parseReminderRequest({ ...base, route: 'somewhere' }, TODAY).ok).toBe(false)
    expect(parseReminderRequest({ ...base, leadMinutes: 7 }, TODAY).ok).toBe(false)
    expect(parseReminderRequest({ ...base, departures: ['8:10'] }, TODAY).ok).toBe(false)
    expect(parseReminderRequest({ ...base, departures: 'x' }, TODAY).ok).toBe(false)
  })

  it('重複した便は畳む', () => {
    const result = parseReminderRequest({ ...base, departures: ['08:10', '08:10'] }, TODAY)
    expect(result.ok && result.value.departures).toEqual(['08:10'])
  })
})

describe('notifyAtEpochMs', () => {
  it('JST の発車時刻からリード分を引いた epoch ミリ秒を返す', () => {
    // 2026-08-17 08:10 JST の 10 分前 = 08:00 JST = 2026-08-16T23:00:00Z
    expect(notifyAtEpochMs('2026-08-17', '08:10', 10)).toBe(Date.parse('2026-08-16T23:00:00Z'))
    // 05:00 JST の 20 分前 = 04:40 JST（前日へは跨がない）
    expect(notifyAtEpochMs('2026-08-17', '05:00', 20)).toBe(Date.parse('2026-08-16T19:40:00Z'))
  })

  it('不正な入力では null', () => {
    expect(notifyAtEpochMs('2026-08-17', '8:10', 10)).toBeNull()
    expect(notifyAtEpochMs('20260817', '08:10', 10)).toBeNull()
  })
})
