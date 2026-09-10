import { Bus } from '@phosphor-icons/react'

interface Props {
  size?: number
  body: string
}

/** バスの共通アイコン。窓などの抜き部分には背景が見える。 */
export function BusGlyph({ size = 21, body }: Props) {
  return <Bus size={size} color={body} weight="fill" aria-hidden="true" style={{ flexShrink: 0 }} />
}
