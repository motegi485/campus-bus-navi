import { type ReactNode } from 'react'
import { usePressable } from '../hooks/usePressable'
import {
  IconGradCap,
  IconBusStop,
  IconTrain,
  IconLaptopCode,
  IconMegaphone,
  IconCalendarWeek,
  IconGear,
  IconHelp,
  IconReset,
  type IconTone,
} from './AppIcons'
import { BellIcon } from './BellIcon'
import { ExternalLinkIcon } from './ExternalLinkIcon'
import { SCHOOL_BUS_INFO_URL } from '../constants/links'

interface Props {
  hasUnread: boolean
  onOpenNews: () => void
  onOpenWeekly: () => void
  onOpenReminders: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onInitApp: () => void
}

const LINKS: { icon: ReactNode; tone: IconTone; title: string; sub: string; url: string }[] = [
  { icon: <IconGradCap />,   tone: 'violet', title: '大学ホームページ', sub: 'fukuyama-u.ac.jp', url: 'https://www.fukuyama-u.ac.jp/' },
  { icon: <IconBusStop />,   tone: 'blue',   title: '通学情報', sub: 'スクールバス、駐車場・駐輪場', url: SCHOOL_BUS_INFO_URL },
  { icon: <IconTrain />,     tone: 'green',  title: 'JR松永駅時刻表', sub: '糸崎・三原方面 / 岡山・福山方面', url: 'https://transit.yahoo.co.jp/timetable/27407' },
  { icon: <IconLaptopCode />, tone: 'yellow', title: 'サークルホームページ', sub: 'fukupro.club', url: 'https://www.fukupro.club/' },
]

/**
 * メニュータブ（改修たたき台 2c）。
 * 項目の並び・アイコン・配色はオリジナル（旧 DrawerMenu.tsx）と完全に一致させる
 * （ターン2チャットでの確定指示）。行は改修たたき台どおり個別カード（グループの
 * 共有背景ではない）。
 */
export function MenuTab({ hasUnread, onOpenNews, onOpenWeekly, onOpenReminders, onOpenSettings, onOpenHelp, onInitApp }: Props) {
  return (
    <div className="flex flex-col" style={{ paddingBottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 16px)' }}>
      {/* 上端の余白はバスタブのヘッダー（App.tsx）と同じ計算にする。safe-area を
          足さないと、ノッチ機でタイトルが端末のステータスバー（時刻・電池）と重なる。 */}
      <header style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 22px) 20px 0' }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: '-0.7px', lineHeight: 1.2, color: 'var(--text-primary)' }}>
          メニュー
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>
          お知らせ・設定・外部リンク
        </p>
      </header>

      {/* リンク */}
      <MenuGroup>
        {LINKS.map(link => (
          <a key={link.title} href={link.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <MenuRow icon={link.icon} tone={link.tone} title={link.title} sub={link.sub} external />
          </a>
        ))}
      </MenuGroup>

      {/* アプリ */}
      <MenuGroup>
        <MenuRow icon={<IconMegaphone />} tone="amber" title="お知らせ" sub="バス運行情報・重要連絡" chevron="›"
          showDot={hasUnread} onClick={onOpenNews} />
        <MenuRow icon={<IconCalendarWeek />} tone="blue" title="週間ダイヤ" sub="今日を含む7日間の運行予定" chevron="›"
          onClick={onOpenWeekly} />
        <MenuRow icon={<BellIcon width={20} height={20} />} tone="green" title="発車前の通知" sub="本日の便ごとに設定" chevron="›"
          onClick={onOpenReminders} />
      </MenuGroup>

      {/* その他 */}
      <MenuGroup>
        <MenuRow icon={<IconGear />} tone="indigo" title="設定" sub="表示・通知オプション" chevron="›"
          onClick={onOpenSettings} />
        <MenuRow icon={<IconHelp />} tone="slate" title="ヘルプ" sub="使い方・お問い合わせ" chevron="›"
          onClick={onOpenHelp} />
        <MenuRow icon={<IconReset />} tone="red" title="アプリの初期化" sub="キャッシュ・SWをリセット"
          titleColor="var(--status-danger-fg)" onClick={onInitApp} />
      </MenuGroup>

      <p style={{ margin: '16px 0 22px', textAlign: 'center', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>
        ver {__APP_VERSION__}
      </p>
    </div>
  )
}

function MenuGroup({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '20px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {children}
    </div>
  )
}

interface MenuRowProps {
  icon: ReactNode
  tone: IconTone
  title: string
  sub: string
  /** 内部遷移の矢印（"›"）。外部リンクは external を使う */
  chevron?: string
  /** 外部リンク行: 斜め矢印アイコンを出す */
  external?: boolean
  onClick?: () => void
  titleColor?: string
  showDot?: boolean
}

function MenuRow({ icon, tone, title, sub, chevron, external, onClick, titleColor, showDot }: MenuRowProps) {
  const { pressed, pressHandlers } = usePressable()
  const baseStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '13px 14px', borderRadius: 16, cursor: 'pointer',
    background: pressed ? 'var(--row-active)' : 'var(--menu-group-bg)',
    border: '1px solid var(--row-card-border)',
    transition: pressed ? 'none' : 'background 0.2s',
    width: '100%', textAlign: 'left',
  }
  const inner = (
    <>
      <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
        <div
          style={{
            width: 38, height: 38, borderRadius: 12,
            backgroundColor: `var(--icon-${tone}-bg)`,
            color: `var(--icon-${tone}-fg)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        {showDot && (
          <span aria-hidden="true" style={{ position: 'absolute', top: -3, right: -3, width: 11, height: 11, pointerEvents: 'none' }}>
            <span className="unread-pulse-ring" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--menu-unread-fg)', opacity: 0.55 }} />
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--menu-unread-fg)', boxShadow: '0 0 0 2px var(--menu-group-bg)' }} />
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: titleColor ?? 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 1 }}>{sub}</div>
      </div>
      {external ? (
        <span aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
          <ExternalLinkIcon width={13} height={13} />
        </span>
      ) : chevron ? (
        <span aria-hidden="true" style={{ fontSize: 15, color: 'var(--text-muted)', flexShrink: 0 }}>{chevron}</span>
      ) : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} {...pressHandlers} style={{ ...baseStyle, font: 'inherit', color: 'inherit' }}>
        {inner}
      </button>
    )
  }
  return <div {...pressHandlers} style={baseStyle}>{inner}</div>
}
