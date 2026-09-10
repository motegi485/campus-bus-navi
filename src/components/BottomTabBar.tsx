import { MapPin, ListBullets } from '@phosphor-icons/react'
import { tapFeedback } from '../utils/haptics'
import { BusGlyph } from './BusGlyph'

export type AppTab = 'bus' | 'map' | 'menu'

interface Props {
  active: AppTab
  onChange: (tab: AppTab) => void
  /** メニュータブの右上に未読ドットを出す（お知らせ未読あり） */
  hasUnread: boolean
}

/**
 * 固定3タブのボトムナビゲーション（改修たたき台 §11 相当）。
 * アイコンは選択・非選択で形を変えない。1 種類の図形を currentColor で
 * 塗り分けるだけ（色は index.css の --tab-active-fg / --tab-inactive-fg）。
 * 高さ・境界線・影の値は index.css の .bottom-tab-bar が単一の真実源。
 */
export function BottomTabBar({ active, onChange, hasUnread }: Props) {
  return (
    <nav
      className="bottom-tab-bar flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="画面切り替え"
    >
      {(['bus', 'map', 'menu'] as const).map((key) => {
        const isActive = key === active
        const label = key === 'bus' ? 'バス' : key === 'map' ? 'マップ' : 'メニュー'
        return (
          <button
            key={key}
            type="button"
            onClick={() => { if (!isActive) tapFeedback(8); onChange(key) }}
            aria-current={isActive ? 'page' : undefined}
            className="flex-1 flex flex-col items-center justify-center gap-1"
            style={{
              height: 56,
              border: 'none',
              background: 'transparent',
              color: isActive ? 'var(--tab-active-fg)' : 'var(--tab-inactive-fg)',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {key === 'bus' && <BusGlyph size={26} body="currentColor" />}
            {key === 'map' && <MapPin size={25} weight="fill" aria-hidden="true" />}
            {key === 'menu' && (
              <span style={{ position: 'relative', width: 25, height: 25, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ListBullets size={25} weight="bold" aria-hidden="true" />
                {hasUnread && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute', top: -1, right: -2,
                      width: 8, height: 8, borderRadius: '50%',
                      background: 'var(--menu-unread-fg)',
                      boxShadow: '0 0 0 2px var(--bg-card)',
                    }}
                  />
                )}
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
