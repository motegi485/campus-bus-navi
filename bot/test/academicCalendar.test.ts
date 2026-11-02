/**
 * FR-13【v1.19】学年暦からの「土日・祝日の授業日」の予約。
 * リンク抽出・変更検知・読み取り結果の検証・state の更新・カレンダーの優先順位・通知本文を固定する。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectAcademicChanges,
  extractAcademicCalendarLinks,
  fiscalYearOf,
  looksLikePdf,
  nextAcademicCalendars,
  toAcademicDays,
  type AcademicLink,
  type AcademicResult,
  type PdfDocument,
  type PdfFetcher,
  type PdfFetchResult,
  type RawAcademicCalendar,
} from '../src/academicCalendar.js'
import { calculateOverrides, type CalendarInput } from '../src/calendar.js'
import { CONFIG } from '../src/config.js'
import { buildPlan } from '../src/plan.js'
import { academicSection } from '../src/report.js'
import type { Holiday, State, StateAcademicCalendar } from '../src/types.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'academic')
const PAGE_HTML = readFileSync(path.join(FIXTURES, 'page_snapshot_20261102.html'), 'utf-8')
const EXPECTED_2026 = JSON.parse(readFileSync(path.join(FIXTURES, 'expected_2026.json'), 'utf-8')) as RawAcademicCalendar
const PAGE_URL = CONFIG.academicCalendarPageUrl
const PDF_URL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/03/2026年度_学年暦.pdf'

const HOLIDAYS_2026: Holiday[] = [
  { date: '2026-11-03', name: '文化の日' },
  { date: '2026-11-23', name: '勤労感謝の日' },
  { date: '2027-01-11', name: '成人の日' },
]

function link(fiscalYear = '2026', url = PDF_URL): AcademicLink {
  return { fiscalYear, url, fetchUrl: new URL(url).toString(), text: `${fiscalYear}年度(PDF)` }
}

function pdf(sha = 'sha-new'): PdfDocument {
  return { buffer: Buffer.from('%PDF-1.7'), sha256: sha, etag: '"etag-new"', lastModified: 'Tue, 31 Mar 2026 10:30:30 GMT' }
}

function entry(partial: Partial<StateAcademicCalendar> = {}): StateAcademicCalendar {
  return {
    url: PDF_URL,
    sha256: 'sha-old',
    processed_at: '2026-04-01T07:00:00+09:00',
    days: [{ date: '2026-11-07', kind: '曜日調整日', note: '' }],
    etag: '"etag-old"',
    checked_at: '2026-11-01',
    ...partial,
  }
}

/** 呼び出しを記録する偽の PDF 取得 */
function fakeFetcher(result: PdfFetchResult): { fetcher: PdfFetcher; calls: { url: string; validators?: unknown }[] } {
  const calls: { url: string; validators?: unknown }[] = []
  const fetcher: PdfFetcher = async (url, validators) => {
    calls.push({ url, validators })
    return result
  }
  return { fetcher, calls }
}

// ---------------------------------------------------------------------------

describe('年度', () => {
  it('4/1 始まりで年度を決める', () => {
    expect(fiscalYearOf('2026-04-01')).toBe(2026)
    expect(fiscalYearOf('2027-03-31')).toBe(2026)
    expect(fiscalYearOf('2026-03-31')).toBe(2025)
  })
})

