import { useEffect, useRef, useState } from 'react'
import type { RouteKey } from '../types/timetable'
import { tapFeedback } from '../utils/haptics'
import { BusGlyph } from './BusGlyph'

interface Props {
  route: RouteKey
  onChange: (route: RouteKey) => void
}

/**
 * ルートごとの塗り（改修たたき台 C11）。
 * gradient は選択中の表現。改修たたき台の全カットが「大学発」選択中の
 * 状態しか描いていないため、松永発側の選択中グラデーションは未確認 —
 * 大学発のグラデーション（原本 #33ae61 → #1d9550 → #16833f）と同じ明度配分で、
 * 既存の --route-solid-station（#6366f1）を中間色として類推した値。
 */
const OPTIONS: {
  key: RouteKey
  label: string
  /** 非選択時のアイコン本体色（そのルートの識別色） */
  inactiveIconColor: string
  /** 選択時の背景グラデーション */
  gradient: string
}[] = [
  {
    key: 'campus_to_station',
    label: '大学発',
    inactiveIconColor: 'var(--route-solid-campus)',
    gradient: 'linear-gradient(180deg, #33ae61 0%, #1d9550 55%, #16833f 100%)',
  },
  {
    key: 'station_to_campus',
    label: '松永発',
    inactiveIconColor: 'var(--route-solid-station)',
    // 松永発の選択中グラデーションは原本未掲載のため類推（上記コメント参照）
    gradient: 'linear-gradient(180deg, #7b7ef5 0%, #6366f1 55%, #4d50c7 100%)',
  },
]

/** ナッジ済みフラグ。設定本体（campusBusNaviSettings）とは別キーで持つ */
const NUDGE_KEY = 'campusBusNaviRouteToggleHinted'

function alreadyHinted(): boolean {
  try {
    return localStorage.getItem(NUDGE_KEY) === 'true'
  } catch {
    // localStorage が使えない環境ではナッジしない（毎回出さないため）
    return true
  }
}

function markHinted(): void {
  try {
    localStorage.setItem(NUDGE_KEY, 'true')
  } catch {
    // 保存できなくても動作に影響はない
  }
}

/**
 * ルート切替セグメント（改修たたき台 1a/2a/2b 共通）。
 * 選択中はグラデーションの塗りつぶしボタン、非選択はラベルのみ。
 * バスアイコンは選択状態で本体色を切り替える（BusGlyph）。
 */
export function RouteToggle({ route, onChange }: Props) {
  const [nudging, setNudging] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (alreadyHinted()) return
    const start = window.setTimeout(() => setNudging(true), 700)
    const end = window.setTimeout(() => {
      setNudging(false)
      markHinted()
    }, 700 + 1300 * 2 + 200)
    timers.current = [start, end]
    return () => timers.current.forEach(id => clearTimeout(id))
  }, [])

  const handle = (key: RouteKey) => {
    if (nudging) {
      timers.current.forEach(id => clearTimeout(id))
      setNudging(false)
      markHinted()
    }
    if (key === route) return
    tapFeedback(10)
    onChange(key)
  }

  return (
    <div
      role="group"
      aria-label="ルート切替"
      className="flex"
      style={{
        gap: 4,
        padding: 5,
        borderRadius: 9999,
        background: 'var(--pill-track-bg)',
        border: '1px solid var(--pill-track-border)',
        boxShadow: 'inset 0 2px 4px rgba(15,23,42,.11)',
      }}
    >
      {OPTIONS.map((opt) => {
        const active = route === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => handle(opt.key)}
            aria-pressed={active}
            className={nudging && active ? 'route-toggle-nudge' : undefined}
            style={{
              position: 'relative',
              flex: 1,
              height: 46,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 9999,
              fontSize: 15,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              background: active ? opt.gradient : 'transparent',
              border: active ? '1px solid rgba(255,255,255,.28)' : 'none',
              boxShadow: active
                ? 'inset 0 1px 0 rgba(255,255,255,.42), 0 4px 10px -2px rgba(20,120,60,.45), 0 1px 2px rgba(15,23,42,.18)'
                : 'none',
              color: active ? '#ffffff' : 'var(--route-toggle-inactive-fg)',
              textShadow: active ? '0 1px 1px rgba(0,0,0,.16)' : 'none',
              transition: 'background .2s, box-shadow .2s, color .2s, border-color .2s',
            }}
          >
            <BusGlyph
              size={21}
              body={active ? '#ffffff' : opt.inactiveIconColor}
            />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
