/**
 * 学年暦の読み取りで Gemini が 400 INVALID_ARGUMENT を返す原因の切り分け用ツール
 * （開発ツール。本番フローからは呼ばれない。リポジトリのファイルは書き換えない）。
 *
 * 条件を 1 つずつ変えて generateContent を 1 回ずつ呼び、成功か失敗かと所要時間を表示する。
 * 2 回読み照合はしない。Gemini の無料枠を条件の数だけ使う。503（高負荷）の条件だけは
 * 60 秒おいて最大 2 回取り直すので、そのぶん多く使うことがある。
 *
 *   npx tsx tools/academic-diag.ts            … 全条件（13 回）
 *   npx tsx tools/academic-diag.ts 7 8        … 指定した番号の条件だけ（503 などで判定できなかった条件の再実行用）
 *
 *   npx tsx tools/academic-diag.ts --model=<モデル名> 7 8   … 切り分けだけ別モデルで試す（本番の設定は変えない）
 *   npx tsx tools/academic-diag.ts --list-models          … この鍵で使えるモデルの一覧（生成の呼び出しはしない）
 *
 * 条件 7〜12 は PDF・画像を付けないテキストのみの条件で、スキーマが受け付けられるかを数秒で確かめる。
 *
 * GEMINI_API_KEY は academic-check.ts と同じく環境変数か bot/.env.local から読む。値は表示しない。
 */

import * as cheerio from 'cheerio'
import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  Type,
  type GenerateContentConfig,
  type Part,
  type Schema,
} from '@google/genai'
import { loadLocalEnv } from '../src/env.js'
import { CONFIG } from '../src/config.js'
import { fetchPage, fetchWithTimeout } from '../src/fetchPage.js'
import { extractAcademicCalendarLinks, looksLikePdf } from '../src/academicCalendar.js'
import { ACADEMIC_PROMPT, ACADEMIC_SCHEMA, INTERMEDIATE_SCHEMA } from '../src/ocr.js'
import { checkUrl } from '../src/url.js'
import { todayJst } from '../src/time.js'

/**
 * スキーマの指定方法。
 * - full    … 本番の ACADEMIC_SCHEMA（responseSchema）。2026-11-12 の修正で maxItems を外した後の現行版
 * - maxItems80 … 修正前のスキーマ（ACADEMIC_SCHEMA に maxItems: '80' を付け直したもの。400 の再現用）
 * - minimal … 型と required だけの responseSchema（maxItems・minimum・maximum を外す）
 * - json    … ACADEMIC_SCHEMA と同じ制約を、標準の JSON Schema として responseJsonSchema で渡す
 * - noMaxItems … ACADEMIC_SCHEMA から days の maxItems だけを外す
 * - maxItems2  … ACADEMIC_SCHEMA の days の maxItems を '2'（時刻表のスキーマと同じ値）にする
 * - timetable  … 時刻表の INTERMEDIATE_SCHEMA（対照。本番で動いていたスキーマが今も受け付けられるか）
 * - none    … スキーマを付けない
 */
type SchemaMode = 'full' | 'maxItems80' | 'minimal' | 'json' | 'noMaxItems' | 'maxItems2' | 'timetable' | 'none'

/**
 * 入力。text は PDF・画像を付けず短い文章だけを送る（メディアの処理を省いて、スキーマが受け付けられるかだけを
 * 数秒で確かめるため。混雑時に PDF・画像の条件が 503・タイムアウトに埋もれるのを避ける）
 */
type InputKind = 'pdf' | 'png' | 'text'

interface Condition {
  id: number
  label: string
  input: InputKind
  schema: SchemaMode
  mediaResolution: boolean
}