describe('学年暦リンクの抽出', () => {
  it('2026-11-02 の教務課ページから 2026 年度の学年暦 PDF だけを取る（入学年度別の PDF は拾わない）', () => {
    const { links, warnings } = extractAcademicCalendarLinks(PAGE_HTML, PAGE_URL, '2026-11-02')
    expect(warnings).toEqual([])
    expect(links).toHaveLength(1)
    expect(links[0]!.fiscalYear).toBe('2026')
    expect(links[0]!.url).toBe(PDF_URL)
    // 取得には percent-encode された URL を使う
    expect(links[0]!.fetchUrl).toBe(
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/03/2026%E5%B9%B4%E5%BA%A6_%E5%AD%A6%E5%B9%B4%E6%9A%A6.pdf',
    )
  })

  it('今日の年度の前後 1 年より外の版は対象にしない', () => {
    expect(extractAcademicCalendarLinks(PAGE_HTML, PAGE_URL, '2028-05-01').links).toEqual([])
    // 2027-03 には翌年度（2027）が前後 1 年に入るが、今回のページにある 2026 も対象のまま
    expect(extractAcademicCalendarLinks(PAGE_HTML, PAGE_URL, '2027-03-20').links.map((l) => l.fiscalYear)).toEqual(['2026'])
  })

  it('ファイル名とリンク文字列で年度が食い違うリンクは採らずに warn にする', () => {
    const html = '<a href="/wp-content/uploads/2027/03/2027年度_学年暦.pdf">2026年度(PDF)</a>'
    const { links, warnings } = extractAcademicCalendarLinks(html, PAGE_URL, '2026-11-02')
    expect(links).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['academic_link_year_unknown'])
  })

  it('年度を読めないリンクは採らずに warn にする', () => {
    const html = '<a href="/wp-content/uploads/gakunenreki.pdf">学年暦(PDF)</a>'
    const { links, warnings } = extractAcademicCalendarLinks(html, PAGE_URL, '2026-11-02')
    expect(links).toEqual([])
    expect(warnings[0]!.code).toBe('academic_link_year_unknown')
  })

  it('同じ年度に別 URL のリンクが複数あれば、どれも採らずに warn にする', () => {
    const html =
      '<a href="/wp-content/uploads/2026/03/2026年度_学年暦.pdf">2026年度(PDF)</a>' +
      '<a href="/wp-content/uploads/2026/05/2026年度_学年暦_改訂.pdf">2026年度(PDF)</a>' +
      // 同じ URL への重複リンクは 1 件と数える
      '<a href="/wp-content/uploads/2026/03/2026年度_学年暦.pdf">学年暦</a>'
    const { links, warnings } = extractAcademicCalendarLinks(html, PAGE_URL, '2026-11-02')
    expect(links).toEqual([])
    expect(warnings.map((w) => w.code)).toEqual(['academic_link_ambiguous'])
  })

  it('許可されていないホストの PDF は取得しない', () => {
    const html = '<a href="https://evil.example.com/2026年度_学年暦.pdf">2026年度(PDF)</a>'
    const { links, warnings } = extractAcademicCalendarLinks(html, PAGE_URL, '2026-11-02')
    expect(links).toEqual([])
    expect(warnings[0]!.code).toBe('academic_link_host_rejected')
  })

  it('「学年暦」を含まない PDF・PDF でないリンクは見ない', () => {
    const html =
      '<a href="/wp-content/uploads/2026/06/2026_ruisekitani.pdf">令和8年度入学生用(PDF)</a>' +
      '<a href="/education/academic-affairs/academic-affairs_guide/">学年暦</a>' +
      '<a href="/wp-content/uploads/2026/03/2026年度_学年暦.png">2026年度</a>'
    expect(extractAcademicCalendarLinks(html, PAGE_URL, '2026-11-02')).toEqual({ links: [], warnings: [] })
  })
})

describe('PDF の実体検査', () => {
  it('%PDF- で始まるものだけを PDF とみなす', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n'))).toBe(true)
    expect(looksLikePdf(Buffer.from('<!DOCTYPE html>'))).toBe(false)
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false)
  })
})

