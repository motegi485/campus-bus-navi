import { useState, useCallback, lazy, Suspense } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { RouteKey } from './types/timetable'
import { useJSTClock } from './hooks/useJSTClock'
import { useTimetable } from './hooks/useTimetable'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { useSettings } from './hooks/useSettings'
import { findNextBus, findUpcomingBuses, findFirstBus } from './utils/findNextBus'
import { RouteToggle } from './components/RouteToggle'
import { NextBusCard } from './components/NextBusCard'
import { UpcomingList } from './components/UpcomingList'
import { FullTimetable } from './components/FullTimetable'
import { EndOfServiceCard } from './components/EndOfServiceCard'
import { DrawerMenu } from './components/DrawerMenu'
import { NewsScreen } from './components/NewsScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { HelpScreen } from './components/HelpScreen'
import { Toast, useToast } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'
import { DayBadge, resolveDiagramType } from './components/DayBadge'

// 地図は遅延ロード（Leaflet はSSRに非対応のため）
const BusStopMap = lazy(() =>
  import('./components/BusStopMap').then(m => ({ default: m.BusStopMap }))
)

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

export default function App() {
  const { settings, setDefaultRoute, setTheme, setFontSize } = useSettings()
  const [route, setRoute] = useState<RouteKey>(settings.defaultRoute)

  const now = useJSTClock()
  const isOnline = useOnlineStatus()
  const { timetable, tomorrowTimetable, loading, error, refresh } = useTimetable(now)
  const { toast, showToast } = useToast()

  // 画面表示状態
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newsOpen, setNewsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // PWA更新検知（registerType: 'prompt'）
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()

  // 時刻計算
  const currentRoute = timetable?.routes[route]
  const schedule = currentRoute?.schedule ?? []
  const nowMinutes = now.hour() * 60 + now.minute()
  const nextBus = schedule.length > 0 ? findNextBus(schedule, now) : null
  const upcoming = nextBus ? findUpcomingBuses(schedule, nextBus.index, 4) : []
  const isEndOfService = schedule.length > 0 && nextBus === null
  const tomorrowSchedule = tomorrowTimetable?.routes[route]?.schedule ?? []
  const tomorrowFirstBus = findFirstBus(tomorrowSchedule)

  // ダイヤ種別バッジ
  const diagramType = timetable ? resolveDiagramType(timetable.id) : 'class'

  // フォントサイズクラス（CSS変数経由ではなくコンポーネントprops渡し）
  const fontSize = settings.fontSize

  // 更新ボタン（window.location.reload() は使用しない）
  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    showToast('⟳ 時刻データを更新しています...', 1600)
    try {
      await refresh()
      showToast('✓ 最新の時刻データに更新しました')
    } catch {
      showToast('⚠ 更新に失敗しました（オフライン？）')
    } finally {
      setRefreshing(false)
    }
  }, [refresh, refreshing, showToast])

  // アプリの初期化
  const handleInitApp = useCallback(async () => {
    const confirmed = window.confirm(
      'アプリを初期化しますか？\nキャッシュが削除され、再読み込みされます。'
    )
    if (!confirmed) return

    // 1. Service Worker の登録解除
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const reg of registrations) {
        await reg.unregister()
      }
    }

    // 2. localStorage のクリア
    localStorage.clear()

    // 3. Cache Storage の完全削除（Workboxキャッシュ本体）
    if ('caches' in window) {
      const cacheKeys = await caches.keys()
      await Promise.all(cacheKeys.map(key => caches.delete(key)))
    }

    // 4. 強制リロード（初期化時のみ reload を許可）
    window.location.reload()
  }, [])

  // テーマクラス
  const themeClass = settings.theme === 'dark' ? 'dark' : ''

  return (
    /*
      レスポンシブ戦略:
      - モバイル（< 768px）: 全画面表示。角丸・余白なし。
      - PC（>= 768px）: 背景 #1a1a2e の中央にカード表示。角丸44px・影付き。
    */
    <>
      {/* PC用背景 */}
      <div className="hidden md:block fixed inset-0 -z-10" style={{ background: '#1a1a2e' }} />

      {/* アプリ外枠 */}
      <div
        className={`md:min-h-screen md:flex md:items-start md:justify-center md:py-8 md:px-4 ${themeClass}`}
      >
{/* フォンシェル：モバイル=全画面、PC=カード */}
        <div
          // 💡 親要素から overflow-hidden を削除
          className={`relative w-full md:max-w-md ${themeClass}`} 
          style={{
            /* 💡 背景色の指定を削除し、透明にする */
            /* モバイルでは最低画面高さいっぱい、PCでは内容に合わせる */
            minHeight: '100dvh',
          }}
        >
          {/* PC時のみ角丸・影をインラインで付与（media queryの代わりにJS判定は使わない） */}
          <style>{`
            @media (min-width: 768px) {
              .phone-shell-inner {
                border-radius: 44px;
                box-shadow: 0 32px 100px rgba(0,0,0,0.55);
                min-height: unset !important;
              }
            }
          `}</style>
          <div
            // 💡 ここに isolate を追加（丸い角を綺麗に切り抜くため）
            className="phone-shell-inner w-full overflow-hidden isolate"
            style={{
              position: 'relative',
              background: 'var(--bg-page)', // 背景は内側だけで描画する
              transition: 'background 0.35s',
              minHeight: '100dvh',
            }}
          >
        {/* Toast */}
        <Toast message={toast.message} visible={toast.visible} />

        {/* ドロワーメニュー */}
        <DrawerMenu
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onOpenNews={() => setNewsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          onInitApp={handleInitApp}
        />

        {/* お知らせ */}
        <NewsScreen open={newsOpen} onClose={() => setNewsOpen(false)} />

        {/* 設定 */}
        <SettingsScreen
          open={settingsOpen}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSetDefaultRoute={setDefaultRoute}
          onSetTheme={setTheme}
          onSetFontSize={setFontSize}
        />

        {/* ヘルプ */}
        <HelpScreen open={helpOpen} onClose={() => setHelpOpen(false)} />

        {/* ヘッダー */}
        <header
          className={route === 'campus_to_station' ? 'header campus' : 'header station'}
          style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 22px 22px', transition: 'background 0.55s' }}
        >
          <div className="flex items-center justify-between mb-1">
            {/* ハンバーガーボタン */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex flex-col gap-[4.5px] items-center justify-center"
              style={{ width: 43, height: 43, borderRadius: '50%', background: 'rgba(255,255,255,0.26)', flexShrink: 0 }}
            >
              <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
              <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
              <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
            </button>

            {/* 中央：タイトル・日付・バッジ */}
            <div className="flex-1 text-center">
              <h1 className="text-[28px] font-bold text-white" style={{ letterSpacing: '-.4px' }}>
                {timetable?.routes[route].origin ?? (route === 'campus_to_station' ? '大学発' : '松永発')}
              </h1>
              <div className="flex items-center justify-center gap-[7px] mt-1">
                <span className="text-[18px] font-medium" style={{ color: 'rgba(255,255,255,0.88)' }}>
                  {now.month() + 1}/{now.date()}（{DAYS_JA[now.day()]}）
                </span>
                <DayBadge type={diagramType} />
              </div>
            </div>

            {/* 更新ボタン */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                width: 43, height: 43, borderRadius: '50%', background: 'rgba(255,255,255,0.26)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                transition: 'transform 0.7s linear',
                transform: refreshing ? 'rotate(720deg)' : 'rotate(0deg)',
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>

          {/* セグメントコントロール */}
          <RouteToggle route={route} onChange={setRoute} />
        </header>

        {/* メインコンテンツ */}
        <main className="flex flex-col gap-[10px] p-[14px]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>

          {/* ローディング */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>時刻表を読み込み中...</p>
            </div>
          )}

          {/* エラー */}
          {error && !loading && (
            <div className="rounded-[20px] p-5 text-center" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p className="text-[14px] text-red-500 font-medium">{error}</p>
              <p className="text-[12px] mt-2" style={{ color: 'var(--text-muted)' }}>キャッシュされた時刻表を使用しています</p>
            </div>
          )}

          {/* 次のバス / 終バス後 */}
          {!loading && currentRoute && (
            <>
              {isEndOfService ? (
                <EndOfServiceCard
                  tomorrowFirstBus={tomorrowFirstBus}
                  tomorrowTimetableName={tomorrowTimetable?.name}
                />
              ) : (
                <NextBusCard next={nextBus} route={route} fontSize={fontSize} />
              )}

              {/* 直近4本 */}
              {!isEndOfService && nextBus && (
                <UpcomingList
                  buses={upcoming}
                  route={route}
                  nowMinutes={nowMinutes}
                  fontSize={fontSize}
                />
              )}

              {/* 全時刻表アコーディオン */}
              <FullTimetable
                schedule={schedule}
                route={route}
                currentDeparture={nextBus?.entry.departure}
                nowMinutes={nowMinutes}
              />
            </>
          )}

          {/* 地図セクション */}
          {!loading && currentRoute && (
            <section>
              <p className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
                乗り場マップ
              </p>
              {isOnline ? (
                <Suspense
                  fallback={
                    <div className="rounded-[20px] flex items-center justify-center" style={{ height: 220, background: 'var(--bg-card)' }}>
                      <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>地図を読み込み中...</p>
                    </div>
                  }
                >
                  <BusStopMap
                    coords={currentRoute.bus_stop_coords}
                    stopName={currentRoute.bus_stop_name}
                    route={route}
                  />
                </Suspense>
              ) : (
                // オフライン時: キャッシュ済みタイルを表示（BusStopMap は minZoom/maxZoom 制限済み）
                <Suspense fallback={null}>
                  <BusStopMap
                    coords={currentRoute.bus_stop_coords}
                    stopName={currentRoute.bus_stop_name}
                    route={route}
                  />
                </Suspense>
              )}
            </section>
          )}
        </main>

        {/* PWA更新通知バナー（registerType: 'prompt'） */}
        {needRefresh && (
          <UpdateBanner onUpdate={() => updateServiceWorker(true)} />
        )}
          </div>{/* phone-shell-inner */}
        </div>{/* phone outer */}
      </div>{/* app wrapper */}
    </>
  )
}
