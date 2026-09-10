import type { BusStopCoords } from '../types/timetable'

/**
 * バス乗り場までの徒歩ルートを Google マップで開く URL を生成する。
 *
 * 以前は iOS だけ Apple マップのユニバーサルリンクを返していたが、実機では
 * 「Google マップで見たいのに Apple マップが開く」ことになるため、OS を問わず
 * Google マップの URL に統一した。この URL は Google マップアプリの
 * ユニバーサルリンク（iOS）／App Link（Android）でもあるので、アプリが
 * 入っていればアプリが、無ければブラウザの Google マップが開く。
 *
 * 出発地（現在地）は指定しない。Google マップ側が端末の現在地を起点に扱う。
 */
export function buildMapUrl(coords: BusStopCoords): string {
  const { lat, lng } = coords

  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`
}
