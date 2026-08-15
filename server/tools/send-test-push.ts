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

import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
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
 * 購読情報の入手方法。
 *
 * 既定は「ターミナルへ直接貼り付け」。ファイルを経由すると、
 *   - 古い端末の購読ファイルが残っていて取り違える
 *   - クリップボードが途中で別のものに上書きされる
 * という取り違えが起きやすく、実際に何度も起きた。貼り付けなら
 * その瞬間の中身がそのまま使われる。
 *
 * ファイルを使いたいときは引数でパスを渡す。
 */
async function readSubscriptionText(): Promise<{ text: string; source: string }> {
  const explicit = process.argv[2]
  if (explicit) {
    return { text: await readFile(explicit, 'utf8'), source: explicit }
  }

  console.log('購読情報（{"endpoint":... で始まる JSON）を貼り付けて Enter を押してください。')
  console.log('中止する場合は Ctrl+C。\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const line = await rl.question('> ')
    return { text: line, source: '貼り付け' }
  } finally {
    rl.close()
  }
}

const keys: VapidKeys = {
  publicKey: requireKey('VAPID_PUBLIC_KEY'),
  privateKey: requireKey('VAPID_PRIVATE_KEY'),
  subject: requireKey('VAPID_SUBJECT'),
}

const { text: rawText, source } = await readSubscriptionText()

let endpoint: string
try {
  // BOM（PowerShell の Out-File が付ける）と前後の空白・引用符を落としてから解釈する
  const text = rawText.replace(/^﻿/, '').trim().replace(/^['"]|['"]$/g, '')
  if (!text.startsWith('{')) {
    // 何を渡されたのかを見せる。「コマンド文字列を貼ってしまった」等がすぐ分かる
    throw new Error(`JSON ではありません。受け取った先頭: ${JSON.stringify(text.slice(0, 40))}`)
  }
  const parsed = JSON.parse(text) as { endpoint?: string }
  if (!parsed.endpoint) throw new Error('endpoint フィールドがありません')
  endpoint = parsed.endpoint
} catch (e) {
  console.error(`\n購読情報を読めませんでした（${source}）: ${e instanceof Error ? e.message : String(e)}`)
  console.error('')
  console.error('アプリの「表示・通知オプション」→ 通知 →「コピー（予備）」で得られる、')
  console.error('{"endpoint":"https://... で始まる 1 行を貼り付けてください。')
  process.exit(1)
}

/**
 * push サービスのホストから、どの種類の端末へ送るのかを言い当てる。
 * PC の購読と iPhone の購読を取り違えたまま「届いた」と判断する事故を防ぐ。
 */
function describeTarget(host: string): string {
  if (host.includes('apple.com')) return 'Safari（iPhone / iPad / Mac）'
  if (host.includes('googleapis.com')) return 'Chrome / Edge（PC / Android）'
  if (host.includes('mozilla.com')) return 'Firefox'
  return '不明な push サービス'
}

// エンドポイントは端末を特定しうるので、ホストだけを出す
const host = new URL(endpoint).host
console.log(`\n送信先: ${describeTarget(host)}  [${host}]`)
console.log('（ペイロードなし push）')

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
