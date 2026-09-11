import { MapPin, ListBullets } from '@phosphor-icons/react'
import { BusGlyph } from './BusGlyph'
import type { AppTab } from './BottomTabBar'

interface Props {
  active: AppTab
  onChange: (tab: AppTab) => void
  /** メニュー行の右上に未読ドットを出す（お知らせ未読あり） */
  hasUnread: boolean
}

/**
 * 1024px 以上でボトムタブバーの代わりに表示する左サイドバー（PC専用）。
 * BottomTabBar と同じ activeTab を読み書きするだけの新規ナビで、独自の状態は
 * 持たない。3タブのアイコン/ラベル定義は BottomTabBar と共有せずここに
 * 独自に持つ（3項目の重複は、動作中のモバイル版コードに触れないほうが
 * リスクが小さいと判断したため）。
 *
 * マウス操作前提の常設チロムなので、ルート色（--route-*）は使わない
 * （BottomTabBar と同じ理由: メニュー/設定を開いていても常に見えるため）。
 * tapFeedback / usePressable も使わない（iOS Safari の :active 不信対策であり、
 * ここではネイティブの :hover / :active で足りる）。
 */
export function Sidebar({ active, onChange, hasUnread }: Props) {
  return (
    <nav className="pc-sidebar" aria-label="画面切り替え">
      <div className="pc-sidebar-title">スクールバス時刻表</div>
      {(['bus', 'map', 'menu'] as const).map((key) => {
        const isActive = key === active
        const label = key === 'bus' ? 'バス' : key === 'map' ? 'マップ' : 'メニュー'
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-current={isActive ? 'page' : undefined}
            className={`pc-sidebar-item${isActive ? ' is-active' : ''}`}
          >
            <span style={{ position: 'relative', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {key === 'bus' && <BusGlyph size={20} body="currentColor" />}
              {key === 'map' && <MapPin size={20} weight="fill" aria-hidden="true" />}
              {key === 'menu' && <ListBullets size={20} weight="bold" aria-hidden="true" />}
              {key === 'menu' && hasUnread && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', top: -2, right: -2,
                    width: 8, height: 8, borderRadius: '50%',
                    background: 'var(--menu-unread-fg)',
                    boxShadow: `0 0 0 2px ${isActive ? 'var(--tab-active-pill-bg)' : 'var(--bg-card)'}`,
                  }}
                />
              )}
            </span>
            <span style={{ fontSize: 14 }}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
