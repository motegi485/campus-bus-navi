import type { BusStopCoords, RouteKey } from '../types/timetable'
import { buildMapUrl } from '../utils/buildMapUrl'
import { buildEmbedMapUrl, buildEmbedStreetViewUrl } from '../utils/buildEmbedUrl'
import { RouteToggle } from './RouteToggle'
import { ExternalLinkIcon } from './ExternalLinkIcon'

interface Props {
  coords: BusStopCoords
  stopName: string
  destination: string
  route: RouteKey
  onChangeRoute: (route: RouteKey) => void
}

/**
 * マップタブ（改修たたき台 2b）。
 * 地図・Street View とも APIキー不要の Google 埋め込み iframe（buildEmbedUrl.ts）を使う。
 * ルート案内行は buildMapUrl.ts の Google マップ起動リンクをそのまま流用する。
 */
export function MapTab({ coords, stopName, destination, route, onChangeRoute }: Props) {
  const mapUrl = buildMapUrl(coords)

  return (
    <div className="flex flex-col" style={{ paddingBottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 16px)' }}>
      {/* 上端の余白はバスタブのヘッダー（App.tsx）と同じ計算にする。safe-area を
          足さないと、ノッチ機でタイトルが端末のステータスバー（時刻・電池）と重なる。 */}
      <header style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 22px) 20px 0' }}>
        <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: '-0.7px', lineHeight: 1.2, color: 'var(--text-primary)' }}>
          スクールバス乗り場
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>
          {route === 'campus_to_station' ? '大学発' : '松永発'} → {destination}
        </p>
        <div className="mt-5">
          <RouteToggle route={route} onChange={onChangeRoute} />
        </div>
      </header>

      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ height: 326, borderRadius: 22, border: '1px solid var(--row-card-border)', overflow: 'hidden' }}>
          <iframe
            title={`${stopName}の地図`}
            src={buildEmbedMapUrl(coords)}
            style={{ border: 0, width: '100%', height: '100%' }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        {/* ルート案内行（改修たたき台の行カード共通デザイン） */}
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center w-full"
          style={{
            gap: 12, marginTop: 12, padding: '13px 14px', borderRadius: 16,
            background: 'var(--menu-group-bg)', border: '1px solid var(--row-card-border)',
            textDecoration: 'none', color: 'inherit',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 38, height: 38, flexShrink: 0, borderRadius: 12,
              background: 'var(--slot-current-bg)', color: 'var(--slot-current-fg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2.2c-4.2 0-7.6 3.4-7.6 7.6 0 5.4 6.7 11.5 7 11.8.3.3.9.3 1.2 0 .3-.3 7-6.4 7-11.8 0-4.2-3.4-7.6-7.6-7.6zm0 10.4a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8z" fill="currentColor" />
            </svg>
          </span>
          <span className="min-w-0" style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>現在地からのルートを見る</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>Googleマップで徒歩ルートを開く</p>
          </span>
          <span style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
            <ExternalLinkIcon width={13} height={13} />
          </span>
        </a>
      </div>

      {/* 乗り場の様子（Street View 埋め込み） */}
      <div style={{ padding: '14px 16px 0' }}>
        <h2 style={{ margin: '0 0 8px', padding: '0 4px', fontSize: 15, fontWeight: 700, color: 'var(--chip-text)' }}>
          乗り場の様子
        </h2>
        <div style={{ height: 176, borderRadius: 22, border: '1px solid var(--row-card-border)', overflow: 'hidden' }}>
          <iframe
            title={`${stopName}のストリートビュー`}
            src={buildEmbedStreetViewUrl(coords)}
            style={{ border: 0, width: '100%', height: '100%' }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>

      <div style={{ height: 22 }} />
    </div>
  )
}
