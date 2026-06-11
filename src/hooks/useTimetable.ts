import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import dayjs from 'dayjs'
import type { CalendarRules, Timetable } from '../types/timetable'
import { resolveCalendar } from '../utils/resolveCalendar'

interface UseTimetableResult {
  timetable: Timetable | null
  tomorrowTimetable: Timetable | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * キャッシュバスター付きフェッチ
 * CDN・SW両方のキャッシュを回避するため ?t=timestamp を付与
 */
async function fetchJSON<T>(path: string, bustCache = false): Promise<T> {
  const url = bustCache ? `${path}?t=${Date.now()}` : path
  const res = await fetch(url, bustCache ? { cache: 'reload' } : undefined)
  if (!res.ok) throw new Error(`${path} の取得に失敗しました (${res.status})`)
  return res.json() as Promise<T>
}

export function useTimetable(now: dayjs.Dayjs): UseTimetableResult {
  const [timetable, setTimetable] = useState<Timetable | null>(null)
  const [tomorrowTimetable, setTomorrowTimetable] = useState<Timetable | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 最新の now を ref で保持。load クロージャは ref 経由で参照することで
  // 「now が毎分変わるが、再フェッチは日付変化時のみ」を満たす
  const nowRef = useRef(now)
  nowRef.current = now

  // 日付キー。再フェッチのトリガーになる
  const dateKey = useMemo(() => now.format('YYYY-MM-DD'), [now])

  const load = useCallback(async (bustCache = false) => {
    setLoading(true)
    setError(null)
    try {
      const rules = await fetchJSON<CalendarRules>('/data/calendar_rules.json', bustCache)
      const current = nowRef.current
      const todayId = resolveCalendar(rules, current)
      const tomorrowId = resolveCalendar(rules, current.add(1, 'day'))

      const [todayData, tomorrowData] = await Promise.all([
        fetchJSON<Timetable>(`/data/timetables/${todayId}.json`, bustCache),
        fetchJSON<Timetable>(`/data/timetables/${tomorrowId}.json`, bustCache).catch(() => null),
      ])

      setTimetable(todayData)
      setTomorrowTimetable(tomorrowData)
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [])

  // 日付が変わったときのみ通常フェッチ（SW NetworkFirst が機能する）
  useEffect(() => {
    void load(false)
  }, [dateKey, load])

  // 更新ボタン用: キャッシュバスター付きで強制再取得
  const refresh = useCallback(() => load(true), [load])

  return { timetable, tomorrowTimetable, loading, error, refresh }
}
