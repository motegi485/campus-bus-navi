import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * 下からのシートを「上端のグラバーを下へ引く」操作で閉じられるようにする。
 *
 * 参照実装（ToDo-Reminder の BottomSheet）と同じく touch イベントで指に追従させる。
 * ハンドル側に `touch-action: none` を付けておくこと（ハンドル上での
 * ブラウザ既定のスクロールを止め、touchmove の preventDefault を確実にする）。
 *
 * 閉じる／戻すの見た目は `.sheet-panel` の transform トランジションに委ね、
 * ドラッグ中だけインラインの transform でそれを上書きする。
 */

/** ここまで引いたら閉じる（px）。浅いドラッグは元の位置へ戻す */
const CLOSE_THRESHOLD = 80

/** 閉じアニメ（.sheet-panel は .34s）が終わってからインライン指定を消す（ms） */
const CLEAR_DELAY = 380

export function useSheetDragToClose(
  panelRef: RefObject<HTMLElement>,
  handleRef: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
): void {
  // 呼び出し側の onClose は毎レンダー作り直される（App は時計で毎秒再描画する）。
  // 依存に入れるとドラッグ中にリスナーが張り直されて状態が飛ぶため、ref で最新を持つ。
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // ドラッグで書いたインラインの transform を掃除する。
  // 開くときは即座に消さないと、閉じるときに書いた translateY(100%) が残って
  // シートが出てこない。閉じるときはアニメが終わってから消す（.sheet-panel-closed
  // が同じ位置を保つので見た目は動かない）。
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const clear = () => {
      panel.style.transition = ''
      panel.style.transform = ''
    }

    if (open) {
      clear()
      return
    }
    const timer = setTimeout(clear, CLEAR_DELAY)
    return () => clearTimeout(timer)
  }, [open, panelRef])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const handle = handleRef.current
    if (!panel || !handle) return

    let startY = 0
    let delta = 0
    let dragging = false

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      dragging = true
      startY = touch.clientY
      delta = 0
      panel.style.transition = 'none' // ドラッグ中は指に追従させる
    }

    const onMove = (e: TouchEvent) => {
      if (!dragging) return
      const touch = e.touches[0]
      if (!touch) return
      e.preventDefault() // ハンドル上での背面スクロールを抑止
      // 上方向は 0 で止める。シートは上端が固定で、上へは伸びない
      delta = Math.max(0, touch.clientY - startY)
      panel.style.transform = `translateY(${delta}px)`
    }

    const onEnd = () => {
      if (!dragging) return
      dragging = false
      panel.style.transition = '' // ここから先はクラス側のトランジションで動かす

      if (delta > CLOSE_THRESHOLD) {
        // 指の位置を起点にそのまま下へ抜けさせる（一度 0 へ戻る跳ねを作らない）
        panel.style.transform = 'translateY(100%)'
        closeRef.current()
        return
      }
      panel.style.transform = '' // 元の位置へスプリングバック
    }

    handle.addEventListener('touchstart', onStart, { passive: true })
    handle.addEventListener('touchmove', onMove, { passive: false })
    handle.addEventListener('touchend', onEnd)
    handle.addEventListener('touchcancel', onEnd)
    return () => {
      handle.removeEventListener('touchstart', onStart)
      handle.removeEventListener('touchmove', onMove)
      handle.removeEventListener('touchend', onEnd)
      handle.removeEventListener('touchcancel', onEnd)
    }
  }, [open, panelRef, handleRef])
}
