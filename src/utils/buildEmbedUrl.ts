import type { BusStopCoords } from '../types/timetable'

/**
 * APIキー不要の Google マップ埋め込み（maps.google.com の output=embed）。
 * Google Cloud の公式 Maps Embed API ではなく、Web版マップが古くから提供する
 * 非公式・無登録の埋め込み方式（2014年頃から現在まで安定動作を確認済み）。
 * Googleが将来変更・廃止する可能性はあるが、支払い情報登録が不要な唯一の手段のため採用。
 */
export function buildEmbedMapUrl(coords: BusStopCoords, zoom = 17): string {
  return `https://maps.google.com/maps?q=${coords.lat},${coords.lng}&z=${zoom}&output=embed`
}

/**
 * APIキー不要の Street View 埋め込み（output=svembed）。
 * heading（cbpの2番目の値）は暫定的に0固定。実際の乗り場の向きに合わせた調整は
 * 座標だけでは正しい向きにならないため、後日この値を直接編集して調整する想定。
 */
export function buildEmbedStreetViewUrl(coords: BusStopCoords, heading = 0): string {
  return `https://maps.google.com/maps?layer=c&cbll=${coords.lat},${coords.lng}&cbp=13,${heading},0,0,0&output=svembed`
}
