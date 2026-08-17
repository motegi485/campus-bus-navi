/**
 * 購読の解除（Cloudflare Pages Functions）。
 *
 * 端末が自分の endpoint を渡して自分の行を消すだけ。認証は持たないが、
 * endpoint は push サービスが発行する推測困難な値で、本人以外は知り得ない。
 * 消えて困る情報も入っていない（通知が止まるだけ）。
 *
 * 【現行 UI はこの入口を使わない】設定画面のトグルは `DELETE /api/subscribe` を呼ぶ。
 * ここは過去のクライアントが残っている場合に備えて公開したままにしてあるが、
 * **削除の契約は /api/subscribe と同一**にしてある。以前はこちらだけ subscriptions を
 * 消して reminders を残しており、D1 の外部キーが既定で無効な構成では孤児が残った。
 * 入口によって「預かった情報をすべて削除」の意味が変わってはいけない。
 */

import { isValidEndpoint, subscriptionId } from '../../server/src/subscription.js'

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
  if (!isValidEndpoint(endpoint)) return json({ error: 'endpoint が不正です' }, 400)

  try {
    const id = await subscriptionId(endpoint)
    // reminders は ON DELETE CASCADE で消えるが、D1 は外部キー制約が既定で無効な
    // 場合があるため明示的に削除する（/api/subscribe の DELETE と同じ手順）
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