const CONDITIONS: Condition[] = [
  { id: 1, label: 'PDF・スキーマあり・HIGH（現状の再現）', input: 'pdf', schema: 'full', mediaResolution: true },
  { id: 2, label: 'PDF・スキーマあり・mediaResolution なし', input: 'pdf', schema: 'full', mediaResolution: false },
  { id: 3, label: 'PDF・スキーマなし・mediaResolution なし', input: 'pdf', schema: 'none', mediaResolution: false },
  { id: 4, label: 'PNG・スキーマあり・HIGH（時刻表と同じ画像の経路）', input: 'png', schema: 'full', mediaResolution: true },
  { id: 5, label: 'PDF・最小スキーマ（型と required のみ）・mediaResolution なし', input: 'pdf', schema: 'minimal', mediaResolution: false },
  { id: 6, label: 'PDF・responseJsonSchema（同じ制約）・mediaResolution なし', input: 'pdf', schema: 'json', mediaResolution: false },
  { id: 7, label: 'テキストのみ・本番の学年暦スキーマ', input: 'text', schema: 'full', mediaResolution: false },
  { id: 8, label: 'テキストのみ・時刻表のスキーマ（対照）', input: 'text', schema: 'timetable', mediaResolution: false },
  { id: 9, label: 'テキストのみ・学年暦スキーマから maxItems を外す', input: 'text', schema: 'noMaxItems', mediaResolution: false },
  { id: 10, label: "テキストのみ・学年暦スキーマの maxItems を '2' にする", input: 'text', schema: 'maxItems2', mediaResolution: false },
  { id: 11, label: 'テキストのみ・最小スキーマ（型と required のみ）', input: 'text', schema: 'minimal', mediaResolution: false },
  { id: 12, label: 'テキストのみ・responseJsonSchema（同じ制約）', input: 'text', schema: 'json', mediaResolution: false },
  { id: 13, label: "テキストのみ・修正前のスキーマ（maxItems: '80'。400 の再現用）", input: 'text', schema: 'maxItems80', mediaResolution: false },
]

/** テキストのみの条件で送る文章（学年暦の抜粋。スキーマの受け付けを見るのが目的で、読み取りの精度は見ない） */
const TEXT_ACADEMIC_PROMPT = `次の福山大学の学年暦の抜粋から、備考欄に「曜日調整日」または「授業予備日」と書かれた日を抽出し、指定スキーマの JSON のみを返してください。
表題: 福山大学 令和8(2026)年度 学年暦
備考: 5/2(土) 曜日調整日(水曜日の授業を実施) / 7/25(土) 授業予備日 / 11/28(土) 曜日調整日(月曜日の授業を実施)`

/** 時刻表のスキーマ（対照）で送る文章 */
const TEXT_TIMETABLE_PROMPT = `次のスクールバス時刻表を、指定スキーマの JSON のみで返してください。
種別: 授業日
松永発: 8時 05 25 45 / 9時 10
大学発: 9時 30 / 10時 00 30`

/** ACADEMIC_SCHEMA の days だけを差し替えた複製 */
function academicSchemaWithDays(patch: (days: Schema) => Schema): Schema {
  const days = ACADEMIC_SCHEMA.properties!.days!
  return { ...ACADEMIC_SCHEMA, properties: { ...ACADEMIC_SCHEMA.properties, days: patch(days) } }
}

const NO_MAX_ITEMS_SCHEMA = academicSchemaWithDays(({ maxItems: _maxItems, ...rest }) => rest)
const MAX_ITEMS_2_SCHEMA = academicSchemaWithDays((days) => ({ ...days, maxItems: '2' }))
const MAX_ITEMS_80_SCHEMA = academicSchemaWithDays((days) => ({ ...days, maxItems: '80' }))

const MINIMAL_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ['fiscal_year', 'days'],
  properties: {
    fiscal_year: { type: Type.INTEGER },
    days: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['month', 'day', 'weekday', 'kind', 'note'],
        properties: {
          month: { type: Type.INTEGER },
          day: { type: Type.INTEGER },
          weekday: { type: Type.STRING },
          kind: { type: Type.STRING },
          note: { type: Type.STRING },
        },
      },
    },
  },
}

