interface Props {
  open: boolean
  onClose: () => void
  onOpenNews: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onInitApp: () => void
}

const LINKS = [
  { icon: '🏫', title: '大学ホームページ', sub: 'fukuyama-u.ac.jp', bg: '#ede9fe', url: 'https://www.fukuyama-u.ac.jp/' },
  { icon: '🚶', title: '通学情報', sub: 'スクールバス、駐車場・駐輪場', bg: '#dbeafe', url: 'https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/' },
  { icon: '💻', title: 'サークルホームページ', sub: 'fukupro.club',  bg: '#fef9c3', url: 'https://www.fukupro.club/' },
]

export function DrawerMenu({ open, onClose, onOpenNews, onOpenSettings, onOpenHelp, onInitApp }: Props) {
  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 30, pointerEvents: open ? 'all' : 'none',
        background: open ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0)',
        transition: 'background 0.3s', borderRadius: '44px', overflow: 'hidden',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* ドロワー本体 */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, width: '82%', height: '100%',
          background: 'var(--bg-card)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s cubic-bezier(.4,0,.2,1), background 0.35s',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div style={{ background: 'linear-gradient(160deg,#16a374,#34d399)', padding: '52px 22px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🚌</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>スクールバス</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', marginTop: 2 }}>福山大学 時刻表アプリ</div>
            </div>
          </div>
        </div>

        {/* スクロールエリア */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px 20px', background: 'var(--bg-page)', transition: 'background 0.35s' }}>

          {/* リンクセクション */}
          <SectionLabel>リンク</SectionLabel>
          {LINKS.map(link => (
            <a key={link.title} href={link.url} target="_blank" rel="noopener noreferrer"
               style={{ textDecoration: 'none' }} onClick={onClose}>
              <DrawerItem icon={link.icon} iconBg={link.bg} title={link.title} sub={link.sub} chevron="↗" />
            </a>
          ))}

          <Divider />

          {/* アプリセクション */}
          <SectionLabel>アプリ</SectionLabel>
          <DrawerItem icon="📢" iconBg="#fef3c7" title="お知らせ" sub="バス運行情報・重要連絡" chevron="›"
            onClick={() => { onClose(); onOpenNews() }} />

          <Divider />

          {/* その他セクション */}
          <SectionLabel>その他</SectionLabel>
          <DrawerItem icon="⚙️" iconBg="#f0f4ff" title="設定" sub="表示・通知オプション" chevron="›"
            onClick={() => { onClose(); onOpenSettings() }} />
          <DrawerItem icon="❓" iconBg="#f4f4f8" title="ヘルプ" sub="使い方・お問い合わせ" chevron="›"
            onClick={() => { onClose(); onOpenHelp() }} />

          {/* アプリの初期化ボタン */}
          <DrawerItem icon="🔄" iconBg="#fef2f2" title="アプリの初期化" sub="キャッシュ・SWをリセット"
            titleColor="#ef4444"
            onClick={() => { onInitApp() }} />

          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '12px 0 4px' }}>
            ver {__APP_VERSION__}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.2px', textTransform: 'uppercase', padding: '14px 10px 6px' }}>
      {children}
    </div>
  )
}

function Divider() {
  return <div style={{ height: '.5px', background: 'var(--border2)', margin: '4px 2px' }} />
}

interface DrawerItemProps {
  icon: string
  iconBg: string
  title: string
  sub: string
  chevron?: string
  onClick?: () => void
  titleColor?: string
}

function DrawerItem({ icon, iconBg, title, sub, chevron, onClick, titleColor }: DrawerItemProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 13,
        padding: '11px 12px', borderRadius: 14, cursor: 'pointer',
        background: 'var(--bg-card)', marginBottom: 6,
        transition: 'background 0.35s',
      }}
      onClick={onClick}
    >
      <div style={{ width: 36, height: 36, borderRadius: 11, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: titleColor ?? 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
      </div>
      {chevron && <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>{chevron}</span>}
    </div>
  )
}
