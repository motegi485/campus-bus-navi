/**
 * 購読の解除（Cloudflare Pages Functions）。
 *
 * 端末が自分の endpoint を渡して自分の行を消すだけ。認証は持たないが、
 * endpoint は push サービスが発行する推測困難な値で、本人以外は知り得ない。
 * 消えて困る情報も入っていない（通知が止まるだけ）。
 */

import { subscriptionId } from '../../server/src/subscription.js'

interface Env {
  DB: D1Database
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: { endpoint?: unknown }
  try {
    payload = (await request.json()) as { endpoint?: unknown }
  } catch {
    return json({ error: 'JSON を解釈できませんでした' }, 400)
  }

  const endpoint = payload.endpoint
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
    return json({ error: 'endpoint が不正です' }, 400)
  }

  try {
    const id = await subscriptionId(endpoint)
    await env.DB.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run()
    // 存在しなかった場合も成功として返す。解除は何度呼ばれても同じ結果になるべきで、
    // 「その endpoint が登録されていたか」を外部へ漏らす必要もない
    return json({ ok: true })
  } catch (e) {
    console.error('購読の削除に失敗しました', e)
    return json({ error: '購読を解除できませんでした' }, 500)
  }
}
