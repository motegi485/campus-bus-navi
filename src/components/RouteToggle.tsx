import { useEffect, useRef, useState } from 'react'
import type { RouteKey } from '../types/timetable'
import { tapFeedback } from '../utils/haptics'

interface Props {
  route: RouteKey
  onChange: (route: RouteKey) => void
}

/**
 * 選択中ラベルの色 = そのルートの色。ノブがライトでは白・ダークでは黒ガラスと
 * 反転するため、実際の値は index.css の --toggle-on-* がテーマ別に持つ。
 */
const OPTIONS: { key: RouteKey; label: string; color: string }[] = [
  { key: 'campus_to_station', label: '大学発', color: 'var(--toggle-on-campus)' },
  { key: 'station_to_campus', label: '松永発', color: 'var(--toggle-on-station)' },
]

/** 未選択ラベル。ヘッダー上の他の文字（タイトル・日付）と揃えて白 */
const IDLE_LABEL = '#ffffff'

/**
 * ダークのトラックに使うティント色（ルート色のスモークガラス）。
 * ライトは透明な白ガラスなので使わない（.frost-surface 側で分岐している）。
 * on = backdrop-filter 有効時 / fb = 無効時（blur が効かないぶん不透明にする）。
 */
const TINT: Record<RouteKey, { on: string; fb: string }> = {
  campus_to_station: { on: 'rgba(4,71,52,.66)', fb: 'rgba(4,71,52,.74)' },
  station_to_campus: { on: 'rgba(55,48,163,.66)', fb: 'rgba(55,48,163,.74)' },
}

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

export function RouteToggle({ route, onChange }: Props) {
  const index = route === 'campus_to_station' ? 0 : 1
  const [nudging, setNudging] = useState(false)
  const timers = useRef<number[]>([])

  // 初回のみ: 700ms 後にナッジ開始、1.3s x 2 回で終了
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
    // ユーザーが自力で操作したらナッジは役目を終える
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
    <div className="mt-4 bp:w-[64%] bp:mx-auto">
      <div
        role="group"
        aria-label="ルート切替"
        className="frost-surface relative flex rounded-full p-1"
        style={{
          // ダークのティントは route ごとに変わる（.frost-surface が var() で読む）。
          // 面・縁・影そのものは index.css の .frost-surface / .dark .frost-surface
          ['--toggle-tint' as string]: TINT[route].on,
          ['--toggle-tint-fb' as string]: TINT[route].fb,
        }}
      >
        {/* ノブ（凸）。transform 1 本で位置とナッジを兼ねるため、
            ナッジ中は class 側の animation が transform を上書きする。
            見た目（鏡面グラデ・縁・影）は index.css の .toggle-knob 側。
            box-sizing: border-box が全要素に効いているので、border が付いても
            width: calc(50% - 4px) とボタン幅の一致は崩れない */}
        <div
          aria-hidden="true"
          className={`toggle-knob${nudging ? ' route-toggle-nudge' : ''}`}
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 4,
            width: 'calc(50% - 4px)',
            // ナッジ用アニメーションの基準位置
            ['--nudge-pos' as string]: `${index * 100}%`,
            transform: `translateX(${index * 100}%)`,
            transition: 'transform .34s cubic-bezier(.34,1.4,.64,1)',
            borderRadius: 9999,
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
              className="relative flex-1 rounded-full py-[9px] px-[6px] select-none"
              style={{
                border: 'none',
                background: 'transparent',
                font: 'inherit',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                color: active ? opt.color : IDLE_LABEL,
                transition: 'color .2s',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* ナッジ中のヒント。装飾なので支援技術には渡さない
          （状態は aria-pressed で伝わっている） */}
      <div
        aria-hidden="true"
        style={{
          marginTop: 8,
          height: nudging ? 16 : 0,
          overflow: 'hidden',
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'center',
          color: '#fff',
          textShadow: '0 1px 3px rgba(0,0,0,.45)',
          opacity: nudging ? 1 : 0,
          transition: 'opacity .3s, height .3s',
        }}
      >
        タップでルートを切り替え
      </div>
    </div>
  )
}
