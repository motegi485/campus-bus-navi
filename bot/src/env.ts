/**
 * ローカル開発用の環境変数読み込み。
 *
 * `bot/.env.local`（git 管理外。リポジトリルートの .gitignore の `*.local` で除外される）が
 * あれば読み込む。GitHub Actions では Secrets が実環境変数として渡るのでこのファイルは存在せず、
 * 何もしない。既に設定済みの環境変数は上書きしない。
 *
 * 秘密情報はこのファイルにのみ置き、リポジトリへコミットしないこと。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function loadLocalEnv(): void {
  const envFile = path.join(BOT_DIR, '.env.local')
  if (!existsSync(envFile)) return
  try {
    process.loadEnvFile(envFile)
  } catch (e) {
    console.warn(`[env] ${envFile} の読み込みに失敗しました: ${(e as Error).message}`)
  }
}
