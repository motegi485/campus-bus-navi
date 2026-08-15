import { useEffect, useRef, useState } from 'react'
import { setInert, useOverlayA11y } from '../hooks/useOverlayA11y'
import { usePressable } from '../hooks/usePressable'
import type { AppSettings, DefaultRoute, Theme, FontSize, RouteKey } from '../types/timetable'
import {
  EVERYDAY_MASK,
  WEEKDAYS_MASK,
  type ReminderLead,
  type ReminderSettings,
} from '../hooks/useReminderSettings'
import { ReminderSection } from './ReminderSection'
import {
  IconRouteSwap,
  IconContrast,
  IconFontSize,
  IconInfo,
  type AppIcon,
  type IconTone,
} from './AppIcons'

interface Props {
  open: boolean
  settings: AppSettings
  reminder: ReminderSettings
  onClose: () => void
  onSetDefaultRoute: (v: DefaultRoute) => void
  onSetTheme: (v: Theme) => void
  onSetFontSize: (v: FontSize) => void
  onSetReminderRoute: (v: RouteKey) => void
  onSetReminderLead: (v: ReminderLead) => void
  onSetReminderDays: (v: number) => void
}

type SelectKey = 'route' | 'theme' | 'font' | 'reminderRoute' | 'reminderLead' | 'reminderDays'

const LEAD_LABELS: Record<ReminderLead, string> = { 5: '5分前', 10: '10分前', 15: '15分前', 20: '20分前' }
const LEAD_VALUES = Object.entries(LEAD_LABELS) as [string, string][]

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#10b981', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}>
      <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8.5 1.5L1.5 8L8.5 14.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      {label}
    </button>
  )
}

function NavBar({ title, onBack, backLabel = '戻る', covered = false }: { title: string; onBack: () => void; backLabel?: string; covered?: boolean }) {
  // covered: サブ画面（選択リスト）が上に重なっている間は Tab 順から外す
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { setInert(ref.current, covered) }, [covered])

  return (
    <div ref={ref} style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
      <BackButton label={backLabel} onClick={onBack} />
      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.3px' }}>{title}</span>
    </div>
  )
}

/**
 * 設定行のアイコンタイル（34×34 / 角丸 10）。
 * アイコンは 19px。ドロワー（タイル 36 / アイコン 20）と同じ比率に揃えてある。
 * 色は CSS 変数から引き、テーマ切替に自動追従する。
 */
