/**
 * VAPID 鍵ペアを生成し、server/.dev.vars へ保存する。
 *
 *   Set-Location C:\Users\mote1\dev\campus-bus-navi\server
 *   npm run keygen
 *
 * 秘密鍵はターミナルに出さない。人が控えて持ち歩くと取り違え・紛失が起きるので、
 * .dev.vars（.gitignore 済み）へ直接書き、テスト送信ツールはそこから読む。
 * 画面に出すのは公開鍵だけ ── アプリの購読パネルに貼るために要る。
 *
 * 既に .dev.vars がある場合は上書きしない（鍵を作り直すと既存の購読がすべて
 * 無効になるため）。作り直したいときは `npm run keygen -- --force`。
 */

import { bytesToBase64Url } from '../src/vapid.js'
import { DEV_VARS_PATH, devVarsExists, readDevVars, writeDevVars } from './devVars.js'

/** VAPID の subject。連絡先を兼ねる識別子で、mailto: か https: の URL であればよい */
const SUBJECT = 'https://campus-bus-navi.pages.dev/'

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const force = process.argv.includes('--force')

if ((await devVarsExists()) && !force) {
  const existing = await readDevVars()
  if (existing.VAPID_PUBLIC_KEY) {
    console.log('既に鍵が保存されています。作り直しません。\n')
    console.log('━━━ 公開鍵（アプリの購読パネルに貼る値） ━━━')
    console.log(existing.VAPID_PUBLIC_KEY)
    console.log('')
    console.log(`保存先: ${DEV_VARS_PATH}`)
    console.log('作り直す場合は  npm run keygen -- --force')
    console.log('※ 作り直すと、それまでに作った購読はすべて無効になります。')
    process.exit(0)
  }
}

// generateKey / exportKey の戻りはユニオン型。P-256 の鍵ペアと JWK なのは自明なので絞る
const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])) as CryptoKeyPair

const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
if (!jwk.x || !jwk.y || !jwk.d) throw new Error('鍵の書き出しに失敗しました')

// 公開鍵は非圧縮点（0x04 || X || Y）の 65 バイト。web-push 系の実装が期待する形式
const publicPoint = new Uint8Array(65)
publicPoint[0] = 0x04
publicPoint.set(b64urlToBytes(jwk.x), 1)
publicPoint.set(b64urlToBytes(jwk.y), 33)
const publicKey = bytesToBase64Url(publicPoint)

await writeDevVars({
  VAPID_PUBLIC_KEY: publicKey,
  VAPID_PRIVATE_KEY: jwk.d,
  VAPID_SUBJECT: SUBJECT,
})

console.log('VAPID 鍵ペアを生成し、保存しました。\n')
console.log('━━━ 公開鍵（アプリの購読パネルに貼る値） ━━━')
console.log(publicKey)
console.log('')
console.log(`秘密鍵の保存先: ${DEV_VARS_PATH}`)
console.log('（.gitignore 済み。控える必要はありません。テスト送信ツールが自動で読みます）\n')
console.log('次の手順:')
console.log('  1. 上の公開鍵をコピーする')
console.log('  2. アプリの「表示・通知オプション」→ 通知 → VAPID 公開鍵 に貼る')
console.log('  3. 「通知を購読する」→「購読情報をコピー」')
console.log('  4. Get-Clipboard | Out-File -Encoding utf8 .\\subscription.json')
console.log('  5. npm run send-test -- .\\subscription.json')
