/**
 * 外部から取得する URL の信頼境界（NFR-8「アクセス礼節」の実装側の担保）。
 *
 * Bot は大学の掲載ページに書かれた href をそのまま取得しにいく。ページが改ざんされたり
 * 誤ったリンクが貼られたりすると、CI ランナーから任意のホスト（社内アドレスや
 * ループバックを含む）へリクエストを飛ばせてしまう。scheme・ホスト・リダイレクト先を
 * すべてこのモジュールで検査し、許可した宛先以外へは接続しない。
 */

/** IPv4 ドット表記（127.0.0.1 など） */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * URL が許可された宛先か検査する。
 * - https のみ（平文 http・file・data などは不可）
 * - 資格情報付き URL（user:pass@host）は不可
 * - ホストは IP リテラルではなく、許可サフィックスに一致すること
 */
export function checkUrl(
  raw: string,
  allowedHostSuffixes: readonly string[],
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: `URL として解釈できません: ${raw}` }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: `https 以外のスキームは取得しません（${url.protocol}）: ${raw}` }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: `資格情報付きの URL は取得しません: ${url.host}` }
  }

  // new URL は IPv6 を [] 付きの hostname にする
  const host = url.hostname.toLowerCase()
  if (IPV4_RE.test(host) || host.startsWith('[')) {
    return { ok: false, reason: `IP アドレス直指定の URL は取得しません: ${host}` }
  }

  const allowed = allowedHostSuffixes.some((suffix) => {
    const s = suffix.toLowerCase()
    return host === s || host.endsWith(`.${s}`)
  })
  if (!allowed) {
    return {
      ok: false,
      reason: `許可されていないホストです（${host}）。許可: ${allowedHostSuffixes.join(', ')}`,
    }
  }

  return { ok: true, url }
}

/** checkUrl の throw 版。取得直前のガードに使う */
export function assertAllowedUrl(raw: string, allowedHostSuffixes: readonly string[]): URL {
  const result = checkUrl(raw, allowedHostSuffixes)
  if (!result.ok) throw new Error(result.reason)
  return result.url
}
