import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

/*
  iPad(WebKit) 縦潰れ不具合の対処メモ:
    真因 = Safari の「shrink-to-fit」。再起動後に一瞬 820px を超える要素が描画されると、
           iOS がレイアウト幅を広げ(1280) ページ全体を縮小描画(scale≈0.64)していた。
    対処 = index.html の viewport メタに「shrink-to-fit=no」を付与（← これが実際の修正本体）。
           <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, shrink-to-fit=no" />
  このファイル側では bp-active(横2カラム判定) と --app-height(実高さ) の同期のみを担当する。
*/

// bp-active（PC/横向き2カラム）判定
//   iPadOS PWA バグ対策:
//   - window.innerWidth はビューポート膨張バグで誤った値を返すことがある（実820pxなのに1280px等）
//   - screen.orientation.type は 2 回目以降の起動時に前回セッションの古い値を返すことがある
//   - 複数ソースで AND 条件を取り、すべて landscape の時のみ landscape と判定する（誤検出回避）
function syncBpActiveClass() {
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
// App.tsx 側は min-height: var(--app-height, 100vh) を使用する。
function syncAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  if (h > 0) {
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`)
  }
}

// bp と 高さ をまとめて再評価。iPad PWA は復帰直後に値が遅れて確定するため、
// 次フレーム + 250ms 後にも再評価して取りこぼしを防ぐ。
function resync() {
  syncBpActiveClass()
  syncAppHeight()
  requestAnimationFrame(() => { syncBpActiveClass(); syncAppHeight() })
  setTimeout(() => { syncBpActiveClass(); syncAppHeight() }, 250)
}

async function main() {
  // iOS PWA では SW バックグラウンド更新が届きにくく、旧 CSS（@media クエリ含む）が
  // キャッシュに残り続けることがある。React mount 前に待機 SW を検出して即座に適用し、
  // 旧 CSS が画面に表示される前に新 SW へ切り替える。
  if ('serviceWorker' in navigator) {
    // 待機 SW を検出してもリロードは 1 セッション 1 回までに制限する。
    // activate に失敗する端末で「起動 → 2秒待ち → リロード」が無限に続くのを防ぐガード。
    const SW_RELOAD_FLAG = 'swWaitingReloadAttempted'
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.getRegistration(),
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 500)),
      ])
      if (reg?.waiting) {
        let attempted = false
        try { attempted = sessionStorage.getItem(SW_RELOAD_FLAG) === '1' } catch { /* noop */ }
        if (!attempted) {
          try { sessionStorage.setItem(SW_RELOAD_FLAG, '1') } catch { /* noop */ }
          const waiting = reg.waiting
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, 2000)
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              clearTimeout(timer)
              resolve()
            }, { once: true })
            waiting.postMessage({ type: 'SKIP_WAITING' })
          })
          // 初期化フローのみ reload を許可（待機 SW を確実に反映するため）
          window.location.reload()
          return
        }
        // 既に試行済み: ループ防止のため今回はリロードせず通常起動を続行する
      }
      // 通常起動（リロードしない経路）に入ったのでワンショットガードを解除する
      try { sessionStorage.removeItem(SW_RELOAD_FLAG) } catch { /* noop */ }
      // 待機 SW がなければバックグラウンドで更新チェック（次回起動時に備える）
      reg?.update().catch(() => {})
    } catch {
      // SW 操作が失敗した場合はそのまま起動
    }
  }

  // 初期同期
  resync()

  // 回転・しきい値変化 → bp と高さを再評価
  screen.orientation?.addEventListener('change', resync)
  window.matchMedia('(orientation: portrait)').addEventListener('change', resync)
  window.matchMedia('(min-width: 1024px)').addEventListener('change', syncBpActiveClass)

  // リサイズ(Split View / Stage Manager 含む) / visualViewport 変化
  window.addEventListener('resize', () => { syncBpActiveClass(); syncAppHeight() })
  window.visualViewport?.addEventListener('resize', syncAppHeight)

  // 前面復帰 / BFCache 復元 → 再評価
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync()
  })
  window.addEventListener('pageshow', () => resync())

  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('index.html に <div id="root"> が見つかりません。')
  }
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

main().catch((err) => {
  console.error('アプリの初期化に失敗しました:', err)
})