import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

function syncBpActiveClass() {
  // iPadOS PWA バグ対策:
  // window.innerWidth は再起動直後に誤った値（実際820pxなのに1280px等）に膨張する。
  // screen.width / screen.height / screen.orientation.type は OS レベルで信頼できる。
  
  const isLandscape = screen.orientation
    ? screen.orientation.type.startsWith('landscape')
    : screen.width > screen.height  // fallback
  
  // screen.width/height の回転挙動はブラウザ差があるため、長辺・短辺で扱う
  const longSide = Math.max(screen.width, screen.height)
  const shortSide = Math.min(screen.width, screen.height)
  const currentWidth = isLandscape ? longSide : shortSide
  
  // 元の bp 条件 (min-width: 1024px) OR (landscape AND min-width: 480px) を JS で評価
  const shouldApplyBp = currentWidth >= 1024 || (isLandscape && currentWidth >= 480)
  
  document.documentElement.classList.toggle('bp-active', shouldApplyBp)
}

syncBpActiveClass()
screen.orientation?.addEventListener('change', syncBpActiveClass)

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('index.html に <div id="root"> が見つかりません。')
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
