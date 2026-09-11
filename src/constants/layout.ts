/**
 * PC 向けレイアウト（サイドバー表示）に切り替える画面幅の境界。
 *
 * CSS の `@media` はこの定数を直接参照できないため、index.css 側の
 * 各 `@media (min-width: 1024px)` ブロックには「この値と合わせること」という
 * コメントを添えている。値を変える場合は両方を手で揃えること。
 */
export const PC_BREAKPOINT_PX = 1024
