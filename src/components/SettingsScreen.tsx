import { useState } from 'react'
import type { AppSettings, DefaultRoute, Theme, FontSize } from '../types/timetable'

interface Props {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onSetDefaultRoute: (v: DefaultRoute) => void
  onSetTheme: (v: Theme) => void
  onSetFontSize: (v: FontSize) => void
}

type SelectKey = 'route' | 'theme' | 'font'

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#10b981', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}>
      <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8.5 1.5L1.5 8L8.5 14.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      {label}
    </button>
  )
}

function NavBar({ title, onBack, backLabel = '戻る' }: { title: string; onBack: () => void; backLabel?: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
      <BackButton label={backLabel} onClick={onBack} />
      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.3px' }}>{title}</span>
    </div>
  )
}

function SettingRow({ icon, iconBg, title, sub, value, onClick }: { icon: string; iconBg: string; title: string; sub: string; value: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderBottom: '.5px solid var(--border)', cursor: 'pointer', transition: 'background 0.12s' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>{value}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>›</span>
      </div>
    </div>
  )
}

export function SettingsScreen({ open, settings, onClose, onSetDefaultRoute, onSetTheme, onSetFontSize }: Props) {
  const [selKey, setSelKey] = useState<SelectKey | null>(null)

  const SELECTS: Record<SelectKey, { title: string; current: string; options: string[]; apply: (v: string) => void }> = {
    route: {
      title: 'デフォルトルート',
      current: settings.defaultRoute === 'campus_to_station' ? '大学発' : '駅発',
      options: ['大学発', '駅発'],
      apply: (v) => onSetDefaultRoute(v === '大学発' ? 'campus_to_station' : 'station_to_campus'),
    },
    theme: {
      title: 'カラーテーマ',
      current: settings.theme === 'light' ? 'ライト' : 'ダーク',
      options: ['ライト', 'ダーク'],
      apply: (v) => onSetTheme(v === 'ライト' ? 'light' : 'dark'),
    },
    font: {
      title: 'フォントサイズ',
      current: settings.fontSize === 'small' ? '小' : settings.fontSize === 'large' ? '大' : '標準',
      options: ['小', '標準', '大'],
      apply: (v) => onSetFontSize(v === '小' ? 'small' : v === '大' ? 'large' : 'medium'),
    },
  }

  const selectAndClose = (v: string) => {
    if (!selKey) return
    SELECTS[selKey].apply(v)
    setTimeout(() => setSelKey(null), 200)
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-page)', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.32s cubic-bezier(.4,0,.2,1), background 0.35s', zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 44, overflow: 'hidden' }}>
      <NavBar title="設定" onBack={onClose} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* 表示セクション */}
        <Section label="表示">
          <SettingRow icon="🚌" iconBg="#d1fae5" title="デフォルトルート" sub="起動時に最初に表示するルート" value={SELECTS.route.current} onClick={() => setSelKey('route')} />
          <SettingRow icon="🎨" iconBg="#ede9fe" title="カラーテーマ" sub="背景の表示モード" value={SELECTS.theme.current} onClick={() => setSelKey('theme')} />
          <SettingRow icon="🔤" iconBg="#fef3c7" title="フォントサイズ" sub="時刻の文字の大きさ" value={SELECTS.font.current} onClick={() => setSelKey('font')} />
        </Section>

        {/* 通知セクション（将来拡張用） */}
        <Section label="通知">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#fce7f3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🔔</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>発車リマインダー</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>発車X分前に通知</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: 'var(--bg-input)', color: 'var(--text-muted)' }}>近日公開</span>
          </div>
        </Section>

        {/* アプリ情報 */}
        <Section label="アプリ情報">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>ℹ️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>バージョン</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>最新の状態です</div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>{__APP_VERSION__}</span>
          </div>
        </Section>
      </div>

      {/* 選択サブスクリーン */}
      {selKey && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-page)', transform: selKey ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s cubic-bezier(.4,0,.2,1), background 0.35s', zIndex: 60, display: 'flex', flexDirection: 'column', borderRadius: 44, overflow: 'hidden' }}>
          <NavBar title={SELECTS[selKey].title} onBack={() => setSelKey(null)} backLabel="設定" />
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 18, overflow: 'hidden', transition: 'background 0.35s' }}>
              {SELECTS[selKey].options.map((opt, i) => {
                const isSelected = opt === SELECTS[selKey].current
                return (
                  <div
                    key={opt}
                    onClick={() => selectAndClose(opt)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '16px 18px',
                      borderBottom: i < SELECTS[selKey].options.length - 1 ? '.5px solid var(--border)' : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: isSelected ? 700 : 500, color: isSelected ? '#10b981' : 'var(--text-primary)' }}>{opt}</span>
                    <span style={{ fontSize: 17, color: '#10b981', opacity: isSelected ? 1 : 0, transition: 'opacity 0.15s' }}>✓</span>
                  </div>
                )
              })}
            </div>
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
