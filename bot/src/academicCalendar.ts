/**
 * FR-13【v1.19】: 学年暦からの「土日・祝日の授業日」の予約。
 *
 * 曜日調整日・授業予備日など、土日・祝日でも授業が行われる日は、バス時刻表ページに特別ダイヤとして
 * 掲載されない（通常の授業日ダイヤが走るだけ）。教務課ページに載る学年暦 PDF を読み、
 * 年度ごとに「授業・試験がある日」を state に持つ。override にするのは calendar.ts（3b'）。
 *
 * 流れ:
 *   1. extractAcademicCalendarLinks … 教務課ページから年度ごとの PDF リンクを抜く（純粋関数）
 *   2. detectAcademicChanges       … state と照合し、新しい版・差し替えだけを読み取り対象にする
 *   3. toAcademicDays              … Gemini の読み取り結果を日付に直して検証する（純粋関数）
 *   4. nextAcademicCalendars       … 結果を state に反映し、年度末を過ぎた記録を捨てる（純粋関数）
 *
 * 人の事前確認なしに main へ反映されるので、読み取りは 2 回読み照合（ocr.ts）に加えて、
 * 曜日の一致・年度内・件数の上限を検査し、1 件でも外れたらその版を丸ごと採らない。
 */

import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'
import { CONFIG } from './config.js'
import { fetchWithTimeout } from './fetchPage.js'
import { checkUrl } from './url.js'
import { dayOfWeek, formatDate, isBefore, isRealDate, parseDate } from './time.js'
import type { AcademicDay, AcademicDayKind, StateAcademicCalendar, StateFetchCheck, Warning } from './types.js'

export const ACADEMIC_DAY_KINDS: readonly AcademicDayKind[] = ['授業日', '曜日調整日', '授業予備日', '定期試験実施日']
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

// ---------------------------------------------------------------------------
// 年度
// ---------------------------------------------------------------------------

/** その日が属する年度（4/1 始まり） */
export function fiscalYearOf(date: string): number {
  const d = parseDate(date)
  return d.month() + 1 >= 4 ? d.year() : d.year() - 1
}

/** 年度の最終日（翌年 3/31） */
export function fiscalYearEnd(fiscalYear: number): string {
  return formatDate(fiscalYear + 1, 3, 31)
}

// ---------------------------------------------------------------------------
// 1. リンク抽出
// ---------------------------------------------------------------------------

