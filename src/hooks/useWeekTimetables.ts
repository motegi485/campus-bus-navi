import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import dayjs from 'dayjs'
import type { CalendarRules, Timetable, DiagramType } from '../types/timetable'
import { resolveCalendar } from '../utils/resolveCalendar'
import { normalizeTimetable } from '../utils/normalizeTimetable'
import { resolveDiagramType } from '../components/DayBadge'

/** 週間ダイヤの 1 日分 */
export interface WeekDay {
  /**
   * この行が対象とする日付（JST）。表示用の月日・曜日はここから取り出す。
   * dateKey を dayjs で parse し直さないのは、dayjs が strict parse ではないため
   * （文字列経由の往復を作らない）。
   */
  date: dayjs.Dayjs
  /** date と同じ日を表すキー（YYYY-MM-DD）。比較・突合用 */
  dateKey: string
  timetableId: string
  diagramType: DiagramType
  /** 未取得・取得失敗なら null。他の日のダイヤで代用はしない */
  timetable: Timetable | null
  status: 'loading' | 'ok' | 'error'
}

interface UseWeekTimetablesResult {
  days: WeekDay[]
  /** calendar_rules.json を取得中（＝日付とダイヤ種別すら出せない） */
  loading: boolean
  /** calendar_rules.json 自体が取得できなかった */
  error: string | null
  reload: () => Promise<void>
}

/**
 * 起点日から N 日分の時刻表を解決するフック。
 *
 * useTimetable（今日・明日）とは独立していて、あちらには一切触れない。
 * 日付跨ぎの昇格・stale 判定という当日表示の安全機構を、週間表示の都合で
 * 複雑にしないため。
 *
 * 設計上の要点:
 * - 日付とダイヤ種別は calendar_rules.json だけで決まる。時刻表の取得を待たず
 *   先に days を返すので、通信が遅くても一覧として成立する
 * - 時刻表 ID は一意化してから取得する。7 日で同じ ID を 5 回取りに行かない
 *   （SW キャッシュ timetable-data の maxEntries を無駄に消費しない）
 * - キャッシュバスター（?t=）は付けない。週間表示は最新性より安定性を優先し、
 *   手動更新はホームの更新ボタンに任せる（付けると putCanonical 相当の
 *   書き戻しが必要になる）
 * - リクエスト世代（seqRef）で古い応答を破棄する。画面の開閉と日付跨ぎで競合しうる
 */
export function useWeekTimetables(
  start: dayjs.Dayjs,
  enabled: boolean,
  dayCount = 7
): UseWeekTimetablesResult {
  const [days, setDays] = useState<WeekDay[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 最新の start を ref で保持。load クロージャは ref 経由で参照することで
  // 「start は毎分作り直されるが、再取得は日付が変わったときだけ」を満たす
  const startRef = useRef(start)
  startRef.current = start

  const startKey = useMemo(() => start.format('YYYY-MM-DD'), [start])

  // リクエスト世代。古い応答が後勝ちしないよう、適用前に必ず照合する
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/data/calendar_rules.json')
      if (!res.ok) {
        throw new Error(`/data/calendar_rules.json の取得に失敗しました (${res.status})`)
      }
      const rules = (await res.json()) as CalendarRules
      if (seq !== seqRef.current) return // より新しい取得が始まっている

      const base = startRef.current
      const plan: WeekDay[] = []
      for (let i = 0; i < dayCount; i++) {
        // 日付演算は dayjs の add だけで完結させる。文字列を組み立てて
        // parse し直すと、dayjs が strict parse でないぶん非実在日を黙って通す
        const date = base.add(i, 'day')
        const timetableId = resolveCalendar(rules, date)
        plan.push({
          date,
          dateKey: date.format('YYYY-MM-DD'),
          timetableId,
          diagramType: resolveDiagramType(timetableId),
          timetable: null,
          status: 'loading',
        })
      }
      setDays(plan)
      setLoading(false)

      // ID を一意化してから並列取得。1 日分の失敗が他の日を巻き込まないよう
      // 各取得を個別に catch する（normalize の失敗も同じ扱い）
      const uniqueIds = Array.from(new Set(plan.map(d => d.timetableId)))
      const entries = await Promise.all(
        uniqueIds.map(async (id): Promise<readonly [string, Timetable | null]> => {
          try {
            const r = await fetch(`/data/timetables/${id}.json`)
            if (!r.ok) throw new Error(String(r.status))
            return [id, normalizeTimetable((await r.json()) as Timetable)] as const
          } catch {
            return [id, null] as const
          }
        })
      )
      if (seq !== seqRef.current) return

      const byId = new Map(entries)
      setDays(prev =>
        prev.map((d): WeekDay => {
          const timetable = byId.get(d.timetableId) ?? null
          return { ...d, timetable, status: timetable ? 'ok' : 'error' }
        })
      )
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました')
      setLoading(false)
    }
  }, [dayCount])

  useEffect(() => {
    if (!enabled) return
    // 日付が変わった直後、前回の起点で作った行がそのまま残っていると
    // 過ぎた日を「今日から7日間」の先頭として見せてしまう。新しい起点より前の
    // 行は取得を待たずに落とす（残る行はどれも自分の日付を持っているので正しい）
    setDays(prev => (prev.length > 0 ? prev.filter(d => d.dateKey >= startKey) : prev))
    void load()
  }, [startKey, enabled, load])

  return { days, loading, error, reload: load }
}
