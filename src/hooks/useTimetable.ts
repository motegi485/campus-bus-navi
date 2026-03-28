import { useState, useEffect } from 'react'
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

  const load = async (bustCache = false) => {
    setLoading(true)
    setError(null)
    try {
      const rules = await fetchJSON<CalendarRules>('/data/calendar_rules.json', bustCache)
      const todayId = resolveCalendar(rules, now)
      const tomorrowId = resolveCalendar(rules, now.add(1, 'day'))

      const [todayData, tomorrowData] = await Promise.all([
        fetchJSON<Timetable>(`/data/${todayId}.json`, bustCache),
        fetchJSON<Timetable>(`/data/${tomorrowId}.json`, bustCache).catch(() => null),
      ])

      setTimetable(todayData)
      setTomorrowTimetable(tomorrowData)
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  // 日付が変わったときのみ通常フェッチ（SW NetworkFirst が機能する）
  useEffect(() => {
    void load(false)
  }, [now.format('YYYY-MM-DD')]) // eslint-disable-line react-hooks/exhaustive-deps

  // 更新ボタン用: キャッシュバスター付きで強制再取得
  const refresh = () => load(true)

  return { timetable, tomorrowTimetable, loading, error, refresh }
}
