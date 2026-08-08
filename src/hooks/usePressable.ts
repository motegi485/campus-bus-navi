import { useCallback, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * タッチ／マウスの押下状態を返すフック。
 *
 * index.css の `* { -webkit-tap-highlight-color: transparent }` により
 * OS 標準の押下反応を消しているため、その代替を自前で持つ必要がある。
 * CSS の :active は iOS Safari でタッチ時に発火しないことがあるため使わない。
 *
 * disabled が true の間は pressed を立てない（更新ボタンの二度押し防止と対）。
 */
export function usePressable(disabled = false) {
  const [pressed, setPressed] = useState(false)

  const down = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (disabled) return
    // マウスは主ボタンのみ。ペン・タッチはそのまま受ける
    if (e.pointerType === 'mouse' && e.button !== 0) return
    setPressed(true)
  }, [disabled])

  const up = useCallback(() => setPressed(false), [])

  return {
    pressed,
    /** 対象要素にスプレッドする */
    pressHandlers: {
      onPointerDown: down,
      onPointerUp: up,
      onPointerLeave: up,
      onPointerCancel: up,
    },
  }
}
