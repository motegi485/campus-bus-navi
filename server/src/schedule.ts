/**
 * 「いま誰に送るべきか」を決める純関数群。
 *
 * Cloudflare のランタイムにも D1 にも依存しないので、vitest から直接検証できる。
 * 時刻は引数で受け取る（Date.now() を内部で呼ばない）。
 *
 * 型と命名規約はフロントエンドと同じ定義を参照する。時刻表の契約を
 * サーバ側で写し取ると、Bot との契約と同種の乖離が生まれるため。
 */

import type { CalendarRules, RouteKey, ScheduleEntry, Timetable } from '../../src/types/timetable'
import { hasDepartures, resolveDiagramType } from '../../src/utils/diagramType'

/** 通知の対象。最終便は日によって時刻が変わるのでサーバ側で解決する */
export type ReminderMode = 'last_bus' | 'fixed_time'

/** D1 の subscriptions テーブル 1 行 */
export interface SubscriptionRow {
  id: string
  endpoint: string
  route: RouteKey
  mode: ReminderMode
  /** mode === 'fixed_time' のときの "HH:mm"。それ以外は null */
  departure: string | null
  leadMinutes: number
  /** 曜日ビットマスク。日=1, 月=2, 火=4, 水=8, 木=16, 金=32, 土=64 */
  daysMask: number
  /** 最後に送信した日（"YYYY-MM-DD"）。同じ日に二度送らないための番人 */
  lastSentOn: string | null
}

/** 平日（月〜金）のマスク。UI の既定値 */
export const WEEKDAYS_MASK = 0b0111110
/** 毎日 */
export const EVERYDAY_MASK = 0b1111111

// ── JST ─────────────────────────────────────────────────────────────────────
// Worker は UTC で動く。日付・曜日・分はすべて JST で判断する必要がある。

export interface JstMoment {
  /** "YYYY-MM-DD" */
  dateKey: string
  /** 0=日 … 6=土 */
  weekday: number
  /** 0 時からの通算分 */
  minutes: number
}

/** epoch ミリ秒を JST の日付・曜日・通算分に落とす */
export function toJst(epochMs: number): JstMoment {
  const shifted = new Date(epochMs + 9 * 60 * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return {
    dateKey: `${y}-${m}-${d}`,
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

// ── ダイヤの解決 ─────────────────────────────────────────────────────────────

/**
 * 適用すべき時刻表 ID を返す。
 * src/utils/resolveCalendar.ts と同じ規則（overrides > 曜日ルール）だが、
 * あちらは dayjs を受け取るため、こちらは日付キーと曜日で受ける。
 */
export function resolveTimetableId(rules: CalendarRules, dateKey: string, weekday: number): string {
  if (rules.overrides?.[dateKey]) return rules.overrides[dateKey]
  return rules.default_rules?.[String(weekday)] ?? 'timetable_weekday'
}

/** "HH:mm" を通算分に。src/utils/parseTime.ts と同じ規則（2 桁固定・範囲検査） */
export function parseHHmmToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

/** 不正な departure を除いた発車分の昇順配列 */
function departureMinutes(schedule: ScheduleEntry[] | undefined): number[] {
  if (!Array.isArray(schedule)) return []
  return schedule
    .map(entry => parseHHmmToMinutes(entry?.departure))
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b)
}

// ── 送信対象の抽出 ───────────────────────────────────────────────────────────

export interface DueSelection {
  /** いま送るべき購読 */
  due: SubscriptionRow[]
  /** 送らなかった理由（ログ・監視用。運休日などで 0 件になったときの判別に使う） */
  reason: 'ok' | 'no-timetable' | 'no-departures'
}

/**
 * いま通知を送るべき購読を選ぶ。
 *
 * 送信の窓は `[目標時刻 - リード分, 目標時刻)` とし、ちょうどの分だけを見ない。
 * Cron は 1 分間隔だが実行が遅れることがあり、等号一致にすると遅延した回で
 * 取りこぼす。窓にしておけば遅れても送れる（通知の文面は受信側の SW が
 * 実時刻から組み立てるので、遅れても「あと N 分」は正しいまま）。
 * 二重送信は lastSentOn が防ぐ。
 */
export function selectDue(params: {
  subscriptions: SubscriptionRow[]
  timetable: Timetable | null
  timetableId: string
  now: JstMoment
}): DueSelection {
  const { subscriptions, timetable, timetableId, now } = params

  // 時刻表が取れていない日は何も送らない（推測して送らない）
  if (!timetable) return { due: [], reason: 'no-timetable' }

  // 運休日・特別ダイヤには送らない（存在しない便を知らせない）
  if (!hasDepartures(resolveDiagramType(timetableId))) {
    return { due: [], reason: 'no-departures' }
  }

  const byRoute = new Map<RouteKey, number[]>()
  const minutesFor = (route: RouteKey): number[] => {
    let cached = byRoute.get(route)
    if (!cached) {
      cached = departureMinutes(timetable.routes?.[route]?.schedule)
      byRoute.set(route, cached)
    }
    return cached
  }

  const due = subscriptions.filter(sub => {
    // 同じ日に二度送らない
    if (sub.lastSentOn === now.dateKey) return false
    // 曜日の絞り込み
    if ((sub.daysMask & (1 << now.weekday)) === 0) return false

    const minutes = minutesFor(sub.route)
    if (minutes.length === 0) return false

    let target: number | undefined
    if (sub.mode === 'last_bus') {
      target = minutes[minutes.length - 1]
    } else {
      const wanted = parseHHmmToMinutes(sub.departure)
      // 当日のダイヤにその便が実在するときだけ送る（ダイヤ差し替えで消えた便は無視）
      target = wanted !== null && minutes.includes(wanted) ? wanted : undefined
    }
    if (target === undefined) return false

    return now.minutes >= target - sub.leadMinutes && now.minutes < target
  })

  return { due, reason: 'ok' }
}

/**
 * 送信バッチを分割する。
 *
 * Workers 無料枠は 1 実行あたり外部サブリクエスト 50 件まで。push 送信 1 件が
 * 1 サブリクエストなので、これを超える分は別の実行（Durable Object）へ渡す。
 * 上限ちょうどではなく余裕を持たせる（ダイヤ取得の fetch も同じ枠を消費するため）。
 */
export const BATCH_SIZE = 40

export function splitIntoBatches<T>(items: T[], size = BATCH_SIZE): T[][] {
  if (size <= 0) throw new Error('バッチサイズは 1 以上でなければなりません')
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}
