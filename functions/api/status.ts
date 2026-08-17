/**
 * 配信の健全性を 1 回のリクエストで確かめるための集計（Cloudflare Pages Functions）。
 *
 * 無料枠を超えると該当する操作がエラーになるだけで、利用者からは「静かに壊れた」
 * ように見える。しかも日次枠のリセットは UTC 00:00 = **JST 09:00** なので、
 * 夜に枯れると最終便の通知が最も要る時間帯を含めて翌朝まで復旧しない。
 * その検知に使う。
 *
 * 返すのは件数だけで、endpoint も鍵も個人を特定しうる値も含めない。
 * 例外の内容も返さない（無認証の公開エンドポイントなので、スキーマ名や
 * ドライバの状態を匿名クライアントへ渡さない）。詳細はサーバのログにだけ残す。
 *
 * 集計は 1 文にまとめる。以前は 4 本の COUNT を並べており、公開エンドポイントを
 * 叩くだけで D1 の読み取りを 4 回発生させられた。
 */

import { toJst } from '../../server/src/schedule.js'

interface Env {
  DB: D1Database
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const nowMs = Date.now()
  const today = toJst(nowMs).dateKey

  try {
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM subscriptions) AS devices,
         SUM(CASE WHEN date_key = ?1 THEN 1 ELSE 0 END) AS today_total,
         SUM(CASE WHEN date_key = ?1 AND sent_at IS NOT NULL THEN 1 ELSE 0 END) AS today_sent,
         -- 前日以前が残っていたら掃除が動いていない兆候。Cron が止まっている可能性がある
         SUM(CASE WHEN date_key < ?1 THEN 1 ELSE 0 END) AS stale,
         -- 発車時刻を過ぎたのに未送信のまま残っている当日行。配信が止まった兆候。
         -- ただし運休日・特別ダイヤ・ダイヤ差し替えで消えた便では正常に増える
         SUM(CASE WHEN date_key = ?1 AND sent_at IS NULL AND notify_at + lead_minutes * 60000 < ?2
                  THEN 1 ELSE 0 END) AS overdue
       FROM reminders`
    )
      .bind(today, nowMs)
      .first<Record<string, unknown>>()

    const count = (key: string) => Number(row?.[key] ?? 0)
    const staleCount = count('stale')
    const overdueCount = count('overdue')

    const warnings: string[] = []
    if (staleCount > 0) {
      warnings.push('前日以前のリマインドが残っています。Cron が動いているか確認してください')
    }
    if (overdueCount > 0) {
      warnings.push(
        '発車時刻を過ぎても未送信の指定があります。運休日・特別ダイヤ・ダイヤ差し替えでなければ配信を確認してください'
      )
    }

    return json({
      today,
      devices: count('devices'),
      remindersToday: count('today_total'),
      sentToday: count('today_sent'),
      pendingToday: count('today_total') - count('today_sent'),
      staleReminders: staleCount,
      overdueReminders: overdueCount,
      warning: warnings.length > 0 ? warnings.join(' / ') : null,
    })
  } catch (e) {
    // D1 の無料枠を使い切ったときもここに来る。理由はログにだけ残す
    console.error('状態の取得に失敗しました', e)
    return json({ error: 'D1 にアクセスできませんでした' }, 500)
  }
}
