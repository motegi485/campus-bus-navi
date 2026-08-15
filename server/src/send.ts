/**
 * push サービスへの送信 1 件分。
 *
 * ここでは**本文を送らない**（ペイロードなし push）。表示内容は受信側の SW が
 * `timetable-data` キャッシュから当日のダイヤを読んで組み立てる。理由は vapid.ts の
 * 冒頭コメントを参照（Workers 無料枠の CPU 10ms/実行に収めるため）。
 *
 * 呼び出し 1 回 = 外部サブリクエスト 1 回。無料枠は 1 実行あたり 50 なので、
 * 50 件を超えるバッチは Durable Object へ分けて送る（各 DO が自分の 50 枠を持つ）。
 */

import { DEFAULT_TTL_SECONDS, VapidSigner } from './vapid.js'

export type SendOutcome =
  /** 受け付けられた（配送されたことの保証ではない） */
  | { status: 'sent'; code: number }
  /** 購読が失効している。D1 から削除してよい */
  | { status: 'expired'; code: number }
  /** push サービスに絞られた。この回は諦め、購読は残す */
  | { status: 'rate-limited' }
  /** それ以外の失敗。購読は残し、ログに残して調べる */
  | { status: 'failed'; code: number; detail: string }

/** エラー本文をログに残す際の上限。push サービスは長い HTML を返すことがある */
const MAX_DETAIL_LENGTH = 200

/**
 * 失効と一時的な失敗を区別する。
 *
 * 404 / 410 は「その購読はもう存在しない」の意味で、RFC 8030 が定める終端状態。
 * ここで確実に削除しないと、失効した購読へ毎分送り続けてサブリクエストを浪費する。
 */
export async function sendPush(params: {
  endpoint: string
  signer: VapidSigner
  nowSeconds: number
  ttlSeconds?: number
}): Promise<SendOutcome> {
  const { endpoint, signer, nowSeconds, ttlSeconds = DEFAULT_TTL_SECONDS } = params

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: await signer.headersFor(endpoint, nowSeconds, ttlSeconds),
    })
  } catch (e) {
    // ネットワーク層の失敗（DNS・TLS・タイムアウト）。購読は消さない
    return { status: 'failed', code: 0, detail: e instanceof Error ? e.message : String(e) }
  }

  if (response.status === 404 || response.status === 410) {
    return { status: 'expired', code: response.status }
  }
  if (response.status === 429) {
    return { status: 'rate-limited' }
  }
  if (response.ok) {
    return { status: 'sent', code: response.status }
  }

  let detail = ''
  try {
    detail = (await response.text()).slice(0, MAX_DETAIL_LENGTH)
  } catch {
    // 本文が読めなくてもステータスだけで十分に判断できる
  }
  return { status: 'failed', code: response.status, detail }
}
