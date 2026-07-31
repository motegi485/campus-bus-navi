import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assemble,
  assembleEvent,
  assembleRegular,
  classifyDayLabel,
  isMeaninglessLabel,
  toSchedule,
} from '../src/assemble.js'
import type { ClassifiedLink, Intermediate, Timetable } from '../src/types.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURES, rel), 'utf-8')) as T

const intermediate = (name: string) => readJson<Intermediate>(`intermediate/${name}.json`)
const expected = (name: string) => readJson<Timetable>(`expected/${name}.json`)

function link(overrides: Partial<ClassifiedLink>): ClassifiedLink {
  return {
    url: 'https://example.com/x.jpg',
    rawHref: 'https://example.com/x.jpg',
    anchorText: '時刻表はコチラ',
    lineText: '',
    normalizedLine: '',
    kind: 'regular',
    ...overrides,
  } as ClassifiedLink
}

describe('テスト4: assemble（FR-7）', () => {
  it('通常ダイヤ画像から weekday / holiday を生成し expected と schedule が完全一致する', () => {
    const result = assembleRegular(intermediate('regular'))
    expect(result.errors).toEqual([])
    expect(result.outputs.map((o) => o.fileName).sort()).toEqual([
      'timetable_holiday.json',
      'timetable_weekday.json',
    ])

    for (const name of ['timetable_weekday', 'timetable_holiday']) {
      const output = result.outputs.find((o) => o.fileName === `${name}.json`)!
      const want = expected(name)
      expect(output.timetable.routes.station_to_campus.schedule, name).toEqual(
        want.routes.station_to_campus.schedule,
      )
      expect(output.timetable.routes.campus_to_station.schedule, name).toEqual(
        want.routes.campus_to_station.schedule,
      )
      expect(output.timetable.id).toBe(name)
      expect(output.timetable.name).toBe(want.name)
    }
  })

  it('イベント画像から expected と完全一致する timetable を生成する（name は OCR ラベル由来）', () => {
    for (const [fixture, date, wantName] of [
      ['event_20260614', '2026-06-14', '簿記検定ダイヤ'],
      ['event_20260620', '2026-06-20', 'オープンキャンパスダイヤ'],
    ] as const) {
      const result = assembleEvent(intermediate(fixture), [date], '掲載行ラベル')
      expect(result.errors, fixture).toEqual([])
      expect(result.outputs).toHaveLength(1)
      const got = result.outputs[0]!.timetable
      const want = expected(`timetable_${fixture}`)
      expect(got, fixture).toEqual(want)
      expect(got.name).toBe(wantName)
    }
  })

  it('長期休暇画像から vacation_summer_weekday / _holiday を生成する（左右2表・共有時列レイアウト）', () => {
    const result = assemble(link({ kind: 'vacation', season: 'summer' }), intermediate('vacation_summer'))
    expect(result.errors).toEqual([])
    for (const name of ['timetable_vacation_summer_weekday', 'timetable_vacation_summer_holiday']) {
      const output = result.outputs.find((o) => o.fileName === `${name}.json`)!
      expect(output.timetable, name).toEqual(expected(name))
    }
  })

  it('複数日イベントは日付ごとに同内容のファイルを作る', () => {
    const result = assembleEvent(intermediate('event_20260620'), ['2026-06-20', '2026-06-21'], '')
    expect(result.outputs.map((o) => o.fileName)).toEqual([
      'timetable_event_20260620.json',
      'timetable_event_20260621.json',
    ])
    expect(result.outputs[0]!.timetable.routes).toEqual(result.outputs[1]!.timetable.routes)
    expect(result.outputs[1]!.timetable.id).toBe('timetable_event_20260621')
  })

  it('OCR ラベルが空なら掲載行ラベルにフォールバックする', () => {
    const im = intermediate('event_20260614')
    im.day_types[0]!.label = '  '
    const result = assembleEvent(im, ['2026-06-14'], '日商簿記検定試験日')
    expect(result.outputs[0]!.timetable.name).toBe('日商簿記検定試験日ダイヤ')
  })

  it('OCR ラベルが日付だけなら掲載行ラベルにフォールバックする（実測: 0823 画像で発生）', () => {
    const im = intermediate('event_20260620')
    im.day_types[0]!.label = '2026年8月23日(日)'
    const result = assembleEvent(im, ['2026-08-23'], 'オープンキャンパス')
    expect(result.outputs[0]!.timetable.name).toBe('オープンキャンパスダイヤ')
  })

  it('日付・記号だけのラベルを無意味と判定する', () => {
    expect(isMeaninglessLabel('2026年8月23日(日)')).toBe(true)
    expect(isMeaninglessLabel('8月17日～9月23日')).toBe(true)
    expect(isMeaninglessLabel('  ')).toBe(true)
    expect(isMeaninglessLabel('オープンキャンパス')).toBe(false)
    expect(isMeaninglessLabel('授業日')).toBe(false)
    expect(isMeaninglessLabel('土・日・祝')).toBe(false)
  })

  it('最終便のみ note に「最終」が入る', () => {
    const schedule = toSchedule([
      { hour: 8, minutes: [0, 30] },
      { hour: 7, minutes: [] },
      { hour: 9, minutes: [15] },
    ])
    expect(schedule).toEqual([
      { departure: '08:00', note: '' },
      { departure: '08:30', note: '' },
      { departure: '09:15', note: '最終' },
    ])
  })

  it('重複時刻を除去して昇順に整列する', () => {
    expect(toSchedule([{ hour: 8, minutes: [30, 0, 30] }]).map((e) => e.departure)).toEqual(['08:00', '08:30'])
  })

  it('ダイヤ種別ラベルを weekday / holiday に振り分ける', () => {
    expect(classifyDayLabel('授業日')).toBe('weekday')
    expect(classifyDayLabel('平日')).toBe('weekday')
    expect(classifyDayLabel('休業日')).toBe('holiday')
    expect(classifyDayLabel('土・日・祝')).toBe('holiday')
    expect(classifyDayLabel('土日祝')).toBe('holiday')
    // 両方に振れる・どちらでもない → 判定不能
    expect(classifyDayLabel('平日および休日')).toBeNull()
    expect(classifyDayLabel('特別')).toBeNull()
  })

  it('振り分けできないラベルはエラーになりファイルを出さない', () => {
    const im = intermediate('regular')
    im.day_types[0]!.label = '特別ダイヤ'
    const result = assembleRegular(im)
    expect(result.outputs).toEqual([])
    expect(result.errors[0]).toContain('振り分けられません')
  })

  it('通常ダイヤ画像の day_types が2件でなければエラーにする', () => {
    const result = assembleRegular({ day_types: [intermediate('regular').day_types[0]!] })
    expect(result.outputs).toEqual([])
    expect(result.errors[0]).toContain('2種別')
  })

  it('イベント画像の day_types が2件ならエラーにする', () => {
    const result = assembleEvent(intermediate('regular'), ['2026-06-14'], 'x')
    expect(result.outputs).toEqual([])
    expect(result.errors[0]).toContain('1種別')
  })
})
