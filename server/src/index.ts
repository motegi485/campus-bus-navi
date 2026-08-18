/**
 * 発車リマインダーの配信 Worker。
 *
 * Cron Trigger（1 分ごと）で起動し、次を行う:
 *   0. 毎時 00 分の回で、前日以前の指定を掃除する（送信対象の有無とは独立）
 *   1. 今日ぶんで未送信、かつ送信開始時刻（notify_at）を過ぎた行を早い順に引く
 *   2. 当日のダイヤを解決する（運休日・特別ダイヤなら何も送らない）
 *   3. いま送るべき購読を選ぶ（純関数 selectDue）
 *   4. 40 件ずつ Durable Object へ分配して送らせる
 *
 * 「送らないのが正しい状態」（運休日・特別ダイヤ・対象 0 件）と、「送れない障害」
 * （静的データの取得失敗・DO の失敗・D1 への記録失敗）を区別する。後者は throw して
 * Cron の実行を失敗させる。ログへ畳むと、通知が止まっていることに誰も気づけない。
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

/**
 * 静的データの取得。失敗は握りつぶさず投げる。
 *
 * 以前は null を返して「この回は送信しない」で終えていたが、取得経路が壊れても
 * Cron の実行結果は成功のままで、通知が止まっていることに気づけなかった。
 * 送らない判断（運休日など）と、送れない障害は区別する。
 */
async function fetchJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } })
  } catch (e) {
    throw new Error(`${url} を取得できませんでした: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!response.ok) throw new Error(`${url} の取得に失敗しました (HTTP ${response.status})`)
  return (await response.json()) as T
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
  const nowMs = Date.now()

  // 前日以前の指定を消す。**送信対象の有無とは独立に**毎時 00 分の回で必ず走らせる。
  // 以前は「当日行が 0 件の 00:00 の回」でしか走らず、00:00 に当日行が 1 件でもあるか、
  // Cron が 00:01 以降にずれるか、削除が一度失敗するだけで前日ぶんが残り続けた。
  // 利用者へは「日付が変わると削除」と説明しているので、その保証を実装側に持たせる。
  // ⚠️ JstMoment.minutes は「0 時からの通算分」。`=== 0` は JST 00:00 の回だけを指し、
  //    毎時 00 分にはならない（1 日 1 回に戻ってしまう）。剰余で「毎時 00 分」を表す。
  if (now.minutes % 60 === 0) await cleanupOldReminders(env, now.dateKey)

  // 今日ぶんで未送信、かつ送信開始時刻を過ぎた行だけを、早い順に引く。
  // 索引 idx_reminders_pending (date_key, sent_at, notify_at) が効く。
  // ORDER BY が無いと、上限内を未到来の行が占めたときに本当に送るべき行を読まない。
  // 端末の鍵は要らない（ペイロードなし push なので endpoint だけで送れる）
  const query = await env.DB.prepare(
    `SELECT r.id, r.date_key, r.route, r.departure, r.lead_minutes, s.endpoint
       FROM reminders r
       JOIN subscriptions s ON s.id = r.subscription_id
      WHERE r.date_key = ? AND r.sent_at IS NULL AND r.notify_at <= ?
      ORDER BY r.notify_at
      LIMIT ?`
  )
    .bind(now.dateKey, nowMs, MAX_REMINDERS_PER_RUN)
    .all()

  const reminders = (query.results ?? []).map(r => toReminderRow(r as Record<string, unknown>))
  // 対象が 0 件の分は、ダイヤの取得すらせずに終える（無駄なサブリクエストを出さない）
  if (reminders.length === 0) return

  // 取得できなければ throw して Cron を失敗させる（通知が止まったことを検知可能にする）
  const rules = await fetchJson<CalendarRules>(`${env.SITE_ORIGIN}/data/calendar_rules.json`)
  const timetableId = resolveTimetableId(rules, now.dateKey, now.weekday)
  const timetable = await fetchJson<Timetable>(`${env.SITE_ORIGIN}/data/timetables/${timetableId}.json`)

  const { due, reason } = selectDue({ reminders, timetable, timetableId, now })
  if (due.length === 0) {
    // 運休日・特別ダイヤは「送らないのが正しい」状態。件数 0 の理由を残す
    if (reason !== 'ok') console.log(`送信対象なし (${reason} / ${timetableId})`)
    return
  }

  const batches = splitIntoBatches(due)
  console.log(`送信対象 ${due.length} 件 / ${batches.length} バッチ (${timetableId})`)

  // バッチごとに別の DO を使う。同じ名前を使い回すと 1 つの DO に直列化され、
  // サブリクエストの枠を分ける意味が無くなる
  const outcomes = await Promise.all(
    batches.map(async (batch, index) => {
      const stub = env.SENDER.get(env.SENDER.idFromName(`${now.dateKey}-${now.minutes}-${index}`))
      try {
        const response = await stub.fetch('https://sender/send', {
          method: 'POST',
          body: JSON.stringify({ targets: batch.map(r => ({ id: r.id, endpoint: r.endpoint })) }),
        })
        // DO 側が結果の記録に失敗すると 500 を返す。成功として数えない
        if (!response.ok) {
          console.error(`バッチ ${index} が失敗を報告しました (HTTP ${response.status})`)
          return false
        }
        return true
      } catch (e) {
        // 1 バッチの失敗で他のバッチを巻き込まない（送信自体は最後まで走らせる）
        console.error(`バッチ ${index} の送信に失敗しました`, e)
        return false
      }
    })
  )

  // 送りきったうえで、失敗があれば実行そのものを失敗させる。
  // ここで畳むと Cron の実行結果は成功のままになり、配信停止に気づけない
  const failed = outcomes.filter(ok => !ok).length
  if (failed > 0) throw new Error(`${failed}/${batches.length} バッチの送信または記録に失敗しました`)
}

/**
 * 前日以前のリマインドを消す。当日限りなので溜めない。
 *
 * 失敗しても投げない（掃除の失敗で当日の配信を止めない）。次の毎時実行で再試行され、
 * それでも残り続ける状態は /api/status の staleReminders から見える。
 */
async function cleanupOldReminders(env: Env, todayKey: string): Promise<void> {
  try {
    const result = await env.DB.prepare('DELETE FROM reminders WHERE date_key < ?').bind(todayKey).run()
    const removed = result.meta?.changes ?? 0
    if (removed > 0) console.log(`過去のリマインドを ${removed} 件削除しました`)
  } catch (e) {
    console.error('過去のリマインドの削除に失敗しました', e)
  }
}