const JSON_SCHEMA = {
  type: 'object',
  required: ['fiscal_year', 'days'],
  properties: {
    fiscal_year: { type: 'integer' },
    days: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        required: ['month', 'day', 'weekday', 'kind', 'note'],
        properties: {
          month: { type: 'integer', minimum: 1, maximum: 12 },
          day: { type: 'integer', minimum: 1, maximum: 31 },
          weekday: { type: 'string' },
          kind: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
}

function schemaConfig(mode: SchemaMode): Partial<GenerateContentConfig> {
  switch (mode) {
    case 'full':
      return { responseSchema: ACADEMIC_SCHEMA }
    case 'minimal':
      return { responseSchema: MINIMAL_SCHEMA }
    case 'json':
      return { responseJsonSchema: JSON_SCHEMA }
    case 'maxItems80':
      return { responseSchema: MAX_ITEMS_80_SCHEMA }
    case 'noMaxItems':
      return { responseSchema: NO_MAX_ITEMS_SCHEMA }
    case 'maxItems2':
      return { responseSchema: MAX_ITEMS_2_SCHEMA }
    case 'timetable':
      return { responseSchema: INTERMEDIATE_SCHEMA }
    case 'none':
      return {}
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 切り分け用の 1 リクエストの上限時間（本番の CONFIG.geminiRequestTimeoutMs は 180 秒）。
 * 400 も成功も 150 秒前後で返ることがあり、180 秒では判定前に打ち切ってしまうため長めに待つ
 */
const DIAG_REQUEST_TIMEOUT_MS = 300_000
/** 503（高負荷）のときの再試行回数と待ち時間。再試行も無料枠を使う */
const DIAG_RETRIES_503 = 2
const DIAG_RETRY_WAIT_MS = 60_000

async function download(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, { allowedHostSuffixes: CONFIG.allowedPageHostSuffixes, maxBytes: CONFIG.maxPdfBytes })
  if (!res.ok) throw new Error(`取得に失敗しました（HTTP ${res.status}）: ${url}`)
  return res.buffer
}

/** 教務課ページから、今年度の学年暦の PDF と PNG（ページに埋め込まれた画像）を取る */
async function loadInputs(): Promise<{ pdf: Buffer; png: Buffer | undefined }> {
  const today = todayJst()
  const html = await fetchPage(CONFIG.academicCalendarPageUrl)
  const { links } = extractAcademicCalendarLinks(html, CONFIG.academicCalendarPageUrl, today)
  const link = links.at(-1)
  if (!link) throw new Error('学年暦の PDF リンクが教務課ページに見つかりません')
  console.log(`PDF: ${link.url}`)
  const pdf = await download(link.fetchUrl)
  if (!looksLikePdf(pdf)) throw new Error('PDF ではないデータが返りました')

  const $ = cheerio.load(html)
  let pngUrl: string | undefined
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const absolute = new URL(src, CONFIG.academicCalendarPageUrl).toString()
    let decoded = absolute
    try {
      decoded = decodeURIComponent(absolute)
    } catch {
      // そのまま使う
    }
    if (!pngUrl && decoded.includes(CONFIG.academicCalendarKeyword) && decoded.includes(link.fiscalYear) && /\.png$/i.test(decoded)) {
      if (checkUrl(absolute, CONFIG.allowedPageHostSuffixes).ok) pngUrl = absolute
    }
  })
  if (!pngUrl) {
    console.warn('[warn] 学年暦の PNG が教務課ページに見つかりません。条件 4 は飛ばします')
    return { pdf, png: undefined }
  }
  console.log(`PNG: ${decodeURIComponent(pngUrl)}`)
  return { pdf, png: await download(pngUrl) }
}

async function main(): Promise<void> {
  loadLocalEnv()
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY が設定されていません。')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const ai = new GoogleGenAI({ apiKey })

  // --list-models: この鍵で generateContent に使えるモデルの一覧だけを表示する（生成の呼び出しはしない）
  if (args.includes('--list-models')) {
    const pager = await ai.models.list()
    for await (const m of pager) {
      if (m.supportedActions?.includes('generateContent')) console.log(`${m.name}  ${m.displayName ?? ''}`)
    }
    return
  }

  // --model=<名前>: 切り分けだけで使うモデル（本番の CONFIG.modelPrimary は変えない）
  const modelArg = args.find((a) => a.startsWith('--model='))
  const model = modelArg ? modelArg.slice('--model='.length) : CONFIG.modelPrimary
  if (!/^(models\/)?[a-z0-9][a-z0-9.\-]*$/i.test(model)) {
    console.error(`モデル名の形式が正しくありません: ${model}（例: --model=gemini-3.8-flash。--list-models で一覧を表示できます）`)
    process.exit(1)
  }
  const selected = args.filter((a) => !a.startsWith('--')).map(Number)
  const targets = selected.length > 0 ? CONDITIONS.filter((c) => selected.includes(c.id)) : CONDITIONS

  // テキストのみの条件だけなら、PDF・PNG は取得しない
  const inputs = targets.some((c) => c.input !== 'text') ? await loadInputs() : { pdf: undefined, png: undefined }
  console.log(
    `モデル: ${model}${model === CONFIG.modelPrimary ? '（本番と同じ）' : '（切り分け用。本番は ' + CONFIG.modelPrimary + '）'}` +
      ` / 条件 ${targets.map((c) => c.id).join(', ')}（各 1 回。503 のときだけ最大 ${DIAG_RETRIES_503} 回再試行）\n`,
  )

  let first = true
  for (const c of targets) {
    let parts: Part[]
    if (c.input === 'text') {
      parts = [{ text: c.schema === 'timetable' ? TEXT_TIMETABLE_PROMPT : TEXT_ACADEMIC_PROMPT }]
    } else {
      const buffer = c.input === 'pdf' ? inputs.pdf : inputs.png
      if (!buffer) {
        console.log(`[${c.id}] ${c.label}: 入力が無いため飛ばしました\n`)
        continue
      }
      parts = [
        { inlineData: { mimeType: c.input === 'pdf' ? 'application/pdf' : 'image/png', data: buffer.toString('base64') } },
        { text: ACADEMIC_PROMPT },
      ]
    }
    if (!first) await sleep(CONFIG.geminiMinIntervalMs)
    first = false

    const baseConfig: GenerateContentConfig = {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      ...schemaConfig(c.schema),
      ...(c.mediaResolution ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH } : {}),
    }
    for (let attempt = 1; ; attempt++) {
      // AbortSignal.timeout は生成時から数えるので、試行ごとに作り直す
      const config: GenerateContentConfig = { ...baseConfig, abortSignal: AbortSignal.timeout(DIAG_REQUEST_TIMEOUT_MS) }
      const tag = `[${c.id}${attempt > 1 ? `・${attempt}回目` : ''}] ${c.label}`
      const started = Date.now()
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config,
        })
        const seconds = ((Date.now() - started) / 1000).toFixed(1)
        const text = res.text ?? ''
        // 指定したモデル名と、応答が申告する実際の版（modelVersion）が違えば、別モデルへ振り替えられている
        console.log(`${tag}: 成功（${seconds} 秒・modelVersion: ${res.modelVersion ?? '不明'}）`)
        console.log(`    応答の先頭: ${text.replace(/\s+/g, ' ').slice(0, 200)}\n`)
        break
      } catch (e) {
        const seconds = ((Date.now() - started) / 1000).toFixed(1)
        const err = e as Error & { status?: number }
        console.log(`${tag}: 失敗（${seconds} 秒）`)
        console.log(`    ${err.name}${err.status ? ` status=${err.status}` : ''}: ${err.message}\n`)
        // 503（高負荷）だけは判定に使えないので、間をおいて取り直す。400・タイムアウトは取り直さない
        if (err.status === 503 && attempt <= DIAG_RETRIES_503) {
          console.log(`    503 のため ${DIAG_RETRY_WAIT_MS / 1000} 秒待って再試行します\n`)
          await sleep(DIAG_RETRY_WAIT_MS)
          continue
        }
        break
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(`[fatal] ${(error as Error).message}`)
  process.exit(1)
})
