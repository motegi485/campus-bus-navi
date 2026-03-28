import type { BusStopCoords } from '../types/timetable'

/**
 * iOS / Android のネイティブマップアプリを起動する URL を生成する。
 * iOS Safari → maps:// (Apple Maps)
 * Android / その他 → https://maps.google.com (Google Maps)
 */
export function buildMapUrl(coords: BusStopCoords, label: string): string {
  const { lat, lng } = coords
  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent)

  if (isIOS) {
    return `maps://?daddr=${lat},${lng}&dirflg=w&t=m`
  }

  const encodedLabel = encodeURIComponent(label)
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodedLabel}&travelmode=walking`
}
