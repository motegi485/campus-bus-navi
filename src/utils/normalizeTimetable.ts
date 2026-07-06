import type { Timetable, RouteKey } from '../types/timetable'
import { parseHHmmToMinutes } from './parseTime'

const ROUTE_KEYS: RouteKey[] = ['station_to_campus', 'campus_to_station']

/** 構造を検証し、不正エントリ除去と発車時刻の昇順ソートを行う。構造不正なら throw */
export function normalizeTimetable(data: Timetable): Timetable {
  if (!data || typeof data.id !== 'string' || !data.routes) {
    throw new Error('時刻表データの形式が不正です')
  }
  for (const key of ROUTE_KEYS) {
    const route = data.routes[key]
    if (!route || !Array.isArray(route.schedule)) {
      throw new Error(`時刻表データの形式が不正です (${data.id}: ${key})`)
    }
    route.schedule = route.schedule
      .filter(e => {
        const ok = parseHHmmToMinutes(e?.departure) !== null
        if (!ok) console.warn(`不正な departure を除外しました: ${JSON.stringify(e)}`)
        return ok
      })
      .sort((a, b) => parseHHmmToMinutes(a.departure)! - parseHHmmToMinutes(b.departure)!)
  }
  return data
}
