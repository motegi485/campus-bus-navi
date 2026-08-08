import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import iconv from 'iconv-lite'
import { fetchHolidays, parseHolidayCsv } from '../src/holidays.js'
import { CONFIG } from '../src/config.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

describe('テスト8: 祝日CSV（FR-10）', () => {
  const buffer = readFileSync(path.join(FIXTURES, 'holidays_sample.csv'))

  it('Shift_JIS をデコードして YYYY-MM-DD に正規化する', () => {
    const holidays = parseHolidayCsv(buffer)
    expect(holidays).toHaveLength(18) // 2026年分
    expect(holidays[0]).toEqual({ date: '2026-01-01', name: '元日' })
    expect(holidays).toContainEqual({ date: '2026-08-11', name: '山の日' })
    expect(holidays).toContainEqual({ date: '2026-09-23', name: '秋分の日' })
    // 振替休日（名称「休日」）も落とさない
    expect(holidays).toContainEqual({ date: '2026-05-06', name: '休日' })
  })

  it('月日のゼロ埋めなし表記をゼロ埋めする', () => {
    const holidays = parseHolidayCsv(buffer)
    expect(holidays).toContainEqual({ date: '2026-01-12', name: '成人の日' })
    expect(holidays).toContainEqual({ date: '2026-05-03', name: '憲法記念日' })
  })

  it('最終行の改行が欠落していても解釈できる', () => {
    const text = iconv.decode(buffer, 'Shift_JIS').replace(/\r\n$/, '')
    const holidays = parseHolidayCsv(iconv.encode(text, 'Shift_JIS'))
    expect(holidays).toHaveLength(18)
  })

  it('LF のみの改行でも解釈できる', () => {
    const text = iconv.decode(buffer, 'Shift_JIS').replace(/\r\n/g, '\n')
    expect(parseHolidayCsv(iconv.encode(text, 'Shift_JIS'))).toHaveLength(18)
  })

  it('壊れた行があれば例外を投げる（黙って欠落させない）', () => {
    const text = iconv.decode(buffer, 'Shift_JIS').replace('2026/8/11,山の日', '2026年8月11日 山の日')
    expect(() => parseHolidayCsv(iconv.encode(text, 'Shift_JIS'))).toThrow(/解釈できません/)
  })

  it('データ行が無ければ例外を投げる', () => {
    const onlyHeader = iconv.encode('国民の祝日・休日月日,国民の祝日・休日名称\r\n', 'Shift_JIS')
    expect(() => parseHolidayCsv(onlyHeader)).toThrow(/データ行がありません/)
  })

  it('同梱の holidays.json 初期キャッシュが CSV と同じ内容を持つ', () => {
    const cache = JSON.parse(readFileSync(path.resolve(FIXTURES, '..', 'holidays.json'), 'utf-8'))
    expect(cache.holidays.length).toBeGreaterThan(1000)
    expect(cache.holidays).toContainEqual({ date: '2026-08-11', name: '山の日' })
    expect(cache.source_sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// 鮮度・将来カバレッジの停止条件（Codex レビュー F-020）
// ---------------------------------------------------------------------------

describe('祝日キャッシュの鮮度と将来カバレッジ（F-020）', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /** CSV 取得を必ず失敗させ、同梱キャッシュへのフォールバック経路を通す */
  function stubFetchFailure() {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
  }

  it('取得失敗時はキャッシュにフォールバックしつつ必ず警告を出す', async () => {
    stubFetchFailure()
    const result = await fetchHolidays('2026-08-01')
    expect(result.holidays.length).toBeGreaterThan(0)
    expect(result.cacheToWrite).toBeNull()
    expect(result.warnings.map((w) => w.code)).toContain('holiday_csv_cache_fallback')
  })

  it('キャッシュ取得日から離れすぎていたら stale として警告する', async () => {
    stubFetchFailure()
    // 同梱キャッシュの fetched_at は 2026-08-01。上限を大きく超えた日付で実行する
    const far = '2027-06-01'
    const result = await fetchHolidays(far)
    expect(result.warnings.map((w) => w.code)).toContain('holiday_cache_stale')
  })

  it('取得日から日が浅ければ stale 警告は出さない', async () => {
    stubFetchFailure()
    const result = await fetchHolidays('2026-08-10')
    expect(result.warnings.map((w) => w.code)).not.toContain('holiday_cache_stale')
  })

  it('収録の最終日が近づいたら coverage 警告を出す', async () => {
    stubFetchFailure()
    // 同梱キャッシュの最終収録日は 2027-11-23。その直前まで進めれば horizon に届かない
    const result = await fetchHolidays('2027-11-01')
    expect(result.warnings.map((w) => w.code)).toContain('holiday_coverage_short')
  })

  it('十分な将来カバレッジがあれば coverage 警告は出さない', async () => {
    stubFetchFailure()
    const result = await fetchHolidays('2026-08-01')
    expect(result.warnings.map((w) => w.code)).not.toContain('holiday_coverage_short')
    // 前提: 上限・閾値がこの検証の意味を保つ範囲にあること
    expect(CONFIG.holidayCoverageMinDays).toBeGreaterThan(0)
  })
})
