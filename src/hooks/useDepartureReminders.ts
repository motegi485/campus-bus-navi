import { useCallback, useEffect, useRef, useState } from 'react'
import type { RouteKey } from '../types/timetable'
import { clearPushMirror, writePushMirror, type MirroredReminder } from '../utils/pushMirror'

/**
 * 当日の便ごとのリマインド指定。
 *
 * 正はサーバ（D1）にある。端末を再起動しても時刻表に印を復元できるよう、
 * 起動時に GET で取り直す。localStorage には「何分前」の好みだけを残す
 * （毎回選び直させないため。指定した便そのものは当日限りなので残さない）。
 *
 * 端末が未登録（設定画面のトグルがオフ）のときは、サーバが 409 を返す。
 * 「トグルをオンにして初めて指定できる」という順序を UI 側でも守る。
 *
 * ── 保存の前提 ─────────────────────────────────────────────────────────
 * POST は「その日・そのルートの指定を送られた内容で置き換える」総入れ替えなので、
 * **現在の集合を正しく読めていることが前提**になる。GET に失敗した状態から保存すると、
 * 見えていない既存の予約を利用者が自覚しないまま消してしまう。そのため読み込み結果を
 * `loadState` で持ち、失敗している間は保存を止めて再読み込みを促す。
 *
 * ── push-sw への写し ───────────────────────────────────────────────────
 * ペイロードなし push では「どの便の通知か」がサーバから届かない。
 * サーバの状態が変わるたびに `utils/pushMirror` へ全ルートぶんを写し、
 * `public/push-sw.js` がそれを読んで便を同定する。
 */

/** 「何分前」の好みだけを残す。指定した便は当日限りなので保存しない */
const LEAD_STORAGE_KEY = 'campusBusNaviReminderLead'

export type ReminderLead = 5 | 10 | 15 | 20
export const LEAD_OPTIONS: ReminderLead[] = [5, 10, 15, 20]
const DEFAULT_LEAD: ReminderLead = 10

/** サーバの現在値を読めているか。'ok' 以外では総入れ替えの保存を許さない */
export type ReminderLoadState = 'idle' | 'loading' | 'ok' | 'error'

function loadLead(): ReminderLead {
  try {
    const raw = Number(localStorage.getItem(LEAD_STORAGE_KEY))
    return LEAD_OPTIONS.includes(raw as ReminderLead) ? (raw as ReminderLead) : DEFAULT_LEAD
  } catch {
    return DEFAULT_LEAD
  }
}

function saveLead(value: ReminderLead): void {
  try {
    localStorage.setItem(LEAD_STORAGE_KEY, String(value))
  } catch {
    // 保存できなくてもその場の指定は成立する
  }
}

async function readError(response: Response): Promise<string> {
  const detail = await response.json().catch(() => null)
  return (detail as { error?: string } | null)?.error ?? `HTTP ${response.status}`
}

interface ServerReminder {
  route: RouteKey
  departure: string
  leadMinutes: number
}

export function useDepartureReminders(params: {
  /** 端末の push エンドポイント。null なら通知がオフ */
  endpoint: string | null
  /** 当日（JST）の "YYYY-MM-DD" */
  dateKey: string
  route: RouteKey
}) {
  const { endpoint, dateKey, route } = params

  /** サーバに保存されている、このルート・この日の指定（"HH:mm" の集合） */
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [lead, setLead] = useState<ReminderLead>(loadLead)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<ReminderLoadState>('idle')
  /** reload() 用の世代。値が変わると下の useEffect が再取得する */
  const [loadSeq, setLoadSeq] = useState(0)

  /**
   * 直近の GET で得た「その日の全ルートぶん」。
   * push-sw のミラーは全ルートを持つ必要があるため、保存時に他ルートぶんを残せるよう控える。
   */
  const allRef = useRef<ServerReminder[]>([])

  // 起動時とルート・日付の変化時にサーバから取り直す
  useEffect(() => {
    if (!endpoint) {
      setMarked(new Set())
      setLoadState('idle')
      allRef.current = []
      // 通知がオフ（または未登録）なら端末に予約を残さない
      void clearPushMirror()
      return
    }
    let cancelled = false
    setLoadState('loading')
    const query = `?endpoint=${encodeURIComponent(endpoint)}&dateKey=${dateKey}`
    fetch(`/api/reminders${query}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(body => {
        if (cancelled) return
        const all = (body as { reminders?: ServerReminder[] }).reminders ?? []
        allRef.current = all
        const list = all.filter(r => r.route === route)
        setMarked(new Set(list.map(r => r.departure)))
        // サーバに残っている値があれば、それを「何分前」の現在値として採用する
        if (list.length > 0 && LEAD_OPTIONS.includes(list[0].leadMinutes as ReminderLead)) {
          setLead(list[0].leadMinutes as ReminderLead)
        }
        setLoadState('ok')
        void writePushMirror(dateKey, all as MirroredReminder[])
      })
      .catch(() => {
        if (cancelled) return
        // 読めていない状態を隠さない。この間は保存を止める（見えない予約を消さないため）
        allRef.current = []
        setMarked(new Set())
        setLoadState('error')
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, dateKey, route, loadSeq])

  const reload = useCallback(() => setLoadSeq(n => n + 1), [])

  const changeLead = useCallback((value: ReminderLead) => {
    setLead(value)
    saveLead(value)
  }, [])

  /**
   * 選んだ便をサーバへ保存する。
   * その日・そのルートの指定を総入れ替えするので、空配列なら全解除になる。
   */
  const save = useCallback(
    async (departures: string[]): Promise<boolean> => {
      if (!endpoint) {
        setError('設定画面で通知をオンにしてください')
        return false
      }
      if (loadState !== 'ok') {
        // 総入れ替えの前提（現在の集合が既知）が崩れている。ここで止めないと
        // サーバにある既存の予約を、利用者が気づかないまま消してしまう
        setError('現在の設定を読み込めていないため保存できません。再読み込みしてください')
        return false
      }
      setSaving(true)
      setError(null)
      try {
        const response = await fetch('/api/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, dateKey, route, departures, leadMinutes: lead }),
        })
        if (!response.ok) throw new Error(await readError(response))
        setMarked(new Set(departures))
        // 他ルートぶんは残したまま、このルートだけ差し替える（サーバ側の総入れ替えと同じ形）
        const next: ServerReminder[] = [
          ...allRef.current.filter(r => r.route !== route),
          ...departures.map(departure => ({ route, departure, leadMinutes: lead })),
        ]
        allRef.current = next
        void writePushMirror(dateKey, next as MirroredReminder[])
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setSaving(false)
      }
    },
    [endpoint, dateKey, route, lead, loadState]
  )

  return { marked, lead, changeLead, save, saving, error, loadState, reload }
}
