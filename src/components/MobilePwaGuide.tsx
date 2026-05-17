import { useEffect, useState } from 'react'

const STORAGE_KEY = 'campusBusNaviMobilePwaDismissed'

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPhone|iPod/.test(navigator.userAgent)) return true
  if (/iPad/.test(navigator.userAgent)) return true
  // iPadOS 13+ はデスクトップ UA ("Macintosh") を送るため UA だけでは判定不可。
  // タッチ対応 Mac は存在しないので maxTouchPoints で補完する。
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true
  return false
}

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/.test(navigator.userAgent)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

function shouldShow(): boolean {
  if (typeof window === 'undefined') return false
  if (!isIOS() && !isAndroid()) return false
  if (isStandalone()) return false
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'true') return false
  } catch {
    // localStorage が使えない場合も表示は試みる
  }
  return true
}

// アイコン（プロジェクト既存スタイルに合わせインラインSVG）
function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function MoreVerticalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function StepNumber({ n }: { n: number }) {
  return (
    <span style={{
      flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
      background: 'linear-gradient(135deg,#0d9966,#34d399)', color: '#fff',
      fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{n}</span>
  )
}

function MoreHorizontalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      {/* cx (X座標) を 5, 12, 19 と横に並べています */}
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  )
}

export function MobilePwaGuide() {
  // 初期表示時のチラつきを避けるため lazy initializer で判定
  const [open, setOpen] = useState<boolean>(() => shouldShow())

  // Esc キーで閉じる
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const android = isAndroid()
  const ios = isIOS()

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // 保存できなくてもモーダルは閉じる
    }
    setOpen(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={android ? 'アプリをインストール' : 'ホーム画面に追加'}
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--bg-card)', color: 'var(--text-primary)',
          borderRadius: 22, padding: 22,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 10, letterSpacing: '-.3px' }}>
          アプリをインストールして使う
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 18 }}>
          ホーム画面に追加（インストール）すると、モバイルアプリとして使用できます。
        </p>

        <ol style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13.5, marginBottom: 18 }}>
          {ios && (
            <>
              <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <StepNumber n={1} />
                <span>
                  Safari のメニュー<MoreHorizontalIcon/>から共有<ShareIcon /> をタップ
                </span>
              </li>
              <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <StepNumber n={2} />
                <span>
                  「ホーム画面に追加」 <PlusIcon /> を選択
                </span>
              </li>
            </>
          )}
          {android && (
            <>
              <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <StepNumber n={1} />
                <span>
                  ブラウザ右上の <MoreVerticalIcon /> をタップ
                </span>
              </li>
              <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <StepNumber n={2} />
                <span>
                  ホーム画面に追加 <DownloadIcon /> からインストールを選択
                </span>
              </li>
            </>
          )}
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <StepNumber n={3} />
            <span>ホーム画面のアイコンから起動</span>
          </li>
        </ol>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button
            type="button"
            onClick={handleDismiss}
            style={{
              padding: '9px 14px', borderRadius: 12, fontSize: 13, fontWeight: 600,
              background: 'transparent', color: 'var(--text-muted)',
              border: 'none', cursor: 'pointer',
            }}
          >
            今後表示しない
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              padding: '9px 18px', borderRadius: 12, fontSize: 13, fontWeight: 700,
              background: 'linear-gradient(135deg,#0d9966,#34d399)', color: '#fff',
              border: 'none', cursor: 'pointer',
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
