import { useState, useCallback, useRef } from 'react'

interface ToastState {
  message: string
  visible: boolean
}

export function useToast() {
  const [toast, setToast] = useState<ToastState>({ message: '', visible: false })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, duration = 2200) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ message, visible: true })
    timerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }))
    }, duration)
  }, [])

  return { toast, showToast }
}

interface ToastProps {
  message: string
  visible: boolean
}

export function Toast({ message, visible }: ToastProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '60px',
        left: '50%',
        transform: `translateX(-50%) translateY(${visible ? '0' : '-8px'})`,
        background: 'rgba(15,23,42,0.88)',
        color: 'white',
        fontSize: '12px',
        fontWeight: 600,
        padding: '8px 16px',
        borderRadius: '20px',
        whiteSpace: 'nowrap',
        zIndex: 200,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s, transform 0.2s',
        pointerEvents: 'none',
        backdropFilter: 'blur(8px)',
      }}
    >
      {message}
    </div>
  )
}
