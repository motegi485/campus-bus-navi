import { useEffect } from 'react'

/**
 * 開いている間だけ背面（ドキュメント）のスクロールを止める。
 *
 * このアプリはページ全体がドキュメントスクロールで、iOS では
 * `html.bounce-native`（useNativeBounce）がルートの縦オーバースクロールを
 * 解放している。全時刻表シートは上端 58px を残す部分オーバーレイなので、
 * ロックしないとシートの非スクロール領域（グラバーやヘッダー）を指でなぞった
 * だけで背後のホームが動いてしまう。
 *
 * `body` の `overflow: hidden` だけでは iOS のタッチスクロールを確実には
 * 止められないため、`position: fixed` で body を流れから外し、
 * ドキュメントにスクロールできる高さを残さない形にする。`top` に現在の
 * スクロール量を負で入れるので見た目は動かず、解除時に同じ位置へ戻す。
 * `position: fixed` の子（シート・タブバー・クッション）は transform 等を持つ
 * 祖先がない限りビューポート基準のままなので、この操作の影響を受けない。
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return
    const body = document.body
    const scrollY = window.scrollY
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    }

    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `${-scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'

    return () => {
      body.style.overflow = previous.overflow
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.left = previous.left
      body.style.right = previous.right
      body.style.width = previous.width
      // 流れへ戻した時点でスクロールは 0 になっているため、必ず元へ戻す
      window.scrollTo(0, scrollY)
    }
  }, [locked])
}
