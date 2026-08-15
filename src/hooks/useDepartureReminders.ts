import { useCallback, useEffect, useState } from 'react'
import type { RouteKey } from '../types/timetable'

/**
 * 当日の便ごとのリマインド指定。
 *
 * 正はサーバ（D1）にある。端末を再起動しても時刻表に印を復元できるよう、
 * 起動時に GET で取り直す。localStorage には「何分前」の好みだけを残す
 * （毎回選び直させないため。指定した便そのものは当日限りなので残さない）。
 *
 * 端末が未登録（設定画面のトグルがオフ）のときは、サーバが 409 を返す。
 * 「トグルをオンにして初めて指定できる」という順序を UI 側でも守る。
 */

/** 「何分前」の好みだけを残す。指定した便は当日限りなので保存しない */
const LEAD_STORAGE_KEY = 'campusBusNaviReminderLead'

export type ReminderLead = 5 | 10 | 15 | 20
export const LEAD_OPTIONS: ReminderLead[] = [5, 10, 15, 20]
const DEFAULT_LEAD: ReminderLead = 10

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

  // 起動時とルート・日付の変化時にサーバから取り直す
  useEffect(() => {
    if (!endpoint) {
      setMarked(new Set())
      return
    }
    let cancelled = false
    const query = `?endpoint=${encodeURIComponent(endpoint)}&dateKey=${dateKey}`
    fetch(`/api/reminders${query}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(body => {
        if (cancelled) return
        const list = ((body as { reminders?: ServerReminder[] }).reminders ?? []).filter(r => r.route === route)
        setMarked(new Set(list.map(r => r.departure)))
        // サーバに残っている値があれば、それを「何分前」の現在値として採用する
        if (list.length > 0 && LEAD_OPTIONS.includes(list[0].leadMinutes as ReminderLead)) {
          setLead(list[0].leadMinutes as ReminderLead)
        }
      })
      .catch(() => {
        // 取得できなくても操作はできる（保存時にサーバが正になる）
        if (!cancelled) setMarked(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, dateKey, route])

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
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setSaving(false)
      }
    },
    [endpoint, dateKey, route, lead]
  )

  return { marked, lead, changeLead, save, saving, error }
}
