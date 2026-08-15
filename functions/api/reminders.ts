/**
 * 当日の便ごとのリマインド指定（Cloudflare Pages Functions）。
 *
 * ホーム画面の「本日の全時刻表」の通知選択モードが呼ぶ。
 * 端末が /api/subscribe で登録済みでなければ受け付けない（通知の根幹の許可は
 * 設定画面のトグルが持つ、という二層構造をサーバ側でも守る）。
 *
 * POST は「その日・そのルートの指定を、送られた内容で置き換える」。
 * 差分ではなく総入れ替えにしているのは、選択モードが「いま選ばれている便の集合」を
 * そのまま送る作りで、そのほうが画面と DB がずれないため。
 */

import {
  parseReminderRequest,
  reminderId,
  subscriptionId,
} from '../../server/src/subscription.js'

interface Env {
  DB: D1Database
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'JSON を解釈できませんでした' }, 400)
  }

  const parsed = parseReminderRequest(payload)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const { endpoint, dateKey, route, departures, leadMinutes } = parsed.value

  try {
    const subId = await subscriptionId(endpoint)

    const known = await env.DB.prepare('SELECT 1 FROM subscriptions WHERE id = ?').bind(subId).first()
    if (!known) {
      return json({ error: '通知が有効になっていません。設定画面で通知をオンにしてください' }, 409)
    }

    const statements: D1PreparedStatement[] = [
      // 同じ日・同じルートの指定を一度消してから入れ直す（総入れ替え）
      env.DB.prepare('DELETE FROM reminders WHERE subscription_id = ? AND date_key = ? AND route = ?').bind(
        subId,
        dateKey,
        route
      ),
      // 前日以前の指定を掃除する。当日限りなので残しておく意味がない
      env.DB.prepare('DELETE FROM reminders WHERE subscription_id = ? AND date_key < ?').bind(subId, dateKey),
    ]

    for (const departure of departures) {
      const id = await reminderId({ subscriptionId: subId, dateKey, route, departure })
      statements.push(
        env.DB.prepare(
          `INSERT INTO reminders (id, subscription_id, date_key, route, departure, lead_minutes, sent_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`
        ).bind(id, subId, dateKey, route, departure, leadMinutes)
      )
    }

    await env.DB.batch(statements)
    return json({ ok: true, count: departures.length })
  } catch (e) {
    console.error('リマインドの保存に失敗しました', e)
    return json({ error: 'リマインドを保存できませんでした' }, 500)
  }
}

/**
 * その端末の当日ぶんの指定を返す。
 *
 * 端末を再起動しても、時刻表に「どの便を指定済みか」を復元できるようにするためのもの。
 * endpoint は推測困難な値なので、これを知っている＝本人とみなす。
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const endpoint = url.searchParams.get('endpoint')
  const dateKey = url.searchParams.get('dateKey')

  // endpoint はクエリ文字列に載せない方針もあるが、GET で本文は送れず、
  // 同一オリジンかつログに残るのは Cloudflare 側のみなので許容する
  if (!endpoint || !dateKey) return json({ error: 'endpoint と dateKey が必要です' }, 400)

  try {
    const subId = await subscriptionId(endpoint)
    const result = await env.DB.prepare(
      'SELECT route, departure, lead_minutes FROM reminders WHERE subscription_id = ? AND date_key = ?'
    )
      .bind(subId, dateKey)
      .all()

    return json({
      reminders: (result.results ?? []).map(r => {
        const row = r as Record<string, unknown>
        return { route: row.route, departure: row.departure, leadMinutes: Number(row.lead_minutes) }
      }),
    })
  } catch (e) {
    console.error('リマインドの取得に失敗しました', e)
    return json({ error: 'リマインドを取得できませんでした' }, 500)
  }
}
