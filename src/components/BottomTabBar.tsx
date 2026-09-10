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
            {key === 'bus' && <BusGlyph size={26} body="currentColor" detail="#ffffff" />}
            {key === 'map' && <MapPinIcon />}
            {key === 'menu' && (
              <span style={{ position: 'relative', width: 25, height: 25, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MenuIcon />
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

function MapPinIcon() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.2c-4.2 0-7.6 3.4-7.6 7.6 0 5.4 6.7 11.5 7 11.8.3.3.9.3 1.2 0 .3-.3 7-6.4 7-11.8 0-4.2-3.4-7.6-7.6-7.6z"
        fill="currentColor"
      />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 6.5h11" />
      <path d="M9.5 12h11" />
      <path d="M9.5 17.5h11" />
      <circle cx="4.6" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="17.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  )
}
