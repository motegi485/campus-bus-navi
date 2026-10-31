/**
 * Pages Functions から、同じデプロイの静的ファイル（ASSETS）で当日のダイヤを読む。
 *
 * 予約の受理時に「その便が当日の時刻表に実在するか」を確かめるために使う
 * （functions/api/reminders.ts）。ASSETS は同じデプロイの public/data を返すので、
 * 利用者が見ている時刻表と検査の正本が一致する。
 *
 * 取得や解釈に失敗したら throw する。呼び出し側は「検査できない」として保存を拒否する
 * （フェイルクローズ）。推測で受理すると、送られない行を作らせる穴が残るため。
 */

import type { CalendarRules, Timetable } from '../../src/types/timetable'
import { resolveTimetableId, type JstMoment } from './schedule.js'

/** Pages の env.ASSETS のうち、ここで使う部分だけ */
export interface AssetFetcher {
  fetch(input: string): Promise<Response>
}

/**
 * 時刻表 ID の形。calendar_rules の値をパスへ埋め込む前の多層防御
 * （`../` などで別のファイルを読ませない）。
 */
const TIMETABLE_ID = /^timetable_[a-z0-9_]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(assets: AssetFetcher, url: URL): Promise<unknown> {
  const response = await assets.fetch(url.toString())
  if (!response.ok) throw new Error(`${url.pathname} の取得に失敗しました (HTTP ${response.status})`)
  // SPA フォールバックで index.html が返る場合は、ここで構文エラーとして throw される
  return (await response.json()) as unknown
}

/**
 * 当日（now の日付・曜日）のダイヤを読む。
 * `base` はリクエストの URL。ASSETS へは同じオリジンの絶対 URL で問い合わせる。
 */
export async function loadTimetableFor(
  assets: AssetFetcher,
  base: string,
  now: JstMoment
): Promise<{ timetableId: string; timetable: Timetable }> {
  const rules = await readJson(assets, new URL('/data/calendar_rules.json', base))
  if (!isRecord(rules)) throw new Error('invalid-calendar-rules')

  const timetableId: unknown = resolveTimetableId(rules as unknown as CalendarRules, now.dateKey, now.weekday)
  if (typeof timetableId !== 'string' || !TIMETABLE_ID.test(timetableId)) throw new Error('invalid-timetable-id')

  const timetable = await readJson(assets, new URL(`/data/timetables/${timetableId}.json`, base))
  if (!isRecord(timetable) || !isRecord(timetable.routes)) throw new Error('invalid-timetable')

  return { timetableId, timetable: timetable as unknown as Timetable }
}
