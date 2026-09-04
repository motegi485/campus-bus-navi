import type { SVGProps } from 'react'

/**
 * 発車リマインダーの鈴アイコン（🔔 の代替）。
 *
 * インライン文脈（ボタンラベル・バッジ）向けの小型専用コンポーネントで、
 * AppIcons.tsx（ドロワー・設定のタイル専用、viewBox 24 / stroke 1.7 固定）とは別に持つ。
 * パスの形状自体は AppIcons.tsx の IconBell と同じ。
 */
export function BellIcon({ width = 13, height = 13, style, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0, ...style }}
      {...rest}
    >
      <path d="M17.8 11.9a5.8 5.8 0 1 0-11.6 0c0 4.6-1.9 6.2-1.9 6.2h15.4c0 0-1.9-1.6-1.9-6.2z" />
      <path d="M12 6.1V4.3" />
      <path d="M10.3 18.9a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  )
}
