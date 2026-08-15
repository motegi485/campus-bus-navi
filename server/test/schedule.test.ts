import { describe, it, expect } from 'vitest'
import type { Timetable } from '../../src/types/timetable'
import {
  EVERYDAY_MASK,
  WEEKDAYS_MASK,
  parseHHmmToMinutes,
  resolveTimetableId,
  selectDue,
  splitIntoBatches,
  toJst,
  type SubscriptionRow,
} from '../src/schedule.js'

function timetable(id: string, campus: string[], station: string[] = []): Timetable {
  const route = (origin: string, destination: string, times: string[]) => ({
    origin,
    destination,
    bus_stop_name: `${origin} バス乗り場`,
    bus_stop_coords: { lat: 34.4, lng: 133.2 },
    schedule: times.map(departure => ({ departure, note: '' })),
  })
  return {
    id,
    name: id,
    routes: {
      campus_to_station: route('大学', '松永駅', campus),
      station_to_campus: route('松永駅', '大学', station),
    },
  }
}

function sub(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    route: 'campus_to_station',
    mode: 'last_bus',
    departure: null,
    leadMinutes: 10,
    daysMask: EVERYDAY_MASK,
    lastSentOn: null,
    ...overrides,
  }
}

/** 2026-10-16（金）17:00 JST = 2026-10-16T08:00:00Z */
const FRI_1700 = Date.UTC(2026, 9, 16, 8, 0, 0)

describe('toJst', () => {
  it('UTC から JST の日付・曜日・分に落とす', () => {
    expect(toJst(FRI_1700)).toEqual({ dateKey: '2026-10-16', weekday: 5, minutes: 17 * 60 })
  })

  it('UTC 15:00 は翌日 0:00 JST（日付が繰り上がる）', () => {
    const moment = toJst(Date.UTC(2026, 9, 16, 15, 0, 0))
    expect(moment.dateKey).toBe('2026-10-17')
    expect(moment.weekday).toBe(6)
    expect(moment.minutes).toBe(0)
  })

  it('UTC 14:59 はまだ同じ日の 23:59 JST', () => {
    const moment = toJst(Date.UTC(2026, 9, 16, 14, 59, 0))
    expect(moment.dateKey).toBe('2026-10-16')
    expect(moment.minutes).toBe(23 * 60 + 59)
  })

  it('月末・年末をまたいでも日付が壊れない', () => {
    expect(toJst(Date.UTC(2026, 11, 31, 15, 0, 0)).dateKey).toBe('2027-01-01')
  })
})

describe('parseHHmmToMinutes', () => {
  it('2 桁固定・範囲内のみ受ける（フロントの実装と同じ規則）', () => {
    expect(parseHHmmToMinutes('08:30')).toBe(510)
    expect(parseHHmmToMinutes('8:30')).toBeNull()
    expect(parseHHmmToMinutes('24:00')).toBeNull()
    expect(parseHHmmToMinutes('12:60')).toBeNull()
    expect(parseHHmmToMinutes(null)).toBeNull()
  })
})

describe('resolveTimetableId', () => {
  const rules = {
    default_rules: { '0': 'timetable_holiday', '5': 'timetable_weekday' },
    overrides: { '2026-10-16': 'timetable_event_open_campus' },
  }

  it('overrides を曜日ルールより優先する', () => {
    expect(resolveTimetableId(rules, '2026-10-16', 5)).toBe('timetable_event_open_campus')
  })

  it('overrides が無ければ曜日ルール', () => {
    expect(resolveTimetableId(rules, '2026-10-09', 5)).toBe('timetable_weekday')
  })

  it('どちらも無ければ授業日ダイヤに落とす', () => {
    expect(resolveTimetableId(rules, '2026-10-14', 3)).toBe('timetable_weekday')
  })
})

