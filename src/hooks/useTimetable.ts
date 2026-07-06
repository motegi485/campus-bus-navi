import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import dayjs from 'dayjs'
import type { CalendarRules, Timetable } from '../types/timetable'
import { resolveCalendar } from '../utils/resolveCalendar'
import { normalizeTimetable } from '../utils/normalizeTimetable'

interface UseTimetableResult {
  timetable: Timetable | null
  tomorrowTimetable: Timetable | null
  loading: boolean
  error: string | null
  refresh: () => Promise<boolean>
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

  // データ取得済みかどうか。既にデータがある状態での再取得（手動更新・日付跨ぎ）は
  // 画面をスピナーに置き換えず、取得済みの表示を維持したまま裏で更新する
  const hasDataRef = useRef(false)

  const load = useCallback(async (bustCache = false): Promise<boolean> => {
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const rules = await fetchJSON<CalendarRules>('/data/calendar_rules.json', bustCache)
      const current = nowRef.current
      const todayId = resolveCalendar(rules, current)
      const tomorrowId = resolveCalendar(rules, current.add(1, 'day'))

      const [todayData, tomorrowData] = await Promise.all([
        fetchJSON<Timetable>(`/data/timetables/${todayId}.json`, bustCache).then(normalizeTimetable),
        fetchJSON<Timetable>(`/data/timetables/${tomorrowId}.json`, bustCache).then(normalizeTimetable).catch(() => null),
      ])

      setTimetable(todayData)
      hasDataRef.current = true
      setTomorrowTimetable(tomorrowData)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました')
      return false
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
