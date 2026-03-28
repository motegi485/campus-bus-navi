import { useState, useEffect } from 'react'
import type { NewsItem } from '../types/timetable'

interface UseNewsResult {
  news: NewsItem[]
  loading: boolean
  error: string | null
}

/**
 * public/data/news.json をフェッチして返す
 * お知らせはGitOps管理のJSONから取得（コンポーネント内ハードコードなし）
 */
export function useNews(): UseNewsResult {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const cacheBuster = `?t=${Date.now()}`
        const res = await fetch(`/data/news.json${cacheBuster}`, { cache: 'reload' })
        if (!res.ok) throw new Error('news.json の取得に失敗しました')
        const data: NewsItem[] = await res.json()
        if (!cancelled) setNews(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'エラーが発生しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  return { news, loading, error }
}
