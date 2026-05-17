// 診断用：起動直後のビューポート関連の値を画面に表示
function showDiagnostic(label: string) {
  const data = {
    label,
    'innerWidth': window.innerWidth,
    'innerHeight': window.innerHeight,
    'screen.width': screen.width,
    'screen.height': screen.height,
    'orientation.type': screen.orientation?.type ?? 'undefined',
    'orientation.angle': screen.orientation?.angle ?? 'undefined',
    'mm:portrait': window.matchMedia('(orientation: portrait)').matches,
    'mm:landscape': window.matchMedia('(orientation: landscape)').matches,
    'mm:min1024': window.matchMedia('(min-width: 1024px)').matches,
    'standalone': window.matchMedia('(display-mode: standalone)').matches,
  }
  
  const id = `diag-${label}`
  let div = document.getElementById(id)
  if (!div) {
    div = document.createElement('div')
    div.id = id
    div.style.cssText = 'position:fixed;left:8px;right:8px;z-index:99999;background:rgba(0,0,0,0.85);color:#0f0;padding:8px;font-size:11px;font-family:monospace;white-space:pre;border-radius:6px;line-height:1.4;'
    div.style.top = `${8 + 140 * document.querySelectorAll('[id^="diag-"]').length}px`
    document.body?.appendChild(div) ?? document.documentElement.appendChild(div)
  }
  div.textContent = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n')
}

// 起動直後（同期実行）
showDiagnostic('T0_sync')

// 次フレーム（iOSがビューポートを修正する猶予を与えた後）
requestAnimationFrame(() => showDiagnostic('T1_raf'))

// 100ms後
setTimeout(() => showDiagnostic('T2_100ms'), 100)

// 1秒後
setTimeout(() => showDiagnostic('T3_1s'), 1000)

function syncOrientationClass() {
  const isLandscape = screen.orientation
    ? screen.orientation.type.startsWith('landscape')
    : window.innerWidth > window.innerHeight          // iOS 16.4未満のfallback
  document.documentElement.classList.toggle('landscape', isLandscape)
}

syncOrientationClass()                                            // 初回・即時実行
screen.orientation?.addEventListener('change', syncOrientationClass) // 回転時に追従

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('index.html に <div id="root"> が見つかりません。')
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