describe('学年暦の変更検知', () => {
  it('記録の無い年度は取得して読む（条件付き GET にしない）', async () => {
    const { fetcher, calls } = fakeFetcher({ status: 'ok', pdf: pdf() })
    const [decision] = await detectAcademicChanges([link()], undefined, '2026-11-02', fetcher)
    expect(decision!.action).toBe('read')
    expect(calls).toEqual([{ url: link().fetchUrl, validators: undefined }])
  })

  it('同じ URL で 304 なら unchanged（検証子と確認日を更新）', async () => {
    const { fetcher, calls } = fakeFetcher({ status: 'not_modified', etag: '', lastModified: '' })
    const [decision] = await detectAcademicChanges([link()], { 2026: entry() }, '2026-11-02', fetcher)
    expect(decision).toMatchObject({ action: 'unchanged', check: { etag: '"etag-old"', checked_at: '2026-11-02' } })
    expect(calls[0]!.validators).toEqual({ etag: '"etag-old"' })
  })

  it('同じ URL で内容が変わっていたら読み直す', async () => {
    const { fetcher } = fakeFetcher({ status: 'ok', pdf: pdf('sha-new') })
    const [decision] = await detectAcademicChanges([link()], { 2026: entry() }, '2026-11-02', fetcher)
    expect(decision!.action).toBe('read')
  })

  it('同じ URL で SHA-256 が同じなら unchanged', async () => {
    const { fetcher } = fakeFetcher({ status: 'ok', pdf: pdf('sha-old') })
    const [decision] = await detectAcademicChanges([link()], { 2026: entry() }, '2026-11-02', fetcher)
    expect(decision!.action).toBe('unchanged')
  })

  it('取得に失敗したら failed（差し替えを検出していなければ pending にしない）', async () => {
    const { fetcher } = fakeFetcher({ status: 'error', reason: 'HTTP 500' })
    const [decision] = await detectAcademicChanges([link()], { 2026: entry() }, '2026-11-02', fetcher)
    expect(decision).toMatchObject({ action: 'failed', pending: false })
  })

  it('前回読めなかった差し替え（pending）がある間は検証子を付けずに取り直し、失敗も pending のまま', async () => {
    const ok = fakeFetcher({ status: 'ok', pdf: pdf('sha-pending') })
    const [read] = await detectAcademicChanges([link()], { 2026: entry({ pending_sha256: 'sha-pending' }) }, '2026-11-02', ok.fetcher)
    expect(read!.action).toBe('read')
    expect(ok.calls[0]!.validators).toBeUndefined()

    const ng = fakeFetcher({ status: 'error', reason: 'timeout' })
    const [failed] = await detectAcademicChanges([link()], { 2026: entry({ pending_sha256: 'sha-pending' }) }, '2026-11-02', ng.fetcher)
    expect(failed).toMatchObject({ action: 'failed', pending: true, pendingSha256: 'sha-pending' })
  })

  it('検証子が無く、最後の確認から間隔が空いていなければ取得しない', async () => {
    const { fetcher, calls } = fakeFetcher({ status: 'ok', pdf: pdf() })
    const prev = entry({ etag: undefined, checked_at: '2026-10-30' })
    delete prev.etag
    const [decision] = await detectAcademicChanges([link()], { 2026: prev }, '2026-11-02', fetcher)
    expect(decision!.action).toBe('unchanged')
    expect(calls).toEqual([])
  })

  it('URL が変わったら（改訂版の掲載など）取得して読む', async () => {
    const { fetcher } = fakeFetcher({ status: 'ok', pdf: pdf() })
    const newUrl = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/05/2026年度_学年暦.pdf'
    const [decision] = await detectAcademicChanges([link('2026', newUrl)], { 2026: entry() }, '2026-11-02', fetcher)
    expect(decision!.action).toBe('read')
    expect(decision!.reason).toMatch(/URL が変わりました/)
  })
})

