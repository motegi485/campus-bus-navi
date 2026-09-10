import type { SVGProps } from 'react'

/**
 * 外部リンクを示す斜め矢印。行カードの右端（大学ホームページ等の外部リンク行、
 * マップタブの「現在地からのルートを見る」）で使う。
 * BellIcon.tsx と同じく、インライン文脈向けの小型専用コンポーネント。
 */
export function ExternalLinkIcon({ width = 13, height = 13, style, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'inline-block', flexShrink: 0, ...style }}
      {...rest}
    >
      <path d="M7.5 16.5 16.5 7.5" />
      <path d="M9.5 7.5h7v7" />
    </svg>
  )
}
