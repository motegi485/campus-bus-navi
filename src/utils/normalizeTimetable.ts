import type { Timetable, RouteKey } from '../types/timetable'
import { parseHHmmToMinutes } from './parseTime'
import { hasDepartures, resolveDiagramType } from './diagramType'

const ROUTE_KEYS: RouteKey[] = ['station_to_campus', 'campus_to_station']

/**
 * 構造を検証し、不正エントリ除去と発車時刻の昇順ソートを行う。構造不正なら throw。
 *
 * 不正な entry を落として表示を続けるのは、一部が壊れていても読める便は見せるため。
 * ただし**全件落ちたときは意味が変わる**。空 `schedule` は運休日・特別ダイヤ専用の
 * 表現なので、そのまま返すと App が「本日の運行はありません」と断定してしまう
 * （配信後の破損・キャッシュ破損を運休と逆案内する）。
 *
 * `scripts/validate-data.mjs` は追跡データに対して同じ規則でビルドを止めている。
 * ここはその規則をランタイムにも置いたもので、呼び出し側（useTimetable /
 * useWeekTimetables）は throw を捕まえて「取得できません」へ落ちる。
 */
export function normalizeTimetable(data: Timetable): Timetable {
  if (!data || typeof data.id !== 'string' || !data.routes) {
    throw new Error('時刻表データの形式が不正です')
  }
  // 空 schedule を正当な表現として許す ID か（運休日・特別ダイヤ）
  const emptyByDesign = !hasDepartures(resolveDiagramType(data.id))

  for (const key of ROUTE_KEYS) {
    const route = data.routes[key]
    if (!route || !Array.isArray(route.schedule)) {
      throw new Error(`時刻表データの形式が不正です (${data.id}: ${key})`)
    }
    const before = route.schedule.length
    route.schedule = route.schedule
      .filter(e => {
        const ok = parseHHmmToMinutes(e?.departure) !== null
        if (!ok) console.warn(`不正な departure を除外しました: ${JSON.stringify(e)}`)
        return ok
      })
      .sort((a, b) => parseHHmmToMinutes(a.departure)! - parseHHmmToMinutes(b.departure)!)

    if (!emptyByDesign && route.schedule.length === 0) {
      throw new Error(
        `時刻表データが壊れています (${data.id}: ${key} の発車時刻を ${before} 件すべて読み取れませんでした)`
      )
    }
  }
  return data
}
