/**
 * server/.dev.vars の読み書き。
 *
 * .dev.vars は wrangler がローカル開発で読む秘密情報のファイルで、.gitignore 済み。
 * 鍵をターミナルへ出して人が控える運用は取り違え・紛失が起きるため、生成時に
 * ここへ書き、必要なツールがここから読む。
 */

import { readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** tools/ から見た server/.dev.vars の絶対パス。実行時のカレントディレクトリに依存させない */
export const DEV_VARS_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), '.dev.vars')

export async function devVarsExists(): Promise<boolean> {
  try {
    await access(DEV_VARS_PATH)
    return true
  } catch {
    return false
  }
}

/** dotenv 形式（KEY=VALUE の行）を読む。値の引用符は剥がす */
export async function readDevVars(): Promise<Record<string, string>> {
  let text: string
  try {
    text = await readFile(DEV_VARS_PATH, 'utf8')
  } catch {
    return {}
  }
  const result: Record<string, string> = {}
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    result[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
  return result
}

export async function writeDevVars(values: Record<string, string>): Promise<void> {
  const body =
    [
      '# 発車リマインダーのローカル用シークレット。',
      '# .gitignore 済み。コミットしないこと。',
      '# 本番の秘密鍵は `npx wrangler secret put VAPID_PRIVATE_KEY` で Cloudflare に置く。',
      ...Object.entries(values).map(([k, v]) => `${k}=${v}`),
    ].join('\n') + '\n'
  await writeFile(DEV_VARS_PATH, body, 'utf8')
}
