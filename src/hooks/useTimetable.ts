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

/** 取得時刻の保存先。設定本体（campusBusNaviSettings）とは別キーで持つ */
const FETCHED_AT_KEY = 'campusBusNaviFetchedAt'

/** 取得時刻として妥当と見なす範囲。端末時計のズレを吸収しつつ、明らかな異常値は捨てる */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

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
  /** データを保持したまま裏で再取得している（初回ロードの loading とは別物） */
  refetching: boolean
  error: string | null
  /** 保持中データの対象日が今日と違う（＝表示してはいけない） */
  stale: boolean
  /** 本日分の本文がサーバから返ってきた時刻（epoch ms）。不明なら null */
  fetchedAt: number | null
  refresh: () => Promise<boolean>
}

/** fetchJSON の戻り値。本文と、その本文がサーバから返ってきた時刻を組で返す */
interface FetchResult<T> {
  data: T
  /** Date レスポンスヘッダ（epoch ms）。読めなければ null */
  serverTime: number | null
}

function readStoredFetchedAt(): number | null {
  try {
    const raw = localStorage.getItem(FETCHED_AT_KEY)
    if (!raw) return null
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return null
    // 保存後に端末時計が巻き戻された場合、未来の値が残りうる。その場合は捨てる
    if (value > Date.now() + CLOCK_SKEW_TOLERANCE_MS) return null
    return value
  } catch {
    // localStorage が使えない環境でも動作継続
    return null
  }
}

function saveFetchedAt(value: number): void {
  try {
    localStorage.setItem(FETCHED_AT_KEY, String(value))
  } catch {
    // 保存できなくてもセッション内の表示には影響しない
  }
}

/**
 * 「この本文がサーバから返ってきた時刻」を決める。
 *
 * fetch の成功は「サーバから新しいデータが返った」ことを意味しない。オフラインでも
 * SW の NetworkFirst が timetable-data キャッシュへフォールバックするため fetch は解決し、
 * 素朴に Date.now() を入れると数日前のデータに「たった今取得」と表示してしまう。
 *
 * Cache API はレスポンスをヘッダごと保存するので、キャッシュから返った場合の Date ヘッダは
 * 「そのレスポンスが実際にサーバから返ってきた時刻」のまま残る。これを第一の根拠にする。
 * ヘッダが読めない環境では、オフライン中の成功を「取得できた」と数えないことで嘘を防ぐ
 * （null を返し、呼び出し側が前回値を維持する）。
 */
function resolveFetchedAt(serverTime: number | null): number | null {
  const now = Date.now()
  if (
    serverTime !== null &&
    serverTime <= now + CLOCK_SKEW_TOLERANCE_MS &&
    now - serverTime <= MAX_AGE_MS
  ) {
    return serverTime
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  return now
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
async function fetchJSON<T>(path: string, bustCache = false): Promise<FetchResult<T>> {
  const url = bustCache ? `${path}?t=${Date.now()}` : path
  const res = await fetch(url, bustCache ? { cache: 'reload' } : undefined)
  if (!res.ok) throw new Error(`${path} の取得に失敗しました (${res.status})`)
  // 本文を読む前に clone すること（res.json() が本文を消費するため）
  if (bustCache) void putCanonical(path, res.clone())
  const raw = res.headers.get('date')
  const parsed = raw ? Date.parse(raw) : NaN
  const data = (await res.json()) as T
  return { data, serverTime: Number.isFinite(parsed) ? parsed : null }
}

export function useTimetable(now: dayjs.Dayjs): UseTimetableResult {
  const [data, setData] = useState<TimetableData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refetching, setRefetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 取得時刻。TimetableData の中ではなく独立して持つ。中に入れると翌日 prefetch の
  // 昇格リデューサ（日付跨ぎで前日の時刻を出さないための中核）を書き換えることになるため。
  // 初期値は localStorage から。オフラインで起動した直後にも前回セッションの値を出せる。
  const [fetchedAt, setFetchedAt] = useState<number | null>(readStoredFetchedAt)

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
    else setRefetching(true)
    setError(null)
    try {
      const rules = await fetchJSON<CalendarRules>('/data/calendar_rules.json', bustCache)
      const current = nowRef.current
      const tomorrow = current.add(1, 'day')
      const todayId = resolveCalendar(rules.data, current)
      const tomorrowId = resolveCalendar(rules.data, tomorrow)

      // 翌日分は normalize まで含めて catch する。翌日の形式不正で今日の表示まで
      // 落とさないため（prefetch はあくまで日付跨ぎ用の保険）
      const [todayRes, tomorrowData] = await Promise.all([
        fetchJSON<Timetable>(`/data/timetables/${todayId}.json`, bustCache),
        fetchJSON<Timetable>(`/data/timetables/${tomorrowId}.json`, bustCache)
          .then(res => normalizeTimetable(res.data))
          .catch(() => null),
      ])

      if (seq !== seqRef.current) return false // より新しい取得が始まっている
      setData({
        dateKey: current.format('YYYY-MM-DD'),
        tomorrowDateKey: tomorrow.format('YYYY-MM-DD'),
        timetable: normalizeTimetable(todayRes.data),
        tomorrowTimetable: tomorrowData,
      })
      // 鮮度の根拠は本日分の本文が返ってきた時刻。null は「取得できたとは言えない」の意味なので
      // その場合は前回値を維持する（オフラインでキャッシュから読めただけ、など）
      const resolved = resolveFetchedAt(todayRes.serverTime)
      if (resolved !== null) {
        setFetchedAt(resolved)
        saveFetchedAt(resolved)
      }
      hasDataRef.current = true
      return true
    } catch (e) {
      if (seq !== seqRef.current) return false
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました')
      return false
    } finally {
      if (seq === seqRef.current) {
        setLoading(false)
        setRefetching(false)
      }
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
    refetching,
    error,
    stale: data !== null && data.dateKey !== dateKey,
    fetchedAt,
    refresh,
  }
}
