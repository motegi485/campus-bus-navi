/**
 * 配信の健全性を 1 回のリクエストで確かめるための集計（Cloudflare Pages Functions）。
 *
 * 無料枠を超えると該当する操作がエラーになるだけで、利用者からは「静かに壊れた」
 * ように見える。しかも日次枠のリセットは UTC 00:00 = **JST 09:00** なので、
 * 夜に枯れると最終便の通知が最も要る時間帯を含めて翌朝まで復旧しない。
 * その検知に使う。
 *
 * 返すのは件数だけで、endpoint も鍵も個人を特定しうる値も含めない。
 */

interface Env {
  DB: D1Database
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** JST の "YYYY-MM-DD"。Worker と同じ +9 時間固定の計算 */
function jstDateKey(epochMs: number): string {
  const shifted = new Date(epochMs + 9 * 60 * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const today = jstDateKey(Date.now())

  try {
    const [devices, todayTotal, todaySent, stale] = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions'),
      env.DB.prepare('SELECT COUNT(*) AS n FROM reminders WHERE date_key = ?').bind(today),
      env.DB.prepare('SELECT COUNT(*) AS n FROM reminders WHERE date_key = ? AND sent_at IS NOT NULL').bind(today),
      // 前日以前が残っていたら掃除が動いていない兆候。Cron が止まっている可能性がある
      env.DB.prepare('SELECT COUNT(*) AS n FROM reminders WHERE date_key < ?').bind(today),
    ])

    const count = (result: D1Result) => Number((result.results?.[0] as { n?: unknown } | undefined)?.n ?? 0)
    const staleCount = count(stale)

    return json({
      today,
      devices: count(devices),
      remindersToday: count(todayTotal),
      sentToday: count(todaySent),
      pendingToday: count(todayTotal) - count(todaySent),
      staleReminders: staleCount,
      // 前日以前が残っている＝日付が変わる分の掃除が走っていない。Cron を疑う
      warning: staleCount > 0 ? '前日以前のリマインドが残っています。Cron が動いているか確認してください' : null,
    })
  } catch (e) {
    console.error('状態の取得に失敗しました', e)
    // D1 の無料枠を使い切ったときもここに来る。理由を残す
    return json({ error: 'D1 にアクセスできませんでした', detail: e instanceof Error ? e.message : String(e) }, 500)
  }
}
