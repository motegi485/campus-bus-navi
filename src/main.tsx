import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// === 一時デバッグ: ビューポート計測オーバーレイ（原因確定後に削除） ===
function mountViewportDebugOverlay() {
  const box = document.createElement('pre')
  box.style.cssText = [
    'position:fixed','top:0','left:0','z-index:99999','margin:0','padding:6px 8px',
    'max-width:100vw','box-sizing:border-box','font:10px/1.35 ui-monospace,monospace',
    'white-space:pre-wrap','word-break:break-all','color:#0f0',
    'background:rgba(0,0,0,.82)','pointer-events:none',
  ].join(';')
  document.body.appendChild(box)

  const vv = () => window.visualViewport
  const mm = (q: string) => window.matchMedia(q).matches
  const appH = () => getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim() || '(unset)'
  const log: string[] = []

  function snap(label: string) {
    const shell = document.querySelector('.phone-shell-inner') as HTMLElement | null
    const r = shell?.getBoundingClientRect()
    log.unshift(
      `[${new Date().toLocaleTimeString()}] ${label}\n` +
      ` inner ${window.innerWidth}x${window.innerHeight} client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}\n` +
      ` vv ${Math.round(vv()?.width ?? -1)}x${Math.round(vv()?.height ?? -1)} scale ${vv()?.scale ?? '-'} offTop ${Math.round(vv()?.offsetTop ?? -1)}\n` +
      ` screen ${screen.width}x${screen.height} avail ${screen.availWidth}x${screen.availHeight} dpr ${window.devicePixelRatio}\n` +
      ` orient ${screen.orientation?.type ?? '-'}(${screen.orientation?.angle ?? '-'}) mmLand ${mm('(orientation: landscape)')} mm1024 ${mm('(min-width:1024px)')}\n` +
      ` bp-active ${document.documentElement.classList.contains('bp-active')} --app-height ${appH()} standalone ${(navigator as any).standalone}\n` +
      ` shell ${r ? Math.round(r.width) + 'x' + Math.round(r.height) : '-'}`
    )
    if (log.length > 8) log.length = 8
    box.textContent = log.join('\n----\n')
  }

  snap('init')
  requestAnimationFrame(() => snap('raf'))
  ;[100, 300, 600, 1200].forEach(ms => setTimeout(() => snap('t+' + ms), ms))
  window.addEventListener('resize', () => snap('resize'))
  window.addEventListener('orientationchange', () => setTimeout(() => snap('orientationchange'), 300))
  vv()?.addEventListener('resize', () => snap('vv-resize'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    snap('visible'); requestAnimationFrame(() => snap('visible+raf'))
    ;[200, 600, 1200].forEach(ms => setTimeout(() => snap('visible+' + ms), ms))
  })
  window.addEventListener('pageshow', (e) => snap('pageshow persisted=' + (e as PageTransitionEvent).persisted))
}

// iOS/iPadOS standalone PWA: 再起動時にレイアウトビューポートが膨張(inner≫screen)し、
// scale<1 で全体が縮小描画される問題への対策。
// meta[viewport] を作り直して倍率を 1 に固定し、ズームアウトを禁止する
// → レイアウト幅が device-width(=実画面幅) に戻り、scale も 1 に戻る。
function fixViewportScale() {
  const short = Math.min(screen.width, screen.height)
  const long  = Math.max(screen.width, screen.height)
  const isLandscape = window.matchMedia('(orientation: landscape)').matches
  const vw = isLandscape ? long : short   // 実画面幅を明示的に指定
  document.querySelector('meta[name="viewport"]')?.remove()
  const meta = document.createElement('meta')
  meta.name = 'viewport'
  meta.content = `width=${vw}, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover`
  document.head.appendChild(meta)
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

// 起動直後にも一度スケールを正常化
  fixViewportScale()
  resync()

  // 前面復帰 / BFCache 復元 → viewport を作り直してスケールを戻してから再評価
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { fixViewportScale(); resync() }
  })
  window.addEventListener('pageshow', () => { fixViewportScale(); resync() })

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
