/**
 * オーケストレータ（要件定義 §6 の手順）。
 *
 *   1. fetchPage → 2. extractLinks → 3. classify → 4. fetchHolidays → 5. detectChanges
 *   → 6. fetchImage → 7. ocr → 8. assemble → 9. validate → 10. writeFiles
 *   → 11. updateCalendar → 12. cleanup → 13. writeState → 14. prBody
 *
 * 8〜13 の純粋部分は plan.ts（buildPlan）に切り出してある。
 * DRY_RUN=1 のときはファイル書込・state 更新・PR 用ファイル生成を行わず、変更計画を JSON で出力する。
 */

import { appendFileSync } from 'node:fs'
import { loadLocalEnv } from './env.js'
import { CONFIG } from './config.js'
import { fetchPage } from './fetchPage.js'
import { extractLinks, classifyLinks } from './extractLinks.js'
import { fetchHolidays } from './holidays.js'
import { detectChanges } from './detectChanges.js'
import { OcrClient } from './ocr.js'
import { buildPlan } from './plan.js'
import { buildPrBody, formatWarning } from './prBody.js'
import {
  readState,
  writeState,
  readCalendarRules,
  writeCalendarRules,
  writeTimetableFile,
  deleteTimetableFile,
  writeHolidaysCache,
  writeTextFile,
} from './files.js'
import { nowIsoJst, todayJst } from './time.js'
import type { Intermediate, State, Warning } from './types.js'

loadLocalEnv()

const isDryRun = process.env.DRY_RUN === '1'
const today = todayJst()

