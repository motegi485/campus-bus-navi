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
 * 以前は許可ドメインの任意のサブドメインを通していた（接尾辞一致）。送信先として使われるのは
 * 下の決まったホストだけなので、完全一致に絞った（2026-11-01）。
 *
 * 【対応ブラウザを増やすときは、実機で得た endpoint のホストをここへ追加すること。】
 * 追加を忘れると購読が 400 で拒否され、利用者には「通知をオンにできない」形で現れる
 * （黙って第三者へ送るより安全側）。
 */

/**
 * 完全一致で許可するホスト。
 *
 * - `fcm.googleapis.com`                … Chrome（PC）で実機確認済み（docs/verification.md、2026-08-16）。
 *                                         Chromium 系の他ブラウザも同じホストを返すと考えられるが、実機記録は無い
 * - `web.push.apple.com`                … iPhone のホーム画面 PWA（Safari / APNs）で実機確認済み（同上）
 * - `updates.push.services.mozilla.com` … Firefox。実機未確認
 *
 * 旧 GCM 形式の `android.googleapis.com` は許可しない（現行の Chrome は fcm を返すと考えられる。実機記録は無い）。
 */
const EXACT_PUSH_HOSTS: ReadonlySet<string> = new Set([
  'fcm.googleapis.com',
  'web.push.apple.com',
  'updates.push.services.mozilla.com',
])

/**
 * WNS（Windows の push。Edge が使う場合がある）。実機未確認。
 * `<1 ラベル>.notify.windows.com` だけを認め、それより深いサブドメインは通さない。
 */
const WNS_HOST = /^[a-z0-9-]{1,63}\.notify\.windows\.com$/

/**
 * ホストが許可リストに一致するか。
 *
 * 部分一致や接尾辞一致にすると `evil-fcm.googleapis.com.example.com` や許可ドメイン配下の
 * 任意のサブドメインを通すため、完全一致（WNS だけは 1 ラベル）で判定する。
 */
export function isAllowedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return EXACT_PUSH_HOSTS.has(host) || WNS_HOST.test(host)
}

/** ホスト部が IP リテラルか。許可リストがあれば通らないが、意図を明示するために持つ */
export function isIpLiteral(hostname: string): boolean {
  // URL は IPv6 を角括弧付きで返す
  if (hostname.startsWith('[')) return true
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}
