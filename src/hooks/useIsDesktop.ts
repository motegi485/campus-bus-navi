import { useState, useEffect } from 'react'
import { PC_BREAKPOINT_PX } from '../constants/layout'

const QUERY = `(min-width: ${PC_BREAKPOINT_PX}px)`

/**
 * PC レイアウト境界（1024px）以上かどうかを購読する。
 *
 * サイドバー自体の表示・非表示は index.css の `@media` だけで切り替えており、
 * このフックは使わない。JS 側の分岐が要るのは「見た目の入れ物そのものを
 * 別実装に切り替える」箇所（FullTimetableSheet のシート⇄中央モーダル切替）
 * だけに限定する。
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const handleChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  return isDesktop
}