function IconTile({ icon: Icon, tone }: { icon: AppIcon; tone: IconTone }) {
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: `var(--icon-${tone}-bg)`,
        color: `var(--icon-${tone}-fg)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background-color 0.35s, color 0.35s',
      }}
    >
      <Icon width={19} height={19} />
    </div>
  )
}

function SettingRow({ icon, tone, title, sub, value, onClick }: { icon: AppIcon; tone: IconTone; title: string; sub: string; value: string; onClick: () => void }) {
  const { pressed, pressHandlers } = usePressable()
  return (
    <button
      type="button"
      onClick={onClick}
      {...pressHandlers}
      aria-label={`${title}（現在: ${value}）`}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        width: '100%', textAlign: 'left',
        // 押した瞬間は即時に色が付き、離すと 0.3s で戻す
        background: pressed ? 'var(--row-active)' : 'transparent',
        border: 'none', borderBottom: '.5px solid var(--border)',
        cursor: 'pointer',
        transition: pressed ? 'none' : 'background 0.3s',
        font: 'inherit', color: 'inherit',
      }}
    >
      <IconTile icon={icon} tone={tone} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>{value}</span>
        <span aria-hidden="true" style={{ fontSize: 13, color: 'var(--text-muted)' }}>›</span>
      </div>
    </button>
  )
}

export function SettingsScreen({
  open,
  settings,
  reminder,
  onClose,
  onSetDefaultRoute,
  onSetTheme,
  onSetFontSize,
  onSetReminderRoute,
  onSetReminderLead,
  onSetReminderDays,
}: Props) {
  const [selKey, setSelKey] = useState<SelectKey | null>(null)

  const reminderRouteLabel = reminder.route === 'campus_to_station' ? '大学発' : '松永発'
  const reminderLeadLabel = LEAD_LABELS[reminder.leadMinutes]
  const reminderDaysLabel = reminder.daysMask === EVERYDAY_MASK ? '毎日' : '平日のみ'

  const SELECTS: Record<SelectKey, { title: string; current: string; options: string[]; apply: (v: string) => void }> = {
    route: {
      title: 'デフォルトルート',
      current: settings.defaultRoute === 'campus_to_station' ? '大学発' : '松永発',
      options: ['大学発', '松永発'],
      apply: (v) => onSetDefaultRoute(v === '大学発' ? 'campus_to_station' : 'station_to_campus'),
    },
    theme: {
      title: 'カラーテーマ',
      current: settings.theme === 'light' ? 'ライト' : settings.theme === 'dark' ? 'ダーク' : 'システム',
      options: ['ライト', 'ダーク', 'システム'],
      apply: (v) => onSetTheme(v === 'ライト' ? 'light' : v === 'ダーク' ? 'dark' : 'system'),
    },
    font: {
      title: 'フォントサイズ',
      current: settings.fontSize === 'small' ? '小' : settings.fontSize === 'large' ? '大' : '標準',
      options: ['小', '標準', '大'],
      apply: (v) => onSetFontSize(v === '小' ? 'small' : v === '大' ? 'large' : 'medium'),
    },
    reminderRoute: {
      title: 'ルート',
      current: reminderRouteLabel,
      options: ['大学発', '松永発'],
      apply: (v) => onSetReminderRoute(v === '大学発' ? 'campus_to_station' : 'station_to_campus'),
    },
    reminderLead: {
      title: '通知するタイミング',
      current: reminderLeadLabel,
      options: LEAD_VALUES.map(([, label]) => label),
      apply: (v) => {
        const entry = LEAD_VALUES.find(([, label]) => label === v)
        if (entry) onSetReminderLead(Number(entry[0]) as ReminderLead)
      },
    },
    reminderDays: {
      title: '通知する曜日',
      current: reminderDaysLabel,
      options: ['平日のみ', '毎日'],
      apply: (v) => onSetReminderDays(v === '毎日' ? EVERYDAY_MASK : WEEKDAYS_MASK),
    },
  }

  // 選択しても自動では戻らない。設定を反映するだけで、サブスクリーンは
  // ユーザーが「設定」(戻る)を押すまで開いたままにする。
  const select = (v: string) => {
    if (!selKey) return
    SELECTS[selKey].apply(v)
  }

  // 閉時の inert 化、開いた直後の初期フォーカス、閉時のフォーカス復帰。
  // Escape はサブ画面を開いていればサブ画面を、そうでなければ設定画面を閉じる。
  const rootRef = useOverlayA11y(open, {
    onEscape: () => { if (selKey) closeSelect(); else onClose() },
  })

  // サブ画面（選択リスト）を開いている間は背後の設定一覧を操作対象から外す
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setInert(listRef.current, selKey !== null) }, [selKey])

  // 画面を閉じたらサブ画面も畳む
  useEffect(() => { if (!open) setSelKey(null) }, [open])

  // サブ画面の開閉時のフォーカス移動（開いたら「設定」(戻る)へ、閉じたら元の行へ）
  const subRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!selKey) return
    subRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [selKey])

  const openSelect = (key: SelectKey) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    setSelKey(key)
  }

  const closeSelect = () => {
    setSelKey(null)
    const prev = returnFocusRef.current
    returnFocusRef.current = null
    // 設定一覧の inert 解除（再描画後の effect）を待ってから戻す
    setTimeout(() => {
      if (prev && document.contains(prev)) prev.focus()
    }, 0)
  }

  return (
    /* fixed: ビューポート基準の全画面パネル。touchAction: NavBar 等起点の
       背後 body への貫通スクロールを防ぐ（詳細は DrawerMenu.tsx のコメント参照） */
    <div ref={rootRef} aria-hidden={!open} style={{ position: 'fixed', inset: 0, background: 'var(--bg-page)', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.32s cubic-bezier(.4,0,.2,1), background 0.35s', zIndex: 50, display: 'flex', flexDirection: 'column', touchAction: 'pinch-zoom' }}>
      <NavBar title="設定" onBack={onClose} covered={selKey !== null} />

      {/* スクローラ（contain + 常時スクロール可能化。露出色 = --bg-page） */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ minHeight: 'calc(100% + 1px)', padding: '20px 16px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* 表示セクション */}
        <Section label="表示">
          <SettingRow icon={IconRouteSwap} tone="green" title="デフォルトルート" sub="起動時に最初に表示するルート" value={SELECTS.route.current} onClick={() => openSelect('route')} />
          <SettingRow icon={IconContrast} tone="violet" title="カラーテーマ" sub="背景の表示モード" value={SELECTS.theme.current} onClick={() => openSelect('theme')} />
          <SettingRow icon={IconFontSize} tone="amber" title="フォントサイズ" sub="時刻の文字の大きさ" value={SELECTS.font.current} onClick={() => openSelect('font')} />
        </Section>

        {/* 通知セクション（「近日公開」のプレースホルダをこの実装で置き換えた） */}
        <Section label="通知">
          <ReminderSection
            reminder={reminder}
            onOpenSelect={openSelect}
            routeLabel={reminderRouteLabel}
            leadLabel={reminderLeadLabel}
            daysLabel={reminderDaysLabel}
          />
        </Section>

        {/* アプリ情報 */}
        <Section label="アプリ情報">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
            <IconTile icon={IconInfo} tone="indigo" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>バージョン</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>最新の状態です</div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>{__APP_VERSION__}</span>
          </div>
        </Section>
        </div>{/* / 内側ラッパー */}
      </div>

      {/* 選択サブスクリーン */}
      {selKey && (
        <div ref={subRef} style={{ position: 'absolute', inset: 0, background: 'var(--bg-page)', transform: selKey ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s cubic-bezier(.4,0,.2,1), background 0.35s', zIndex: 60, display: 'flex', flexDirection: 'column', overflow: 'hidden', touchAction: 'pinch-zoom' }}>
          <NavBar title={SELECTS[selKey].title} onBack={closeSelect} backLabel="設定" />
          <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            <div style={{ minHeight: 'calc(100% + 1px)', padding: '20px 16px' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 18, overflow: 'hidden', transition: 'background 0.35s' }}>
              {SELECTS[selKey].options.map((opt, i) => {
                const isSelected = opt === SELECTS[selKey].current
                return (
                  <button
                    type="button"
                    key={opt}
                    onClick={() => select(opt)}
                    aria-pressed={isSelected}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', textAlign: 'left', font: 'inherit',
                      padding: '16px 18px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: i < SELECTS[selKey].options.length - 1 ? '.5px solid var(--border)' : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: isSelected ? 700 : 500, color: isSelected ? '#10b981' : 'var(--text-primary)' }}>{opt}</span>
                    <span aria-hidden="true" style={{ fontSize: 17, color: '#10b981', opacity: isSelected ? 1 : 0, transition: 'opacity 0.15s' }}>✓</span>
                  </button>
                )
              })}
            </div>
            </div>{/* / 内側ラッパー */}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.1px', textTransform: 'uppercase', padding: '0 4px 8px' }}>{label}</div>
      <div style={{ background: 'var(--bg-card)', borderRadius: 18, overflow: 'hidden', transition: 'background 0.35s' }}>{children}</div>
    </div>
  )
}
