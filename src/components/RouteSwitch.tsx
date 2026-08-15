import type { RouteKey } from '../types/timetable'
import { tapFeedback } from '../utils/haptics'
import { IconRouteSwap } from './AppIcons'

interface Props {
  route: RouteKey
  onChange: (route: RouteKey) => void
}

const OPTIONS: { key: RouteKey; label: string; color: string }[] = [
  { key: 'campus_to_station', label: '大学発', color: 'var(--toggle-on-campus)' },
  { key: 'station_to_campus', label: '松永発', color: 'var(--toggle-on-station)' },
]

/**
 * ページ面（--bg-page）に置く小型のルート切替スイッチ。
 *
 * ヘッダーの RouteToggle は使えない。あちらの .frost-surface は「半透明の白ガラスで
 * ヘッダーのグラデが透ける」ことが前提の面で、ページ面の上では地の色が抜けてしまう。
 *
 * 「押せる部品」に見えることを最優先にしてある。面と影は index.css の
 * .route-switch-track / .route-switch-knob が単一の真実源で、ここには書かない。
 * 左の入替アイコンは何のスイッチかを示す静的な手掛かり（装飾なので aria-hidden）。
 *
 * 幾何は RouteToggle と同じ契約: トラックの padding・gap なしの 2 分割・
 * ノブ幅 calc(50% - 3px) が対になっている。gap を足すとノブ位置が崩れる。
 *
 * 文字色は AA を満たす組み合わせだけを使う。未選択に --text-secondary を使うと
 * ライトで 4.20:1 となり AA を割るため、この問題のために用意された --chip-text を使う。
 */
export function RouteSwitch({ route, onChange }: Props) {
  const index = route === 'campus_to_station' ? 0 : 1

  const handle = (key: RouteKey) => {
    if (key === route) return
    tapFeedback(10)
    onChange(key)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
      <span aria-hidden="true" style={{ display: 'flex', color: 'var(--text-muted)', transition: 'color 0.35s' }}>
        <IconRouteSwap width={15} height={15} />
      </span>

      <div
        role="group"
        aria-label="ルート切替"
        className="route-switch-track"
        style={{ position: 'relative', display: 'flex', borderRadius: 9999, padding: 3 }}
      >
        {/* ノブ。位置だけをここで持ち、面・縁・影とばねは index.css 側 */}
        <div
          aria-hidden="true"
          className="route-switch-knob"
          style={{
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 3,
            width: 'calc(50% - 3px)',
            borderRadius: 9999,
            transform: `translateX(${index * 100}%)`,
          }}
        />

        {OPTIONS.map(opt => {
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
                borderRadius: 9999,
                padding: '7px 14px',
                border: 'none',
                background: 'transparent',
                font: 'inherit',
                fontSize: 12.5,
                fontWeight: 700,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                color: active ? opt.color : 'var(--chip-text)',
                transition: 'color .2s',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
