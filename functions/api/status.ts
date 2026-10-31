/**
 * 配信の健全性を 1 回のリクエストで確かめるための集計（Cloudflare Pages Functions）。
 *
 * 無料枠を超えると該当する操作がエラーになるだけで、利用者からは「静かに壊れた」
 * ように見える。しかも日次枠のリセットは UTC 00:00 = **JST 09:00** なので、
 * 夜に枯れると最終便の通知が最も要る時間帯を含めて翌朝まで復旧しない。
 * その検知に使う。
 *
 * 運用者だけが使う。Pages の secret `STATUS_TOKEN`（32 文字以上）を合言葉にし、
 * `Authorization: Bearer <合言葉>` が一致しない要求は D1 に触れる前に 401 で返す。
 * 以前は無認証で、匿名の GET のたびに subscriptions と reminders を全件集計していたため、
 * 叩き続けるだけで D1 の読み取り枠を消費させられ、集計値も匿名に公開されていた。
 * STATUS_TOKEN が未設定（または短すぎる）なら 503 で、誰も通さない（フェイルクローズ）。
 *
 * 返すのは件数だけで、endpoint も鍵も個人を特定しうる値も含めない。
 * 例外の内容も返さない（スキーマ名やドライバの状態をクライアントへ渡さない）。
 * 詳細はサーバのログにだけ残す。
 *
 * 集計は 1 文にまとめる（以前は 4 本の COUNT を並べており、1 要求で D1 の読み取りが 4 回起きた）。
 */

import { toJst } from '../../server/src/schedule.js'
import { privateJson as json } from '../../server/src/apiRequest.js'
import { checkOperatorToken } from '../../server/src/operatorAuth.js'

interface Env {
  DB: D1Database
  /** 運用者の合言葉（Pages の secret）。値はリポジトリにも文書にも書かない */
  STATUS_TOKEN?: string
  /** 配信 Worker の名前付き RPC。mutationUsage は新 Worker だけが持つ */
  API_RATE_LIMITER?: {
    mutationUsage?(): Promise<unknown>
  }
}

interface MutationBudget {
  day: string
  used: number
  limit: number
}

/** 全利用者を合わせた変更系の 1 日の上限に対する、この割合以上で警告する */
const MUTATION_BUDGET_WARNING_RATIO = 0.8

function parseMutationBudget(raw: unknown): MutationBudget | null {
  const value = raw as { day?: unknown; used?: unknown; limit?: unknown } | null | undefined
  if (typeof value?.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return null
  const { used, limit } = value
  if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0) return null
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) return null
  return { day: value.day, used, limit }
}

/**
 * 変更系の当日の消費数を Worker から読む。失敗（旧 Worker でメソッドが無い場合を含む）・不正値は null。
 * 状態 API 全体は落とさない。
 */
async function readMutationBudget(env: Env): Promise<MutationBudget | null> {
  const limiter = env.API_RATE_LIMITER
  if (typeof limiter?.mutationUsage !== 'function') return null
  try {
    // RPC スタブの this を保つため、メソッドとして呼ぶ
    return parseMutationBudget(await limiter.mutationUsage())
  } catch (e) {
    console.error('変更系の 1 日の消費数を取得できませんでした', e instanceof Error ? e.message : typeof e)
    return null
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // D1 に触れる前に判定する
  const auth = await checkOperatorToken(request.headers.get('Authorization'), env.STATUS_TOKEN)
  if (auth === 'unconfigured') return json({ error: '状態 API は設定されていません' }, 503)
  if (auth === 'denied') {
    const response = json({ error: '認証が必要です' }, 401)
    response.headers.set('WWW-Authenticate', 'Bearer')
    return response
  }

  const nowMs = Date.now()
  const today = toJst(nowMs).dateKey
  // D1 の集計と並行して読む（readMutationBudget は reject しない）
  const budgetPromise = readMutationBudget(env)

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
    const mutationBudget = await budgetPromise
    if (mutationBudget !== null && mutationBudget.used / mutationBudget.limit >= MUTATION_BUDGET_WARNING_RATIO) {
      warnings.push('本日の変更要求が上限の 80% を超えました')
    }

    return json({
      today,
      devices: count('devices'),
      remindersToday: count('today_total'),
      sentToday: count('today_sent'),
      pendingToday: count('today_total') - count('today_sent'),
      staleReminders: staleCount,
      overdueReminders: overdueCount,
      // 全利用者を合わせた変更系の 1 日の消費数（UTC 日）。取得できなければ null
      mutationBudget,
      warning: warnings.length > 0 ? warnings.join(' / ') : null,
    })
  } catch (e) {
    // D1 の無料枠を使い切ったときもここに来る。理由はログにだけ残す
    console.error('状態の取得に失敗しました', e)
    return json({ error: 'D1 にアクセスできませんでした' }, 500)
  }
}
