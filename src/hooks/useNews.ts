import { useState, useEffect, useCallback, useRef } from 'react'
import type { NewsItem } from '../types/timetable'

const READ_IDS_KEY = 'campusBusNaviNewsReadIds'

interface UseNewsResult {
  news: NewsItem[]
  loading: boolean
  error: string | null
  readIds: Set<number>
  markAsRead: (id: number) => void
  /** 取得に失敗したときの再取得（useWeekTimetables の reload と同じ形） */
  reload: () => Promise<void>
}

function loadReadIds(): Set<number> {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is number => typeof v === 'number'))
  } catch {
    return new Set()
  }
}

function saveReadIds(ids: Set<number>): void {
  try {
    localStorage.setItem(READ_IDS_KEY, JSON.stringify([...ids]))
  } catch {
    // localStorage 利用不可環境でも動作は継続
  }
}

/**
 * public/data/news.json をフェッチして返す
 * 既読 ID は localStorage に永続化する
 */
export function useNews(): UseNewsResult {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<number>>(loadReadIds)
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/data/news.json')
      if (!res.ok) throw new Error('news.json の取得に失敗しました')
      const data: NewsItem[] = await res.json()
      if (!cancelledRef.current) setNews(data)
    } catch (e) {
      if (!cancelledRef.current) setError(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    void load()
    return () => { cancelledRef.current = true }
  }, [load])

  const markAsRead = useCallback((id: number) => {
    setReadIds(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      saveReadIds(next)
      return next
    })
  }, [])

  return { news, loading, error, readIds, markAsRead, reload: load }
}
