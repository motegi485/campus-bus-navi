import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

/*
  iPad(WebKit) の standalone PWA / Safari で、再起動2回目以降に「UIが縦に潰れる」不具合への対応コード群。
  実機計測で判明した原因:
    - 起動直後は正しく 820幅 / scale=1 で描画される
    - その後 iOS が device-width を無視して勝手にレイアウト幅を 1280 に広げ、scale≈0.64 で縮小描画する
    - コンテンツ過幅・bp-active 誤発火・高さ(dvh) いずれも原因ではない（切り分け済み）
  対策:
    - enforceViewport(): 膨張を検知したら viewport を「実画面幅の数値」で貼り直し、scale=1 に戻す（上限つき）
  ※ mountViewportDebugOverlay は検証用の一時コード。原因/効果確認後に「呼び出し」と「定義」を削除する。
*/

// ───────────────────────────────────────────────────────────
// ★一時デバッグ用オーバーレイ（確認が済んだら削除する）
//   画面左上に inner サイズ / scale と、「820pxより右に張り出している要素」を表示する。
// ───────────────────────────────────────────────────────────
function mountViewportDebugOverlay() {
  const box = document.createElement('pre')
  box.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'z-index:99999', 'margin:0', 'padding:6px 8px',
    'max-width:100vw', 'box-sizing:border-box', 'font:9px/1.3 ui-monospace,monospace',
    'white-space:pre-wrap', 'word-break:break-all', 'color:#0f0',
    'background:rgba(0,0,0,.85)', 'pointer-events:none',
  ].join(';')
  document.body.appendChild(box)

  const vv = () => window.visualViewport
  const correct = Math.min(screen.width, screen.height) // 正しい縦持ち幅(=820)
  const log: string[] = []

  function wideEls(): string {
    const rows: { id: string; right: number }[] = []
    document.querySelectorAll('body *').forEach(node => {
      const el = node as HTMLElement
      const r = el.getBoundingClientRect()
      if (r.right > correct + 2) {
        const cls = (typeof el.className === 'string' ? el.className : '').trim().replace(/\s+/g, '.').slice(0, 38)
        rows.push({ id: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}(${Math.round(r.right)})`, right: r.right })
      }
    })
    rows.sort((a, b) => b.right - a.right)
    return rows.length ? rows.slice(0, 6).map(x => x.id).join(' ') : 'none'
  }

  function snap(label: string, scan = false) {
    log.unshift(
      `[${label}] inner ${window.innerWidth}x${window.innerHeight} scale ${vv()?.scale ?? '-'}` +
      (scan ? `\n  >${correct}px: ${wideEls()}` : '')
    )
    if (log.length > 9) log.length = 9
    box.textContent = log.join('\n')
  }

  snap('init', true)
  requestAnimationFrame(() => snap('raf', true))
  ;[100, 300, 600, 1000, 1800].forEach(ms => setTimeout(() => snap('t+' + ms, true), ms))
  window.addEventListener('resize', () => snap('resize', true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    ;[0, 300, 1000].forEach(ms => setTimeout(() => snap('vis+' + ms, true), ms))
  })
  window.addEventListener('pageshow', () => snap('pageshow', true))
}

// ───────────────────────────────────────────────────────────
// bp-active（PC/横向き2カラム）判定
//   iPadOS PWA バグ対策:
//   - window.innerWidth はビューポート膨張バグで誤った値を返す（実際820pxなのに1280px等）
//   - screen.orientation.type は 2 回目以降の起動時に前回セッションの古い値を返すことがある
//   - 複数ソースで AND 条件を取り、すべて landscape の時のみ landscape と判定する（誤検出回避）
// ───────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────
// ビューポート膨張ウォッチドッグ
//   iOS が device-width を無視して 1280 幅 / scale<1 に膨張させた場合に、
//   信頼できる screen から「実画面幅を数値で」指定し直して 820 幅 / scale=1 に戻す。
//   無限ループ防止のため、1セッションあたりの貼り直しは上限つき。
// ───────────────────────────────────────────────────────────
let vpFixAttempts = 0
function enforceViewport() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches
  const w = isLandscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height)
  const inflated = (window.visualViewport ? window.visualViewport.scale < 0.99 : false) || window.innerWidth > w + 4
  if (!inflated || vpFixAttempts > 6) return
  vpFixAttempts++
  document.querySelector('meta[name="viewport"]')?.remove()
  const m = document.createElement('meta')
  m.name = 'viewport'
  m.content = `width=${w}, initial-scale=1, viewport-fit=cover` // 実画面幅を数値で固定
  document.head.appendChild(m)
}

// iOS は膨張を「描画後しばらく経ってから」起こすため、数回に分けて検査する。
function enforceViewportSoon() {
  for (const ms of [0, 200, 500, 1000, 2000]) setTimeout(enforceViewport, ms)
}

async function main() {
  mountViewportDebugOverlay() // ★一時デバッグ: 確認後に「この行」と「上の定義」を削除する

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
        // 初期化フローのみ reload を許可（待機 SW を確実に反映するため）
        window.location.reload()
        return
      }
      // 待機 SW がなければバックグラウンドで更新チェック（次回起動時に備える）
      reg?.update().catch(() => {})
    } catch {
      // SW 操作が失敗した場合はそのまま起動
    }
  }

  // 初期同期 + 膨張チェック
  resync()
  enforceViewportSoon()

  // 回転・しきい値変化 → bp/高さ を再評価し、向きが変わったら膨張チェックもやり直す
  screen.orientation?.addEventListener('change', () => { vpFixAttempts = 0; resync(); enforceViewportSoon() })
  window.matchMedia('(orientation: portrait)').addEventListener('change', resync)
  window.matchMedia('(min-width: 1024px)').addEventListener('change', syncBpActiveClass)

  // リサイズ(Split View / Stage Manager 含む) / visualViewport 変化
  window.addEventListener('resize', () => { syncBpActiveClass(); syncAppHeight(); enforceViewport() })
  window.visualViewport?.addEventListener('resize', () => { syncAppHeight(); enforceViewport() })

  // 前面復帰 / BFCache 復元 → 再評価 + 膨張チェック
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