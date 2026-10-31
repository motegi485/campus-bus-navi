/**
 * API レート制限の計数を持つ Durable Object（SQLite バックエンド）。
 *
 * - ApiRateLimitShard: IP 由来キー（SHA-256 の 16 進）ごとの 60 秒固定窓の数え。4 個に固定して振り分ける。
 *   IP ごとに DO を作らないのは、新しいキーごとに掃除の alarm（DO 要求と書込み）が要り、
 *   アドレスを替え続ける分散攻撃で 1 要求あたりの DO 消費が増えるため。シャードなら alarm の数は 4 個で頭打ち
 * - ApiDailyMutationBudget: 全利用者を合わせた変更系の 1 日の数え（1 個）
 *
 * 原子性: DO は単一スレッドで、入力ゲートにより同期区間へ他の要求は割り込めない。
 * そこで「読む → 判定 → 書く」を await を挟まずに行う。出力ゲートにより、書込みが確定する前に
 * 応答は返らない。拒否した要求の計数は書かない（掃除の alarm の予約は別）。
 *
 * DO 内で setTimeout / setInterval は使わない（休止を妨げ、Duration 課金が続くため）。
 * 古い行の掃除は alarm で行う。
 */

import { DurableObject } from 'cloudflare:workers'
import {
  WINDOW_MS, decideDailyBudget, decideIpWindow, isCounterKey, isPositiveInteger, utcDayKey,
} from './apiRateLimitWindow.js'

/** 通常の掃除間隔。行は通常約 20 分以内に消えるが、storage や alarm の障害時は遅れ得る */
const CLEANUP_DELAY_MS = 10 * 60_000

export interface CounterResult {
  allowed: boolean
  /** 拒否時は再試行までの秒数、許可時は 0 */
  retryAfter: number
}

export interface DailyUsage {
  day: string
  used: number
}

type CounterRow = { window_start: number; all_count: number; mutation_count: number }

export class ApiRateLimitShard extends DurableObject<unknown> {
  /** この instance が alarm の予約を確かめたか。退避・再生成されれば false から確かめ直す */
  private cleanupArmed = false

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS counters (
         key TEXT PRIMARY KEY,
         window_start INTEGER NOT NULL,
         all_count INTEGER NOT NULL,
         mutation_count INTEGER NOT NULL
       ) WITHOUT ROWID`
    )
  }

  async hit(key: unknown, isMutation: unknown, allLimit: unknown, mutationLimit: unknown): Promise<CounterResult> {
    if (!isCounterKey(key) || typeof isMutation !== 'boolean' || !isPositiveInteger(allLimit) || !isPositiveInteger(mutationLimit)) {
      throw new Error('rate-limit-input-unavailable')
    }
    // 掃除を予約できない状態で新しいハッシュを残さない。予約失敗は呼出し側で 503 になる。
    // await は計数の同期区間より前に置き、予約中に分を跨いだ場合も現在の窓で判定する。
    await this.armCleanup(Date.now())
    const sql = this.ctx.storage.sql
    const now = Date.now()
    // ここから書込みまで await を挟まない
    const row = sql.exec<CounterRow>(
      'SELECT window_start, all_count, mutation_count FROM counters WHERE key = ?', key
    ).toArray()[0]
    const stored = row === undefined
      ? null
      : { windowStart: Number(row.window_start), all: Number(row.all_count), mutation: Number(row.mutation_count) }
    const decision = decideIpWindow(stored, now, isMutation, { all: allLimit, mutation: mutationLimit })
    if (!decision.allowed) return { allowed: false, retryAfter: decision.retryAfter }
    const { windowStart, all, mutation } = decision.next
    sql.exec(
      `INSERT INTO counters (key, window_start, all_count, mutation_count) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         window_start = excluded.window_start,
         all_count = excluded.all_count,
         mutation_count = excluded.mutation_count`,
      key, windowStart, all, mutation
    )
    return { allowed: true, retryAfter: 0 }
  }

  /** 保存の前に掃除の alarm を確保する。失敗した要求ではハッシュを保存しない */
  private async armCleanup(now: number): Promise<void> {
    if (this.cleanupArmed) return
    try {
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + CLEANUP_DELAY_MS)
      this.cleanupArmed = true
    } catch {
      // IP やキー、storage の例外文言は RPC に渡さない。
      throw new Error('rate-limit-counter-failed')
    }
  }

  async alarm(): Promise<void> {
    // DELETE・COUNT・再予約のどこで失敗しても、次の hit では予約を確かめ直す。
    // 例外は投げ直し、Cloudflare の alarm の再試行にも任せる。
    this.cleanupArmed = false
    const sql = this.ctx.storage.sql
    const now = Date.now()
    const windowStart = now - (now % WINDOW_MS)
    sql.exec('DELETE FROM counters WHERE window_start < ?', windowStart)
    const remaining = Number(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM counters').one().n)
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(now + CLEANUP_DELAY_MS)
      this.cleanupArmed = true
    }
  }
}

export class ApiDailyMutationBudget extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS daily (
         day TEXT PRIMARY KEY,
         count INTEGER NOT NULL
       ) WITHOUT ROWID`
    )
  }

  consume(limit: unknown): CounterResult {
    if (!isPositiveInteger(limit)) throw new Error('rate-limit-input-unavailable')
    const sql = this.ctx.storage.sql
    const now = Date.now()
    const day = utcDayKey(now)
    // 同期区間のみ（await なし）
    const row = sql.exec<{ count: number }>('SELECT count FROM daily WHERE day = ?', day).toArray()[0]
    const decision = decideDailyBudget(row === undefined ? 0 : Number(row.count), limit, now)
    if (!decision.allowed) return { allowed: false, retryAfter: decision.retryAfter }
    // 日が変わった最初の許可で、前日以前の行を 1 文で消す（alarm は使わない）
    if (row === undefined) sql.exec('DELETE FROM daily WHERE day < ?', day)
    sql.exec('INSERT INTO daily (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1', day)
    if (decision.reachedLimit) {
      console.warn(`変更系の 1 日の上限 ${limit} 回に達しました（${day} UTC）。次の 00:00 UTC（JST 9:00）まで変更系は 429 になります`)
    }
    return { allowed: true, retryAfter: 0 }
  }

  usage(): DailyUsage {
    const day = utcDayKey(Date.now())
    const row = this.ctx.storage.sql.exec<{ count: number }>('SELECT count FROM daily WHERE day = ?', day).toArray()[0]
    return { day, used: row === undefined ? 0 : Number(row.count) }
  }
}
