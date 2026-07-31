/**
 * OCR 単体チェック用の開発ツール（本番フローからは呼ばれない）。
 *
 * リポジトリのファイルを一切書き換えずに、1枚の画像に対する Gemini の読み取り結果だけを確認する。
 * 正解 fixture を指定すると差分を表示するので、プロンプト調整や JR 列混入の有無を安全に検証できる。
 *
 *   npm run ocr:check -- fixtures/images/R8スクールバス時刻表.jpg fixtures/intermediate/regular.json
 *   npm run ocr:check -- https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0817-.jpg
 */

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from '../src/env.js'
import { OcrClient, normalizeIntermediate } from '../src/ocr.js'
import { fetchImage } from '../src/fetchImage.js'
import type { Intermediate } from '../src/types.js'

function mimeFor(file: string): string {
  return /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'
}

/** 中間構造を「時: 分, 分, …」の見やすい形にする */
function render(intermediate: Intermediate): string {
  const lines: string[] = []
  for (const dayType of intermediate.day_types) {
    lines.push(`■ ${dayType.label || '(ラベルなし)'}`)
    for (const [name, rows] of [
      ['松永発', dayType.matsunaga],
      ['大学発', dayType.university],
    ] as const) {
      lines.push(`  ${name}:`)
      for (const row of rows) {
        lines.push(`    ${String(row.hour).padStart(2, ' ')}時  ${row.minutes.map((m) => String(m).padStart(2, '0')).join(' ') || '—'}`)
      }
    }
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  loadLocalEnv()
  const [target, expectedPath] = process.argv.slice(2)
  if (!target) {
    console.error('使い方: npm run ocr:check -- <画像パス or URL> [正解 fixture の JSON パス]')
    process.exit(1)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY が設定されていません。')
    process.exit(1)
  }

  let buffer: Buffer
  let mimeType: string
  if (/^https?:\/\//.test(target)) {
    const result = await fetchImage(target)
    if (!result.ok) {
      console.error(`画像を取得できませんでした: ${result.reason}`)
      process.exit(1)
    }
    buffer = result.buffer
    mimeType = result.mimeType
    console.log(`取得: ${result.url}（${buffer.byteLength} bytes）`)
  } else {
    const abs = path.resolve(target)
    if (!existsSync(abs)) {
      console.error(`ファイルが見つかりません: ${abs}`)
      process.exit(1)
    }
    buffer = readFileSync(abs)
    mimeType = mimeFor(abs)
    console.log(`読み込み: ${abs}（${buffer.byteLength} bytes）`)
  }

  const client = new OcrClient(apiKey, process.env.OCR_MODEL)
  const outcome = await client.read(buffer, mimeType)

  console.log(`\nモデル: ${client.modelUsed}${client.usedFallback ? '（フォールバック）' : ''}`)
  console.log(`読み取り回数: ${outcome.attempts}${outcome.majority ? '（多数決採用）' : ''}`)

  if (!outcome.ok || !outcome.intermediate) {
    console.error(`\n✗ 読み取りに失敗しました: ${outcome.reason}`)
    process.exit(1)
  }

  console.log('\n===== 読み取り結果 =====')
  console.log(render(outcome.intermediate))

  if (!expectedPath) {
    console.log('\n===== JSON =====')
    console.log(JSON.stringify(outcome.intermediate, null, 2))
    return
  }

  const expected = normalizeIntermediate(JSON.parse(readFileSync(path.resolve(expectedPath), 'utf-8')) as Intermediate)
  const got = normalizeIntermediate(outcome.intermediate)
  if (JSON.stringify(expected) === JSON.stringify(got)) {
    console.log('\n✓ 正解 fixture と完全一致しました')
    return
  }

  console.error('\n✗ 正解 fixture と一致しませんでした')
  console.error('--- 期待値 ---')
  console.error(render(expected))
  console.error('--- 差分のある行 ---')
  const wantLines = render(expected).split('\n')
  const gotLines = render(got).split('\n')
  for (let i = 0; i < Math.max(wantLines.length, gotLines.length); i++) {
    if (wantLines[i] !== gotLines[i]) {
      console.error(`  期待: ${wantLines[i] ?? '(なし)'}`)
      console.error(`  実際: ${gotLines[i] ?? '(なし)'}`)
    }
  }
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
