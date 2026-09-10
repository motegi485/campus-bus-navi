import { useEffect, type RefObject } from 'react'
import { isIOS } from '../utils/platform'

/*
  モバイル/タブレット専用のオーバースクロール表現（バウンス/ストレッチ）。

  方針（当初検討していた JS 弾性エミュレーション案からの変更点。設計判断の要約は
  docs/design-decisions.md の「オーバースクロール」にもある）:
  実機検証の結果、JS 実装（touchmove 乗っ取り + rAF アニメ）はコンポジタ駆動の
  ネイティブ慣性に体感レベルで追従できない（scroll イベントは実描画から 1-2
  フレーム遅れ、プログラムスクロールは生存中の慣性と競合する）ことが確定した。
  そのため両 OS とも OS ネイティブのオーバースクロール表現を解放して使う。

  - iOS/iPadOS … html.bounce-native でルートの縦 overscroll-behavior を解放し、
    ネイティブのラバーバンドバウンスをそのまま使う。上端露出域のグラデ継続は
    viewport 固定・コンテンツ背面の .header-cushion（ヘッダー上端 1 行の色
    プロファイル = 90deg グラデ、stop 位置は本フックが算出）が担う。
    下端露出域は body 背景（--bg-page）が自動で正しく塗る。
  - Android … html.bounce-stretch でルートを overscroll-behavior-y: contain にし、
    ネイティブの「ストレッチ」（Android 12+。11 以前はグロー）を使う。contain は
    オーバースクロール表現を残したまま pull-to-refresh とスクロール連鎖を抑止する。
    ストレッチは端をピン留めしたままコンテンツを引き伸ばす表現で隙間が開かない
    ため、露出色の同期は不要（クッションも使わない）。
  - PC … 従来どおり html,body の overscroll-behavior: none（バウンス無し。
    macOS Safari のネイティブバウンスもこれで抑止される）。

  改修デザイン（白基調ヘッダー）でヘッダーの背景が単色（--bg-card）になったため、
  クッションも単色でよく、以前あったグラデ近似の stop 位置計算（--bounce-x0/1/2、
  ResizeObserver）は不要になった。.header-cushion 自体は index.css 側で
  background: var(--bg-card) を直接指定する。
*/

const COARSE_MQ = '(pointer: coarse)'

/**
 * ネイティブのオーバースクロール表現を有効化する（html へのモードクラス付与）。
 */
export function useNativeBounce(headerRef: RefObject<HTMLElement>, cushionRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const header = headerRef.current
    const cushion = cushionRef.current
    if (!header || !cushion) return

    if (isIOS()) {
      document.documentElement.classList.add('bounce-native')
      return () => {
        document.documentElement.classList.remove('bounce-native')
      }
    }

    // 非 iOS: タッチ主体端末（Android 等）でのみストレッチ表現を解放する。
    // 回転・入力モード変更で条件が変わり得るため matchMedia の change に追従
    const coarse = window.matchMedia(COARSE_MQ)
    const sync = () => {
      document.documentElement.classList.toggle('bounce-stretch', coarse.matches)
    }
    sync()
    coarse.addEventListener('change', sync)
    return () => {
      coarse.removeEventListener('change', sync)
      document.documentElement.classList.remove('bounce-stretch')
    }
  }, [headerRef, cushionRef])
}