export interface AcademicLink {
  /** 年度（西暦の文字列。state のキー） */
  fiscalYear: string
  /** decodeURIComponent した絶対 URL（state・レポート用） */
  url: string
  /** 取得に使う URL（new URL で正規化したもの。日本語のパスは percent-encode される） */
  fetchUrl: string
  /** リンク文字列 */
  text: string
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 全角数字を半角にする */
function toHalfWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

function yearsIn(value: string): Set<string> {
  return new Set([...toHalfWidthDigits(value).matchAll(/(20\d{2})\s*年度/g)].map((m) => m[1]!))
}

/**
 * 教務課ページから学年暦 PDF のリンクを抜き出す。
 *
 * - href（デコード後）かリンク文字列に「学年暦」を含み、パスが `.pdf` で終わる `<a>` だけを見る。
 *   同じページには「令和8年度入学生用(PDF)」など年度付きの別 PDF が並ぶので、「年度」だけでは拾わない。
 * - 年度は href のファイル名とリンク文字列の「20XX年度」から決める。両方にあって食い違う・どちらにも無い
 *   リンクは、取り違えを避けるため採らずに warn にする。
 * - 今日の年度の前後 1 年だけを対象にする（過去年度の版が並んでも読まない）。
 * - 同じ年度のリンクが複数あれば、どれが正か決められないので、その年度は採らずに warn にする。
 */
export function extractAcademicCalendarLinks(
  html: string,
  baseUrl: string,
  today: string,
): { links: AcademicLink[]; warnings: Warning[] } {
  const $ = cheerio.load(html)
  const warnings: Warning[] = []
  const currentFy = fiscalYearOf(today)
  const byYear = new Map<string, AcademicLink[]>()

  $('a[href]').each((_, el) => {
    const rawHref = ($(el).attr('href') ?? '').trim()
    if (rawHref === '' || rawHref.startsWith('#')) return
    let absolute: URL
    try {
      absolute = new URL(rawHref, baseUrl)
    } catch {
      return
    }
    const decodedPath = decode(absolute.pathname)
    if (!/\.pdf$/i.test(decodedPath)) return
    const text = toHalfWidthDigits($(el).text()).replace(/\s+/g, ' ').trim()
    const decodedUrl = decode(absolute.toString())
    if (!decodedUrl.includes(CONFIG.academicCalendarKeyword) && !text.includes(CONFIG.academicCalendarKeyword)) return

    const fileName = decodedPath.split('/').pop() ?? ''
    const fromFile = yearsIn(fileName)
    const fromText = yearsIn(text)
    const candidates = new Set([...fromFile, ...fromText])
    if (candidates.size !== 1) {
      warnings.push({
        level: 'warn',
        code: 'academic_link_year_unknown',
        message:
          candidates.size === 0
            ? `学年暦の PDF リンクから年度を読み取れないため取り込みません「${text}」。`
            : `学年暦の PDF リンクの年度がファイル名とリンク文字列で食い違うため取り込みません（${[...candidates].join(' / ')}）「${text}」。`,
        url: decodedUrl,
      })
      return
    }
    const fiscalYear = [...candidates][0]!
    const fy = Number(fiscalYear)
    if (fy < currentFy - 1 || fy > currentFy + 1) return

    const allowed = checkUrl(absolute.toString(), CONFIG.allowedPageHostSuffixes)
    if (!allowed.ok) {
      warnings.push({
        level: 'warn',
        code: 'academic_link_host_rejected',
        message: `学年暦の PDF リンクの宛先が許可されていないため取得しません（${allowed.reason}）。`,
        url: decodedUrl,
      })
      return
    }

    const list = byYear.get(fiscalYear) ?? []
    // 同じ URL への重複リンク（目次とボタンなど）は 1 件として数える
    if (!list.some((l) => l.url === decodedUrl)) {
      list.push({ fiscalYear, url: decodedUrl, fetchUrl: absolute.toString(), text })
    }
    byYear.set(fiscalYear, list)
  })

  const links: AcademicLink[] = []
  for (const [fiscalYear, list] of [...byYear].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length > 1) {
      warnings.push({
        level: 'warn',
        code: 'academic_link_ambiguous',
        message:
          `${fiscalYear}年度の学年暦の PDF リンクが ${list.length} 件あり、どれが正か決められないため取り込みません` +
          `（${list.map((l) => l.url).join(' / ')}）。前回取り込んだ内容は維持します。`,
      })
      continue
    }
    links.push(list[0]!)
  }
  return { links, warnings }
}

// ---------------------------------------------------------------------------
// 2. 取得と変更検知
// ---------------------------------------------------------------------------

export interface PdfDocument {
  buffer: Buffer
  sha256: string
  etag: string
  lastModified: string
}

export type PdfFetchResult =
  | { status: 'ok'; pdf: PdfDocument }
  | { status: 'not_modified'; etag: string; lastModified: string }
  | { status: 'error'; reason: string }

/** 実体が PDF か（Content-Type は申告にすぎないので、Gemini へ渡す前にバイト列を確かめる） */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.byteLength >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

