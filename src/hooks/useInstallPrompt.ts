export function useInstallPrompt(): { shouldShow: boolean } {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

  return { shouldShow: isMobile && !isStandalone }
}
