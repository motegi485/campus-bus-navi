import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

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

function resyncBp() {
  syncBpActiveClass()
  // iPad PWA は再起動直後 screen.* / matchMedia の値が遅れて更新されることがあるため、
  // 次フレームでも再評価して取りこぼしを防ぐ
  requestAnimationFrame(syncBpActiveClass)
}

async function main() {
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

  resyncBp()

  // orientation 変化（回転）
  screen.orientation?.addEventListener('change', syncBpActiveClass)

  // matchMedia の変化（orientation / breakpoint しきい値）
  window.matchMedia('(orientation: portrait)').addEventListener('change', syncBpActiveClass)
  window.matchMedia('(min-width: 1024px)').addEventListener('change', syncBpActiveClass)

  // viewport サイズ変更（ウィンドウリサイズ等）
  window.addEventListener('resize', syncBpActiveClass)

  // PWA が前面に出るたびに再評価
  // iPad PWA で 2 回目以降の起動時に screen.* が前回セッションの古い値を返す問題への対策
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resyncBp()
  })

  // pageshow（BFCache からの復元時も含めて発火）
  window.addEventListener('pageshow', resyncBp)

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
