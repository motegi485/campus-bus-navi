/**
 * FR-2: リンク抽出（md-box スコープ・2条件 AND・トリップワイヤー・サイレント欠落警告）
 * FR-3: 分類と日付解析
 */

import * as cheerio from 'cheerio'
import type { AnyNode, Element, Text } from 'domhandler'
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
/**
 * 曜日の括弧。`（土）` だけでなく `（月・祝）` のような複数文字も対象にする。
 * 1 文字だけを対象にしていた頃は、10/12 の行ラベルが「（月 祝）」という残骸になっていた（2026-10-03）。
 */
export const WEEKDAY_PAREN_RE = /[（(][日月火水木金土祝・\s]+[）)]/g

/**
 * 掲示の見出し記号。2026-10 からの掲載形式では「● 行事名」が独立した行になり、
 * その後に日付だけの行が続いて、最後の行にリンクが付く。
 */
const BULLET_RE = /^[●○◆◇■□]/
/**
 * 補足行の記号。8/1 形式ではリンク行の【後ろ】に「→ 8月12日 … 最終時刻」が続く。
 * 「※」の注記行も同じ扱い（日付を含んでも適用日ではない。まとめを止め、未使用の警告にもしない）
 */
const NOTE_LINE_RE = /^[→⇒※]/
/** 見出しまで遡る行数の上限（日付行の数）。これを超える掲示はまとめない */
const MAX_GROUP_LINES = 5

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

/** 兄弟ノード 1 つを「1 行」として読む。行として扱えないノードは null */
function nodeLine($: cheerio.CheerioAPI, node: AnyNode): { text: string; hasAnchor: boolean } | null {
  if (node.type === 'text') return { text: (node as Text).data, hasAnchor: false }
  if (node.type === 'tag') {
    const el = node as Element
    return { text: $(el).text(), hasAnchor: el.name === 'a' || $(el).find('a').length > 0 }
  }
  return null
}

/** 空白だけのテキストノードとコメントは、行の区切りとして数えない（実ページの <p> 間には "\n" がある） */
function isIgnorableNode(node: AnyNode): boolean {
  if (node.type === 'comment') return true
  return node.type === 'text' && normalizeLineText((node as Text).data) === ''
}

/**
 * 複数行に分かれた掲示を 1 件にまとめる（FR-2 の 3【v1.16】）。
 *
 * 2026-10 から掲載形式が次のように変わった:
 *   <p>● 公開講座</p><p>2026年 10月 3日（土）</p><p>10月10日（土）</p><p>10月31日（土） <a>時刻表はコチラ</a></p>
 * リンクを含む <p> だけを読むと 10/31 しか取れず、10/03・10/10 の override が作られなかった。
 *
 * リンク行が見出し記号で始まらない場合だけ、直前の行を遡る。日付行は取り込んで遡り続け、
 * 見出し記号の行に着いたらそこまでを 1 件として確定する。次のどれかに当たったら【まとめない】
 * （＝リンク行だけを使う従来どおりの動作）。別の掲示の日付を取り違えるより、取りこぼして
 * possible_missed_dates で知らせる方が安全なため。
 *   - 空行 / <a> を含む行（画像リンクに限らない）/ 補足行（→・※）
 *   - 日付も見出し記号も無い行 / 日付入りの見出し記号の行 / 行数の上限超え / 兄弟の先頭
 * 8/1 形式は見出し記号がリンク行の中にあり、リンク行の前は別のリンク行か補足行なので、
 * この規則では遡りが起きない（結果は従来と同じ）。
 */
function groupWithPrecedingLines(
  $: cheerio.CheerioAPI,
  block: Element,
  ownText: string,
): { text: string; nodes: AnyNode[] } | null {
  if ($(block).hasClass('md-box')) return null // md-box 直下のアンカー。遡ると告知ボックスの外に出る
  if (BULLET_RE.test(normalizeLineText(ownText))) return null // 見出しがリンク行の中にある（従来形式）

  const lines: string[] = []
  const nodes: AnyNode[] = []
  for (let node = block.prev; node; node = node.prev) {
    if (isIgnorableNode(node)) continue
    const line = nodeLine($, node)
    if (!line || line.hasAnchor) return null
    const normalized = normalizeLineText(line.text)
    if (normalized === '' || NOTE_LINE_RE.test(normalized)) return null
    if (BULLET_RE.test(normalized)) {
      // 見出しは行事名の行。日付入りの ● 行（「● 10月20日（火）は運休します」等）は
      // 別の告知とみなし、その日付を取り込まない（運休日にイベントダイヤを張る事故の防止）
      if (dateRe().test(normalized)) return null
      lines.unshift(line.text)
      nodes.unshift(node)
      return { text: [...lines, ownText].join(' '), nodes }
    }
    if (!dateRe().test(normalized)) return null
    if (lines.length >= MAX_GROUP_LINES) return null
    lines.unshift(line.text)
    nodes.unshift(node)
  }
  return null
}