describe('selectDue', () => {
  const now = toJst(FRI_1700) // 2026-10-16（金）17:00
  const weekday = timetable('timetable_weekday', ['08:30', '16:40', '17:10', '18:40'])

  const run = (subscriptions: SubscriptionRow[], tt = weekday, id = tt.id) =>
    selectDue({ subscriptions, timetable: tt, timetableId: id, now })

  it('最終便の 10 分前ちょうどで送る（18:40 の便、17:00 では送らない）', () => {
    expect(run([sub({ leadMinutes: 10 })]).due).toHaveLength(0)
    const at1830 = selectDue({
      subscriptions: [sub({ leadMinutes: 10 })],
      timetable: weekday,
      timetableId: weekday.id,
      now: toJst(Date.UTC(2026, 9, 16,9, 30, 0)), // 18:30 JST
    })
    expect(at1830.due).toHaveLength(1)
  })

  it('窓の下端（ちょうどリード分前）を含む', () => {
    const at1710 = selectDue({
      subscriptions: [sub({ mode: 'fixed_time', departure: '17:10', leadMinutes: 10 })],
      timetable: weekday,
      timetableId: weekday.id,
      now,
    })
    expect(at1710.due).toHaveLength(1)
  })

  it('リード分より前は送らない', () => {
    const at1659 = selectDue({
      subscriptions: [sub({ mode: 'fixed_time', departure: '17:10', leadMinutes: 10 })],
      timetable: weekday,
      timetableId: weekday.id,
      now: toJst(Date.UTC(2026, 9, 16,7, 59, 0)), // 16:59
    })
    expect(at1659.due).toHaveLength(0)
  })

  it('Cron が遅れても窓の中なら送る（等号一致にしない理由）', () => {
    const at1705 = selectDue({
      subscriptions: [sub({ mode: 'fixed_time', departure: '17:10', leadMinutes: 10 })],
      timetable: weekday,
      timetableId: weekday.id,
      now: toJst(Date.UTC(2026, 9, 16,8, 5, 0)), // 17:05
    })
    expect(at1705.due).toHaveLength(1)
  })

  it('発車時刻ちょうど以降は送らない', () => {
    const at1710 = selectDue({
      subscriptions: [sub({ mode: 'fixed_time', departure: '17:10', leadMinutes: 10 })],
      timetable: weekday,
      timetableId: weekday.id,
      now: toJst(Date.UTC(2026, 9, 16,8, 10, 0)), // 17:10
    })
    expect(at1710.due).toHaveLength(0)
  })

  it('同じ日に二度送らない', () => {
    const already = sub({ mode: 'fixed_time', departure: '17:10', lastSentOn: '2026-10-16' })
    expect(run([already]).due).toHaveLength(0)
  })

  it('前日に送っていれば当日は送る', () => {
    const yesterday = sub({ mode: 'fixed_time', departure: '17:10', lastSentOn: '2026-10-15' })
    expect(run([yesterday]).due).toHaveLength(1)
  })

  it('曜日マスクに含まれない日は送らない（平日設定・金曜は送る）', () => {
    expect(run([sub({ mode: 'fixed_time', departure: '17:10', daysMask: WEEKDAYS_MASK })]).due).toHaveLength(1)
    // 日曜だけのマスク
    expect(run([sub({ mode: 'fixed_time', departure: '17:10', daysMask: 0b0000001 })]).due).toHaveLength(0)
  })

  it('運休日には送らない', () => {
    const closed = timetable('timetable_closed', [])
    expect(run([sub()], closed).reason).toBe('no-departures')
    expect(run([sub()], closed).due).toHaveLength(0)
  })

  it('特別ダイヤには送らない', () => {
    const special = timetable('timetable_special', ['17:10'])
    expect(run([sub({ mode: 'fixed_time', departure: '17:10' })], special).due).toHaveLength(0)
  })

  it('時刻表が取れていない日は送らない', () => {
    const result = selectDue({ subscriptions: [sub()], timetable: null, timetableId: 'timetable_weekday', now })
    expect(result).toEqual({ due: [], reason: 'no-timetable' })
  })

  it('当日のダイヤに存在しない便は送らない（ダイヤ差し替えで消えた便）', () => {
    expect(run([sub({ mode: 'fixed_time', departure: '19:99' })]).due).toHaveLength(0)
    expect(run([sub({ mode: 'fixed_time', departure: '21:00' })]).due).toHaveLength(0)
  })

  it('最終便は日ごとのダイヤから解決する', () => {
    const shortDay = timetable('timetable_holiday', ['08:30', '17:10'])
    // このダイヤでは 17:10 が最終便なので、17:00 に最終便リマインドが出る
    expect(run([sub({ leadMinutes: 10 })], shortDay).due).toHaveLength(1)
  })

  it('ルートごとに別の時刻表を見る', () => {
    const asymmetric = timetable('timetable_weekday', ['18:40'], ['17:10'])
    const campus = sub({ id: 'a', route: 'campus_to_station', leadMinutes: 10 })
    const station = sub({ id: 'b', route: 'station_to_campus', leadMinutes: 10 })
    const result = run([campus, station], asymmetric)
    // 17:00 時点で最終便 10 分前なのは松永発（17:10）だけ
    expect(result.due.map(d => d.id)).toEqual(['b'])
  })

  it('不正な departure しか無いルートでは何も送らない', () => {
    const broken = timetable('timetable_weekday', ['bad', '25:00'])
    expect(run([sub()], broken).due).toHaveLength(0)
  })
})

describe('splitIntoBatches', () => {
  it('無料枠の 50 サブリクエストに収まる大きさで割る', () => {
    const batches = splitIntoBatches(Array.from({ length: 95 }, (_, i) => i))
    expect(batches.map(b => b.length)).toEqual([40, 40, 15])
  })

  it('空なら空', () => {
    expect(splitIntoBatches([])).toEqual([])
  })

  it('ちょうど割り切れるとき余分な空バッチを作らない', () => {
    expect(splitIntoBatches([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('サイズ 0 以下は拒む（無限ループを作らない）', () => {
    expect(() => splitIntoBatches([1], 0)).toThrow()
  })
})
