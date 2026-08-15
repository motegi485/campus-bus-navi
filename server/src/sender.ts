/**
 * 送信担当の Durable Object。
 *
 * 1 回の実行で最大 40 件へ push を送る。DO の実行は Worker 本体とは別の実行なので、
 * 「1 実行あたり外部サブリクエスト 50 件」という無料枠の制限を、DO の数だけ分割できる。
 *
 * 送信後の後片付けもここで行う:
 *   - 成功した購読は last_sent_on を今日にする（二重送信の防止）
 *   - 410 / 404 を返した購読は削除する（失効。残すと毎分無駄に送り続ける）
 */

import type { Env } from './index.js'
import { sendPush } from './send.js'
import { VapidSigner } from './vapid.js'

interface SendRequest {
  dateKey: string
  endpoints: { id: string; endpoint: string }[]
}

export class ReminderSender {
  private signer: VapidSigner | null = null

  constructor(
    _state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    let payload: SendRequest
    try {
      payload = (await request.json()) as SendRequest
    } catch {
      return new Response('bad request', { status: 400 })
    }
    if (!Array.isArray(payload.endpoints) || payload.endpoints.length === 0) {
      return new Response('empty', { status: 400 })
    }

    // 署名器は DO のインスタンスに持たせる。aud ごとの JWT キャッシュが効くので、
    // このバッチ内での署名は push サービスの種類の数（3 程度）で済む
    if (!this.signer) {
      this.signer = new VapidSigner({
        publicKey: this.env.VAPID_PUBLIC_KEY,
        privateKey: this.env.VAPID_PRIVATE_KEY,
        subject: this.env.VAPID_SUBJECT,
      })
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const results = await Promise.all(
      payload.endpoints.map(async target => ({
        id: target.id,
        outcome: await sendPush({ endpoint: target.endpoint, signer: this.signer!, nowSeconds }),
      }))
    )

    const sent: string[] = []
    const expired: string[] = []
    let failed = 0
    for (const { id, outcome } of results) {
      if (outcome.status === 'sent') sent.push(id)
      else if (outcome.status === 'expired') expired.push(id)
      else {
        failed++
        if (outcome.status === 'failed') console.error(`送信失敗 (HTTP ${outcome.code}): ${outcome.detail}`)
      }
    }

    await this.recordOutcome(payload.dateKey, sent, expired)

    if (failed > 0) console.warn(`${failed} 件の送信に失敗しました（購読は残します）`)
    return Response.json({ sent: sent.length, expired: expired.length, failed })
  }

  /**
   * D1 への後片付け。
   *
   * まとめて 2 文に収める（1 件ずつ実行すると D1 の行書き込み枠を無駄に消費し、
   * サブリクエスト相当の往復も増える）。
   */
  private async recordOutcome(dateKey: string, sent: string[], expired: string[]): Promise<void> {
    const statements: D1PreparedStatement[] = []

    if (sent.length > 0) {
      const placeholders = sent.map(() => '?').join(',')
      statements.push(
        this.env.DB.prepare(`UPDATE subscriptions SET last_sent_on = ? WHERE id IN (${placeholders})`).bind(
          dateKey,
          ...sent
        )
      )
    }
    if (expired.length > 0) {
      const placeholders = expired.map(() => '?').join(',')
      statements.push(
        this.env.DB.prepare(`DELETE FROM subscriptions WHERE id IN (${placeholders})`).bind(...expired)
      )
    }

    if (statements.length === 0) return
    try {
      await this.env.DB.batch(statements)
    } catch (e) {
      // ここで落ちると二重送信または失効購読の残留が起きる。必ず記録に残す
      console.error('送信結果の記録に失敗しました', e)
    }
  }
}
