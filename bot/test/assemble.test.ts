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

/**
 * FR-7【v1.16・2026-10-03 ユーザー決定】特殊便・複数表のイベント画像は取り込まず、
 * 適用日を特別ダイヤにする。rejectCode は plan.ts が state.rejected_images に記録し、
 * 同じ画像の再 OCR を止めるための印なので、「画像の内容による拒否」にだけ付くことを固定する。
 */
describe('イベント画像の内容による拒否（FR-7 v1.16）', () => {
  it('day_types が2件（日付ごとの別表）なら multi_table で拒否し、ファイルを出さない', () => {
    // 実例: 2026-1011.1012.jpg は 10/11 と 10/12 の表が別々に載っている
    const result = assembleEvent(intermediate('regular'), ['2026-10-11', '2026-10-12'], '薬学ワークショップ')
    expect(result.outputs).toEqual([])
    expect(result.rejectCode).toBe('multi_table')
    // 既存の文言（「1種別を期待」「件数」）を保ったうえで、特別ダイヤにする旨が付いている
    expect(result.errors[0]).toContain('1種別')
    expect(result.errors[0]).toContain('2 件')
    expect(result.errors[0]).toContain('特別ダイヤ')
  })

  it('day_types が0件は読み取りの失敗であって画像の内容による拒否ではないので rejectCode を付けない', () => {
    // rejectCode を付けると同じ画像を以後読み直さなくなる。0 件は再読取りで直り得る
    const result = assembleEvent({ day_types: [] }, ['2026-10-11'], 'x')
    expect(result.outputs).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('0 件')
    expect(result.rejectCode).toBeUndefined()
    expect('rejectCode' in result).toBe(false)
  })

  it('irregular_notes が true なら irregular_notes で拒否し、ファイルを出さない', () => {
    // 実例: 「34号館出発→みどりのこかげ」のように便ごとに乗り場・行先が違う注記がある
    const im = intermediate('event_20260614')
    im.day_types[0]!.irregular_notes = true
    const result = assembleEvent(im, ['2026-10-11'], '薬学ワークショップ')
    expect(result.outputs).toEqual([])
    expect(result.rejectCode).toBe('irregular_notes')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('特別ダイヤ')
  })

  it('irregular_notes が false・未定義なら従来どおり組み立て、rejectCode は付かない', () => {
    for (const value of [false, undefined]) {
      const im = intermediate('event_20260614')
      if (value === undefined) delete im.day_types[0]!.irregular_notes
      else im.day_types[0]!.irregular_notes = value
      const result = assembleEvent(im, ['2026-06-14'], '掲載行ラベル')
      expect(result.errors, String(value)).toEqual([])
      expect(result.rejectCode, String(value)).toBeUndefined()
      expect(result.outputs[0]!.timetable, String(value)).toEqual(expected('timetable_event_20260614'))
    }
  })

  it('assemble 経由（event リンク）でも irregular_notes で拒否される', () => {
    const im = intermediate('event_20260620')
    im.day_types[0]!.irregular_notes = true
    const result = assemble(link({ kind: 'event', dates: ['2026-10-11'], label: 'x' }), im)
    expect(result.outputs).toEqual([])
    expect(result.rejectCode).toBe('irregular_notes')
  })

  it('通常ダイヤは irregular_notes があっても組み立てる（拒否は event だけ。warn は plan.ts が出す）', () => {
    const im = intermediate('regular')
    for (const d of im.day_types) d.irregular_notes = true
    const result = assemble(link({ kind: 'regular' }), im)
    expect(result.errors).toEqual([])
    expect(result.rejectCode).toBeUndefined()
    expect(result.outputs.map((o) => o.fileName).sort()).toEqual(['timetable_holiday.json', 'timetable_weekday.json'])
    // 注記の印は時刻表ファイルへ漏れない（expected と完全一致の範囲で比較）
    for (const name of ['timetable_weekday', 'timetable_holiday']) {
      const output = result.outputs.find((o) => o.fileName === `${name}.json`)!
      expect(output.timetable.routes, name).toEqual(expected(name).routes)
    }
  })

  it('長期休暇ダイヤは irregular_notes があっても組み立てる', () => {
    const im = intermediate('vacation_summer')
    for (const d of im.day_types) d.irregular_notes = true
    const result = assemble(link({ kind: 'vacation', season: 'summer' }), im)
    expect(result.errors).toEqual([])
    expect(result.rejectCode).toBeUndefined()
    for (const name of ['timetable_vacation_summer_weekday', 'timetable_vacation_summer_holiday']) {
      const output = result.outputs.find((o) => o.fileName === `${name}.json`)!
      expect(output.timetable, name).toEqual(expected(name))
    }
  })
})

describe('曜日括弧の除去の拡張（v1.16）', () => {
  // 実ページ（2026-10-03）で「（月・祝）」の表記があり、1 文字の曜日括弧しか除けず種別名と誤認していた
  it('「（月・祝）」など複数文字の曜日括弧を含む日付だけのラベルを無意味と判定する', () => {
    expect(isMeaninglessLabel('2026年10月12日（月・祝）')).toBe(true)
    expect(isMeaninglessLabel('10月12日(月・祝)')).toBe(true)
    expect(isMeaninglessLabel('10月12日（月 祝）')).toBe(true)
    expect(isMeaninglessLabel('10月12日（祝）')).toBe(true)
    expect(isMeaninglessLabel('10月11日（日）・10月12日（月・祝）')).toBe(true)
  })

  it('曜日以外の括弧書きは除かない（行事名を無意味と誤判定しない）', () => {
    expect(isMeaninglessLabel('10月12日（月・祝）薬学ワークショップ')).toBe(false)
    expect(isMeaninglessLabel('（公開講座）')).toBe(false)
  })

  it('OCR ラベルが「（月・祝）」付きの日付だけなら掲載行ラベルにフォールバックする', () => {
    const im = intermediate('event_20260620')
    im.day_types[0]!.label = '2026年10月12日（月・祝）'
    const result = assembleEvent(im, ['2026-10-12'], '薬学ワークショップ')
    expect(result.errors).toEqual([])
    expect(result.outputs[0]!.timetable.name).toBe('薬学ワークショップダイヤ')
  })
})