function log(step: string, message: string, detail?: unknown): void {
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`
  console.log(`[${step}] ${message}${suffix}`)
}

function summary(lines: string[]): void {
  const target = process.env.GITHUB_STEP_SUMMARY
  if (!target) return
  try {
    appendFileSync(target, lines.join('\n') + '\n', 'utf-8')
  } catch (e) {
    console.warn(`[summary] GITHUB_STEP_SUMMARY への書き込みに失敗しました: ${(e as Error).message}`)
  }
}

async function main(): Promise<void> {
  const runAt = nowIsoJst()
  const warnings: Warning[] = []
  log('start', `campus-bus-navi-bot 開始（today=${today} / DRY_RUN=${isDryRun ? '1' : '0'}）`)

  // ---- 1. ページ取得 ---------------------------------------------------
  const state: State = readState()
  const html = await fetchPage()
  log('fetchPage', `ページを取得しました（${html.length} bytes）`)

  // ---- 2〜3. 抽出と分類 ------------------------------------------------
  const extracted = extractLinks(html)
  warnings.push(...extracted.warnings)
  const classified = classifyLinks(extracted.links, today)
  log(
    'extractLinks',
    `時刻表リンク ${classified.length} 件`,
    classified.map((c) => ({ kind: c.kind, line: c.normalizedLine, url: c.url })),
  )

  // ---- 4. 祝日 ---------------------------------------------------------
  const holidaysResult = await fetchHolidays()
  warnings.push(...holidaysResult.warnings)
  log(
    'fetchHolidays',
    `祝日 ${holidaysResult.holidays.length} 件（キャッシュ更新: ${holidaysResult.cacheToWrite ? 'あり' : 'なし'}）`,
  )

  // ---- 5〜6. 変更検知（必要なら画像 DL） --------------------------------
  const detected = await detectChanges(classified, state, today)
  warnings.push(...detected.warnings)
  log(
    'detectChanges',
    '変更検知の結果',
    detected.decisions.map((d) => ({ key: d.key, action: d.action, reason: d.reason })),
  )

  // ---- 7. OCR ----------------------------------------------------------
  // SKIP_OCR=1 は「OCR を通さずに計画だけ見たい」ローカル検証用の逃げ道。
  // Gemini の無料枠は RPD（1日あたりリクエスト数）が 20 程度しかないため、
  // 抽出・分類・カレンダーだけ確認したいときに枠を消費しないようにする。
  const skipOcr = process.env.SKIP_OCR === '1'
  const apiKey = skipOcr ? undefined : process.env.GEMINI_API_KEY
  const ocrTargets = detected.decisions.filter((d) => d.action === 'ocr')
  const intermediates = new Map<string, Intermediate>()
  const ocrFailures = new Map<string, string>()
  const ocrStats = { matched: 0, total: 0, majority: 0 }
  let ocrClient: OcrClient | null = null

  if (ocrTargets.length > 0) {
    if (!apiKey) {
      if (isDryRun || skipOcr) {
        const cause = skipOcr ? 'SKIP_OCR=1 が指定された' : 'GEMINI_API_KEY が未設定の'
        warnings.push({
          level: 'info',
          code: 'ocr_skipped',
          message: `${cause}ため OCR をスキップしました（対象 ${ocrTargets.length} 件）。`,
        })
        log('ocr', `${cause}ため OCR をスキップします（対象 ${ocrTargets.length} 件）`)
      } else {
        // AC-5: 鍵が無く OCR 対象がある場合は明確に失敗させる（不正なファイルは書かない）
        throw new Error(
          `OCR 対象が ${ocrTargets.length} 件ありますが GEMINI_API_KEY が設定されていません。ファイルは一切変更していません。`,
        )
      }
    } else {
      ocrClient = new OcrClient(apiKey)
    }
  }

  if (ocrClient) {
    for (const decision of ocrTargets) {
      if (!decision.image) continue
      if (ocrClient.budgetExhausted) {
        // 無料枠を使い切った残りは「読めなかった」として顕在化させる（古いデータは触らない）
        ocrFailures.set(
          decision.key,
          `Gemini の呼び出し上限（${CONFIG.geminiMaxCallsPerRun}回/実行）に達したため読み取りをスキップしました。翌日の実行で再試行されます（元画像: ${decision.imageUrl}）`,
        )
        log('ocr', `${decision.key}: 呼び出し上限に達したためスキップします`)
        continue
      }
      ocrStats.total += 1
      log('ocr', `${decision.key}: ${decision.imageUrl} を読み取ります`)
      const outcome = await ocrClient.read(decision.image.buffer, decision.image.mimeType)
      if (!outcome.ok || !outcome.intermediate) {
        ocrFailures.set(decision.key, `${outcome.reason ?? 'OCR に失敗しました'}（元画像: ${decision.imageUrl}）`)
        log('ocr', `${decision.key}: 失敗 — ${outcome.reason}`)
        continue
      }
      if (outcome.majority) ocrStats.majority += 1
      else ocrStats.matched += 1
      intermediates.set(decision.key, outcome.intermediate)
      log('ocr', `${decision.key}: 成功（${outcome.attempts}回読み${outcome.majority ? '・多数決採用' : '・一致'}）`)
    }
    log('ocr', `Gemini 呼び出し回数: ${ocrClient.calls} / 上限 ${CONFIG.geminiMaxCallsPerRun}`)
  }

  // ---- 8〜13(計算). 組み立て・検証・state・カレンダー -------------------
  const rules = readCalendarRules()
  const planned = buildPlan({
    decisions: detected.decisions,
    intermediates,
    ocrFailures,
    needsReviewLinks: classified.filter((c) => c.kind === 'needs_review'),
    state,
    liveOverrides: rules.overrides,
    holidays: holidaysResult.holidays,
    today,
    runAt,
  })
  warnings.push(...planned.warnings)
  if (holidaysResult.source) planned.nextState.holidays_source = holidaysResult.source

  log('calendar', `overrides ${Object.keys(planned.calendar.nextOverrides).length} 件`, {
    changes: planned.calendar.changes.length,
    deletions: planned.calendar.deletions,
  })

  const summaryData = {
    today,
    dryRun: isDryRun,
    links: classified.map((c) => ({ kind: c.kind, line: c.normalizedLine, url: c.url, reason: c.reason })),
    decisions: detected.decisions.map((d) => ({ key: d.key, action: d.action, reason: d.reason })),
    files: planned.filePlans.map((f) => ({ op: f.op, fileName: f.fileName, kind: f.kind, counts: f.counts })),
    overrideChanges: planned.calendar.changes,
    deletions: planned.calendar.deletions,
    warnings,
    validationFailures: planned.validationFailures,
  }

  // ---- FR-12: ドライランはここで計画を出力して終了 ----------------------
  if (isDryRun) {
    console.log('\n===== DRY RUN 変更計画 =====')
    console.log(JSON.stringify(summaryData, null, 2))
    console.log('===== ファイルは一切変更していません =====')
    summary(buildSummaryLines(summaryData))
    return
  }

  // ---- 10 / 12. ファイル書き込みと削除 ----------------------------------
  for (const filePlan of planned.filePlans) {
    if (filePlan.op === 'delete') {
      deleteTimetableFile(filePlan.fileName)
      log('writeFiles', `削除: ${filePlan.fileName}`)
      continue
    }
    writeTimetableFile(filePlan.fileName, filePlan.timetable!)
    log('writeFiles', `${filePlan.op === 'create' ? '新規' : '更新'}: ${filePlan.fileName}`)
  }

  // ---- 11. calendar_rules.json -----------------------------------------
  rules.overrides = planned.calendar.nextOverrides
  writeCalendarRules(rules)

  // ---- 13. state / holidays --------------------------------------------
  writeState(planned.nextState)
  if (holidaysResult.cacheToWrite) writeHolidaysCache(holidaysResult.cacheToWrite)

  // ---- 14. PR 本文 -------------------------------------------------------
  const body = buildPrBody({
    runAt,
    modelUsed: ocrClient?.modelUsed ?? CONFIG.modelPrimary,
    fallbackUsed: ocrClient?.usedFallback ?? false,
    files: planned.filePlans,
    overrideChanges: planned.calendar.changes,
    deletions: planned.calendar.deletions,
    warnings,
    ocrStats,
    validationFailures: planned.validationFailures,
  })
  writeTextFile(CONFIG.prBodyPath, body)
  log('prBody', `${CONFIG.prBodyPath} を生成しました`)
  summary(buildSummaryLines(summaryData))
}

function buildSummaryLines(data: {
  today: string
  dryRun: boolean
  files: { op: string; fileName: string }[]
  overrideChanges: unknown[]
  deletions: string[]
  warnings: Warning[]
  validationFailures: string[]
}): string[] {
  const lines = [
    `## timetable-sync (${data.today})${data.dryRun ? ' — DRY RUN' : ''}`,
    '',
    `- 時刻表ファイル: ${data.files.length} 件`,
    `- overrides 差分: ${data.overrideChanges.length} 件`,
    `- 削除: ${data.deletions.length} 件`,
    `- 要手動確認: ${data.validationFailures.length} 件`,
    `- 警告: ${data.warnings.filter((w) => w.level === 'warn').length} 件`,
  ]
  const warns = data.warnings.filter((w) => w.level === 'warn')
  if (warns.length > 0) {
    lines.push('', '### ⚠ 警告')
    for (const warning of warns) lines.push(`- ${formatWarning(warning)}`)
  }
  return lines
}

main().catch((error: unknown) => {
  console.error(`[fatal] ${(error as Error).message}`)
  console.error((error as Error).stack)
  process.exit(1)
})
