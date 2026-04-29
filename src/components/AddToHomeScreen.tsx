import { useState, useEffect, useRef } from 'react'

interface Props {
  onDismiss: () => void
  onTap: () => void
}

export function AddToHomeScreen({ onDismiss, onTap }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)
  const [dragY, setDragY] = useState(0)

  const startYRef = useRef(0)
  const hasDraggedRef = useRef(false)
  const isDraggingRef = useRef(false)
  const dragYRef = useRef(0)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handleMove = (clientY: number) => {
      if (!isDraggingRef.current) return
      const delta = startYRef.current - clientY
      if (delta > 3) hasDraggedRef.current = true
      const newDragY = Math.max(0, delta)
      dragYRef.current = newDragY
      setDragY(newDragY)
    }

    const handleEnd = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      setIsDragging(false)

      if (!hasDraggedRef.current) {
        onTap()
        return
      }

      if (dragYRef.current > 40) {
        setIsDismissing(true)
        dismissTimerRef.current = setTimeout(onDismiss, 340)
      } else {
        setDragY(0)
        dragYRef.current = 0
      }
    }

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientY)
    const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientY)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', handleEnd)
    window.addEventListener('touchmove', onTouchMove)
    window.addEventListener('touchend', handleEnd)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', handleEnd)
    }
  }, [onDismiss, onTap])

  const handleStart = (clientY: number) => {
    startYRef.current = clientY
    hasDraggedRef.current = false
    isDraggingRef.current = true
    dragYRef.current = 0
    setIsDragging(true)
    setDragY(0)
  }

  const translateY = isDismissing ? -130 : isDragging ? -Math.max(0, dragY) : 0
  const opacity = isDismissing ? 0 : isDragging && dragY > 8 ? Math.max(0, 1 - dragY / 80) : 1

  return (
    <div
      onMouseDown={e => handleStart(e.clientY)}
      onTouchStart={e => handleStart(e.touches[0].clientY)}
      style={{
        position: 'fixed',
        bottom: 32,
        left: '50%',
        transform: `translateX(-50%) translateY(${translateY}px)`,
        transition: isDragging ? 'none' : 'transform 0.34s cubic-bezier(.4,0,.2,1), opacity 0.28s',
        opacity,
        zIndex: 9999,
        background: 'rgba(8, 14, 28, 0.96)',
        border: '0.5px solid rgba(255,255,255,0.13)',
        borderRadius: 28,
        padding: '10px 14px 14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        touchAction: 'none',
        userSelect: 'none',
        cursor: 'pointer',
        minWidth: 340,
        maxWidth: 'calc(100vw - 16px)',
      }}
    >
      {/* スワイプハンドル */}
      <div style={{ width: 28, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.22)', marginBottom: 12 }} />

      {/* メインコンテンツ行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        {/* アイコン */}
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: 'linear-gradient(135deg, #0d9966, #34d399)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>

        {/* テキスト */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
            ホーム画面に追加することで、モバイルアプリのように使用できます
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#10b981', marginTop: 1 }}>
            追加方法を見る →
          </div>
        </div>

        {/* × ボタン */}
        <button
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDismiss() }}
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
