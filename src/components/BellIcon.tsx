import { Bell, type IconProps } from '@phosphor-icons/react'

/** ボタンラベル・行末向けの小型アイコン。 */
export function BellIcon({ width = 13, height = 13, style, ...rest }: IconProps) {
  return <Bell width={width} height={height} weight="bold" aria-hidden="true" style={{ display: 'inline-block', flexShrink: 0, verticalAlign: '-2px', ...style }} {...rest} />
}
