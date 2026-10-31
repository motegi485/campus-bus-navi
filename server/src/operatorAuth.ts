/**
 * 運用者向け API（/api/status）の合言葉の検査。
 *
 * 合言葉は Pages の secret `STATUS_TOKEN` に置き、要求は `Authorization: Bearer <合言葉>` で送る。
 * 未設定・短すぎる値は「設定されていない」として扱い、誰も通さない（フェイルクローズ）。
 *
 * 比較は両方を SHA-256 にしてから 32 バイトを XOR で畳む。文字列の === は先頭から
 * 違う位置で打ち切るので、応答時間から一致した長さを推測される余地がある。ハッシュしてから
 * 比べると、長さの違いも比較時間に出ない。crypto.subtle.timingSafeEqual は workerd には
 * あるが Node（vitest）には無いので、両方にある digest だけを使う。
 */

export type OperatorAuth = 'ok' | 'unconfigured' | 'denied'

/** 合言葉の最小長。これより短い値は設定漏れ・誤設定とみなす */
export const MIN_OPERATOR_TOKEN_LENGTH = 32

/** RFC 6750 の b64token より広めに、表示可能な ASCII を 1〜512 文字だけ認める */
const BEARER = /^Bearer ([\x21-\x7e]{1,512})$/

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

export async function checkOperatorToken(header: string | null, token: unknown): Promise<OperatorAuth> {
  if (typeof token !== 'string' || token.length < MIN_OPERATOR_TOKEN_LENGTH) return 'unconfigured'
  const match = BEARER.exec(header ?? '')
  if (!match) return 'denied'
  const [given, expected] = await Promise.all([digest(match[1]), digest(token)])
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= given[i] ^ expected[i]
  return diff === 0 ? 'ok' : 'denied'
}
