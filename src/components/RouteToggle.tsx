import { useEffect, useRef, useState } from 'react'
import type { RouteKey } from '../types/timetable'
import { tapFeedback } from '../utils/haptics'
import { fs } from '../utils/fontScale'
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
 * 選択中はグラデーションの塗りつぶし、非選択はラベルのみ。
 * 面は共有の1個のノブが担い、選択位置へスプリングでスライドする
 * （大規模改修前の動きを復元。docs/design-decisions.md 参照）。
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

  const index = route === 'campus_to_station' ? 0 : 1
  // gap を挟む現行トラックでもノブが2ボタン分にきっちり収まるよう、
  // 「自分の幅 + gap」だけ動かす（gap 分を translateX 側の +4px で補う）
  const knobOffset = `calc(${index} * (100% + 4px))`

  return (
    <div>
      <div
        role="group"
        aria-label="ルート切替"
        className="flex"
        style={{
          position: 'relative',
          gap: 4,
          padding: 5,
          borderRadius: 9999,
          background: 'var(--pill-track-bg)',
          border: '1px solid var(--pill-track-border)',
          boxShadow: 'inset 0 2px 4px rgba(15,23,42,.11)',
        }}
      >
        {/* ノブ。位置・色・影はここに集約し、ボタン側はラベルとアイコンだけ描く */}
        <div
          aria-hidden="true"
          className={`route-toggle-knob${nudging ? ' route-toggle-nudge' : ''}`}
          style={{
            position: 'absolute',
            top: 5,
            bottom: 5,
            left: 5,
            width: 'calc(50% - 7px)',
            borderRadius: 9999,
            background: OPTIONS[index].gradient,
            border: '1px solid rgba(255,255,255,.28)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.42), 0 4px 10px -2px rgba(20,120,60,.45), 0 1px 2px rgba(15,23,42,.18)',
            ['--nudge-pos' as string]: knobOffset,
            transform: `translateX(${knobOffset})`,
          }}
        />

        {OPTIONS.map((opt) => {
          const active = route === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => handle(opt.key)}
              aria-pressed={active}
              style={{
                position: 'relative',
                flex: 1,
                height: 46,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 9999,
                fontSize: fs(15),
                fontWeight: 700,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
                color: active ? '#ffffff' : 'var(--route-toggle-inactive-fg)',
                textShadow: active ? '0 1px 1px rgba(0,0,0,.16)' : 'none',
                transition: 'color .2s',
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

      {/* ナッジ中のヒント（3タブ化の際に落ちていたものを復元）。
          装飾なので支援技術には渡さない（状態は aria-pressed で伝わっている）。
          高さごと開閉させ、消えた後は余白を残さない。
          以前は緑ヘッダー上の白文字＋影だったが、いまは白地（header-plain）なので
          --text-muted で描く。 */}
      <div
        aria-hidden="true"
        style={{
          marginTop: nudging ? 8 : 0,
          height: nudging ? fs(16) : 0,
          overflow: 'hidden',
          fontSize: fs(11),
          lineHeight: fs(16),
          fontWeight: 600,
          textAlign: 'center',
          color: 'var(--text-muted)',
          opacity: nudging ? 1 : 0,
          transition: 'opacity .3s, height .3s, margin-top .3s',
        }}
      >
        タップでルートを切り替え
      </div>
    </div>
  )
}
