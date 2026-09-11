import type { BusStopCoords, RouteKey } from '../types/timetable'

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
 * 「乗り場の様子」に出すパノラマの指定。
 * - panoid: Google マップのストリートビュー URL の `!1s` 直後の値。座標最寄り検索だと
 *   密集市街地で無関係な店舗内観に一致することがある（松永発で実際に発生）ため、
 *   乗り場が写るパノラマを人が選んで固定する。
 * - heading: 向き（0=北、時計回りの度数）。
 * - pitch: 上下（0=水平、正が下向き、負が上向き）。Google マップ URL の `NNt` とは
 *   `pitch = 90 - t` の関係。
 * ズーム（画角）は埋め込みに指定手段が無い（cbp の4番目は向きのオフセットとして働き、
 * fov / zoom などのクエリも無視される）ので持たない。利用者がピンチ／ホイールで寄る前提。
 */
export interface StreetViewSpot {
  panoid: string
  heading: number
  pitch: number
}

/**
 * ルート別の乗り場パノラマ。2026-09-11 に Google マップ上で乗り場が写る位置・向きを
 * 人が選んで確定した値（調整手順は docs/data-model-and-operations.md）。
 * 時刻表 JSON ではなくここに置くのは、表示の都合であって時刻表データではないことと、
 * JSON に入れると Bot 側（zod スキーマ・assemble）の改修まで必要になるため。
 */
export const STREET_VIEW_SPOTS: Record<RouteKey, StreetViewSpot> = {
  campus_to_station: { panoid: 'MkV4_jJTj3WeP6fB6i6D4Q', heading: 244.4, pitch: -15.7 },
  station_to_campus: { panoid: 'heqMblKoItoC-yT1Z-WqtA', heading: 276.2, pitch: -0.8 },
}

/**
 * APIキー不要の Street View 埋め込み（output=svembed）。
 * spot があれば panoid でパノラマを固定し、無ければ座標（cbll）から最寄りを検索する。
 * panoid と cbll を同時に付けると意図しない別パノラマになるため併用しない。
 * 存在しない panoid を渡した場合は Google 側で座標最寄りにフォールバックすることを確認済み。
 * cbp は `13,heading,0,0,pitch` の並び（3番目と4番目は 0 固定）。
 */
export function buildEmbedStreetViewUrl(coords: BusStopCoords, spot?: StreetViewSpot): string {
  const heading = spot?.heading ?? 0
  const pitch = spot?.pitch ?? 0
  const where = spot ? `panoid=${encodeURIComponent(spot.panoid)}` : `cbll=${coords.lat},${coords.lng}`
  return `https://maps.google.com/maps?layer=c&${where}&cbp=13,${heading},0,0,${pitch}&output=svembed`
}
