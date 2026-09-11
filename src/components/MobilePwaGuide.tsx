import { Export, Plus, DotsThreeVertical, DownloadSimple, DotsThree } from '@phosphor-icons/react'
import { isIOS, isAndroid, isStandalone } from '../utils/platform'
import { useOverlayA11y } from '../hooks/useOverlayA11y'
import { fs } from '../utils/fontScale'

const STORAGE_KEY = 'campusBusNaviMobilePwaDismissed'

/**
 * 初回に案内を出すべき端末か。
 *
 * 開閉状態は App が持つ。`aria-modal` を名乗る以上、背面を inert にする必要があり、
 * それは App の共通オーバーレイ管理（backgroundRef）にしかできないため
 * （自分の中に状態を閉じ込めると、背面へフォーカスが抜ける）。
 */
export function shouldShowMobilePwaGuide(): boolean {
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

/** 「今後表示しない」を記録する。保存できなくても案内は閉じる */
function rememberDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true')
  } catch {
    // 保存できなくてもモーダルは閉じる
  }
}

// ブラウザの操作案内に使う Phosphor アイコン
function ShareIcon() {
  return (
    <Export size={16} weight="regular" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  )
}

function PlusIcon() {
  return (
    <Plus size={16} weight="bold" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  )
}

function MoreVerticalIcon() {
  return (
    <DotsThreeVertical size={16} weight="bold" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  )
}

function DownloadIcon() {
  return (
    <DownloadSimple size={16} weight="regular" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  )
}

function StepNumber({ n }: { n: number }) {
  return (
    <span style={{
      flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
      background: 'var(--ui-accent-grad)', color: '#fff',
      fontSize: fs(12), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{n}</span>
  )
}

function MoreHorizontalIcon() {
  return (
    <DotsThree size={16} weight="bold" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  )
}

interface Props {
  open: boolean
  onClose: () => void
}

export function MobilePwaGuide({ open, onClose }: Props) {
  /**
   * 初期フォーカス・復帰・Escape・自身が閉じている間の inert は共通フックへ寄せる
   * （他のオーバーレイと同じ契約にする）。背面を inert にするのは App の役目。
   */
  const rootRef = useOverlayA11y(open, { onEscape: onClose })

  const android = isAndroid()
  const ios = isIOS()

  const handleDismiss = () => {
    rememberDismissed()
    onClose()
  }

  // 閉じている間は DOM ごと外す。開閉アニメーションを持たないので残す必要がない
  if (!open) return null

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={android ? 'アプリをインストール' : 'ホーム画面に追加'}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        // backdrop 起点のタッチで背後の body がスクロールする「貫通」を防ぐ
        touchAction: 'pinch-zoom',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto',
          // カード内が溢れた場合のスクロールを外（body）へ連鎖させない。
          // バウンス/ストレッチはカード自身が担う（露出色 = カード背景 --bg-card）
          overscrollBehavior: 'contain',
          background: 'var(--bg-card)', color: 'var(--text-primary)',
          borderRadius: 22, padding: 22,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <h2 style={{ fontSize: fs(18), fontWeight: 800, marginBottom: 10, letterSpacing: '-.3px' }}>
          アプリをインストールして使う
        </h2>
        <p style={{ fontSize: fs(13), color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 18 }}>
          ホーム画面に追加（インストール）すると、モバイルアプリとして使用できます。
        </p>

        <ol style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: fs(13.5), marginBottom: 18 }}>
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
              padding: '9px 14px', borderRadius: 12, fontSize: fs(13), fontWeight: 600,
              background: 'transparent', color: 'var(--text-muted)',
              border: 'none', cursor: 'pointer',
            }}
          >
            今後表示しない
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 18px', borderRadius: 12, fontSize: fs(13), fontWeight: 700,
              background: 'var(--ui-accent-grad)', color: '#fff',
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
