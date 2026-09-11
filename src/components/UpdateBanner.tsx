import { usePressable } from '../hooks/usePressable'
import { tapFeedback } from '../utils/haptics'
import { fs } from '../utils/fontScale'

interface UpdateBannerProps {
  onUpdate: () => void
  onDismiss: () => void
}

/**
 * 新しいService Workerが検知されたときに画面下部に表示するバナー
 * registerType: 'prompt' との組み合わせで使用する
 * 「更新」タップ時に updateServiceWorker(true) を呼び出しアプリを再起動
 * 「あとで」タップ時は onDismiss でバナーを閉じる（セッション中は再表示しない）
 */
export function UpdateBanner({ onUpdate, onDismiss }: UpdateBannerProps) {
  const dismissPress = usePressable()
  const updatePress = usePressable()

  return (
    <div
      // 新しいバージョンの検知は、画面を見ていないと分からない状態変化なので
      // 支援技術へも通知する。操作を中断させたい性質ではないので polite
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '32px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(15,23,42,0.92)',
        color: 'white',
        padding: '12px 20px',
        borderRadius: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        fontSize: fs(13),
        fontWeight: 600,
        backdropFilter: 'blur(8px)',
        // レイヤー: 全時刻表シート(z-45/46) < NewsScreen等(50) < MobilePwaGuide(100) < UpdateBanner(110)
        zIndex: 110,
        // 文字サイズ「大」+ 狭い画面幅では1行の幅が画面をはみ出しうるため、
        // 画面端に余白を残す maxWidth を設け、あふれる場合だけ折り返す
        // （幅・余白・角丸など他の見た目は変えない。実測: 320px幅で「大」設定時に
        // 1行の必要幅が約320pxとほぼ余白ゼロになることを確認済み）。
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <span>更新データがあります</span>
      <button
        onClick={() => { tapFeedback(8); onDismiss() }}
        {...dismissPress.pressHandlers}
        style={{
          color: 'rgba(255,255,255,0.7)',
          fontWeight: 600,
          fontSize: fs(13),
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '12px 8px',
          transform: dismissPress.pressed ? 'scale(.93)' : 'scale(1)',
          transition: 'transform .12s ease-out',
        }}
      >
        あとで
      </button>
      <button
        onClick={() => { tapFeedback(10); onUpdate() }}
        {...updatePress.pressHandlers}
        style={{
          // バナーはテーマに関わらず暗い面（rgba(15,23,42,.92)）なので、
          // テーマで反転する --ui-accent-fg ではなく固定側のトークンを使う
          color: 'var(--ui-accent-on-dark)',
          fontWeight: 800,
          fontSize: fs(13),
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '12px 8px',
          transform: updatePress.pressed ? 'scale(.93)' : 'scale(1)',
          transition: 'transform .12s ease-out',
        }}
      >
        更新
      </button>
    </div>
  )
}
