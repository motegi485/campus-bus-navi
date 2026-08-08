import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * オーバーレイ（ドロワー・全画面パネル）のキーボード／支援技術対応。
 *
 * 本アプリの 4 画面（ドロワー・お知らせ・設定・ヘルプ）は、開閉アニメーションのため
 * 閉じている間も transform で画面外へ置いたまま DOM に残る。何もしないと
 * 「見えていない画面のリンク・ボタンに Tab で到達できる」「開いたダイアログの外へ
 * Tab で出られる」という状態になるため、最上位のオーバーレイ以外を inert にする。
 *
 * inert は「フォーカス不可 + アクセシビリティツリーから除外 + ポインタ操作無効」を
 * まとめて行う標準属性で、WAI-ARIA の modal dialog パターンが求める
 * 「開いたダイアログの外を操作させない」を JS のフォーカストラップ無しで満たせる。
 */

/**
 * inert を DOM プロパティ経由で設定する。
 * React 18 は真偽値の未知属性を文字列化するため（inert={false} → inert="false" となり
 * 属性が存在＝真として効いてしまう）、JSX 属性では設定しない。
 */
export function setInert(el: HTMLElement | null, on: boolean): void {
  if (!el) return
  // TypeScript 5.5 の lib.dom には inert がないため局所的に補う
  const target = el as HTMLElement & { inert?: boolean }
  target.inert = on
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Options {
  /** 開いていても上に別のオーバーレイが重なっている間は true（inert にする） */
  covered?: boolean
  /** Escape キーで閉じる */
  onEscape?: () => void
}

/**
 * 返した ref をオーバーレイのルート要素に付ける。
 * - 閉じている / 上に別のオーバーレイが重なっている間は inert
 * - 開いた直後に内部の最初の操作要素へフォーカスを移す
 * - 閉じたら開く前にフォーカスがあった要素へ戻す
 */
export function useOverlayA11y(open: boolean, options: Options = {}) {
  const { covered = false, onEscape } = options
  const rootRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(open)

  // 開いた瞬間のフォーカス位置を控える。他コンポーネントの inert 適用（useEffect）が
  // 走るとフォーカスが body へ飛ぶため、それより先に動く useLayoutEffect で取る。
  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      restoreRef.current = document.activeElement as HTMLElement | null
    }
  }, [open])

  useEffect(() => {
    setInert(rootRef.current, !open || covered)
  }, [open, covered])

  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (open === wasOpen) return

    if (open) {
      // 自分の inert は直前の effect（同じコンポーネント内なので必ず先に走る）で
      // 解除済み。ここで同期的に移してよい。
      rootRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
      return
    }

    const restoreTarget = restoreRef.current
    restoreRef.current = null
    if (!restoreTarget) return

    /**
     * 復帰先（ハンバーガーボタン等）は背面レイヤーの中にあり、その inert を外すのは
     * 親（App）の effect である。React は effect を子 → 親の順に流すので、この時点では
     * まだ背面が inert のままで focus() が効かない。コミット全体が終わってから動かす。
     * rAF は非アクティブなタブでスロットリングされるため setTimeout を使う。
     */
    const timer = setTimeout(() => {
      if (document.contains(restoreTarget)) restoreTarget.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open || covered || !onEscape) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, covered, onEscape])

  return rootRef
}
