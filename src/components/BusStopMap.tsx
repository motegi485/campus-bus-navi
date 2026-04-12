import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { BusStopCoords, RouteKey } from '../types/timetable'
import { buildMapUrl } from '../utils/buildMapUrl'

// Leaflet デフォルトアイコン修正（Viteビルド対策）
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// カスタムバス停ピン
const busStopIcon = L.divIcon({
  className: '',
  html: `<svg width="44" height="60" viewBox="0 0 50 66" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="pin-shadow" x="-35%" y="-10%" width="170%" height="165%">
        <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#881337" flood-opacity="0.28"/>
      </filter>
    </defs>
    <path d="M25 2C13.4 2 4 11.4 4 23C4 38 25 64 25 64C25 64 46 38 46 23C46 11.4 36.6 2 25 2Z"
          fill="#be123c" filter="url(#pin-shadow)"/>
    <circle cx="25" cy="23" r="15" fill="#fff1f2"/>
    <circle cx="25" cy="23" r="15" fill="none" stroke="#fda4af" stroke-width="1"/>
    <rect x="16" y="17" width="18" height="12.5" rx="2.5" fill="#881337"/>
    <rect x="17" y="19" width="5.5" height="4.5"  rx="1.2" fill="#fff1f2"/>
    <rect x="24.5" y="19" width="5.5" height="4.5" rx="1.2" fill="#fff1f2"/>
    <rect x="16" y="27" width="18" height="1.8"   rx="0.9" fill="#fb7185"/>
    <circle cx="20" cy="32" r="2.3" fill="#881337"/>
    <circle cx="30" cy="32" r="2.3" fill="#881337"/>
  </svg>`,
  iconSize: [48, 66],
  iconAnchor: [22, 60],
  popupAnchor: [0, -68],
})

/** ルート変更時に地図の中心を滑らかに移動 */
function MapFlyTo({ coords }: { coords: BusStopCoords }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([coords.lat, coords.lng], 17, { duration: 1.2 })
  }, [coords.lat, coords.lng, map])
  return null
}

interface Props {
  coords: BusStopCoords
  stopName: string
  route: RouteKey
}

export function BusStopMap({ coords, stopName, route }: Props) {
  const mapUrl = buildMapUrl(coords, stopName)
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
            <Popup>
              <span className="font-bold">{stopName}</span>
            </Popup>
          </Marker>
          <MapFlyTo coords={coords} />
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
