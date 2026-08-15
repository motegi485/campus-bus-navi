/**
 * 実機へテスト用の push を 1 通送る。
 *
 * 計画の段階 1（VAPID 署名の実証）と段階 2（ペイロードなし push が Safari で動くか）を
 * 確かめるための道具。サーバも D1 も要らず、購読 1 件だけを相手にする。
 *
 * ── 使い方 ──────────────────────────────────────────────────────────
 *
 * 1. 端末で https://campus-bus-navi.pages.dev を開く
 *    （iPhone は必ず「ホーム画面に追加」してから、そのアイコンで開くこと。
 *      Safari のタブでは push は動かない）
 *
 * 2. 「表示・通知オプション」→ 通知 で購読し、「subscription.json を保存」を押す
 *    （ダウンロードフォルダに落ちる）
 *
 * 3. 送る。鍵は .dev.vars から、購読情報はダウンロードフォルダから自動で読まれる:
 *
 *      Set-Location server
 *      npm run send-test
 *
 * 購読情報の受け渡しにクリップボードは使わない。次に別のものをコピーした時点で
 * 消えてしまい、原因の分かりにくい失敗になるため。
 *
 * subscription.json は端末を特定しうる値なので、リポジトリに入れないこと。
 */

import { readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { VapidSigner, type VapidKeys } from '../src/vapid.js'
import { sendPush } from '../src/send.js'
import { DEV_VARS_PATH, readDevVars } from './devVars.js'

// 鍵は server/.dev.vars（npm run keygen が作る）から読む。
// 環境変数が設定されていればそちらを優先する（CI や本番鍵での確認用）。
const stored = await readDevVars()
function requireKey(name: string): string {
  const value = process.env[name] || stored[name]
  if (!value) {
    console.error(`${name} が見つかりません。`)
    console.error(`まず  npm run keygen  を実行してください（保存先: ${DEV_VARS_PATH}）。`)
    process.exit(1)
  }
  return value
}

/**
 * 購読情報の場所を決める。
 *
 * 引数が無ければ、ダウンロードフォルダ → server/ の順に探す。パネルの
 * 「subscription.json を保存」がダウンロードフォルダへ落とすので、
 * ふつうは引数もパス入力も要らない。
 */
async function resolveSubscriptionPath(): Promise<string> {
  const explicit = process.argv[2]
  if (explicit) return explicit

  const candidates = [
    join(homedir(), 'Downloads', 'subscription.json'),
    join(process.cwd(), 'subscription.json'),
  ]
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // 次の候補へ
    }
  }
  console.error('subscription.json が見つかりません。探した場所:')
  for (const candidate of candidates) console.error(`  ${candidate}`)
  console.error('')
  console.error('アプリの「表示・通知オプション」→ 通知 →「subscription.json を保存」を先に実行してください。')
  process.exit(1)
}

const path = await resolveSubscriptionPath()

const keys: VapidKeys = {
  publicKey: requireKey('VAPID_PUBLIC_KEY'),
  privateKey: requireKey('VAPID_PRIVATE_KEY'),
  subject: requireKey('VAPID_SUBJECT'),
}

let endpoint: string
try {
  // PowerShell の Out-File は UTF-8 BOM を付ける。BOM が残っていると JSON.parse が落ちるので剥がす
  const text = (await readFile(path, 'utf8')).replace(/^﻿/, '')
  const parsed = JSON.parse(text) as { endpoint?: string }
  if (!parsed.endpoint) throw new Error('endpoint がありません')
  endpoint = parsed.endpoint
} catch (e) {
  console.error(`購読情報を読めませんでした: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

// エンドポイントは端末を特定しうるので、ホストだけを出す
const host = new URL(endpoint).host
console.log(`送信先: ${host}（ペイロードなし push）`)

const signer = new VapidSigner(keys)
const result = await sendPush({
  endpoint,
  signer,
  nowSeconds: Math.floor(Date.now() / 1000),
})

switch (result.status) {
  case 'sent':
    console.log(`✓ push サービスが受理しました（HTTP ${result.code}）`)
    console.log('  端末に通知が出れば成功。出ない場合は SW の push ハンドラを確認する。')
    break
  case 'expired':
    console.error(`✗ 購読が失効しています（HTTP ${result.code}）。購読を作り直してください。`)
    process.exitCode = 1
    break
  case 'rate-limited':
    console.error('✗ push サービスに絞られました（HTTP 429）。少し待って再試行してください。')
    process.exitCode = 1
    break
  case 'failed':
    console.error(`✗ 送信に失敗しました（HTTP ${result.code}）: ${result.detail}`)
    process.exitCode = 1
    break
}
