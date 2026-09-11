/**
 * 文字サイズ設定（--font-scale）を反映した font-size 値を返す。
 * html のルート font-size には触れず、body 以下の文字だけを拡大縮小する
 * （Tailwind の spacing 系ユーティリティは rem 由来のため影響を受けない）。
 */
export function fs(px: number): string {
  return `calc(${px}px * var(--font-scale))`
}