/** PDF を取得する。validators を渡すと条件付き GET にする */
export async function fetchPdf(fetchUrl: string, validators?: { etag?: string; lastModified?: string }): Promise<PdfFetchResult> {
  const headers: Record<string, string> = {}
  if (validators?.etag) headers['if-none-match'] = validators.etag
  if (validators?.lastModified) headers['if-modified-since'] = validators.lastModified
  let res: Awaited<ReturnType<typeof fetchWithTimeout>>
  try {
    res = await fetchWithTimeout(fetchUrl, {
      allowedHostSuffixes: CONFIG.allowedPageHostSuffixes,
      maxBytes: CONFIG.maxPdfBytes,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    })
  } catch (e) {
    return { status: 'error', reason: `学年暦の PDF を取得できませんでした（${(e as Error).message}）` }
  }
  if (res.status === 304) return { status: 'not_modified', etag: res.etag, lastModified: res.lastModified }
  if (!res.ok) return { status: 'error', reason: `学年暦の PDF を取得できませんでした（HTTP ${res.status}）` }
  if (!looksLikePdf(res.buffer)) {
    return { status: 'error', reason: `PDF ではないデータが返りました（Content-Type: ${res.contentType || '不明'}）` }
  }
  return {
    status: 'ok',
    pdf: {
      buffer: res.buffer,
      sha256: createHash('sha256').update(res.buffer).digest('hex'),
      etag: res.etag,
      lastModified: res.lastModified,
    },
  }
}

/** 年度ごとの検知結果 */
export type AcademicDecision =
  /** 新しい版・差し替えを取得できた。読み取る */
  | { fiscalYear: string; action: 'read'; link: AcademicLink; pdf: PdfDocument; reason: string }
  /** 前回と同じ内容。検証子と確認日だけ更新する */
  | { fiscalYear: string; action: 'unchanged'; link: AcademicLink; check: StateFetchCheck; reason: string }
  /** 確かめられなかった・取り込めなかった。前回の記録を維持する */
  | {
      fiscalYear: string
      action: 'failed'
      link: AcademicLink
      reason: string
      /** 内容が変わったのに読めていない（翌日も読み直す。warn） */
      pending: boolean
      /** 差し替え後の SHA-256（分かっていれば） */
      pendingSha256?: string
    }

export type PdfFetcher = typeof fetchPdf

function daysBetween(from: string, to: string): number {
  return parseDate(to).diff(parseDate(from), 'day')
}

/**
 * state と照合して読み取り対象を決める。
 *
 * - 年度の記録が無い・URL が変わった → 取得して読む
 * - URL が同じ → 検証子があれば毎回の条件付き GET（変わっていなければ 304 だけ）。
 *   検証子が無ければ最後に確認した日から imageRevalidateIntervalDays 以上経ったときだけ取り直して SHA-256 を比べる
 * - 前回、差し替えを検出したのに読めなかった（pending_sha256）→ 内容がまだ差し替え後なら読み直す
 */
