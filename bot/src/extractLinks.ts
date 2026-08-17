/**
 * FR-2: リンク抽出（md-box スコープ・2条件 AND・トリップワイヤー・サイレント欠落警告）
 * FR-3: 分類と日付解析
 */

import * as cheerio from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import { CONFIG } from './config.js'
import type { ClassifiedLink, LinkInfo, LinkKind, Season, Warning } from './types.js'
import { formatDate, isAfter, isBefore, isRealDate, parseDate, todayJst } from './time.js'
import { checkUrl } from './url.js'

const BLOCK_TAGS = new Set(['p', 'li', 'td', 'th', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/**
 * 年（任意）＋月日。年月日の間の空白を許容（2026-07 ライブの「2026年 7月  5日」形式に対応）。
 * lastIndex の共有事故を避けるため、使うたびに新しいインスタンスを作る。
 */
const dateRe = (): RegExp => /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/g
/** 波ダッシュ: U+FF5E（実測）/ U+301C / ASCII チルダ */
const TILDE_RE = /[～〜~]/

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

/** 全角数字→半角、全角空白・NBSP→半角空白、連続空白を1つに圧縮 */
export function normalizeLineText(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

function absolutize(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

/**
 * 画像リンクかどうかを、URL の **パス部分**の拡張子で判定する。
 *
 * URL 全体の末尾へ拡張子パターンを当てると、`timetable.jpg?v=2` や `timetable.png#x`
 * が画像として扱われない。CMS がキャッシュバスターやアンカーを付けただけで、
 * その系列を無警告で取りこぼす（`possible_missed_link` にも入らない）。
 *
 * パースできない href はパターンを文字列にそのまま当てる従来動作へ落とす
 * （相対 href や壊れたマークアップでも判定を諦めない）。
 */
function hasImageExtension(href: string, baseUrl: string): boolean {
  const decoded = decodeHref(href)
  try {
    // decode してから解釈する。全角空白などを含むファイル名があるため
    const pathname = decodeHref(new URL(href, baseUrl).pathname)
    return CONFIG.imageExtPattern.test(pathname)
  } catch {
    return CONFIG.imageExtPattern.test(decoded)
  }
}

// ---------------------------------------------------------------------------
// FR-2: 抽出
// ---------------------------------------------------------------------------

function nearestBlock($: cheerio.CheerioAPI, el: Element): Element {
  let cur: AnyNode | null = el.parent as AnyNode | null
  while (cur && cur.type === 'tag') {
    const tag = cur as Element
    if ($(tag).hasClass('md-box')) return tag // md-box まで来たら打ち切り（degenerate fallback）
    if (BLOCK_TAGS.has(tag.name)) return tag
    cur = tag.parent as AnyNode | null
  }
  return el
}

/**
 * 同一ブロック内に対象アンカーが複数ある場合、<br> でテキストを分割し
 * 当該アンカーを含むセグメントを lineText とする（将来のマークアップ変化への防御）。
 */
function lineTextForAnchor($: cheerio.CheerioAPI, block: Element, rawHref: string, matchesInBlock: number): string {
  const fullText = $(block).text()
  if (matchesInBlock <= 1) return fullText

  const inner = $(block).html() ?? ''
  const segments = inner.split(/<br\s*\/?>/i)
  if (segments.length <= 1) return fullText

  for (const seg of segments) {
    const $seg = cheerio.load(`<div>${seg}</div>`)
    const hit = $seg('a[href]').filter((_, a) => ($seg(a).attr('href') ?? '') === rawHref)
    if (hit.length > 0) return $seg('div').first().text()
  }
  return fullText
}

export interface ExtractResult {
  links: LinkInfo[]
  warnings: Warning[]
}

export function extractLinks(html: string, baseUrl: string = CONFIG.pageUrl): ExtractResult {
  const $ = cheerio.load(html)
  const warnings: Warning[] = []
  const links: LinkInfo[] = []
  const seen = new Set<string>()

  const anchors = $(`${CONFIG.announceBoxSelector} a[href]`).toArray() as Element[]

  // ブロックごとの「条件を満たすアンカー数」を先に数える（<br> 分割の要否判定に使う）
  const matchCountByBlock = new Map<Element, number>()
  const isTarget = (a: Element): boolean => {
    const rawHref = $(a).attr('href') ?? ''
    const hasImageExt = hasImageExtension(rawHref, baseUrl)
    const hasKeyword = $(a).text().includes(CONFIG.anchorKeyword)
    return hasImageExt && hasKeyword
  }
  for (const a of anchors) {
    if (!isTarget(a)) continue
    const block = nearestBlock($, a)
    matchCountByBlock.set(block, (matchCountByBlock.get(block) ?? 0) + 1)
  }

  for (const a of anchors) {
    const rawHref = $(a).attr('href') ?? ''
    if (!rawHref) continue
    const decoded = decodeHref(rawHref)
    const anchorText = $(a).text()
    const hasImageExt = hasImageExtension(rawHref, baseUrl)
    const hasKeyword = anchorText.includes(CONFIG.anchorKeyword)

    if (hasImageExt && hasKeyword) {
      const block = nearestBlock($, a)
      const lineText = lineTextForAnchor($, block, rawHref, matchCountByBlock.get(block) ?? 1)
      // 正規化 URL は「絶対化 → デコード」。state との突合・重複排除・ログ表示に使う。
      // 実際のフェッチは % エンコードのままの rawHref を使う（全角空白を含むファイル名があるため）。
      const absolute = absolutize(rawHref, baseUrl)
      const url = decodeHref(absolute)
      if (seen.has(url)) continue
      seen.add(url)
      // 掲載ページの改ざん・誤リンクで許可外のホストへ取得に行かないよう、候補の時点で弾く
      const allowed = checkUrl(absolute, CONFIG.allowedImageHostSuffixes)
      if (!allowed.ok) {
        warnings.push({
          level: 'warn',
          code: 'link_host_not_allowed',
          message: `時刻表リンクの取得先が許可されていないため取り込みません（${allowed.reason}）。`,
          url,
        })
        continue
      }
      links.push({
        url,
        rawHref: absolute,
        anchorText: normalizeLineText(anchorText),
        lineText,
      })
      continue
    }

    // FR-2 の 6(a): 画像リンクだが『時刻表』文言が無く、行に日付がある → 取りこぼしの疑い
    if (hasImageExt && !hasKeyword) {
      const block = nearestBlock($, a)
      const line = normalizeLineText($(block).text())
      if (dateRe().test(line)) {
        warnings.push({
          level: 'warn',
          code: 'possible_missed_link',
          message: `『${CONFIG.anchorKeyword}』を含まない画像リンクの行に日付があります。リンク文言の変更で取りこぼしている可能性があります: 「${line}」`,
          url: absolutize(decoded, baseUrl),
        })
      }
    }
  }

  // FR-2 の 5: トリップワイヤー
  if (links.length === 0) {
    throw new Error(
      'ページ取得は成功しましたが時刻表リンクが1件も抽出できませんでした。ページ構造変更の可能性があります。セレクタ（' +
        `${CONFIG.announceBoxSelector}）と抽出条件を確認してください。`,
    )
  }

  return { links, warnings }
}

// ---------------------------------------------------------------------------
// FR-3: 日付解析
// ---------------------------------------------------------------------------

interface RawDate {
  year?: number
  month: number
  day: number
}

export function findRawDates(normalized: string): RawDate[] {
  const out: RawDate[] = []
  const re = dateRe()
  let m: RegExpExecArray | null
  while ((m = re.exec(normalized)) !== null) {
    out.push({
      year: m[1] ? Number(m[1]) : undefined,
      month: Number(m[2]),
      day: Number(m[3]),
    })
  }
  return out
}

/**
 * 年の補完（FR-3 補助規則）。
 * - 先頭の日付: 年が無ければ現在 JST 年を補い、today-180日 より過去なら +1 年 →【年推定】フラグ
 * - 2つ目以降 : 年が無ければ先頭と同年。それでも先頭より前なら +1 年
 *               （これは規則で一意に決まるので推定フラグは立てない）
 */
export function resolveDates(raws: RawDate[], today: string = todayJst()): { dates: string[]; yearGuessed: boolean } {
  const dates: string[] = []
  let yearGuessed = false
  const threshold = parseDate(today).subtract(180, 'day')

  raws.forEach((raw, i) => {
    if (raw.year !== undefined) {
      dates.push(formatDate(raw.year, raw.month, raw.day))
      return
    }
    if (i === 0 || dates.length === 0) {
      yearGuessed = true
      let year = parseDate(today).year()
      let candidate = formatDate(year, raw.month, raw.day)
      if (parseDate(candidate).isBefore(threshold, 'day')) {
        year += 1
        candidate = formatDate(year, raw.month, raw.day)
      }
      dates.push(candidate)
      return
    }
    const base = dates[0]!
    let year = parseDate(base).year()
    let candidate = formatDate(year, raw.month, raw.day)
    if (isBefore(candidate, base)) {
      year += 1
      candidate = formatDate(year, raw.month, raw.day)
    }
    dates.push(candidate)
  })

  return { dates, yearGuessed }
}

// ---------------------------------------------------------------------------
// FR-3: 分類
// ---------------------------------------------------------------------------

function matchVacation(normalized: string): { matched: string } | null {
  for (const re of CONFIG.vacationPatterns) {
    const m = normalized.match(re)
    if (m) return { matched: m[0] }
  }
  return null
}

function detectSeason(matched: string, normalized: string): Season | undefined {
  for (const source of [matched, normalized]) {
    for (const [kanji, season] of Object.entries(CONFIG.seasonMap)) {
      if (source.includes(kanji)) return season
    }
  }
  return undefined
}

/** イベント行の見出しラベルを取り出す（PR 表示・OCR ラベル欠損時のフォールバック） */
export function extractEventLabel(normalized: string, anchorText: string): string {
  let s = normalized.replace(dateRe(), ' ')
  s = s.replace(/[（(][日月火水木金土][）)]/g, ' ')
  if (anchorText) s = s.split(anchorText).join(' ')
  s = s.replace(/時刻表はコチラ/g, ' ')
  s = s.replace(/[●○◆■□▲△▼▽・→⇒※【】[\]「」『』｜|／/＝=～〜~,、。:：]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

export function classifyLink(link: LinkInfo, today: string = todayJst()): ClassifiedLink {
  const normalizedLine = normalizeLineText(link.lineText)
  const base = { ...link, normalizedLine }
  const raws = findRawDates(normalizedLine)
  const hasTilde = TILDE_RE.test(normalizedLine)
  const vac = matchVacation(normalizedLine)

  /**
   * needs_review でも【期間の両端が読めているときは start/end を残す】。
   * plan.ts がこれを見て、その期間を特別ダイヤ（timetable_special）で塗り潰す。
   * 読めない掲示の期間に通常ダイヤの時刻を出し続けないためのフェイルセーフ。
   */
  const reviewed = (reason: string, range?: { start?: string; end?: string }): ClassifiedLink => ({
    ...base,
    kind: 'needs_review' as LinkKind,
    reason,
    ...(range?.start ? { start: range.start } : {}),
    ...(range?.end ? { end: range.end } : {}),
  })

  /**
   * 日付そのものが破綻している掲示は、期間を残さず needs_review にする。
   *
   * `parseDate` は strict ではないので `2月30日` は `3月2日` へ黙って正規化される。
   * そのまま通すと「読めたつもりで別の日に override を張る」ことになるため、ここで止める。
   * 期間（start/end）も残さない ＝ 特別ダイヤの塗り潰しもしない。日付が読めていない以上、
   * どの期間に適用すべきかを決められないためである。
   */
  if (raws.length > 0) {
    const resolvedAll = resolveDates(raws, today)
    const invalid = resolvedAll.dates.filter((d) => !isRealDate(d))
    if (invalid.length > 0) {
      return reviewed(`実在しない日付が含まれるため取り込みません（${invalid.join(', ')}）: 「${normalizedLine}」`)
    }
    if (hasTilde && resolvedAll.dates.length >= 2 && isAfter(resolvedAll.dates[0]!, resolvedAll.dates[1]!)) {
      return reviewed(
        `期間の開始日が終了日より後になっています（${resolvedAll.dates[0]}〜${resolvedAll.dates[1]}）。` +
          `日付の誤読の可能性があるため取り込みません: 「${normalizedLine}」`,
      )
    }
  }

  // 優先1: 長期休暇
  if (vac) {
    if (raws.length === 0) {
      return reviewed(`長期休暇の告知と判定しましたが日付が読み取れません: 「${normalizedLine}」`)
    }
    const season = detectSeason(vac.matched, normalizedLine)
    if (!season) {
      const { dates } = resolveDates(raws.slice(0, 2), today)
      return reviewed(`長期休暇の告知ですが季節（春/夏/冬）が特定できません: 「${normalizedLine}」`, {
        start: dates[0],
        end: dates[1],
      })
    }
    const { dates, yearGuessed } = resolveDates(raws.slice(0, 2), today)
    return {
      ...base,
      kind: 'vacation',
      season,
      start: dates[0],
      end: dates[1],
      yearGuessed,
    }
  }

  // 優先2: イベント（日付が1つ以上あり `～` を含まない）
  if (raws.length >= 1 && !hasTilde) {
    const { dates, yearGuessed } = resolveDates(raws, today)
    return {
      ...base,
      kind: 'event',
      dates,
      label: extractEventLabel(normalizedLine, link.anchorText),
      yearGuessed,
    }
  }

  // 優先3: 通常ダイヤ（日付がちょうど1つ ＋ `～` あり）
  if (raws.length === 1 && hasTilde) {
    const { dates, yearGuessed } = resolveDates(raws, today)
    return { ...base, kind: 'regular', start: dates[0], yearGuessed }
  }

  // 日付が2つ以上 ＋ `～` あり だが休暇語彙に不一致 → 通常ダイヤを期間ダイヤで上書きする事故を防ぐ
  if (raws.length >= 2 && hasTilde) {
    const { dates } = resolveDates(raws.slice(0, 2), today)
    return reviewed(
      '期間指定（日付2つ＋波ダッシュ）ですが長期休暇の語彙に一致しません。' +
        `通常ダイヤの誤上書きを避けるため取り込みません: 「${normalizedLine}」`,
      { start: dates[0], end: dates[1] },
    )
  }

  return reviewed(`分類不能の時刻表リンクです: 「${normalizedLine}」`)
}

export function classifyLinks(links: LinkInfo[], today: string = todayJst()): ClassifiedLink[] {
  return links.map((l) => classifyLink(l, today))
}
