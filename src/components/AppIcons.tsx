import type { ReactElement } from 'react'
import { GraduationCap, Signpost, Train, DesktopTower, Megaphone, CalendarMinus, Gear, Question, ArrowClockwise, ArrowsLeftRight, Palette, TextAa, Bell, Info, type IconProps } from '@phosphor-icons/react'

/** メニュー・設定の共通アイコン。色は親から継承し、項目名はテキストで併記する。 */
export type AppIcon = (props: IconProps) => ReactElement

/** アイコンタイルの配色トークン。index.css の --icon-*-bg / --icon-*-fg と対応する。 */
export type IconTone =
  | 'violet'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'amber'
  | 'indigo'
  | 'slate'
  | 'red'
  | 'pink'

export function IconGradCap(props: IconProps) {
  return <GraduationCap width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconBusStop(props: IconProps) {
  return <Signpost width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconTrain(props: IconProps) {
  return <Train width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconLaptopCode(props: IconProps) {
  return <DesktopTower width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconMegaphone(props: IconProps) {
  return <Megaphone width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconCalendarWeek(props: IconProps) {
  return <CalendarMinus width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconGear(props: IconProps) {
  return <Gear width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconHelp(props: IconProps) {
  return <Question width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconReset(props: IconProps) {
  return <ArrowClockwise width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconRouteSwap(props: IconProps) {
  return <ArrowsLeftRight width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconContrast(props: IconProps) {
  return <Palette width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconFontSize(props: IconProps) {
  return <TextAa width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconBell(props: IconProps) {
  return <Bell width={20} height={20} weight="bold" aria-hidden="true" style={{ display: 'block' }} {...props} />
}

export function IconInfo(props: IconProps) {
  return <Info width={20} height={20} weight="regular" aria-hidden="true" style={{ display: 'block' }} {...props} />
}
