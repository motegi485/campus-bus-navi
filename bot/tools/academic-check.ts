/**
 * 学年暦 PDF の読み取りチェック用の開発ツール（本番フローからは呼ばれない。FR-13【v1.19】）。
 *
 * リポジトリのファイルを一切書き換えずに、学年暦 PDF に対する Gemini の読み取り結果と、
 * toAcademicDays による検証結果だけを確認する。期待値 fixture を指定すると日付の差分を表示する。
 * Gemini の無料枠を 2〜3 回使う（2 回読み照合。不一致なら 3 回目）。
 *
 *   npm run academic:check -- 2026 fixtures/academic/expected_2026.json
 *   npm run academic:check -- 2026 fixtures/academic/expected_2026.json path/to/local.pdf
 *   npm run academic:check -- --model=<モデル名> 2026 fixtures/academic/expected_2026.json     … 検証だけ別モデルで
 *   npm run academic:check -- --thinking=high 2026 fixtures/academic/expected_2026.json        … 考える深さを変えて
 *
 * 第 3 引数を省くと、教務課ページから該当年度の PDF を取得する。
 *
 * 【v1.21】期待値と照らし合わせるのは、自動で予約する日（備考欄で裏付けられた日。isRemarkGrounded）だけ。
 * セルの色だけで判断した土日・祝日は「要確認の候補」として別に一覧し、件数を出す（終了コードには含めない）。
 * 終了コード: 2 = 読み取りの失敗、3 = 検証の失敗、4 = 自動で予約する日が期待値と不一致。
 */

import { readFileSync } from 'node:fs'
import { loadLocalEnv } from '../src/env.js'
import { OcrClient } from '../src/ocr.js'
import { CONFIG, GEMINI_THINKING_LEVELS, type GeminiThinkingLevel } from '../src/config.js'
import { fetchPage } from '../src/fetchPage.js'
import {
  extractAcademicCalendarLinks,
  fetchPdf,
  isRemarkGrounded,
  looksLikePdf,
  toAcademicDays,
  type RawAcademicCalendar,
} from '../src/academicCalendar.js'
import { isOffDay } from '../src/calendar.js'
import { readHolidaysCache } from '../src/files.js'
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
  // --thinking=<low|medium|high>: 考える深さだけを変えて確かめる（本番の CONFIG.academicThinkingLevel は変えない）
  const thinkingArg = args.find((a) => a.startsWith('--thinking='))
  const thinkingValue = thinkingArg ? thinkingArg.slice('--thinking='.length).toUpperCase() : undefined
  if (thinkingValue !== undefined && !(GEMINI_THINKING_LEVELS as readonly string[]).includes(thinkingValue)) {
    console.error(`考える深さの指定が正しくありません: ${thinkingArg}（low / medium / high のいずれか）`)
    process.exit(1)
  }
  const thinkingLevel = (thinkingValue as GeminiThinkingLevel | undefined) ?? CONFIG.academicThinkingLevel
  const [fiscalYear, expectedPath, localPath] = args.filter((a) => !a.startsWith('--'))
  if (!fiscalYear || !/^\d{4}$/.test(fiscalYear)) {
    console.error('使い方: npm run academic:check -- [--model=<モデル名>] [--thinking=<low|medium|high>] <年度> [期待値 fixture の JSON パス] [ローカルの PDF パス]')
    process.exit(1)
  }
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY が設定されていません。')
    process.exit(1)
  }

  const buffer = await loadPdf(fiscalYear, localPath)
  const client = new OcrClient(apiKey, modelOverride)
  const startedAt = Date.now()
  const outcome = await client.readAcademicCalendar(buffer, { thinkingLevel })
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `モデル: ${outcome.modelUsed} / 考える深さ: ${thinkingLevel} / 呼び出し ${client.calls} 回 / ` +
      `${outcome.attempts}回読み${outcome.majority ? '（多数決）' : ''} / 所要 ${elapsedSec} 秒`,
  )
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
  const auto = checked.days.filter((d) => isRemarkGrounded(d))
  const others = checked.days.filter((d) => !isRemarkGrounded(d))
  console.log(`自動で予約する日（備考欄で裏付けあり）: ${auto.length} 日`)
  for (const day of auto) console.log(`  ${day.date}  ${day.kind}  ${day.note}`)

  // 要確認の候補: 色だけで判断した日のうち土日・祝日に当たるもの（本番で「要確認」と通知される日）
  const holidaySet = new Set((readHolidaysCache()?.holidays ?? []).map((h) => h.date))
  const candidates = others.filter((d) => isOffDay(d.date, holidaySet))
  console.log(`要確認の候補（色だけで判断した土日・祝日）: ${candidates.length} 件`)
  for (const day of candidates) console.log(`  ${day.date}  ${day.kind}  ${day.note || '-'}`)
  const weekdayOthers = others.length - candidates.length
  if (weekdayOthers > 0) console.log(`（ほかに、色だけで判断した平日 ${weekdayOthers} 件。平日は override にならない）`)

  if (expectedPath) {
    const expected = toAcademicDays(Number(fiscalYear), JSON.parse(readFileSync(expectedPath, 'utf-8')) as RawAcademicCalendar)
    if (!expected.ok) throw new Error(`期待値 fixture が不正です: ${expected.reason}`)
    const got = new Set(auto.map((d) => d.date))
    const want = new Set(expected.days.map((d) => d.date))
    const missing = [...want].filter((d) => !got.has(d))
    const extra = [...got].filter((d) => !want.has(d))
    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ 自動で予約する日が期待値と一致しました（${want.size} 日）`)
    } else {
      console.error(`✗ 自動で予約する日が期待値と不一致: 不足 ${missing.join(', ') || 'なし'} / 余分 ${extra.join(', ') || 'なし'}`)
      process.exit(4)
    }
  }
}

main().catch((error: unknown) => {
  console.error(`[fatal] ${(error as Error).message}`)
  process.exit(1)
})
