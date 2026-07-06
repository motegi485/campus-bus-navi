import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { BusStopCoords, RouteKey } from '../types/timetable'
import { buildMapUrl } from '../utils/buildMapUrl'

// カスタムバス停ピン
const busStopIcon = L.divIcon({
  className: '', // デフォルトの白い背景などを消すために空にしておく
  html: `<div style="
      /* 影が途切れないように一回り大きい枠（48x48）を作る */
      width: 48px; height: 48px;
      display: flex; align-items: center; justify-content: center;
      /* ここでピン全体に対して真下に影を落とす */
      filter: drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.4));
    ">
    <div style="
        background:#E11D48;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        width:34px; height:34px;
        position:relative;
      ">
      <span style="
        position:absolute;
        width:14px;height:14px;
        background:#fff;
        border-radius:50%;
        top:50%;left:50%;
        transform:translate(-50%,-50%);
      "></span>
    </div>
  </div>`,
  // 全体の枠サイズ（48x48）に合わせて数値を再設定
  iconSize:      [48, 48],
  iconAnchor:    [24, 46], // 48x48の中心下部（ピンの先端）に座標を合わせる
  popupAnchor:   [0, -46],
  tooltipAnchor: [0, -46], // popupAnchor と同じ位置にツールチップを表示
})

/** ルート変更時に地図の中心を滑らかに移動 */
function MapFlyTo({ coords }: { coords: BusStopCoords }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([coords.lat, coords.lng], 17, { duration: 1.2 })
  }, [coords.lat, coords.lng, map])
  return null
}

/** 初回マウント時にコンテナサイズを再計算する */
function MapInvalidateOnMount() {
  const map = useMap()
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      map.invalidateSize()
    })
    return () => cancelAnimationFrame(raf)
  }, [map])
  return null
}

/** コンテナサイズの変化を監視して Leaflet に通知する */
function MapInvalidateOnResize() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    let raf = 0
    const observer = new ResizeObserver(() => {
      // ResizeObserver は連続発火するため次フレームで一度だけ実行
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        map.invalidateSize()
      })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [map])
  return null
}

interface Props {
  coords: BusStopCoords
  stopName: string
  route: RouteKey
}

export function BusStopMap({ coords, stopName, route }: Props) {
  const mapUrl = buildMapUrl(coords)
  const isCampus = route === 'campus_to_station'
  const btnColor = isCampus ? '#10b981' : '#6c63d5'

  return (
    <div className="bg-[var(--bg-card)] rounded-[20px] overflow-hidden transition-[background] duration-300">
      {/* isolation: isolate でLeaflet内部のz-indexをこのコンテナ内に閉じ込める
          これによりドロワー（z-index:30）がLeafletタイル（z-index:400+）の下に潜るバグを防ぐ */}
      <div style={{ position: 'relative', zIndex: 0, isolation: 'isolate' }}>
        <MapContainer
          center={[coords.lat, coords.lng]}
          zoom={17}
          minZoom={14}
          maxZoom={18}
          style={{ height: '220px', width: '100%' }}
          zoomControl={true}
          attributionControl={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <Marker position={[coords.lat, coords.lng]} icon={busStopIcon}>
            {/* Popup は openPopup() のタイミング制御が複雑なため permanent Tooltip に変更 */}
            <Tooltip permanent direction="top">
              <span className="font-bold">{stopName}</span>
            </Tooltip>
          </Marker>
          <MapFlyTo coords={coords} />
          <MapInvalidateOnMount />
          <MapInvalidateOnResize /> 
        </MapContainer>
      </div>

      {/* ルート案内ボタン */}
      <a
        href={mapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-4 font-bold text-[14px] border-t border-[var(--border)] select-none"
        style={{ color: btnColor }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="10" r="3" />
          <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z" />
        </svg>
        現在地からのルートを見る
      </a>
    </div>
  )
}