describe('読み取り結果の検証（toAcademicDays）', () => {
  it('2026 年度の期待値を日付に直す（1〜3 月は翌年）', () => {
    const result = toAcademicDays(2026, EXPECTED_2026)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.days.map((d) => d.date)).toEqual([
      '2026-05-02', '2026-05-09', '2026-05-16', '2026-07-25', '2026-09-26', '2026-10-24',
      '2026-11-07', '2026-11-28', '2027-01-21', '2027-01-28', '2027-01-29',
    ])
    expect(result.days[0]).toEqual({ date: '2026-05-02', kind: '曜日調整日', note: '曜日調整日(水曜日の授業を実施)' })
  })

  it('曜日が実際と合わない日が 1 件でもあれば版全体を採らない（月の取り違えの検出）', () => {
    const raw: RawAcademicCalendar = {
      fiscal_year: 2026,
      days: [...EXPECTED_2026.days, { month: 6, day: 7, weekday: '土', kind: '曜日調整日', note: '' }], // 6/7 は日曜
    }
    const result = toAcademicDays(2026, raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/6\/7\(土\) の曜日が実際の曜日（日）と一致しません/)
  })

  it('実在しない日・想定外の種別・年度の不一致・件数超過は採らない', () => {
    expect(toAcademicDays(2026, { fiscal_year: 2026, days: [{ month: 2, day: 30, weekday: '火', kind: '授業日', note: '' }] }).ok).toBe(false)
    expect(toAcademicDays(2026, { fiscal_year: 2026, days: [{ month: 11, day: 7, weekday: '土', kind: '休業日', note: '' }] }).ok).toBe(false)
    expect(toAcademicDays(2026, { ...EXPECTED_2026, fiscal_year: 2025 }).ok).toBe(false)
    const many: RawAcademicCalendar = { fiscal_year: 2026, days: [] }
    for (let d = 0; d < CONFIG.academicMaxDaysPerYear + 1; d++) {
      // 2026-04-04（土）から 7 日ごとの土曜
      const date = new Date(Date.UTC(2026, 3, 4 + d * 7))
      many.days.push({ month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: '土', kind: '授業日', note: '' })
    }
    const result = toAcademicDays(2026, many)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/上限/)
  })

  it('同じ日付が 2 回出たら最初の 1 件を残す', () => {
    const result = toAcademicDays(2026, {
      fiscal_year: 2026,
      days: [
        { month: 11, day: 7, weekday: '土', kind: '曜日調整日', note: '曜日調整日(火曜日の授業を実施)' },
        { month: 11, day: 7, weekday: '土', kind: '授業日', note: '' },
      ],
    })
    expect(result).toEqual({ ok: true, days: [{ date: '2026-11-07', kind: '曜日調整日', note: '曜日調整日(火曜日の授業を実施)' }] })
  })
})

