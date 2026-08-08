import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import dayjs from 'dayjs'
import type { CalendarRules, Timetable } from '../types/timetable'
import { resolveCalendar } from '../utils/resolveCalendar'
import { normalizeTimetable } from '../utils/normalizeTimetable'

/**
 * SW のランタイムキャッシュ名。vite.config.ts の
 * runtimeCaching[0].options.cacheName と一致させること。
 */
const DATA_CACHE = 'timetable-data'

/** 取得済みデータ。「いつの分か」を必ず一緒に持ち、日付跨ぎで前日の時刻を出さないようにする */
interface TimetableData {
  /** この timetable が対象とする日付（YYYY-MM-DD） */
  dateKey: string
  /** prefetch した tomorrowTimetable が対象とする日付 */
  tomorrowDateKey: string
  timetable: Timetable
  tomorrowTimetable: Timetable | null
}

interface UseTimetableResult {
  timetable: Timetable | null
  tomorrowTimetable: Timetable | null
  loading: boolean
  error: string | null
  /** 保持中データの対象日が今日と違う（＝表示してはいけない） */
  stale: boolean
  refresh: () => Promise<boolean>
}

/**
 * 手動更新で取得した内容を、素の URL のキャッシュエントリにも書き込む。
 *
 * Cache API のマッチングは既定でクエリ文字列を無視しないため、`?t=` 付きで取得した
 * レスポンスは SW のキャッシュでは別キーになる。これを行わないと「更新ボタンを
 * 押した直後にオフラインで起動すると旧ダイヤに戻る」（通常起動は素の URL を要求し、
 * NetworkFirst が前回の素の URL のエントリへフォールバックするため）。
 */
async function putCanonical(path: string, res: Response): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(DATA_CACHE)
    await cache.put(path, res)
  } catch {
    // Cache API 非対応・容量不足などでは諦める（表示は既に最新になっている）
  }
}

/**
 * キャッシュバスター付きフェッチ
 * CDN・SW両方のキャッシュを回避するため ?t=timestamp を付与
 */
async function fetchJSON<T>(path: string, bustCache = false): Promise<T> {
  const url = bustCache ? `${path}?t=${Date.now()}` : path
  const res = await fetch(url, bustCache ? { cache: 'reload' } : undefined)
  if (!res.ok) throw new Error(`${path} の取得に失敗しました (${res.status})`)
  if (bustCache) void putCanonical(path, res.clone())
  return res.json() as Promise<T>
}

export function useTimetable(now: dayjs.Dayjs): UseTimetableResult {
  const [data, setData] = useState<TimetableData | null>(null)
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

  // リクエスト世代。23:59 に始まった取得が 00:00 の取得より後に完了しても
  // 古い方が後勝ちしないよう、応答適用前に世代を照合する
  const seqRef = useRef(0)

  const load = useCallback(async (bustCache = false): Promise<boolean> => {
    const seq = ++seqRef.current
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const rules = await fetchJSON<CalendarRules>('/data/calendar_rules.json', bustCache)
      const current = nowRef.current
      const tomorrow = current.add(1, 'day')
      const todayId = resolveCalendar(rules, current)
      const tomorrowId = resolveCalendar(rules, tomorrow)

      const [todayData, tomorrowData] = await Promise.all([
        fetchJSON<Timetable>(`/data/timetables/${todayId}.json`, bustCache).then(normalizeTimetable),
        fetchJSON<Timetable>(`/data/timetables/${tomorrowId}.json`, bustCache).then(normalizeTimetable).catch(() => null),
      ])

      if (seq !== seqRef.current) return false // より新しい取得が始まっている
      setData({
        dateKey: current.format('YYYY-MM-DD'),
        tomorrowDateKey: tomorrow.format('YYYY-MM-DD'),
        timetable: todayData,
        tomorrowTimetable: tomorrowData,
      })
      hasDataRef.current = true
      return true
    } catch (e) {
      if (seq !== seqRef.current) return false
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました')
      return false
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [])

  // 日付が変わったときのみ通常フェッチ（SW NetworkFirst が機能する）
  useEffect(() => {
    // 取得の前に、prefetch 済みの「翌日」が新しい今日と一致するなら昇格させる。
    // オフラインで日付を跨いでも正しい時刻を出し続けられる。
    setData(prev => {
      if (!prev || prev.dateKey === dateKey) return prev
      if (prev.tomorrowDateKey !== dateKey || !prev.tomorrowTimetable) return prev
      return {
        dateKey,
        tomorrowDateKey: '',
        timetable: prev.tomorrowTimetable,
        tomorrowTimetable: null,
      }
    })
    void load(false)
  }, [dateKey, load])

  // 更新ボタン用: キャッシュバスター付きで強制再取得
  const refresh = useCallback(() => load(true), [load])

  return {
    timetable: data?.timetable ?? null,
    tomorrowTimetable: data?.tomorrowTimetable ?? null,
    loading,
    error,
    stale: data !== null && data.dateKey !== dateKey,
    refresh,
  }
}
