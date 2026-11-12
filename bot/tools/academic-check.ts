/**
 * 学年暦 PDF の読み取りチェック用の開発ツール（本番フローからは呼ばれない。FR-13【v1.19】）。
 *
 * リポジトリのファイルを一切書き換えずに、学年暦 PDF に対する Gemini の読み取り結果と、
 * toAcademicDays による検証結果だけを確認する。期待値 fixture を指定すると日付の差分を表示する。
 * Gemini の無料枠を 2〜3 回使う（2 回読み照合。不一致なら 3 回目）。
 *
 *   npm run academic:check -- 2026 fixtures/academic/expected_2026.json
 *   npm run academic:check -- 2026 fixtures/academic/expected_2026.json path/to/local.pdf
 *   npm run academic:check -- --model=gemini-3.6-flash 2026 fixtures/academic/expected_2026.json   … 検証だけ別モデルで
 *
 * 第 3 引数を省くと、教務課ページから該当年度の PDF を取得する。
 */

import { readFileSync } from 'node:fs'
import { loadLocalEnv } from '../src/env.js'
import { OcrClient } from '../src/ocr.js'
import { CONFIG } from '../src/config.js'
import { fetchPage } from '../src/fetchPage.js'
import {
  extractAcademicCalendarLinks,
  fetchPdf,
  looksLikePdf,
  toAcademicDays,
  type RawAcademicCalendar,
} from '../src/academicCalendar.js'
import { todayJst } from '../src/time.js'

async function loadPdf(fiscalYear: string, localPath: string | undefined): Promise<Buffer> {
  if (localPath) {
    const buffer = readFileSync(localPath)
    if (!looksLikePdf(buffer)) throw new Error(`PDF ではありません: ${localPath}`)
    return buffer
  }
  const html = await fetchPage(CONFIG.academicCalendarPageUrl)
  const { links, warnings } = extractAcademicCalendarLinks(html, CONFIG.academicCalendarPageUrl, todayJst())
  for (const w of warnings) console.warn(`[warn] ${w.message}`)
  const link = links.find((l) => l.fiscalYear === fiscalYear)
  if (!link) throw new Error(`${fiscalYear}年度の学年暦リンクが教務課ページに見つかりません`)
  console.log(`取得: ${link.url}`)
  const got = await fetchPdf(link.fetchUrl)
  if (got.status !== 'ok') throw new Error(got.status === 'error' ? got.reason : '304 が返りました')
  return got.pdf.buffer
}

async function main(): Promise<void> {
  loadLocalEnv()
  const args = process.argv.slice(2)
  // --model=<名前>: 検証だけ別モデルで行う（本番の CONFIG.modelPrimary は変えない）
  const modelArg = args.find((a) => a.startsWith('--model='))
  const modelOverride = modelArg ? modelArg.slice('--model='.length) : undefined
  if (modelOverride !== undefined && !/^(models\/)?[a-z0-9][a-z0-9.\-]*$/i.test(modelOverride)) {
    console.error(`モデル名の形式が正しくありません: ${modelOverride}（例: --model=gemini-3.6-flash）`)
    process.exit(1)
  }
  const [fiscalYear, expectedPath, localPath] = args.filter((a) => !a.startsWith('--'))
  if (!fiscalYear || !/^\d{4}$/.test(fiscalYear)) {
    console.error('使い方: npm run academic:check -- <年度> [期待値 fixture の JSON パス] [ローカルの PDF パス]')
    process.exit(1)
  }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY が設定されていません。')
    process.exit(1)
  }

  const buffer = await loadPdf(fiscalYear, localPath)
  const client = new OcrClient(apiKey, modelOverride)
  const outcome = await client.readAcademicCalendar(buffer)
  console.log(`モデル: ${outcome.modelUsed} / 呼び出し ${client.calls} 回 / ${outcome.attempts}回読み${outcome.majority ? '（多数決）' : ''}`)
  if (!outcome.ok || !outcome.calendar) {
    console.error(`読み取り失敗: ${outcome.reason}`)
    process.exit(2)
  }

  const checked = toAcademicDays(Number(fiscalYear), outcome.calendar)
  if (!checked.ok) {
    console.error(`検証失敗: ${checked.reason}`)
    console.error(JSON.stringify(outcome.calendar, null, 2))
    process.exit(3)
  }
  for (const day of checked.days) console.log(`  ${day.date}  ${day.kind}  ${day.note}`)

  if (expectedPath) {
    const expected = toAcademicDays(Number(fiscalYear), JSON.parse(readFileSync(expectedPath, 'utf-8')) as RawAcademicCalendar)
    if (!expected.ok) throw new Error(`期待値 fixture が不正です: ${expected.reason}`)
    const got = new Set(checked.days.map((d) => d.date))
    const want = new Set(expected.days.map((d) => d.date))
    const missing = [...want].filter((d) => !got.has(d))
    const extra = [...got].filter((d) => !want.has(d))
    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ 期待値と一致しました（${want.size} 日）`)
    } else {
      console.error(`✗ 期待値と不一致: 不足 ${missing.join(', ') || 'なし'} / 余分 ${extra.join(', ') || 'なし'}`)
      process.exit(4)
    }
  }
}

main().catch((error: unknown) => {
  console.error(`[fatal] ${(error as Error).message}`)
  process.exit(1)
})
