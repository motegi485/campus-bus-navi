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
import { sendPush, type SendOutcome } from './send.js'
import { VapidSigner } from './vapid.js'

interface SendRequest {
  /** id は reminders.id、endpoint は送信先 */
  targets: { id: string; endpoint: string }[]
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
    if (!Array.isArray(payload.targets) || payload.targets.length === 0) {
      return new Response('empty', { status: 400 })
    }

    // 署名器は DO のインスタンスに持たせる。aud ごとの JWT キャッシュが効くので、
    // このバッチ内での署名は push サービスの種類の数（3 程度）で済む
    try {
      if (!this.signer) {
        this.signer = new VapidSigner({
          publicKey: this.env.VAPID_PUBLIC_KEY,
          privateKey: this.env.VAPID_PRIVATE_KEY,
          subject: this.env.VAPID_SUBJECT,
        })
      }
    } catch (e) {
      // VAPID_SUBJECT の書式など、設定そのものが誤っている。1 件も送れない
      console.error('VAPID の設定が不正です。server/wrangler.toml の VAPID_SUBJECT を確認してください', e)
      return Response.json({ error: 'vapid-config' }, { status: 500 })
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    let results: { id: string; endpoint: string; outcome: SendOutcome }[]
    try {
      results = await Promise.all(
        payload.targets.map(async target => ({
          id: target.id,
          endpoint: target.endpoint,
          outcome: await sendPush({ endpoint: target.endpoint, signer: this.signer!, nowSeconds }),
        }))
      )
    } catch (e) {
      // 署名鍵を読めない（VAPID_PRIVATE_KEY が未登録、または 32 バイトの base64url でない）。
      // 個々の送信失敗ではなく設定の誤りなので、実行の失敗として返す。
      // ここをログへ畳むと、Cron は成功したまま通知だけが永久に止まる
      console.error(
        '署名に失敗しました。`npx wrangler secret put VAPID_PRIVATE_KEY` で秘密鍵が登録されているか確認してください',
        e
      )
      return Response.json({ error: 'signing-failed' }, { status: 500 })
    }

    /** 送信済みにするリマインド */
    const sent: string[] = []
    /** 失効した端末の endpoint。購読ごと消す */
    const expiredEndpoints: string[] = []
    /** 署名を拒否された件（401 / 403）。鍵を直すまで直らないので一時的な失敗と分ける */
    const rejected: { code: number; detail: string }[] = []
    let failed = 0
    for (const { id, endpoint, outcome } of results) {
      if (outcome.status === 'sent') sent.push(id)
      else if (outcome.status === 'expired') expiredEndpoints.push(endpoint)
      else if (outcome.status === 'rejected') rejected.push({ code: outcome.code, detail: outcome.detail })
      else {
        failed++
        if (outcome.status === 'failed') console.error(`送信失敗 (HTTP ${outcome.code}): ${outcome.detail}`)
      }
    }

    // 記録は下の 500 より先に済ませる。送れた分に sent_at を付けずに実行を失敗させると、
    // 次の分で同じ便へもう一度送ってしまう（重複通知）
    const recorded = await this.recordOutcome(sent, expiredEndpoints)

    if (failed > 0) console.warn(`${failed} 件の送信に失敗しました（購読は残します）`)

    const summary = { sent: sent.length, expired: expiredEndpoints.length, failed, rejected: rejected.length }

    // 記録に失敗すると sent_at が付かず、次の分で同じ集合へ再送する（重複通知）。
    // 呼び出し側が実行を失敗として扱えるよう、200 では返さない
    if (!recorded) {
      return Response.json({ ...summary, recorded: false }, { status: 500 })
    }

    // 署名を拒否された＝鍵の設定が誤っている。次の分で再試行しても同じ結果になるため、
    // ログと警告だけで済ませると利用者からは「静かに届かない」だけに見える。
    // 「送らないのが正しい状態」ではなく「送れない障害」なので、実行の失敗として表面化させる
    if (rejected.length > 0) {
      console.error(
        `VAPID 署名が ${rejected.length} 件で拒否されました (HTTP ${rejected[0].code}): ${rejected[0].detail}` +
          ' — /api/vapid-key が返す公開鍵と Worker の VAPID_PRIVATE_KEY が対になっているか確認してください'
      )
      return Response.json({ ...summary, recorded: true }, { status: 500 })
    }

    return Response.json({ ...summary, recorded: true })
  }

  /**
   * D1 への後片付け。記録できたら true。
   *
   * まとめて 2 文に収める（1 件ずつ実行すると D1 の行書き込み枠を無駄に消費し、
   * サブリクエスト相当の往復も増える）。
   */
  private async recordOutcome(sent: string[], expiredEndpoints: string[]): Promise<boolean> {
    const statements: D1PreparedStatement[] = []

    if (sent.length > 0) {
      const placeholders = sent.map(() => '?').join(',')
      statements.push(
        this.env.DB.prepare(`UPDATE reminders SET sent_at = ? WHERE id IN (${placeholders})`).bind(
          Date.now(),
          ...sent
        )
      )
    }
    // 失効は端末そのものが消えた状態。その端末のリマインドも一緒に消す
    for (const endpoint of expiredEndpoints) {
      statements.push(
        this.env.DB.prepare(
          'DELETE FROM reminders WHERE subscription_id IN (SELECT id FROM subscriptions WHERE endpoint = ?)'
        ).bind(endpoint),
        this.env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(endpoint)
      )
    }

    if (statements.length === 0) return true
    try {
      await this.env.DB.batch(statements)
      return true
    } catch (e) {
      // ここで落ちると二重送信または失効購読の残留が起きる。必ず記録に残す
      console.error('送信結果の記録に失敗しました', e)
      return false
    }
  }
}