export async function detectAcademicChanges(
  links: AcademicLink[],
  state: Record<string, StateAcademicCalendar> | undefined,
  today: string,
  fetcher: PdfFetcher = fetchPdf,
): Promise<AcademicDecision[]> {
  const decisions: AcademicDecision[] = []
  for (const link of links) {
    const prev = state?.[link.fiscalYear]

    if (!prev || prev.url !== link.url) {
      const got = await fetcher(link.fetchUrl)
      const reason = prev ? `学年暦の URL が変わりました（前回: ${prev.url}）` : `${link.fiscalYear}年度の学年暦が新しく掲載されました`
      if (got.status === 'ok') {
        decisions.push({ fiscalYear: link.fiscalYear, action: 'read', link, pdf: got.pdf, reason })
      } else {
        decisions.push({
          fiscalYear: link.fiscalYear,
          action: 'failed',
          link,
          pending: true,
          reason: `${reason}が、${got.status === 'error' ? got.reason : '条件付きでない要求に 304 が返りました'}`,
        })
      }
      continue
    }

    const hasValidators = Boolean(prev.etag || prev.last_modified)
    const dueByInterval =
      !prev.checked_at || daysBetween(prev.checked_at, today) >= CONFIG.imageRevalidateIntervalDays
    if (!hasValidators && !dueByInterval && !prev.pending_sha256) {
      decisions.push({
        fiscalYear: link.fiscalYear,
        action: 'unchanged',
        link,
        check: pickCheck(prev),
        reason: `前回の確認（${prev.checked_at}）から ${CONFIG.imageRevalidateIntervalDays} 日経っていないため再取得しません`,
      })
      continue
    }

    // pending がある間は検証子を付けない（検証子は前回取り込めた版のもので、304 だと差し替え後の版を確かめられない）
    const got = await fetcher(
      link.fetchUrl,
      prev.pending_sha256
        ? undefined
        : { ...(prev.etag ? { etag: prev.etag } : {}), ...(prev.last_modified ? { lastModified: prev.last_modified } : {}) },
    )
    if (got.status === 'not_modified') {
      decisions.push({
        fiscalYear: link.fiscalYear,
        action: 'unchanged',
        link,
        check: { etag: got.etag || prev.etag || '', last_modified: got.lastModified || prev.last_modified || '', checked_at: today },
        reason: '学年暦は前回から変わっていません（304）',
      })
      continue
    }
    if (got.status === 'error') {
      decisions.push({
        fiscalYear: link.fiscalYear,
        action: 'failed',
        link,
        pending: Boolean(prev.pending_sha256),
        ...(prev.pending_sha256 ? { pendingSha256: prev.pending_sha256 } : {}),
        reason: got.reason,
      })
      continue
    }
    if (got.pdf.sha256 === prev.sha256) {
      decisions.push({
        fiscalYear: link.fiscalYear,
        action: 'unchanged',
        link,
        check: { etag: got.pdf.etag, last_modified: got.pdf.lastModified, checked_at: today },
        reason: prev.pending_sha256 ? '学年暦が前回取り込んだ内容に戻りました' : '学年暦は前回から変わっていません（SHA-256 一致）',
      })
      continue
    }
    decisions.push({
      fiscalYear: link.fiscalYear,
      action: 'read',
      link,
      pdf: got.pdf,
      reason: '学年暦の内容が差し替えられました',
    })
  }
  return decisions
}

function pickCheck(prev: StateAcademicCalendar): StateFetchCheck {
  return {
    ...(prev.etag !== undefined ? { etag: prev.etag } : {}),
    ...(prev.last_modified !== undefined ? { last_modified: prev.last_modified } : {}),
    ...(prev.checked_at !== undefined ? { checked_at: prev.checked_at } : {}),
  }
}

// ---------------------------------------------------------------------------
// 3. 読み取り結果の検証
// ---------------------------------------------------------------------------

/** Gemini が返す 1 日分（ocr.ts の zod スキーマと同じ形） */
export interface RawAcademicDay {
  month: number
  day: number
  weekday: string
  kind: string
  note: string
}

export interface RawAcademicCalendar {
  fiscal_year: number
  days: RawAcademicDay[]
}

/**
 * 読み取り結果を日付に直して検証する。1 件でも外れたら版全体を採らない（部分採用で誤った日だけ残さない）。
 *
 * - 月 4〜12 は年度の年、1〜3 は翌年
 * - 実在日であること・読み取った曜日が実際の曜日と一致すること（月の取り違えの検出）
 * - 読み取った年度がリンクの年度と一致すること
 * - 件数が academicMaxDaysPerYear 以下であること
 * 同じ日付が 2 回出てきたら（備考と色の両方から拾った等）最初の 1 件を残す。
 */
