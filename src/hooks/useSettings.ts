import { useState, useCallback } from 'react'
import type { AppSettings, DefaultRoute, Theme, FontSize } from '../types/timetable'

const STORAGE_KEY = 'campusBusNaviSettings'

const DEFAULT_SETTINGS: AppSettings = {
  defaultRoute: 'campus_to_station',
  theme: 'light',
  fontSize: 'medium',
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage が使えない環境でも動作継続
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  const updateSetting = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }, [])

  const setDefaultRoute = (v: DefaultRoute) => updateSetting('defaultRoute', v)
  const setTheme = (v: Theme) => updateSetting('theme', v)
  const setFontSize = (v: FontSize) => updateSetting('fontSize', v)

  return { settings, setDefaultRoute, setTheme, setFontSize }
}
