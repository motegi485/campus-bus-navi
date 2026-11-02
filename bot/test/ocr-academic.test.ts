/**
 * FR-13【v1.19】学年暦 PDF の読み取り（2 回読み照合）。Gemini はモックする。
 * 既存の時刻表 OCR（read）と同じ照合規則で、比べるのは年度と日付の集合だけであることを固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }

    constructor(_options: unknown) {}
  },
  Type: {
    ARRAY: 'ARRAY',
    OBJECT: 'OBJECT',
    INTEGER: 'INTEGER',
    STRING: 'STRING',
    BOOLEAN: 'BOOLEAN',
  },
  ThinkingLevel: { LOW: 'LOW' },
  MediaResolution: { MEDIA_RESOLUTION_HIGH: 'MEDIA_RESOLUTION_HIGH' },
}))

import { ACADEMIC_SCHEMA, OcrClient, academicDateKey, parseAcademicCalendar } from '../src/ocr.js'
import { CONFIG } from '../src/config.js'

const mutableConfig = CONFIG as unknown as { geminiMinIntervalMs: number }
const originalMinIntervalMs = CONFIG.geminiMinIntervalMs

const day = (month: number, d: number, weekday: string, kind = '曜日調整日', note = '') => ({ month, day: d, weekday, kind, note })
const response = (days: ReturnType<typeof day>[], fiscalYear = 2026) => ({ text: JSON.stringify({ fiscal_year: fiscalYear, days }) })

const PDF = Buffer.from('%PDF-1.7')

describe('学年暦の読み取り（readAcademicCalendar）', () => {
  beforeEach(() => {
    mocks.generateContent.mockReset()
    mutableConfig.geminiMinIntervalMs = 0
  })
  afterEach(() => {
    mutableConfig.geminiMinIntervalMs = originalMinIntervalMs
  })

  it('2 回の読みで日付の集合が一致すれば採用する（種別・備考の揺れは比べない）', async () => {
    mocks.generateContent
      .mockResolvedValueOnce(response([day(11, 7, '土', '曜日調整日', '曜日調整日(火曜日の授業を実施)'), day(1, 29, '金', '授業予備日')]))
      .mockResolvedValueOnce(response([day(1, 29, '金', '授業予備日'), day(11, 7, '土', '授業日', '')]))
    const client = new OcrClient('dummy')
    const outcome = await client.readAcademicCalendar(PDF)
    expect(outcome.ok).toBe(true)
    expect(outcome.attempts).toBe(2)
    expect(outcome.majority).toBe(false)
    // 採用するのは先の読み取り
    expect(outcome.calendar!.days[0]!.note).toBe('曜日調整日(火曜日の授業を実施)')
    // PDF として送り、学年暦のプロンプトとスキーマを使う
    const request = mocks.generateContent.mock.calls[0]![0] as {
      contents: { parts: ({ inlineData?: { mimeType: string } } | { text?: string })[] }[]
      config: { responseSchema: { required: string[] } }
    }
    expect((request.contents[0]!.parts[0] as { inlineData: { mimeType: string } }).inlineData.mimeType).toBe('application/pdf')
    expect((request.contents[0]!.parts[1] as { text: string }).text).toMatch(/学年暦/)
    expect(request.config.responseSchema.required).toEqual(['fiscal_year', 'days'])
  })

  it('不一致なら 3 回目を読み、2 つが一致すれば多数決で採用する', async () => {
    mocks.generateContent
      .mockResolvedValueOnce(response([day(11, 7, '土')]))
      .mockResolvedValueOnce(response([day(11, 7, '土'), day(11, 14, '土')]))
      .mockResolvedValueOnce(response([day(11, 7, '土')]))
    const outcome = await new OcrClient('dummy').readAcademicCalendar(PDF)
    expect(outcome).toMatchObject({ ok: true, attempts: 3, majority: true })
    expect(outcome.calendar!.days).toHaveLength(1)
  })

  it('3 回とも一致しなければ失敗にする', async () => {
    mocks.generateContent
      .mockResolvedValueOnce(response([day(11, 7, '土')]))
      .mockResolvedValueOnce(response([day(11, 14, '土')]))
      .mockResolvedValueOnce(response([day(11, 21, '土')]))
    const outcome = await new OcrClient('dummy').readAcademicCalendar(PDF)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toMatch(/一致しませんでした/)
  })

  it('年度が違えば日付が同じでも一致とみなさない', async () => {
    mocks.generateContent
      .mockResolvedValueOnce(response([day(11, 7, '土')], 2026))
      .mockResolvedValueOnce(response([day(11, 7, '土')], 2027))
      .mockResolvedValueOnce(response([day(11, 7, '土')], 2028))
    const outcome = await new OcrClient('dummy').readAcademicCalendar(PDF)
    expect(outcome.ok).toBe(false)
  })

  it('形の崩れた応答は再試行せず失敗にする', async () => {
    mocks.generateContent.mockResolvedValueOnce({ text: JSON.stringify({ fiscal_year: '2026', days: [] }) })
    const client = new OcrClient('dummy')
    const outcome = await client.readAcademicCalendar(PDF)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toMatch(/学年暦のスキーマに合いません/)
    expect(client.calls).toBe(1)
  })

  it('学年暦の読み取りも 1 実行・1 日の呼び出し上限に数える', async () => {
    mocks.generateContent.mockResolvedValue(response([day(11, 7, '土')]))
    const client = new OcrClient('dummy', undefined, undefined, CONFIG.geminiMaxCallsPerDay - 1)
    const outcome = await client.readAcademicCalendar(PDF)
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toMatch(/呼び出し上限/)
    expect(client.budgetExhausted).toBe(true)
  })
})

describe('学年暦の responseSchema', () => {
  it('enum を使わない（値の検査は toAcademicDays が行う。時刻表のスキーマに無い機能を増やさない）', () => {
    expect(JSON.stringify(ACADEMIC_SCHEMA)).not.toMatch(/"enum"/)
  })
})

describe('照合キーと応答の検証', () => {
  it('日付の順序・重複に依存しない（4 月始まりで並べる）', () => {
    const a = academicDateKey({ fiscal_year: 2026, days: [day(1, 29, '金'), day(11, 7, '土'), day(11, 7, '土')] })
    const b = academicDateKey({ fiscal_year: 2026, days: [day(11, 7, '土'), day(1, 29, '金')] })
    expect(a).toBe(b)
    expect(a).toBe('2026|11-07,01-29')
  })

  it('JSON でない応答・範囲外の月は OcrResponseInvalidError', () => {
    expect(() => parseAcademicCalendar('not json')).toThrow(/JSON ではありません/)
    expect(() => parseAcademicCalendar(JSON.stringify({ fiscal_year: 2026, days: [day(13, 1, '土')] }))).toThrow(/スキーマ/)
  })
})
