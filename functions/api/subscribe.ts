/**
 * 購読の登録・更新（Cloudflare Pages Functions）。
 *
 * Pages と同じオリジン（campus-bus-navi.pages.dev/api/subscribe）で動くので CORS が要らない。
 * Cron の配信本体は server/ の Worker が担い、ここは D1 への書き込みだけを行う。
 *
 * ⚠️ public/_redirects に `/* /index.html 200` があるが、Pages では Functions が
 *    先に評価されるため /api/* はここへ届く。デプロイ後に必ず実際に叩いて確認すること。
 */

import { parseSubscribeRequest, subscriptionId } from '../../server/src/subscription.js'

interface Env {
  DB: D1Database
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'JSON を解釈できませんでした' }, 400)
  }

  const parsed = parseSubscribeRequest(payload)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const value = parsed.value

  try {
    const id = await subscriptionId(value.endpoint)
    // 同じ端末が設定を変えて再購読したときは上書きする。last_sent_on は引き継がず
    // NULL に戻す（条件が変わったのだから、その日の送信済み判定もやり直す）
    await env.DB.prepare(
      `INSERT INTO subscriptions
         (id, endpoint, p256dh, auth, route, mode, departure, lead_minutes, days_mask, created_at, last_sent_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         route = excluded.route,
         mode = excluded.mode,
         departure = excluded.departure,
         lead_minutes = excluded.lead_minutes,
         days_mask = excluded.days_mask,
         last_sent_on = NULL`
    )
      .bind(
        id,
        value.endpoint,
        value.p256dh,
        value.auth,
        value.route,
        value.mode,
        value.departure,
        value.leadMinutes,
        value.daysMask,
        Date.now()
      )
      .run()

    return json({ ok: true })
  } catch (e) {
    console.error('購読の保存に失敗しました', e)
    return json({ error: '購読を保存できませんでした' }, 500)
  }
}
