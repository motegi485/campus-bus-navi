/**
 * 端末の購読の登録・解除（Cloudflare Pages Functions）。
 *
 * 設定画面のトグル（通知の根幹の許可）が呼ぶ。ここで端末が登録されて初めて、
 * 時刻表から便ごとのリマインドを指定できるようになる。
 *
 * 便の指定そのものは /api/reminders が扱う。
 *
 * Pages と同じオリジンで動くので CORS が要らない。
 * public/_redirects の `/* /index.html 200` より Functions が優先されることは
 * デプロイ後に /api/vapid-key で確認済み。
 */

import { parseSubscribeRequest, isValidEndpoint, subscriptionId } from '../../server/src/subscription.js'

interface Env {
  DB: D1Database
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** 通知をオンにする */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'JSON を解釈できませんでした' }, 400)
  }

  const parsed = parseSubscribeRequest(payload)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const { endpoint, p256dh, auth } = parsed.value

  try {
    const id = await subscriptionId(endpoint)
    // 同じ端末が再購読したときは鍵だけ更新する。created_at は最初の登録時のまま残す
    await env.DB.prepare(
      `INSERT INTO subscriptions (id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
    )
      .bind(id, endpoint, p256dh, auth, Date.now())
      .run()

    return json({ ok: true })
  } catch (e) {
    console.error('購読の保存に失敗しました', e)
    return json({ error: '購読を保存できませんでした' }, 500)
  }
}

/**
 * 通知をオフにする。端末の購読と、その端末のリマインドをまとめて消す。
 *
 * reminders は ON DELETE CASCADE で消えるが、D1 は外部キー制約が既定で無効な
 * 場合があるため明示的に削除する（残ると配信のたびに無駄な結合が走る）。
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  let payload: { endpoint?: unknown }
  try {
    payload = (await request.json()) as { endpoint?: unknown }
  } catch {
    return json({ error: 'JSON を解釈できませんでした' }, 400)
  }
  if (!isValidEndpoint(payload.endpoint)) return json({ error: 'endpoint が不正です' }, 400)

  try {
    const id = await subscriptionId(payload.endpoint)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reminders WHERE subscription_id = ?').bind(id),
      env.DB.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id),
    ])
    // 存在しなかった場合も成功として返す。解除は何度呼ばれても同じ結果になるべきで、
    // 「その endpoint が登録されていたか」を外部へ漏らす必要もない
    return json({ ok: true })
  } catch (e) {
    console.error('購読の削除に失敗しました', e)
    return json({ error: '購読を解除できませんでした' }, 500)
  }
}
