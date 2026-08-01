import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  repoPath,
  formatTimetable,
  formatCalendarRules,
  formatHolidaysCache,
  isWritableTimetableFile,
  isDeletableTimetableFile,
  assertWritable,
  assertDeletable,
} from '../src/files.js'
import type { Timetable } from '../src/types.js'

function readRaw(rel: string): string {
  return readFileSync(repoPath(rel), 'utf-8').replace(/\r\n/g, '\n')
}

describe('JSON 整形規約（NFR-2 / §3.5）', () => {
  // 既存ファイルを parse → 再整形して byte 一致すること。
  // これが崩れると Bot が触ったファイルが全行書き換えになり、PR レビューが機能しなくなる。
  it.each([
    'public/data/timetables/timetable_weekday.json',
    'public/data/timetables/timetable_holiday.json',
    'public/data/timetables/timetable_closed.json',
    'public/data/timetables/timetable_special.json',
    'public/data/timetables/timetable_vacation_obon.json',
  ])('%s を再整形しても既存ファイルと完全一致する', (rel) => {
    const raw = readRaw(rel)
    expect(formatTimetable(JSON.parse(raw))).toBe(raw)
  })

  it('calendar_rules.json を再整形しても既存ファイルと完全一致する', () => {
    const raw = readRaw('public/data/calendar_rules.json')
    expect(formatCalendarRules(JSON.parse(raw))).toBe(raw)
  })

  it('holidays.json を再整形しても既存ファイルと完全一致する', () => {
    const raw = readRaw('bot/holidays.json')
    expect(formatHolidaysCache(JSON.parse(raw))).toBe(raw)
  })

  it('_examples/ のテンプレートも同じスタイルで再現できる', () => {
    const raw = readRaw('public/data/_examples/timetable_vacation_SEASON_weekday.json')
    expect(formatTimetable(JSON.parse(raw))).toBe(raw)
  })

  it('BOM なし・LF・末尾改行1つで出力する', () => {
    const out = formatTimetable(JSON.parse(readRaw('public/data/timetables/timetable_holiday.json')))
    expect(out.startsWith('﻿')).toBe(false)
    expect(out.includes('\r')).toBe(false)
    expect(out.endsWith('}\n')).toBe(true)
    expect(out.endsWith('}\n\n')).toBe(false)
  })

  it('キー順を保持する（未知フィールドも落とさない）', () => {
    const obj = {
      id: 'timetable_event_20260823',
      name: 'テスト',
      _memo: '未知フィールド',
      routes: {
        station_to_campus: {
          origin: '松永発',
          destination: '大学行き',
          bus_stop_name: '松永 バス乗り場',
          bus_stop_coords: { lat: 1, lng: 2 },
          schedule: [{ departure: '08:00', note: '最終' }],
        },
      },
    }
    const out = formatTimetable(obj)
    expect(out).toContain('"_memo": "未知フィールド"')
    expect(out.indexOf('"id"')).toBeLessThan(out.indexOf('"name"'))
    expect(out.indexOf('"name"')).toBeLessThan(out.indexOf('"_memo"'))
    expect(out).toContain('"bus_stop_coords": { "lat": 1, "lng": 2 },')
    expect(out).toContain('        { "departure": "08:00", "note": "最終" }')
  })

  it('空の schedule は [] と出力する', () => {
    const t = JSON.parse(readRaw('public/data/timetables/timetable_closed.json')) as Timetable
    expect(formatTimetable(t)).toContain('"schedule": []')
  })
})

describe('保護ガード（§7.4・テスト7）', () => {
  it('ホワイトリストに合致するファイル名のみ書込を許可する', () => {
    expect(isWritableTimetableFile('timetable_weekday.json')).toBe(true)
    expect(isWritableTimetableFile('timetable_holiday.json')).toBe(true)
    expect(isWritableTimetableFile('timetable_vacation_summer_weekday.json')).toBe(true)
    expect(isWritableTimetableFile('timetable_vacation_winter_holiday.json')).toBe(true)
    expect(isWritableTimetableFile('timetable_event_20260823.json')).toBe(true)
  })

  it('保護ファイル・未知ファイルへの書込を拒否する', () => {
    expect(isWritableTimetableFile('timetable_closed.json')).toBe(false)
    // 特別ダイヤは override から参照するだけで、Bot はファイルを書かない
    expect(isWritableTimetableFile('timetable_special.json')).toBe(false)
    expect(isWritableTimetableFile('timetable_sample.json')).toBe(false)
    expect(isWritableTimetableFile('timetable_event_example.json')).toBe(false)
    expect(isWritableTimetableFile('timetable_event_YYYYMMDD.json')).toBe(false)
    expect(isWritableTimetableFile('timetable_vacation_SEASON_weekday.json')).toBe(false)
    expect(isWritableTimetableFile('../../../etc/passwd')).toBe(false)
    expect(isWritableTimetableFile('news.json')).toBe(false)
    expect(() => assertWritable('timetable_closed.json')).toThrow()
  })

  it('削除はイベントファイルのみ許可する', () => {
    expect(isDeletableTimetableFile('timetable_event_20260614.json')).toBe(true)
    expect(isDeletableTimetableFile('timetable_weekday.json')).toBe(false)
    expect(isDeletableTimetableFile('timetable_holiday.json')).toBe(false)
    expect(isDeletableTimetableFile('timetable_vacation_summer_weekday.json')).toBe(false)
    expect(isDeletableTimetableFile('timetable_closed.json')).toBe(false)
    expect(isDeletableTimetableFile('timetable_special.json')).toBe(false)
    expect(() => assertDeletable('timetable_weekday.json')).toThrow()
  })
})
