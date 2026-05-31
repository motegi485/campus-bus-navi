import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

function mountViewportDebugOverlay() {
  const box = document.createElement('pre')
  box.style.cssText = [
    'position:fixed','top:0','left:0','z-index:99999','margin:0','padding:6px 8px',
    'max-width:100vw','box-sizing:border-box','font:9px/1.3 ui-monospace,monospace',
    'white-space:pre-wrap','word-break:break-all','color:#0f0',
    'background:rgba(0,0,0,.85)','pointer-events:none',
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

  resync()

  // 前面復帰 / BFCache 復元 → viewport を作り直してスケールを戻してから再評価
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync()
  })
  window.addEventListener('pageshow', () => resync())

  // 回転・しきい値変化
  screen.orientation?.addEventListener('change', resync)
  window.matchMedia('(orientation: portrait)').addEventListener('change', resync)
  window.matchMedia('(min-width: 1024px)').addEventListener('change', syncBpActiveClass)

  // リサイズ(Split View / Stage Manager 含む)
  window.addEventListener('resize', () => { syncBpActiveClass(); syncAppHeight() })
  window.visualViewport?.addEventListener('resize', syncAppHeight)

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
