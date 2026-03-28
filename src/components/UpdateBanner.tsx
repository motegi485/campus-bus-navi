interface UpdateBannerProps {
  onUpdate: () => void
}

/**
 * 新しいService Workerが検知されたときに画面下部に表示するバナー
 * registerType: 'prompt' との組み合わせで使用する
 * 「更新」タップ時に updateServiceWorker(true) を呼び出しアプリを再起動
 */
export function UpdateBanner({ onUpdate }: UpdateBannerProps) {
  return (
    <div
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
        gap: '12px',
        fontSize: '13px',
        fontWeight: 600,
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        whiteSpace: 'nowrap',
      }}
    >
      <span>新しいバージョンがあります</span>
      <button
        onClick={onUpdate}
        style={{
          color: '#34d399',
          fontWeight: 800,
          fontSize: '13px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        更新
      </button>
    </div>
  )
}
