import { describe, it, expect } from 'vitest'
import type { Timetable } from '../../src/types/timetable'
import {
  parseHHmmToMinutes,
  resolveTimetableId,
  selectDue,
  splitIntoBatches,
  toJst,
  type ReminderRow,
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

/** 2026-10-16（金）17:00 JST = 2026-10-16T08:00:00Z */
const FRI_1700 = Date.UTC(2026, 9, 16, 8, 0, 0)
const TODAY = '2026-10-16'

function reminder(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: 'rem-1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    dateKey: TODAY,
    route: 'campus_to_station',
    departure: '17:10',
    leadMinutes: 10,
    ...overrides,
  }
}

/** JST の任意時刻を作る（UTC 時刻を指定する） */
function at(utcHour: number, utcMinute: number) {
  return toJst(Date.UTC(2026, 9, 16, utcHour, utcMinute, 0))
}

describe('toJst', () => {
  it('UTC から JST の日付・曜日・分に落とす', () => {
    expect(toJst(FRI_1700)).toEqual({ dateKey: TODAY, weekday: 5, minutes: 17 * 60 })
  })

  it('UTC 15:00 は翌日 0:00 JST（日付が繰り上がる）', () => {
    const moment = toJst(Date.UTC(2026, 9, 16, 15, 0, 0))
    expect(moment.dateKey).toBe('2026-10-17')
    expect(moment.weekday).toBe(6)
    expect(moment.minutes).toBe(0)
  })

  it('UTC 14:59 はまだ同じ日の 23:59 JST', () => {
    const moment = toJst(Date.UTC(2026, 9, 16, 14, 59, 0))
    expect(moment.dateKey).toBe(TODAY)
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
  const weekday = timetable('timetable_weekday', ['08:30', '16:40', '17:10', '18:40'])

  const run = (reminders: ReminderRow[], now = toJst(FRI_1700), tt: Timetable | null = weekday) =>
    selectDue({ reminders, timetable: tt, timetableId: tt?.id ?? 'timetable_weekday', now })

  it('リード分前ちょうど（窓の下端）で送る', () => {
    expect(run([reminder({ departure: '17:10', leadMinutes: 10 })]).due).toHaveLength(1)
  })

  it('リード分より前は送らない', () => {
    expect(run([reminder({ departure: '17:10', leadMinutes: 10 })], at(7, 59)).due).toHaveLength(0)
  })

  it('Cron が遅れても窓の中なら送る（等号一致にしない理由）', () => {
    expect(run([reminder({ departure: '17:10', leadMinutes: 10 })], at(8, 5)).due).toHaveLength(1)
  })

  it('発車時刻ちょうど以降は送らない', () => {
    expect(run([reminder({ departure: '17:10', leadMinutes: 10 })], at(8, 10)).due).toHaveLength(0)
  })

  it('リード時間が違えば窓も変わる', () => {
    // 20 分前指定なら 16:50 から窓に入る
    expect(run([reminder({ departure: '17:10', leadMinutes: 20 })], at(7, 50)).due).toHaveLength(1)
    expect(run([reminder({ departure: '17:10', leadMinutes: 5 })], at(7, 50)).due).toHaveLength(0)
  })

  it('前日以前の指定は送らない（当日限り）', () => {
    expect(run([reminder({ dateKey: '2026-10-15' })]).due).toHaveLength(0)
  })

  it('翌日の指定も送らない', () => {
    expect(run([reminder({ dateKey: '2026-10-17' })]).due).toHaveLength(0)
  })

  it('当日のダイヤに存在しない便は送らない（ダイヤ差し替えで消えた便）', () => {
    expect(run([reminder({ departure: '21:00' })], at(11, 50)).due).toHaveLength(0)
  })

  it('不正な departure は送らない', () => {
    expect(run([reminder({ departure: '19:99' })]).due).toHaveLength(0)
  })

  it('運休日には送らない', () => {
    const closed = timetable('timetable_closed', [])
    expect(run([reminder()], toJst(FRI_1700), closed).reason).toBe('no-departures')
  })

  it('特別ダイヤには送らない', () => {
    const special = timetable('timetable_special', ['17:10'])
    expect(run([reminder()], toJst(FRI_1700), special).due).toHaveLength(0)
  })

  it('時刻表が取れていない日は送らない', () => {
    expect(run([reminder()], toJst(FRI_1700), null)).toEqual({ due: [], reason: 'no-timetable' })
  })

  it('ルートごとに別の時刻表を見る', () => {
    const asymmetric = timetable('timetable_weekday', ['18:40'], ['17:10'])
    const campus = reminder({ id: 'a', route: 'campus_to_station', departure: '17:10' })
    const station = reminder({ id: 'b', route: 'station_to_campus', departure: '17:10' })
    // 大学発には 17:10 が無いので、届くのは松永発だけ
    expect(run([campus, station], toJst(FRI_1700), asymmetric).due.map(d => d.id)).toEqual(['b'])
  })

  it('同じ端末が同じ日に複数の便を指定できる', () => {
    const a = reminder({ id: 'a', departure: '17:10', leadMinutes: 10 })
    const b = reminder({ id: 'b', departure: '18:40', leadMinutes: 100 })
    // 17:00 時点で、17:10 は 10 分前、18:40 は 100 分前。どちらも窓の中
    expect(run([a, b]).due.map(d => d.id)).toEqual(['a', 'b'])
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
    expect(splitIntoBatches([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('サイズ 0 以下は拒む（無限ループを作らない）', () => {
    expect(() => splitIntoBatches([1], 0)).toThrow()
  })
})