describe('state への反映（nextAcademicCalendars）', () => {
  const RUN_AT = '2026-11-02T07:00:00+09:00'
  const days2026 = (() => {
    const r = toAcademicDays(2026, EXPECTED_2026)
    if (!r.ok) throw new Error(r.reason)
    return r.days
  })()

  it('初めて取り込んだ年度を記録し、確認を促す warn を出す', () => {
    const results: AcademicResult[] = [{ fiscalYear: '2026', status: 'accepted', link: link(), pdf: pdf(), days: days2026, reason: '' }]
    const out = nextAcademicCalendars(undefined, results, '2026-11-02', RUN_AT, true)
    expect(out.calendars['2026']).toMatchObject({ url: PDF_URL, sha256: 'sha-new', etag: '"etag-new"', checked_at: '2026-11-02', processed_at: RUN_AT })
    expect(out.calendars['2026']!.days).toHaveLength(11)
    expect(out.updates).toMatchObject([{ fiscalYear: '2026', first: true }])
    expect(out.warnings.map((w) => [w.level, w.code])).toEqual([['warn', 'academic_calendar_updated']])
  })

  it('読み直した年度は追加・削除された日をレポートに渡す', () => {
    const prev = { 2026: entry({ days: [{ date: '2026-11-07', kind: '曜日調整日', note: '' }, { date: '2026-12-05', kind: '授業予備日', note: '' }] }) }
    const results: AcademicResult[] = [{ fiscalYear: '2026', status: 'accepted', link: link(), pdf: pdf(), days: days2026, reason: '' }]
    const out = nextAcademicCalendars(prev, results, '2026-11-02', RUN_AT, true)
    expect(out.updates[0]!.first).toBe(false)
    expect(out.updates[0]!.removed).toEqual(['2026-12-05'])
    expect(out.updates[0]!.added).toContain('2026-11-28')
    expect(out.updates[0]!.added).not.toContain('2026-11-07')
  })

  it('unchanged は検証子と確認日を更新し、pending を消す', () => {
    const prev = { 2026: entry({ pending_sha256: 'sha-pending' }) }
    const out = nextAcademicCalendars(
      prev,
      [{ fiscalYear: '2026', status: 'unchanged', link: link(), check: { etag: '"etag-2"', checked_at: '2026-11-02' } }],
      '2026-11-02',
      RUN_AT,
      true,
    )
    expect(out.calendars['2026']).toMatchObject({ etag: '"etag-2"', checked_at: '2026-11-02', sha256: 'sha-old' })
    expect(out.calendars['2026']).not.toHaveProperty('pending_sha256')
    expect(out.warnings).toEqual([])
  })

  it('差し替えを読めなかったら前回の記録を維持し、pending を残して warn', () => {
    const out = nextAcademicCalendars(
      { 2026: entry() },
      [{ fiscalYear: '2026', status: 'failed', link: link(), reason: '3回読んでも結果が一致しませんでした', pending: true, pendingSha256: 'sha-new', retry: true }],
      '2026-11-02',
      RUN_AT,
      true,
    )
    expect(out.calendars['2026']).toMatchObject({ sha256: 'sha-old', pending_sha256: 'sha-new', days: entry().days })
    expect(out.warnings.map((w) => [w.level, w.code])).toEqual([['warn', 'academic_calendar_failed']])
  })

  it('今年度を初めて読めなかった回は failed の warn だけを出し、未取り込みの warn を重ねない', () => {
    const out = nextAcademicCalendars(
      undefined,
      [{ fiscalYear: '2026', status: 'failed', link: link(), reason: 'SKIP_OCR=1', pending: true, pendingSha256: 'sha-new', retry: true }],
      '2026-11-02',
      RUN_AT,
      true,
    )
    expect(out.calendars).toEqual({})
    expect(out.warnings.map((w) => [w.level, w.code])).toEqual([['warn', 'academic_calendar_failed']])
    expect(out.warnings[0]!.message).toMatch(/まだ予約されていません/)
  })

  it('一時的な再確認の失敗は info、長く確認できていなければ warn', () => {
    const failed: AcademicResult = { fiscalYear: '2026', status: 'failed', link: link(), reason: 'HTTP 500', pending: false, retry: true }
    const recent = nextAcademicCalendars({ 2026: entry({ checked_at: '2026-11-01' }) }, [failed], '2026-11-02', RUN_AT, true)
    expect(recent.warnings.map((w) => [w.level, w.code])).toEqual([['info', 'academic_calendar_recheck_failed']])
    const stale = nextAcademicCalendars({ 2026: entry({ checked_at: '2026-10-01' }) }, [failed], '2026-11-02', RUN_AT, true)
    expect(stale.warnings.map((w) => w.level)).toEqual(['warn'])
  })

  it('リンクが消えても年度末までは残し、過ぎたら捨てる', () => {
    expect(nextAcademicCalendars({ 2026: entry() }, [], '2027-03-31', RUN_AT, true).calendars).toHaveProperty('2026')
    const after = nextAcademicCalendars({ 2026: entry() }, [], '2027-04-01', RUN_AT, true)
    expect(after.calendars).toEqual({})
    // 新年度（2027）の記録が無いので warn
    expect(after.warnings.map((w) => w.code)).toEqual(['academic_calendar_missing'])
  })

  it('今日の年度の記録があれば未取り込みの warn は出さない', () => {
    expect(nextAcademicCalendars({ 2026: entry() }, [], '2026-11-02', RUN_AT, true).warnings).toEqual([])
    expect(nextAcademicCalendars(undefined, [], '2026-11-02', RUN_AT, false).warnings[0]!.message).toMatch(/取得できませんでした/)
  })
})

