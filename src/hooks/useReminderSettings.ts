import { useCallback, useState } from 'react'
import type { RouteKey } from '../types/timetable'

/**
 * 発車リマインダーの設定。
 *
 * 通知を「いつ・どのルートで」出すかは端末ごとの選択なので、アプリ全体の設定
 * （campusBusNaviSettings）とは別のキーで持つ。読み込み時に 1 項目ずつ検証して
 * 不正値を既定値へ落とす規律は useSettings.ts と同じ。
 *
 * 保存した内容はサーバ（D1）にも送られる。こちらは「画面に何を表示するか」、
 * D1 は「いつ送るか」を担当する。
 */

const STORAGE_KEY = 'campusBusNaviReminder'

export type ReminderLead = 5 | 10 | 15 | 20

export interface ReminderSettings {
  route: RouteKey
  leadMinutes: ReminderLead
  /** 曜日ビットマスク。日=1, 月=2, 火=4, 水=8, 木=16, 金=32, 土=64 */
  daysMask: number
}

export const WEEKDAYS_MASK = 0b0111110
export const EVERYDAY_MASK = 0b1111111

const DEFAULT_SETTINGS: ReminderSettings = {
  route: 'campus_to_station',
  leadMinutes: 10,
  daysMask: WEEKDAYS_MASK,
}

const VALID_ROUTES: RouteKey[] = ['campus_to_station', 'station_to_campus']
const VALID_LEADS: ReminderLead[] = [5, 10, 15, 20]

function loadSettings(): ReminderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    // 曜日は 1〜127 の整数のみ。0（どの曜日にも通知しない）は設定として成立しない
    const daysMask =
      Number.isInteger(parsed.daysMask) && parsed.daysMask > 0 && parsed.daysMask <= EVERYDAY_MASK
        ? parsed.daysMask
        : DEFAULT_SETTINGS.daysMask
    return {
      route: VALID_ROUTES.includes(parsed.route) ? parsed.route : DEFAULT_SETTINGS.route,
      leadMinutes: VALID_LEADS.includes(parsed.leadMinutes) ? parsed.leadMinutes : DEFAULT_SETTINGS.leadMinutes,
      daysMask,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: ReminderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage が使えない環境でも動作継続
  }
}

export function useReminderSettings() {
  const [reminder, setReminder] = useState<ReminderSettings>(loadSettings)

  const update = useCallback(<K extends keyof ReminderSettings>(key: K, value: ReminderSettings[K]) => {
    setReminder(prev => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }, [])

  return {
    reminder,
    setReminderRoute: (v: RouteKey) => update('route', v),
    setReminderLead: (v: ReminderLead) => update('leadMinutes', v),
    setReminderDays: (v: number) => update('daysMask', v),
  }
}
