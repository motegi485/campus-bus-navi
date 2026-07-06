import type { BusStopCoords } from '../types/timetable'
import { isIOS } from './platform'

/**
 * iOS / Android のネイティブマップアプリを起動する URL を生成する。
 * iOS → Apple Maps ユニバーサルリンク（非対応環境では Web にフォールバック）
 * Android / その他 → https://maps.google.com (Google Maps)
 */
export function buildMapUrl(coords: BusStopCoords): string {
  const { lat, lng } = coords

  if (isIOS()) {
    return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w&t=m`
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`
}
