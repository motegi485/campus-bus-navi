/**
 * バスの二色グリフ（本体色 + 窓・車輪色）。
 *
 * 改修たたき台に繰り返し登場する同一形状のアイコン（ルートトグルの両状態、
 * ボトムタブの「バス」タブ）を 1 か所にまとめたもの。色の組み合わせだけが
 * 文脈ごとに変わる（本体が白で窓が濃色＝選択中トグル／本体が濃色で窓が白＝
 * 非選択トグルとタブバー）。
 */
interface Props {
  size?: number
  /** 車体（外周・裾の 2 枚）の色 */
  body: string
  /** 窓・車輪の色 */
  detail: string
}

export function BusGlyph({ size = 21, body, detail }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="16" height="15.6" rx="3.6" fill={body} />
      <rect x="6.6" y="6" width="10.8" height="5" rx="1.4" fill={detail} />
      <circle cx="8.2" cy="14.4" r="1.15" fill={detail} />
      <circle cx="15.8" cy="14.4" r="1.15" fill={detail} />
      <rect x="6.4" y="18" width="3.4" height="2.7" rx="1.2" fill={body} />
      <rect x="14.2" y="18" width="3.4" height="2.7" rx="1.2" fill={body} />
    </svg>
  )
}
