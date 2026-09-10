import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { isIOS, isStandalone } from './utils/platform'

/*
  iPad(WebKit) 縦潰れ不具合の対処メモ:
    真因 = Safari の「shrink-to-fit」。再起動後に一瞬 820px を超える要素が描画されると、
           iOS がレイアウト幅を広げ(1280) ページ全体を縮小描画(scale≈0.64)していた。
    対処 = index.html の viewport メタに「shrink-to-fit=no」を付与（← これが実際の修正本体）。
           <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, shrink-to-fit=no" />
  このファイル側では --app-height(実高さ) の同期のみを担当する。
  （旧 bp-active 判定は、3タブ構成への改修で PC/横向きも常にモバイル幅相当の
  レイアウトへ統一したため廃止した。）
*/

// 実ビューポート高さ(px)を CSS 変数 --app-height に反映する。
// App.tsx 側は min-height: var(--app-height, 100vh) を使用する。
function syncAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  if (h > 0) {
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`)
  }
}

/*
  レイアウトビューポートが実画面より短く確定する件（iOS PWA のコールドスタート）。

  症状: iOS の PWA（standalone）でアプリを起動した最初の 1 回だけ、レイアウト
  ビューポート（= position:fixed の基準になる initial containing block）の高さが
  「実画面高 − 上部セーフエリア」で確定する（実機 iPhone 16 Pro で 874pt に対し
  812pt）。ページは画面上端 (y=0) から描かれるので、下端に約 62pt の帯が残り、
  ボトムタブバーがそのぶん浮いて見える。2 回目以降の起動では起きない。初回に
  起きやすいのは、待機中の Service Worker を適用するため main() が一度
  location.reload() するためと考えられる。

  ⚠️ 「タブバーを負の bottom でビューポート外へ押し下げる」補正は行わないこと。
  iOS は position:fixed の描画をレイアウトビューポートでクリップするため、はみ出した
  アイコン・ラベルが丸ごと消える（2026-09-10 に実機で確認。押し下げた未読ドットが
  812pt でちょうど切れていた）。ビューポートの外にページは何も描けない —— 画面全体を
  塗るのはルート背景だけ。

  対処: ビューポート自体を直す。「1px スクロールして次のフレームで戻す」ことで
  WebKit に再計算させる。同じ問題を持たない既存プロジェクト（ToDo-Reminder、
  src/main.tsx の load ハンドラ）で実績のある方法をそのまま採っている。

  ⚠️ scrollTo(0, 1) と scrollTo(0, 0) を同じフレームで続けて呼んではいけない。
  ブラウザが合成してしまい y=1 でのレイアウトが一度も起きず、完全な無操作になる。
  必ず requestAnimationFrame をまたいで戻すこと（2026-09-10、これが原因で効いて
  いなかった）。

  ⚠️ 文書がスクロールできる高さを持っていないと、この 1px スクロール自体が
  成立しない。参照プロジェクトは html/body/#root に min-height:100lvh を敷いており、
  ビューポートが短いときでも文書は実画面ぶんの高さを持つのでスクロールできる。
  こちらは min-height に実測値（--app-height）を使っていて、ビューポートが短いと
  文書も同じだけ短くなり、スクロールできない。そのため index.css の body へ
  min-height:100lvh を足したうえで、ここでも 1 パスのあいだだけ背の高いスペーサーを
  挿して確実にスクロールできる状態を作る。

  viewport メタの書き換えも併せて行う。単独では 868pt までしか戻らなかった（実機実測。
  実画面 874pt に対し 6pt 不足）が、62pt の不足を 6pt まで詰める効果は確認できている。

  ⚠️ 実行タイミング。最初は main() の中（待機 SW の確認を await した後）で呼んでいた
  ため、起動のたびにタブバーが一度短いビューポートの位置に描かれ、0.5 秒ほど遅れて
  正しい位置へ跳ぶのが見えていた（実機 2026-09-10 報告）。モジュール評価時に始め、
  load と React のマウント後にも測り直す。収束したら即座に止まる。
*/
const MAX_VIEWPORT_SHORTFALL = 120

/** ビューポート再評価の試行回数の上限（1 巡ぶん）。収束すれば途中で止まる */
const MAX_RECOVERY_PASSES = 6

/**
 * 実画面の下端とレイアウトビューポートの下端のズレ(px)。
 * 判定できない表示形態、またはズレが無いときは 0。
 */
function measureViewportShortfall(): number {
  // 全画面で表示される iOS PWA のときだけ screen.height を基準にできる。
  // Safari のタブ（ツールバーぶん短い）や iPad の Split View / Stage Manager
  // （幅が画面幅と一致しない）では基準にならない。iOS は回転しても
  // screen.width/height を入れ替えないため、横向きはこの幅比較で自然に外れる。
  if (!isIOS() || !isStandalone()) return 0
  if (Math.abs(window.innerWidth - window.screen.width) > 1) return 0

  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const viewportBottom = probe.getBoundingClientRect().bottom
  probe.remove()

  const shortfall = Math.round(window.screen.height - viewportBottom)
  // 1px 以下は測定誤差。上限を超える値は前提が崩れている（想定外の表示形態）。
  if (shortfall <= 1 || shortfall > MAX_VIEWPORT_SHORTFALL) return 0
  return shortfall
}

let recoveryPassesLeft = 0

/** viewport メタの content を「意味は同じだが文字列としては別」の値にする */
function nudgedViewportContent(original: string): string {
  const SCALE_RE = /initial-scale=[\d.]+/
  return SCALE_RE.test(original)
    ? original.replace(SCALE_RE, 'initial-scale=1.0001')
    : `${original}, initial-scale=1.0001`
}

/**
 * ビューポートが短く確定していたら、1px スクロール（＋ viewport メタの書き換え）で
 * WebKit に再計算させる。収束するまでフレームごとに繰り返し、上限で打ち切る。
 */
function recoverShortViewport() {
  if (recoveryPassesLeft <= 0) return
  // 収束した（またはこの表示形態では判定できない）ので打ち切る
  if (measureViewportShortfall() === 0) {
    recoveryPassesLeft = 0
    return
  }
  recoveryPassesLeft--

  // 文書が短いと 1px スクロール自体が成立しないので、このパスのあいだだけ高さを与える。
  // 絶対配置・visibility:hidden・幅 1px なので何も描かない。スクロールバーは
  // ::-webkit-scrollbar で非表示にしてあるので出ない。
  const spacer = document.createElement('div')
  spacer.setAttribute('aria-hidden', 'true')
  spacer.style.cssText =
    'position:absolute;left:0;top:0;width:1px;height:200vh;visibility:hidden;pointer-events:none'
  document.body.appendChild(spacer)

  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  const original = meta?.content ?? ''
  const nudged = meta ? nudgedViewportContent(original) : ''
  if (meta && nudged !== original) meta.content = nudged

  const scrollY = window.scrollY
  window.scrollTo(0, scrollY + 1)

  // ⚠️ 戻すのは必ず次のフレーム。同じフレームで戻すとブラウザが合成してしまい、
  //    y+1 でのレイアウトが一度も起きず無操作になる（2026-09-10 の失敗要因）。
  requestAnimationFrame(() => {
    window.scrollTo(0, scrollY)
    if (meta) meta.content = original
    spacer.remove()
    // 戻した結果を次のフレームで測り直す。まだ短ければもう一度やる
    requestAnimationFrame(recoverShortViewport)
  })
}

/** ビューポート再評価を 1 巡ぶん開始する（既に走っている途中なら回数だけ足す） */
function startViewportRecovery() {
  const wasIdle = recoveryPassesLeft <= 0
  recoveryPassesLeft = MAX_RECOVERY_PASSES
  if (wasIdle) recoverShortViewport()
}

// ビューポートの是正は最優先で、React のマウントより前に始める（上のコメント参照）。
// このモジュールは <script type="module"> なので DOM の解析完了後に評価され、
// プローブを挿す document.body は既に存在する。
startViewportRecovery()

// 参照実装（ToDo-Reminder）は load で 1px スクロールを行っている。こちらも同じ
// タイミングで測り直す（load 済みなら即座に）。収束していれば何もしない。
if (document.readyState === 'complete') {
  requestAnimationFrame(startViewportRecovery)
} else {
  window.addEventListener('load', () => requestAnimationFrame(startViewportRecovery), { once: true })
}

// 高さを再評価。iPad PWA は復帰直後に値が遅れて確定するため、
// 次フレーム + 250ms 後にも再評価して取りこぼしを防ぐ。
function resync() {
  syncAppHeight()
  requestAnimationFrame(syncAppHeight)
  setTimeout(syncAppHeight, 250)
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

  // 回転変化 → 高さを再評価
  screen.orientation?.addEventListener('change', resync)
  window.matchMedia('(orientation: portrait)').addEventListener('change', resync)

  // リサイズ(Split View / Stage Manager 含む) / visualViewport 変化
  window.addEventListener('resize', syncAppHeight)
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

  // マウント後にもう一巡。#root が空のうちは文書に高さが無く、iOS がビューポートを
  // 確定しきらない（実機では 6pt 足りないまま残り、ユーザーのスクロールやタブ切替で
  // 初めて解消していた）。実コンテンツが入って文書高が決まったここで測り直す。
  // 既に収束していれば measureViewportShortfall() が 0 を返して即座に止まる。
  requestAnimationFrame(startViewportRecovery)
}

main().catch((err) => {
  console.error('アプリの初期化に失敗しました:', err)
})