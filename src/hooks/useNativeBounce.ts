import { useEffect, type RefObject } from 'react'
import { isIOS } from '../utils/platform'

/*
  モバイル/タブレット専用のオーバースクロール表現（バウンス/ストレッチ）。

  方針（BOUNCE_SCROLL_HANDOFF.md §3 からの変更点）:
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

  クッションの色・角度は .header と共通の CSS 変数（--hdr-g0/1/2・--hdr-angle）を
  参照するため route 切替・テーマに自動追従する。stop 位置のみ本フックが計算する。
*/

const COARSE_MQ = '(pointer: coarse)'

/**
 * ネイティブのオーバースクロール表現を有効化する（html へのモードクラス付与）。
 * iOS ではあわせて .header-cushion（上端露出域のグラデ継続レイヤー）の
 * stop 位置をヘッダー実寸から同期する。
 */
export function useNativeBounce(headerRef: RefObject<HTMLElement>, cushionRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const header = headerRef.current
    const cushion = cushionRef.current
    if (!header || !cushion) return

    if (isIOS()) {
      document.documentElement.classList.add('bounce-native')

      /*
        ヘッダーの 160deg グラデの上端行 t(x, 0) は x の一次式なので、
        90deg（x 方向）グラデとして正確に表現できる。t(x, 0) = s となる位置:

          x_s = W/2 + ( (s - 0.5)·L + (H/2)·(-cos a) ) / sin a
          L = W·|sin a| + H·|cos a|   （CSS の勾配線長。a = --hdr-angle）

        クッションは viewport 固定なので、境界線上の色はヘッダーの押し下げ量に
        よらず常にヘッダー上端と同一 → 継ぎ目はどの変位でも原理上出ない
        （上方向の色変化は本来ほぼ一定色のため省略する近似。ベタ塗りと違い
        x 方向の連続性は完全に保たれる）。負値・100% 超の stop 位置は CSS として
        合法。ヘッダー側の stop が 0% / 50% / 100% であることは index.css 側との
        固定契約（変更時は両方更新する）。
      */
      const compute = () => {
        // offsetWidth/Height はレイアウト値（transform の影響を受けない）
        const w = header.offsetWidth
        const h = header.offsetHeight
        if (w <= 0 || h <= 0) return
        const angle = parseFloat(getComputedStyle(cushion).getPropertyValue('--hdr-angle')) || 160
        const rad = (angle * Math.PI) / 180
        const sinA = Math.sin(rad)
        const cosA = Math.cos(rad)
        if (Math.abs(sinA) < 0.01) {
          // ほぼ垂直な勾配では上端行は実質単色（g0）: 全域を g0 で塗る
          cushion.style.setProperty('--bounce-x0', '100%')
          cushion.style.setProperty('--bounce-x1', '200%')
          cushion.style.setProperty('--bounce-x2', '300%')
          return
        }
        const lh = w * Math.abs(sinA) + h * Math.abs(cosA)
        const xAt = (s: number) => (w / 2 + ((s - 0.5) * lh + (h / 2) * -cosA) / sinA) / w
        cushion.style.setProperty('--bounce-x0', `${(xAt(0) * 100).toFixed(3)}%`)
        cushion.style.setProperty('--bounce-x1', `${(xAt(0.5) * 100).toFixed(3)}%`)
        cushion.style.setProperty('--bounce-x2', `${(xAt(1) * 100).toFixed(3)}%`)
      }

      compute()
      // 回転・Split View・文字折返し等によるヘッダー寸法変化へ追従
      const ro = new ResizeObserver(compute)
      ro.observe(header)
      return () => {
        ro.disconnect()
        document.documentElement.classList.remove('bounce-native')
        for (const p of ['--bounce-x0', '--bounce-x1', '--bounce-x2']) {
          cushion.style.removeProperty(p)
        }
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
