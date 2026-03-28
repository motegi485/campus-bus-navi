import { useState } from 'react'
import { useNews } from '../hooks/useNews'
import type { NewsItem } from '../types/timetable'

const TAG_STYLES: Record<string, { bg: string; color: string }> = {
  important: { bg: '#fee2e2', color: '#dc2626' },
  info:      { bg: '#dbeafe', color: '#2563eb' },
  change:    { bg: '#fef3c7', color: '#d97706' },
  event:     { bg: '#ede9fe', color: '#7c3aed' },
}

interface Props {
  open: boolean
  onClose: () => void
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#10b981', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}
    >
      <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
        <path d="M8.5 1.5L1.5 8L8.5 14.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {label}
    </button>
  )
}

function NewsTag({ tag, tagLabel }: { tag: string; tagLabel: string }) {
  const style = TAG_STYLES[tag] ?? TAG_STYLES.info
  return (
    <span style={{ ...style, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center' }}>
      {tagLabel}
    </span>
  )
}

function NewsDetail({ item, onBack }: { item: NewsItem; onBack: () => void }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-page)', transform: 'none', display: 'flex', flexDirection: 'column', borderRadius: 44, overflow: 'hidden', zIndex: 10, transition: 'background 0.35s' }}>
      <div style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
        <BackButton label="お知らせ" onClick={onBack} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <NewsTag tag={item.tag} tagLabel={item.tagLabel} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.date}</span>
        </div>
        <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 16, letterSpacing: '-.3px' }}>
          {item.title}
        </p>
        <div style={{ height: .5, background: 'var(--border2)', marginBottom: 16 }} />
        <div
          style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}
          dangerouslySetInnerHTML={{ __html: item.body }}
        />
      </div>
    </div>
  )
}

export function NewsScreen({ open, onClose }: Props) {
  const { news, loading, error } = useNews()
  const [readIds, setReadIds] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<NewsItem | null>(null)

  const openDetail = (item: NewsItem) => {
    setReadIds(prev => new Set([...prev, item.id]))
    setSelected(item)
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'var(--bg-page)',
      transform: open ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.32s cubic-bezier(.4,0,.2,1), background 0.35s',
      zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 44, overflow: 'hidden',
    }}>
      {/* ナビバー */}
      <div style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
        <BackButton label="戻る" onClick={onClose} />
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.3px' }}>お知らせ</span>
      </div>

      {/* リスト */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '32px 0' }}>読み込み中...</p>}
        {error && <p style={{ textAlign: 'center', color: '#ef4444', fontSize: 13, padding: '32px 0' }}>{error}</p>}
        {!loading && news.map(item => {
          const isUnread = !readIds.has(item.id) && item.unread
          return (
            <div
              key={item.id}
              onClick={() => openDetail(item)}
              style={{
                background: 'var(--bg-card)', borderRadius: 18, padding: '16px 18px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 8,
                borderLeft: isUnread ? '4px solid #10b981' : '4px solid transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <NewsTag tag={item.tag} tagLabel={item.tagLabel} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.date}</span>
              </div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>{item.title}</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {item.preview}
              </p>
              {isUnread && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 詳細スクリーン */}
      {selected && <NewsDetail item={selected} onBack={() => setSelected(null)} />}
    </div>
  )
}
