import { useEffect } from 'react'

interface Props {
  open: boolean
  hasUnread: boolean
  onClose: () => void
  onOpenNews: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onInitApp: () => void
}

const LINKS = [
  { icon: '🏫', title: '大学ホームページ', sub: 'fukuyama-u.ac.jp', bg: '#ede9fe', url: 'https://www.fukuyama-u.ac.jp/' },
  { icon: '🚶', title: '通学情報', sub: 'スクールバス、駐車場・駐輪場', bg: '#dbeafe', url: 'https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/' },
  { icon: '🚉', title: 'JR松永駅時刻表', sub: '糸崎・三原方面 / 岡山・福山方面', bg: '#dcfce7', url: 'https://transit.yahoo.co.jp/timetable/27407' },
  { icon: '💻', title: 'サークルホームページ', sub: 'fukupro.club',  bg: '#fef9c3', url: 'https://www.fukupro.club/' },
]

export function DrawerMenu({ open, hasUnread, onClose, onOpenNews, onOpenSettings, onOpenHelp, onInitApp }: Props) {
  // Esc キーでドロワーを閉じる（キーボード操作対応）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    /*
      fixed: ビューポート基準で全面を覆う（absolute だと phone-shell-inner 基準 =
      ドキュメント全高になり、内部スクローラが実質スクロールしなくなる）。
      touchAction: backdrop やドロワーの非スクロール部で始まるタッチが背後の
      body をスクロールさせる「貫通」を防ぐ（内部スクローラへのタッチは最寄りの
      スクロールコンテナで判定が止まるため通常どおり動く。ピンチズームは許可）。
    */
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 30, pointerEvents: open ? 'all' : 'none',
        background: open ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0)',
        transition: 'background 0.3s',
        touchAction: 'pinch-zoom',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      aria-hidden={!open}
    >
      {/* ドロワー本体 */}
      <div
        className="w-[80%] bp:w-[40%]"
        role="dialog"
        aria-modal="true"
        aria-label="メニュー"
        style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          background: 'var(--bg-card)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s cubic-bezier(.4,0,.2,1), background 0.35s',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div style={{ backgroundColor: 'var(--bg-card2)', padding: '52px 22px 20px', flexShrink: 0, transition: 'background 0.35s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div>
              <div style={{ fontSize: 25, fontWeight: 800, color: 'var(--text-primary)' }}>バスNAVI</div>
              <div style={{ fontSize: 16, color: 'var(--text-secondary)', marginTop: 2 }}>スクールバス時刻表アプリ</div>
            </div>
          </div>
        </div>

        {/* スクロールエリア。overscroll-behavior: contain で外（body）への
            スクロール連鎖を遮断し、バウンス/ストレッチはこの領域自身が担う
            （露出色 = この背景 --bg-page）。内側ラッパーの minHeight を
            「100% + 1px」にして内容が短くても常にスクロール可能にする
            （iOS はスクロール不能な領域をバウンスも連鎖遮断もしないため）。 */}
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', background: 'var(--bg-page)', transition: 'background 0.35s' }}>
          <div style={{ minHeight: 'calc(100% + 1px)', padding: '10px 12px 20px' }}>

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
          {/* 各画面はドロワー(z-30)の上(z-50)に重ねて開く。ここでドロワーを閉じないことで、
              画面の「戻る」を押すと下に残った開いたままのドロワーへ戻れる。 */}
          <SectionLabel>アプリ</SectionLabel>
          <DrawerItem icon="📢" iconBg="#fef3c7" title="お知らせ" sub="バス運行情報・重要連絡" chevron="›"
            showDot={hasUnread}
            onClick={onOpenNews} />

          <Divider />

          {/* その他セクション */}
          <SectionLabel>その他</SectionLabel>
          <DrawerItem icon="⚙️" iconBg="#f0f4ff" title="設定" sub="表示・通知オプション" chevron="›"
            onClick={onOpenSettings} />
          <DrawerItem icon="❓" iconBg="#f4f4f8" title="ヘルプ" sub="使い方・お問い合わせ" chevron="›"
            onClick={onOpenHelp} />

          {/* アプリの初期化ボタン */}
          <DrawerItem icon="🔄" iconBg="#fef2f2" title="アプリの初期化" sub="キャッシュ・SWをリセット"
            titleColor="#ef4444"
            onClick={() => { onInitApp() }} />

          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '12px 0 4px' }}>
            ver {__APP_VERSION__}
          </div>
          </div>{/* / 内側ラッパー */}
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
  showDot?: boolean   // 未読インジケーター表示（お知らせ項目のみ true）
}

function DrawerItem({ icon, iconBg, title, sub, chevron, onClick, titleColor, showDot }: DrawerItemProps) {
  const baseStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 13,
    padding: '11px 12px', borderRadius: 14, cursor: 'pointer',
    background: 'var(--bg-card)', marginBottom: 6,
    transition: 'background 0.35s',
    width: '100%', textAlign: 'left',
  }
  const inner = (
    <>
      <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
          {icon}
        </div>

        {/* 未読インジケーター（B4: パルスリング＋行背景色フチの中心ドット） */}
        {showDot && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', top: -3, right: -3,
              width: 11, height: 11, pointerEvents: 'none',
            }}
          >
            {/* 広がるリング（prefers-reduced-motion で停止） */}
            <span
              className="unread-pulse-ring"
              style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#0ea5e9', opacity: 0.55 }}
            />
            {/* 中心ドット（タイル分離のため行背景色フチを維持） */}
            <span
              style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#0ea5e9', boxShadow: '0 0 0 2px var(--bg-card)' }}
            />
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: titleColor ?? 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
      </div>
      {chevron && <span aria-hidden="true" style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>{chevron}</span>}
    </>
  )

  // アクション項目（onClick あり）はキーボード操作可能な <button> として描画する。
  // リンク項目は親の <a> がフォーカス可能なので、ここは presentational な <div>。
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ ...baseStyle, border: 'none', font: 'inherit', color: 'inherit' }}>
        {inner}
      </button>
    )
  }
  return <div style={baseStyle}>{inner}</div>
}