describe('カレンダーの優先順位（FR-9 の 3b\' 学年暦）', () => {
  const TODAY = '2026-11-02'
  function run(days: { date: string; kind?: string }[], overrides: Partial<CalendarInput> = {}) {
    const state: State = {
      version: 1,
      academic_calendars: {
        2026: entry({ days: days.map((d) => ({ date: d.date, kind: (d.kind ?? '曜日調整日') as '曜日調整日', note: '' })) }),
      },
      ...(overrides.state ?? {}),
    }
    return calculateOverrides({
      liveOverrides: {},
      holidays: HOLIDAYS_2026,
      today: TODAY,
      timetableExists: () => true,
      ...overrides,
      state,
    })
  }

  it('土曜の授業日を授業日ダイヤにし、academic カテゴリで管理する', () => {
    const result = run([{ date: '2026-11-07' }, { date: '2026-11-28' }])
    expect(result.nextOverrides).toEqual({
      '2026-11-03': 'timetable_holiday',
      '2026-11-07': 'timetable_weekday',
      '2026-11-23': 'timetable_holiday',
      '2026-11-28': 'timetable_weekday',
      '2027-01-11': 'timetable_holiday',
    })
    expect(result.managed.academic).toEqual({ '2026-11-07': 'timetable_weekday', '2026-11-28': 'timetable_weekday' })
  })

  it('祝日の授業日は祝日 baseline より優先して授業日ダイヤにする', () => {
    const result = run([{ date: '2026-11-23', kind: '授業日' }])
    expect(result.nextOverrides['2026-11-23']).toBe('timetable_weekday')
    expect(result.managed.academic).toEqual({ '2026-11-23': 'timetable_weekday' })
    expect(result.managed.holiday).not.toHaveProperty('2026-11-23')
  })

  it('平日の曜日調整日・過去日には override を張らない', () => {
    const result = run([{ date: '2027-01-21' }, { date: '2026-10-24' }])
    expect(result.managed.academic).toEqual({})
    expect(result.nextOverrides).not.toHaveProperty('2027-01-21')
    expect(result.nextOverrides).not.toHaveProperty('2026-10-24')
  })

  it('長期休暇の期間と重なれば長期休暇を優先し、info を出す', () => {
    const result = run([{ date: '2026-12-26' }], {
      state: {
        version: 1,
        vacations: {
          winter: { url: 'u', sha256: 's', period: { start: '2026-12-22', end: '2027-01-04' }, derived: [], processed_at: 'x' },
        },
      },
    })
    expect(result.nextOverrides['2026-12-26']).toBe('timetable_vacation_winter_holiday')
    expect(result.warnings.map((w) => w.code)).toContain('academic_vacation_conflict')
  })

  it('イベント・特別ダイヤが張られる日はそちらを優先する（警告なし）', () => {
    const result = run([{ date: '2026-11-07' }], {
      failedEventDates: ['2026-11-07'],
    })
    expect(result.nextOverrides['2026-11-07']).toBe('timetable_special')
    expect(result.warnings.filter((w) => w.code === 'academic_vacation_conflict')).toEqual([])
  })

  it('同じ値の手動 override があれば手動が勝ち、警告は出さない（2026-11-02 の応急対応と同じ形）', () => {
    const result = run([{ date: '2026-11-07' }], { liveOverrides: { '2026-11-07': 'timetable_weekday' } })
    expect(result.nextOverrides['2026-11-07']).toBe('timetable_weekday')
    expect(result.managed.academic).toEqual({})
    expect(result.warnings.filter((w) => w.code === 'override_conflict_manual_wins')).toEqual([])
  })

  it('人が削除した学年暦の override は再生成しない', () => {
    const result = run([{ date: '2026-11-07' }], {
      prevManaged: { special: {}, event: {}, vacation: {}, academic: { '2026-11-07': 'timetable_weekday' }, holiday: {} },
    })
    expect(result.nextOverrides).not.toHaveProperty('2026-11-07')
    expect(result.suppressed).toEqual({ '2026-11-07': 'timetable_weekday' })
    expect(result.warnings.map((w) => w.code)).toContain('managed_override_deleted')
  })

  it('academic カテゴリを持たない旧 state の managed_overrides も読める', () => {
    const result = run([{ date: '2026-11-07' }], {
      liveOverrides: { '2026-11-03': 'timetable_holiday' },
      prevManaged: { special: {}, event: {}, vacation: {}, holiday: { '2026-11-03': 'timetable_holiday' } },
    })
    expect(result.nextOverrides['2026-11-07']).toBe('timetable_weekday')
    expect(result.managed.holiday).toHaveProperty('2026-11-03')
  })
})

