import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

let vpFixAttempts = 0
function enforceViewport() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches
  const w = isLandscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height)
  const inflated = (window.visualViewport ? window.visualViewport.scale < 0.99 : false) || window.innerWidth > w + 4
  if (!inflated || vpFixAttempts > 6) return       // 膨張時のみ・最大6回まで
  vpFixAttempts++
  document.querySelector('meta[name="viewport"]')?.remove()
  const m = document.createElement('meta')
  m.name = 'viewport'
  m.content = `width=${w}, initial-scale=1, viewport-fit=cover`   // 実画面幅を数値で固定
  document.head.appendChild(m)
}
function enforceViewportSoon() {
  for (const ms of [0, 200, 500, 1000, 2000]) setTimeout(enforceViewport, ms)
}

function syncBpActiveClass() {
  // iPadOS PWA バグ対策:
  // - window.innerWidth はビューポート膨張バグで誤った値を返す（実際820pxなのに1280px等）
  // - screen.orientation.type は 2 回目以降の起動時に前回セッションの古い値を返すことがある
  // - 複数ソースで AND 条件を取り、すべて landscape の時のみ landscape と判定する（誤検出回避）

  const signals: boolean[] = []
  if (typeof window.matchMedia === 'function') {
    signals.push(window.matchMedia('(orientation: landscape)').matches)
  }
  if (screen.orientation?.type) {
    signals.push(screen.orientation.type.startsWith('landscape'))
  }

  const isLandscape = signals.length > 0
    ? signals.every(s => s)  // 全シグナル一致時のみ landscape（一つでも portrait なら portrait 扱い）
    : screen.width > screen.height  // API 未提供時の最終フォールバック

  // screen.width/height の回転挙動はブラウザ差があるため、長辺・短辺で扱う
  const longSide = Math.max(screen.width, screen.height)
  const shortSide = Math.min(screen.width, screen.height)
  const currentWidth = isLandscape ? longSide : shortSide

  // 元の bp 条件 (min-width: 1024px) OR (landscape AND min-width: 480px) を JS で評価
  const shouldApplyBp = currentWidth >= 1024 || (isLandscape && currentWidth >= 480)

  document.documentElement.classList.toggle('bp-active', shouldApplyBp)
}

// 実ビューポート高さ(px)を CSS 変数 --app-height に反映する。
// iOS/iPadOS の standalone PWA では 100dvh が(再)起動直後に正しく初期化されず、
// 回転 or リロードまで誤った高さのままになる(= UI が縦に潰れて見える主因)。
// window.innerHeight / visualViewport.height は確定後は正しいので、これを採用する。
function syncAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  if (h > 0) {
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`)
  }
}

function resync() {
  syncBpActiveClass()
  syncAppHeight()
  // iPad PWA は前面復帰直後 screen.* / innerHeight が遅れて確定するため、
  // 次フレーム + 250ms 後にも再評価して取りこぼし(縦潰れ)を防ぐ
  requestAnimationFrame(() => { syncBpActiveClass(); syncAppHeight() })
  setTimeout(() => { syncBpActiveClass(); syncAppHeight() }, 250)
}

async function main() {
  mountViewportDebugOverlay()
  // iOS PWA では SW バックグラウンド更新が届きにくく、旧 CSS（@media クエリ含む）が
  // キャッシュに残り続けることがある。React mount 前に待機 SW を検出して即座に適用し、
  // 旧 CSS が画面に表示される前に新 SW へ切り替える。
  if ('serviceWorker' in navigator) {
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.getRegistration(),
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 500)),
      ])
      if (reg?.waiting) {
        const waiting = reg.waiting
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 2000)
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
          waiting.postMessage({ type: 'SKIP_WAITING' })
        })
        window.location.reload()
        return
      }
      // 待機 SW がなければバックグラウンドで更新チェック（次回起動時に備える）
      reg?.update().catch(() => {})
    } catch {
      // SW 操作が失敗した場合はそのまま起動
    }
  }

  // 膨張を検知したら viewport を貼り直すウォッチドッグ
  resync()
  enforceViewportSoon()

  screen.orientation?.addEventListener('change', () => { vpFixAttempts = 0; resync(); enforceViewportSoon() })
  window.matchMedia('(orientation: portrait)').addEventListener('change', resync)
  window.matchMedia('(min-width: 1024px)').addEventListener('change', syncBpActiveClass)

  window.addEventListener('resize', () => { syncBpActiveClass(); syncAppHeight(); enforceViewport() })
  window.visualViewport?.addEventListener('resize', () => { syncAppHeight(); enforceViewport() })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { resync(); enforceViewportSoon() }
  })
  window.addEventListener('pageshow', () => { resync(); enforceViewportSoon() })

  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('index.html に <div id="root"> が見つかりません。')
  }
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

main()
