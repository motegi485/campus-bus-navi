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
