/**
 * 送信先として受け入れる push サービスの許可リスト。
 *
 * `/api/subscribe` は無認証で、送られた endpoint をそのまま D1 に保存し、
 * 配信 Worker がその URL へ VAPID 署名付きの POST を送る（server/src/send.ts）。
 * scheme が `https:` かどうかだけを見ていると、**任意の第三者サーバを送信先に
 * 指定できる**（宛先の所有証明が無いため、公開 API から外向き通信を反復させられる）。
 *
 * ブラウザが発行する push endpoint のホストは実質数種類しかないので、
 * ホスト単位で絞る。これは「対応ブラウザの追加＝ここへの追記」を意味する運用コストと
 * 引き換えに、任意宛の送信経路を塞ぐ選択である。
 *
 * 【対応ブラウザを増やすときは、実機で得た endpoint のホストをここへ追加すること。】
 * 追加を忘れると購読が 400 で拒否され、利用者には「通知をオンにできない」形で現れる
 * （黙って第三者へ送るより安全側）。
 */

/**
 * 許可するホスト接尾辞（完全一致 or そのサブドメイン）。
 *
 * - `fcm.googleapis.com`      … Chrome / Edge / Chromium 系（Samsung Internet も同じ）
 * - `android.googleapis.com`  … 旧 GCM 形式の endpoint（古い Chrome）
 * - `push.services.mozilla.com` … Firefox（`updates.push.services.mozilla.com`）
 * - `web.push.apple.com`      … Safari / iOS ホーム画面 PWA（APNs）
 * - `notify.windows.com`      … 旧 Edge（WNS。`*.notify.windows.com`）
 */
export const ALLOWED_PUSH_HOST_SUFFIXES: string[] = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
]

/**
 * ホストが許可接尾辞に一致するか。
 *
 * 部分一致にすると `evil-fcm.googleapis.com.example.com` のような名前を通すため、
 * 完全一致かドット境界のサブドメインだけを認める（bot/src/url.ts と同じ規律）。
 */
export function isAllowedPushHost(hostname: string, suffixes: string[] = ALLOWED_PUSH_HOST_SUFFIXES): boolean {
  const host = hostname.toLowerCase()
  return suffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`))
}

/** ホスト部が IP リテラルか。許可リストがあれば通らないが、意図を明示するために持つ */
export function isIpLiteral(hostname: string): boolean {
  // URL は IPv6 を角括弧付きで返す
  if (hostname.startsWith('[')) return true
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}