describe('buildPlan への組み込み', () => {
  const days2026 = (() => {
    const r = toAcademicDays(2026, EXPECTED_2026)
    if (!r.ok) throw new Error(r.reason)
    return r.days
  })()

  function plan(liveOverrides: Record<string, string>, academic?: { results: AcademicResult[]; pageHealthy: boolean }, state: State = { version: 1 }) {
    return buildPlan({
      decisions: [],
      intermediates: new Map(),
      state,
      liveOverrides,
      holidays: HOLIDAYS_2026,
      today: '2026-11-02',
      runAt: '2026-11-02T07:00:00+09:00',
      readTimetable: () => null,
      timetableExists: () => true,
      ...(academic ? { academic } : {}),
    })
  }

  it('2026 年度を初めて取り込むと、11/7・11/28 は手動 override のまま、平日と過去日は記録だけになる', () => {
    const out = plan(
      { '2026-11-07': 'timetable_weekday', '2026-11-28': 'timetable_weekday' },
      { results: [{ fiscalYear: '2026', status: 'accepted', link: link(), pdf: pdf(), days: days2026, reason: '' }], pageHealthy: true },
    )
    expect(out.nextState.academic_calendars?.['2026']?.days).toHaveLength(11)
    // 手動 override と同じ値なので calendar_rules.json の差分は出ない（祝日 baseline の追加は除く）
    expect(out.calendar.changes.filter((c) => c.date === '2026-11-07' || c.date === '2026-11-28')).toEqual([])
    const status = Object.fromEntries(out.academicReports[0]!.days.map((d) => [d.date, d.status]))
    expect(status['2026-05-02']).toBe('過去日')
    expect(status['2026-11-07']).toMatch(/手動 override/)
    expect(status['2027-01-21']).toMatch(/平日/)
    expect(out.warnings.map((w) => w.code)).toContain('academic_calendar_updated')
  })

  it('手動 override が無ければ授業日ダイヤを予約する', () => {
    const out = plan({}, {
      results: [{ fiscalYear: '2026', status: 'accepted', link: link(), pdf: pdf(), days: days2026, reason: '' }],
      pageHealthy: true,
    })
    expect(out.calendar.nextOverrides['2026-11-07']).toBe('timetable_weekday')
    expect(out.nextState.managed_overrides?.academic).toEqual({
      '2026-11-07': 'timetable_weekday',
      '2026-11-28': 'timetable_weekday',
    })
    const status = Object.fromEntries(out.academicReports[0]!.days.map((d) => [d.date, d.status]))
    expect(status['2026-11-28']).toBe('授業日ダイヤを予約')
  })

  it('academic を渡さなければ前回の記録をそのまま使い、警告も出さない', () => {
    const state: State = { version: 1, academic_calendars: { 2026: entry() } }
    const out = plan({}, undefined, state)
    expect(out.nextState.academic_calendars).toEqual(state.academic_calendars)
    expect(out.calendar.nextOverrides['2026-11-07']).toBe('timetable_weekday')
    expect(out.warnings.filter((w) => w.code.startsWith('academic_'))).toEqual([])
    expect(out.academicReports).toEqual([])
  })
})

describe('通知本文（学年暦の節）', () => {
  it('備考・URL を escape し、時刻表 ID の _ を逃がす', () => {
    const lines = academicSection([
      {
        fiscalYear: '2026',
        url: 'https://www.fukuyama-u.ac.jp/a (b).pdf',
        first: false,
        added: ['2026-11-28'],
        removed: [],
        days: [{ date: '2026-11-28', kind: '曜日調整日', note: '<img src=x>[link](y)|', status: '授業日ダイヤを予約' }],
      },
    ]).join('\n')
    expect(lines).toContain('timetable\\_weekday')
    expect(lines).toContain('(https://www.fukuyama-u.ac.jp/a%20%28b%29.pdf)')
    expect(lines).toContain('&lt;img src=x&gt;\\[link\\](y)\\|')
    expect(lines).not.toContain('<img')
    expect(lines).toContain('追加 2026-11-28')
  })

  it('取り込みが無ければ節を出さない', () => {
    expect(academicSection([])).toEqual([])
  })
})