/**
 * md-box 内で日付を含むのに、どのリンクにも使われなかった行を探す（FR-2 の 6(c)【v1.16】）。
 *
 * 2026-10-03 の不具合は「掲載に日付は書いてあるのに Bot が読んでいない」状態で、警告が何も
 * 出ていなかった。まとめの規則に合わない掲示（見出しと日付の間に注記がある等）が来ても、
 * 黙って適用日を落とさないように、使われなかった日付行を警告にする。
 * 補足行（→・※）は注記なので対象外。
 *
 * 今日以降の日付を含む行だけを対象にする。過ぎた日付の告知（「● 8月13日～8月15日 運休」等）が
 * 掲示に残り続けると、毎日 warn になって「⚠ 要確認」メールが届き続けるため。
 * 同じブロックに対象アンカーが複数あるブロックは <br> ごとに見る（各リンクは自分の区間しか
 * 使わないので、リンクの無い区間の日付は取りこぼしの疑いがある）。
 */
function findUnusedDateLines(
  $: cheerio.CheerioAPI,
  usedNodes: Set<AnyNode>,
  multiAnchorBlocks: Set<AnyNode>,
  today: string,
): string[] {
  const unused: string[] = []
  const check = (text: string): void => {
    const normalized = normalizeLineText(text)
    if (normalized === '' || NOTE_LINE_RE.test(normalized)) return
    const raws = findRawDates(normalized)
    if (raws.length === 0) return
    const { dates } = resolveDates(raws, today)
    if (dates.some((d) => isRealDate(d) && !isBefore(d, today))) unused.push(normalized)
  }

  for (const box of $(CONFIG.announceBoxSelector).toArray() as Element[]) {
    if (usedNodes.has(box)) continue // md-box 直下のアンカーで、ボックス全体を lineText に使った
    for (const node of box.children as AnyNode[]) {
      if (isIgnorableNode(node) || usedNodes.has(node)) continue
      if (multiAnchorBlocks.has(node)) {
        for (const segment of ($(node as Element).html() ?? '').split(/<br\s*\/?>/i)) {
          const $seg = cheerio.load(`<div>${segment}</div>`)
          if ($seg('a').length > 0) continue
          check($seg('div').first().text())
        }
        continue
      }
      const line = nodeLine($, node)
      if (!line || line.hasAnchor) continue
      check(line.text)
    }
  }
  return unused
}

export interface ExtractResult {
  links: LinkInfo[]
  warnings: Warning[]
}

export function extractLinks(
  html: string,
  baseUrl: string = CONFIG.pageUrl,
  today: string = todayJst(),
): ExtractResult {
  const $ = cheerio.load(html)
  const warnings: Warning[] = []
  const links: LinkInfo[] = []
  const seen = new Set<string>()
  /** リンクの lineText に使った行（possible_missed_dates の判定用） */
  const usedNodes = new Set<AnyNode>()
  /** 対象アンカーが複数あり、<br> 区間ごとに lineText を取ったブロック */
  const multiAnchorBlocks = new Set<AnyNode>()

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
      const matchesInBlock = matchCountByBlock.get(block) ?? 1
      const ownLineText = lineTextForAnchor($, block, rawHref, matchesInBlock)
      // 同じブロックに対象アンカーが複数あるときは <br> 分割だけで扱い、前の行へは遡らない
      const grouped = matchesInBlock <= 1 ? groupWithPrecedingLines($, block, ownLineText) : null
      const lineText = grouped ? grouped.text : ownLineText
      if (matchesInBlock > 1) multiAnchorBlocks.add(block)
      else usedNodes.add(block)
      for (const node of grouped?.nodes ?? []) usedNodes.add(node)
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
        ...(grouped ? { ownLineText } : {}),
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

  // FR-2 の 6(c): 日付が書いてあるのに、どのリンクにも使われなかった行
  for (const line of findUnusedDateLines($, usedNodes, multiAnchorBlocks, today)) {
    warnings.push({
      level: 'warn',
      code: 'possible_missed_dates',
      message:
        `掲載ページに日付の行がありますが、どの時刻表リンクの適用日にも使われませんでした: 「${line}」。` +
        '掲載形式の変化で適用日を取りこぼしている可能性があります（その日は時刻表が切り替わりません）。',
    })
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
  s = s.replace(WEEKDAY_PAREN_RE, ' ')
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
  return links.map((l) => {
    const classified = classifyLink(l, today)
    if (l.ownLineText === undefined) return classified
    // 前の行とまとめた掲示は、リンク行だけで分類した場合の種別も残す。見出しの語（例「冬季休業を除く」）を
    // 巻き込んで種別が変わっていないかを detectChanges が確かめる（grouping_changed_kind）
    const ungrouped = classifyLink({ ...l, lineText: l.ownLineText }, today)
    return { ...classified, ungroupedKind: ungrouped.kind }
  })
}
