/**
 * 発車リマインダーの配信 Worker。
 *
 * Cron Trigger（1 分ごと）で起動し、次を行う:
 *   1. 今日まだ送っていない購読を D1 から引く
 *   2. 当日のダイヤを解決する（運休日・特別ダイヤなら何も送らない）
 *   3. いま送るべき購読を選ぶ（純関数 selectDue）
 *   4. 40 件ずつ Durable Object へ分配して送らせる
 *
 * 4 の分配が要るのは、Workers 無料枠が 1 実行あたり外部サブリクエスト 50 件までで、
 * push 送信 1 件がちょうど 1 サブリクエストだから。DO の実行はそれぞれ独立した実行に
 * なるので、各自 50 件の枠を持つ。DO への呼び出しは Cloudflare サービス向けの枠
 * （1,000 件）を使うため、ここでは上限に当たらない。
 */

import { selectDue, splitIntoBatches, toJst, resolveTimetableId } from './schedule.js'
import { toReminderRow } from './subscription.js'
import type { CalendarRules, Timetable } from '../../src/types/timetable'

export { ReminderSender } from './sender.js'

export interface Env {
  DB: D1Database
  SENDER: DurableObjectNamespace
  /** 静的データの取得元。例: https://campus-bus-navi.pages.dev */
  SITE_ORIGIN: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
}

/** 1 実行で扱うリマインドの上限。想定規模（数百人）を大きく超えたときの暴走止め */
const MAX_REMINDERS_PER_RUN = 2000

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

export default {
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // waitUntil ではなく await する。waitUntil だと run() が投げても Cron の実行結果は
    // 成功として記録され、通知が止まっていることに気づけない
    try {
      await run(env)
    } catch (e) {
      console.error('配信処理が失敗しました', e)
      throw e
    }
  },
}

async function run(env: Env): Promise<void> {
  const now = toJst(Date.now())

  // 今日ぶんで未送信のリマインドだけを引く。索引 idx_reminders_pending が効く。
  // 端末の鍵は要らない（ペイロードなし push なので endpoint だけで送れる）
  const query = await env.DB.prepare(
    `SELECT r.id, r.date_key, r.route, r.departure, r.lead_minutes, s.endpoint
       FROM reminders r
       JOIN subscriptions s ON s.id = r.subscription_id
      WHERE r.date_key = ? AND r.sent_at IS NULL
      LIMIT ?`
  )
    .bind(now.dateKey, MAX_REMINDERS_PER_RUN)
    .all()

  const reminders = (query.results ?? []).map(r => toReminderRow(r as Record<string, unknown>))
  // 対象が 0 件の分は、ダイヤの取得すらせずに終える（無駄なサブリクエストを出さない）
  if (reminders.length === 0) {
    // 日付が変わったタイミングで、前日以前の指定を掃除する（当日限りなので残さない）
    if (now.minutes === 0) await cleanupOldReminders(env, now.dateKey)
    return
  }

  const rules = await fetchJson<CalendarRules>(`${env.SITE_ORIGIN}/data/calendar_rules.json`)
  if (!rules) {
    console.error('calendar_rules.json を取得できませんでした。この回は送信しません')
    return
  }

  const timetableId = resolveTimetableId(rules, now.dateKey, now.weekday)
  const timetable = await fetchJson<Timetable>(`${env.SITE_ORIGIN}/data/timetables/${timetableId}.json`)

  const { due, reason } = selectDue({ reminders, timetable, timetableId, now })
  if (due.length === 0) {
    // 運休日・特別ダイヤ・取得失敗は「送らないのが正しい」状態。件数 0 の理由を残す
    if (reason !== 'ok') console.log(`送信対象なし (${reason} / ${timetableId})`)
    return
  }

  const batches = splitIntoBatches(due)
  console.log(`送信対象 ${due.length} 件 / ${batches.length} バッチ (${timetableId})`)

  // バッチごとに別の DO を使う。同じ名前を使い回すと 1 つの DO に直列化され、
  // サブリクエストの枠を分ける意味が無くなる
  await Promise.all(
    batches.map((batch, index) => {
      const stub = env.SENDER.get(env.SENDER.idFromName(`${now.dateKey}-${now.minutes}-${index}`))
      return stub
        .fetch('https://sender/send', {
          method: 'POST',
          body: JSON.stringify({ targets: batch.map(r => ({ id: r.id, endpoint: r.endpoint })) }),
        })
        .catch(e => {
          // 1 バッチの失敗で他のバッチを巻き込まない
          console.error(`バッチ ${index} の送信に失敗しました`, e)
        })
    })
  )
}

/** 前日以前のリマインドを消す。当日限りなので溜めない */
async function cleanupOldReminders(env: Env, todayKey: string): Promise<void> {
  try {
    const result = await env.DB.prepare('DELETE FROM reminders WHERE date_key < ?').bind(todayKey).run()
    const removed = result.meta?.changes ?? 0
    if (removed > 0) console.log(`過去のリマインドを ${removed} 件削除しました`)
  } catch (e) {
    console.error('過去のリマインドの削除に失敗しました', e)
  }
}
