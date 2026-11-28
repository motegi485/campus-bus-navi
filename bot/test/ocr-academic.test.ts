/**
 * FR-13【v1.19】学年暦 PDF の読み取り（2 回読み照合）。Gemini はモックする。
 * 既存の時刻表 OCR（read）と同じ照合規則で、比べるのは年度と、備考欄で裏付けられた日（v1.21）の
 * 日付の集合だけであることを固定する。
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
  ThinkingLevel: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
  MediaResolution: { MEDIA_RESOLUTION_HIGH: 'MEDIA_RESOLUTION_HIGH' },
}))

import { ACADEMIC_PROMPT, ACADEMIC_SCHEMA, OcrClient, academicDateKey, parseAcademicCalendar } from '../src/ocr.js'
import { CONFIG } from '../src/config.js'

const mutableConfig = CONFIG as unknown as { geminiMinIntervalMs: number }
const originalMinIntervalMs = CONFIG.geminiMinIntervalMs

// 備考を省くと、実データと同じく種別の語をそのまま入れる（曜日調整日・授業予備日なら自動で予約する日になる）
const day = (month: number, d: number, weekday: string, kind = '曜日調整日', note: string = kind) => ({ month, day: d, weekday, kind, note })
/** セルの色だけで判断した日（備考は空。要確認の候補） */
const colorOnly = (month: number, d: number, weekday: string, kind = '授業日') => day(month, d, weekday, kind, '')

type Request = { config: { thinkingConfig: { thinkingLevel: string } } }
const thinkingOf = (call: number) => (mocks.generateContent.mock.calls[call]![0] as Request).config.thinkingConfig.thinkingLevel
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

  it('2 回の読みで自動で予約する日の集合が一致すれば採用する（備考の言い回しの揺れは比べない）', async () => {
    mocks.generateContent
      .mockResolvedValueOnce(response([day(11, 7, '土', '曜日調整日', '曜日調整日(火曜日の授業を実施)'), day(1, 29, '金', '授業予備日')]))
      .mockResolvedValueOnce(response([day(1, 29, '金', '授業予備日', '29(金)授業予備日'), day(11, 7, '土', '曜日調整日', '曜日調整日')]))
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

  it('【v1.21】色だけで判断した日（要確認の候補）だけが食い違っても、2 回で採用する', async () => {
    mocks.generateContent
      .mockResolvedValueOnce(response([day(11, 7, '土'), colorOnly(11, 23, '月'), colorOnly(2, 6, '土', '定期試験実施日')]))
      .mockResolvedValueOnce(response([day(11, 7, '土')]))
    const outcome = await new OcrClient('dummy').readAcademicCalendar(PDF)
    expect(outcome).toMatchObject({ ok: true, attempts: 2, majority: false })
    // 採用するのは先の読み取り（要確認の候補も含めて記録する）
    expect(outcome.calendar!.days).toHaveLength(3)
  })

  it('【v1.21】自動で予約する日が食い違えば 3 回目に進む（種別が同じでも備考の裏付けが消えれば食い違い）', async () => {
    mocks.generateContent
      .mockResolvedValueOnce(response([day(11, 7, '土')]))
      .mockResolvedValueOnce(response([day(11, 7, '土', '曜日調整日', '')]))
      .mockResolvedValueOnce(response([day(11, 7, '土')]))
    const outcome = await new OcrClient('dummy').readAcademicCalendar(PDF)
    expect(outcome).toMatchObject({ ok: true, attempts: 3, majority: true })
  })

  it('【v1.21】考える深さは CONFIG.academicThinkingLevel（既定 LOW）。上書きを渡せばその値で呼ぶ', async () => {
    mocks.generateContent.mockResolvedValue(response([day(11, 7, '土')]))
    expect(CONFIG.academicThinkingLevel).toBe('LOW')
    await new OcrClient('dummy').readAcademicCalendar(PDF)
    expect(thinkingOf(0)).toBe('LOW')
    expect(thinkingOf(1)).toBe('LOW')

    mocks.generateContent.mockClear()
    await new OcrClient('dummy').readAcademicCalendar(PDF, { thinkingLevel: 'HIGH' })
    expect(thinkingOf(0)).toBe('HIGH')
    expect(thinkingOf(1)).toBe('HIGH')
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

describe('【v1.21】学年暦の読み取り指示', () => {
  it('2026 年度の期間の文言を例に挙げない（期間内の土曜を挙げる方向へ誘導した可能性がある）', () => {
    expect(ACADEMIC_PROMPT).not.toMatch(/7\/30/)
    expect(ACADEMIC_PROMPT).not.toMatch(/その期間のうち B に当たる日/)
  })

  it('灰色・白のセルは授業なしとし、一般知識・前後の日・期間の記載から推測しないよう求める', () => {
    expect(ACADEMIC_PROMPT).toMatch(/灰色・白/)
    expect(ACADEMIC_PROMPT).toMatch(/一般的な知識/)
    expect(ACADEMIC_PROMPT).toMatch(/前後の日/)
    expect(ACADEMIC_PROMPT).toMatch(/期間の記載/)
  })

  it('A（備考欄の曜日調整日・授業予備日）の指示は残す', () => {
    expect(ACADEMIC_PROMPT).toMatch(/A\. 備考欄に「曜日調整日」または「授業予備日」と書かれた日/)
  })
})

describe('学年暦の responseSchema', () => {
  it('enum を使わない（値の検査は toAcademicDays が行う。時刻表のスキーマに無い機能を増やさない）', () => {
    expect(JSON.stringify(ACADEMIC_SCHEMA)).not.toMatch(/"enum"/)
  })

  it('days に maxItems を付けない（maxItems: "80" で Gemini が 400 INVALID_ARGUMENT を返した。上限は zod と toAcademicDays で検査する）', () => {
    expect(ACADEMIC_SCHEMA.properties?.days?.maxItems).toBeUndefined()
    expect(() =>
      parseAcademicCalendar(JSON.stringify({ fiscal_year: 2026, days: Array.from({ length: 81 }, () => day(11, 7, '土')) })),
    ).toThrow(/スキーマ/)
  })
})

describe('照合キーと応答の検証', () => {
  it('日付の順序・重複に依存しない（4 月始まりで並べる）', () => {
    const a = academicDateKey({ fiscal_year: 2026, days: [day(1, 29, '金'), day(11, 7, '土'), day(11, 7, '土')] })
    const b = academicDateKey({ fiscal_year: 2026, days: [day(11, 7, '土'), day(1, 29, '金')] })
    expect(a).toBe(b)
    expect(a).toBe('2026|11-07,01-29')
  })

  it('【v1.21】色だけで判断した日はキーに含めない', () => {
    const key = academicDateKey({ fiscal_year: 2026, days: [day(11, 7, '土'), colorOnly(11, 23, '月'), colorOnly(8, 1, '土', '定期試験実施日')] })
    expect(key).toBe('2026|11-07')
  })

  it('JSON でない応答・範囲外の月は OcrResponseInvalidError', () => {
    expect(() => parseAcademicCalendar('not json')).toThrow(/JSON ではありません/)
    expect(() => parseAcademicCalendar(JSON.stringify({ fiscal_year: 2026, days: [day(13, 1, '土')] }))).toThrow(/スキーマ/)
  })
})