export function toAcademicDays(
  fiscalYear: number,
  raw: RawAcademicCalendar,
): { ok: true; days: AcademicDay[] } | { ok: false; reason: string } {
  if (raw.fiscal_year !== fiscalYear) {
    return { ok: false, reason: `読み取った年度（${raw.fiscal_year}）がリンクの年度（${fiscalYear}）と一致しません` }
  }
  const errors: string[] = []
  const byDate = new Map<string, AcademicDay>()
  for (const item of raw.days) {
    const year = item.month >= 4 ? fiscalYear : fiscalYear + 1
    const date = formatDate(year, item.month, item.day)
    const label = `${item.month}/${item.day}(${item.weekday})`
    if (!isRealDate(date)) {
      errors.push(`${label} は実在しない日付です`)
      continue
    }
    const actual = WEEKDAYS[dayOfWeek(date)]!
    if (item.weekday !== actual) {
      errors.push(`${label} の曜日が実際の曜日（${actual}）と一致しません`)
      continue
    }
    if (!(ACADEMIC_DAY_KINDS as readonly string[]).includes(item.kind)) {
      errors.push(`${label} の種別「${item.kind}」は想定外です`)
      continue
    }
    if (!byDate.has(date)) {
      byDate.set(date, { date, kind: item.kind as AcademicDayKind, note: item.note.replace(/\s+/g, ' ').trim() })
    }
  }
  if (errors.length > 0) {
    return { ok: false, reason: `読み取り結果の検証に失敗しました（${errors.slice(0, 3).join(' / ')}${errors.length > 3 ? ` ほか ${errors.length - 3} 件` : ''}）` }
  }
  if (byDate.size > CONFIG.academicMaxDaysPerYear) {
    return {
      ok: false,
      reason: `読み取った日が ${byDate.size} 件あり、上限（${CONFIG.academicMaxDaysPerYear} 件）を超えています。誤読を疑い取り込みません`,
    }
  }
  return { ok: true, days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) }
}

// ---------------------------------------------------------------------------
// 4. state への反映
// ---------------------------------------------------------------------------

/** 読み取りの結果（index.ts が OCR 後に作る） */
export type AcademicResult =
  | { fiscalYear: string; status: 'accepted'; link: AcademicLink; pdf: PdfDocument; days: AcademicDay[]; reason: string }
  | { fiscalYear: string; status: 'unchanged'; link: AcademicLink; check: StateFetchCheck }
  | { fiscalYear: string; status: 'failed'; link: AcademicLink; reason: string; pending: boolean; pendingSha256?: string; retry: boolean }

/** 取り込み内容が変わった年度（レポート用） */
export interface AcademicUpdate {
  fiscalYear: string
  url: string
  days: AcademicDay[]
  added: string[]
  removed: string[]
  first: boolean
}

export interface AcademicStateResult {
  calendars: Record<string, StateAcademicCalendar>
  updates: AcademicUpdate[]
  warnings: Warning[]
}

/**
 * 結果を state に反映する。
 *
 * - accepted → その年度の記録を置き換える（差分をレポートへ）
 * - unchanged → 検証子と確認日を更新する。前回の pending は消す（元の内容に戻った・既に取り込み済み）
 * - failed → 前回の記録を維持する。内容が変わったのに読めていない間は pending_sha256 を残して warn
 * - 年度末を過ぎた記録は捨てる（リンクが消えても年度末までは残す）
 * - 今日の年度の記録が無ければ warn（学年暦の未取り込み。ページ構成の変化で黙って止まるのを防ぐ）
 */
