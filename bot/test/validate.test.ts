import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTimetable } from '../src/validate.js'
import type { Timetable } from '../src/types.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

function base(): Timetable {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'expected/timetable_holiday.json'), 'utf-8')) as Timetable
}

const opts = { fileName: 'timetable_holiday.json', ocrVerified: true }

describe('テスト5: validate（FR-8）', () => {
  it('正しい timetable は合格する', () => {
    expect(validateTimetable(base(), opts)).toMatchObject({ ok: true, errors: [] })
  })

  it('降順・重複データを検出する', () => {
    const t = base()
    const s = t.routes.station_to_campus.schedule
    ;[s[2]!.departure, s[3]!.departure] = [s[3]!.departure, s[2]!.departure]
    const result = validateTimetable(t, opts)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('昇順ではありません')
  })

  it('重複時刻を検出する', () => {
    const t = base()
    t.routes.station_to_campus.schedule[1]!.departure = t.routes.station_to_campus.schedule[0]!.departure
    expect(validateTimetable(t, opts).ok).toBe(false)
  })

  it('24:00 のような不正な時刻表記を検出する', () => {
    const t = base()
    t.routes.station_to_campus.schedule[0]!.departure = '24:00'
    const result = validateTimetable(t, opts)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('HH:mm')
  })

  it('許容時間帯（05:00〜23:59）の外を検出する', () => {
    const t = base()
    t.routes.station_to_campus.schedule[0]!.departure = '04:30'
    const result = validateTimetable(t, opts)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('許容範囲')
  })

  it('note の位置違反を検出する（末尾以外に「最終」）', () => {
    const t = base()
    t.routes.campus_to_station.schedule[0]!.note = '最終'
    const result = validateTimetable(t, opts)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('note が空ではありません')
  })

  it('note の欠落を検出する（末尾が「最終」でない）', () => {
    const t = base()
    const s = t.routes.campus_to_station.schedule
    s[s.length - 1]!.note = ''
    const result = validateTimetable(t, opts)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('note が「最終」ではありません')
  })

  it('id とファイル名の不一致を検出する', () => {
    const result = validateTimetable(base(), { fileName: 'timetable_weekday.json', ocrVerified: true })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('一致しません')
  })

  it('routes のキーが2つ丁度でなければ落とす', () => {
    const t = base() as unknown as Record<string, unknown>
    delete (t.routes as Record<string, unknown>).campus_to_station
    expect(validateTimetable(t as unknown as Timetable, opts).ok).toBe(false)
  })

  it('余計な route キーがあれば落とす', () => {
    const t = base()
    const routes = t.routes as unknown as Record<string, unknown>
    routes.extra = { ...t.routes.station_to_campus }
    expect(validateTimetable(t, opts).ok).toBe(false)
  })

  it('発車時刻が0件なら落とす', () => {
    const t = base()
    t.routes.station_to_campus.schedule = []
    expect(validateTimetable(t, opts).ok).toBe(false)
  })

  it('2回読み照合が成立していなければ落とす', () => {
    const result = validateTimetable(base(), { fileName: 'timetable_holiday.json', ocrVerified: false })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('2回読み照合')
  })

  // 自動適用（2026-08-16〜）では人間の事前レビューが無いため、便数の急変は
  // 警告ではなく「書かない」で止める。
  it('便数が ±50% 超変化したら書き込みを止める', () => {
    const result = validateTimetable(base(), { ...opts, prevCounts: { station: 30, campus: 30 } })
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('便数が大きく変化')
  })

  it('便数の変化が範囲内なら合格する', () => {
    const result = validateTimetable(base(), { ...opts, prevCounts: { station: 11, campus: 12 } })
    expect(result).toMatchObject({ ok: true, errors: [] })
  })

  it('新規ファイル（prevCounts なし）は便数チェックの対象外', () => {
    expect(validateTimetable(base(), opts).ok).toBe(true)
  })
})

// zod の版更新で書込み前検証（FR-8 の安全境界）の挙動が変わっていないことを固定する契約テスト。
// 特殊文字はソース上でエスケープ表記が化けないよう、文字コードから組み立てる。
describe('zod スキーマの契約（FR-8）', () => {
  const ch = (code: number) => String.fromCharCode(code)

  it('routes に未知のキーがあると失敗する（strict）', () => {
    const t = base() as unknown as { routes: Record<string, unknown> }
    t.routes.extra_route = t.routes.station_to_campus
    expect(validateTimetable(t as unknown as Timetable, opts).ok).toBe(false)
  })

  it('schedule が空なら失敗する', () => {
    const t = base()
    t.routes.station_to_campus.schedule = []
    expect(validateTimetable(t, opts).ok).toBe(false)
  })

  it('座標が数値でなければ失敗する', () => {
    const t = base() as unknown as { routes: { station_to_campus: { bus_stop_coords: { lat: unknown } } } }
    t.routes.station_to_campus.bus_stop_coords.lat = '34.4'
    expect(validateTimetable(t as unknown as Timetable, opts).ok).toBe(false)
  })

  it('name は 40 文字ちょうどなら通り、41 文字なら失敗する', () => {
    const ok = base()
    ok.name = 'あ'.repeat(40)
    expect(validateTimetable(ok, opts).ok).toBe(true)
    const ng = base()
    ng.name = 'あ'.repeat(41)
    const result = validateTimetable(ng, opts)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('40 文字以内')
  })

  it.each([
    ['双方向制御 U+202E', `オープン${ch(0x202e)}キャンパスダイヤ`],
    ['制御文字 BEL', `A${ch(0x07)}Bダイヤ`],
    ['改行', `x${ch(0x0a)}::warning::yダイヤ`],
    ['行区切り U+2028', `x${ch(0x2028)}yダイヤ`],
    ['山括弧', '<img src=x onerror=alert(1)>ダイヤ'],
  ])('name に %s を含むと失敗する', (_label, name) => {
    const t = base()
    t.name = name
    const result = validateTimetable(t, opts)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('制御文字')
  })
})
