/** iOS/iPadOS 判定。iPadOS 13+ はデスクトップ UA（Macintosh）を送るため maxTouchPoints で補完する */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/.test(navigator.userAgent)
}

/**
 * ホーム画面に追加した PWA として起動しているか。
 *
 * iOS の Web Push は「ホーム画面に追加した PWA」でしか動かず（Safari のタブでは
 * Notification 自体が未定義のことがある）、通知 UI の出し分けに必要なので
 * MobilePwaGuide から移してここで共有する。
 * navigator.standalone は iOS 独自の非標準プロパティ。
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}