export function nextAcademicCalendars(
  prev: Record<string, StateAcademicCalendar> | undefined,
  results: AcademicResult[],
  today: string,
  runAt: string,
  pageHealthy: boolean,
): AcademicStateResult {
  const warnings: Warning[] = []
  const updates: AcademicUpdate[] = []
  const calendars: Record<string, StateAcademicCalendar> = {}

  for (const [fy, entry] of Object.entries(prev ?? {})) {
    if (isBefore(fiscalYearEnd(Number(fy)), today)) continue
    calendars[fy] = entry
  }

  for (const result of results) {
    const before = calendars[result.fiscalYear]
    if (result.status === 'accepted') {
      const prevDates = new Set((before?.days ?? []).map((d) => d.date))
      const nextDates = new Set(result.days.map((d) => d.date))
      calendars[result.fiscalYear] = {
        url: result.link.url,
        sha256: result.pdf.sha256,
        processed_at: runAt,
        days: result.days,
        ...(result.pdf.etag ? { etag: result.pdf.etag } : {}),
        ...(result.pdf.lastModified ? { last_modified: result.pdf.lastModified } : {}),
        checked_at: today,
      }
      const added = [...nextDates].filter((d) => !prevDates.has(d)).sort()
      const removed = [...prevDates].filter((d) => !nextDates.has(d)).sort()
      updates.push({ fiscalYear: result.fiscalYear, url: result.link.url, days: result.days, added, removed, first: before === undefined })
      // 人の事前確認なしに数か月先まで予約するので、取り込んだ回は必ずメールに載せる（warn）。
      // 予約した日が手動 override と同じだと public/data に差分が出ず、warn が無いとメールが届かない
      warnings.push({
        level: 'warn',
        code: 'academic_calendar_updated',
        message:
          `${result.fiscalYear}年度の学年暦を${before ? '読み直しました' : '取り込みました'}（${result.days.length} 日` +
          (before ? `、追加 ${added.length}・削除 ${removed.length}` : '') +
          '）。「学年暦から予約した授業日」の日付が学年暦 PDF と合っているか確認してください。' +
          '誤っている日は calendar_rules.json の override を削除または変更すれば、以後 Bot は再生成しません。',
        url: result.link.url,
      })
      continue
    }
    if (result.status === 'unchanged') {
      if (!before) continue
      const { pending_sha256: _pending, ...rest } = before
      calendars[result.fiscalYear] = {
        ...rest,
        ...(result.check.etag ? { etag: result.check.etag } : {}),
        ...(result.check.last_modified ? { last_modified: result.check.last_modified } : {}),
        ...(result.check.checked_at ? { checked_at: result.check.checked_at } : {}),
      }
      continue
    }
    // failed
    if (before && result.pendingSha256 && result.link.url === before.url) {
      calendars[result.fiscalYear] = { ...before, pending_sha256: result.pendingSha256 }
    }
    const stale =
      before?.checked_at !== undefined && daysBetween(before.checked_at, today) >= CONFIG.imageRecheckStaleDays
    const level: Warning['level'] = result.pending || !before || stale ? 'warn' : 'info'
    warnings.push({
      level,
      code: result.pending || !before ? 'academic_calendar_failed' : 'academic_calendar_recheck_failed',
      message:
        `${result.fiscalYear}年度の学年暦を${result.pending || !before ? '取り込めませんでした' : '再確認できませんでした'}。` +
        (before ? '前回取り込んだ内容を維持します。' : '土日・祝日の授業日はまだ予約されていません。') +
        (result.retry ? '翌日の実行で再試行します。' : '') +
        (stale ? `最後に確認できたのは ${before!.checked_at} です。` : '') +
        `理由: ${result.reason}`,
      url: result.link.url,
    })
  }

  const currentFy = String(fiscalYearOf(today))
  // 今年度のリンクを見つけたが読めなかった回は、上の academic_calendar_failed が理由つきで warn を出しているので重ねない
  const currentFyAttempted = results.some((r) => r.fiscalYear === currentFy)
  if (!calendars[currentFy] && !currentFyAttempted) {
    warnings.push({
      level: 'warn',
      code: 'academic_calendar_missing',
      message:
        `${currentFy}年度の学年暦を取り込めていません` +
        (pageHealthy ? '（教務課ページに今年度の学年暦の PDF リンクが見つかりません）' : '（教務課ページを取得できませんでした）') +
        '。土日・祝日の授業日（曜日調整日・授業予備日など）が休業日ダイヤで表示されます。' +
        `教務課ページ（${CONFIG.academicCalendarPageUrl}）を確認し、必要なら calendar_rules.json に手動で override を追加してください。`,
    })
  }

  const sorted: Record<string, StateAcademicCalendar> = {}
  for (const fy of Object.keys(calendars).sort()) sorted[fy] = calendars[fy]!
  return { calendars: sorted, updates, warnings }
}
