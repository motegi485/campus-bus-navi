import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { RouteKey } from './types/timetable'
import { useJSTClock } from './hooks/useJSTClock'
import { useTimetable } from './hooks/useTimetable'
import { useWeekTimetables } from './hooks/useWeekTimetables'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { useSettings } from './hooks/useSettings'
import { usePushSubscription } from './hooks/usePushSubscription'
import { useDepartureReminders } from './hooks/useDepartureReminders'
import { useNews } from './hooks/useNews'
import { useNativeBounce } from './hooks/useNativeBounce'
import { setInert } from './hooks/useOverlayA11y'
import { useOverlayBackGesture } from './hooks/useOverlayBackGesture'
import { usePressable } from './hooks/usePressable'
import { tapFeedback } from './utils/haptics'
import { findNextBus, findUpcomingBuses, findFirstBus, countRemainingBuses } from './utils/findNextBus'
import { deriveDataStatus, hidesTimes, showsBand } from './utils/deriveDataStatus'
import { StatusCard } from './components/StatusCard'
import { StatusBand } from './components/StatusBand'
import { RouteToggle } from './components/RouteToggle'
import { NextBusCard } from './components/NextBusCard'
import { UpcomingList } from './components/UpcomingList'
import { FullTimetable } from './components/FullTimetable'
import { WeekStrip } from './components/WeekStrip'
import { EndOfServiceCard } from './components/EndOfServiceCard'
import { SpecialScheduleCard } from './components/SpecialScheduleCard'
import { DrawerMenu } from './components/DrawerMenu'
import { NewsScreen } from './components/NewsScreen'
import { WeeklyScreen } from './components/WeeklyScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { HelpScreen } from './components/HelpScreen'
import { Toast, useToast } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'
import { DayBadge, resolveDiagramType } from './components/DayBadge'
import { MobilePwaGuide, shouldShowMobilePwaGuide } from './components/MobilePwaGuide'

// 地図は遅延ロード（Leaflet はSSRに非対応のため）
const BusStopMap = lazy(() =>
  import('./components/BusStopMap').then(m => ({ default: m.BusStopMap }))
)

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

export default function App() {
  const { settings, setDefaultRoute, setTheme, setFontSize } = useSettings()
  // 発車リマインダーは二層。設定画面のトグルが端末の購読（通知の根幹の許可）を持ち、
  // どの便に何分前かは「本日の全時刻表」で当日ぶんだけ指定する。
  const push = usePushSubscription()
  const [route, setRoute] = useState<RouteKey>(settings.defaultRoute)

  const now = useJSTClock()
  const isOnline = useOnlineStatus()
  const { timetable, tomorrowTimetable, loading, refetching, error, stale, fetchedAt, refresh } = useTimetable(now)
  const { toast, showToast } = useToast()

  // 当日の便ごとのリマインド指定。正はサーバ（D1）にあり、ここは表示用の写し。
  // 日付が変わると dateKey が変わり、自動的に取り直される（当日限りの担保）
  const reminders = useDepartureReminders({
    endpoint: push.endpoint,
    dateKey: now.format('YYYY-MM-DD'),
    route,
  })

  // お知らせ状態はここ（App）で一元管理し、NewsScreen へ受け渡す。
  // 本体UI（ハンバーガー・ドロワー）の未読インジケーターと NewsScreen の
  // 既読状態を同一ソースで同期させるため。hasUnread = 未読が1件以上あるか。
  const newsState = useNews()
  const hasUnread = newsState.news.some(item => item.unread && !newsState.readIds.has(item.id))

  // 画面表示状態
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newsOpen, setNewsOpen] = useState(false)
  const [weeklyOpen, setWeeklyOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // 初回表示時のチラつきを避けるため lazy initializer で判定。状態を App が持つのは、
  // aria-modal を名乗る以上、背面を inert にする必要があるため（下の anyOverlayOpen）
  const [pwaGuideOpen, setPwaGuideOpen] = useState<boolean>(shouldShowMobilePwaGuide)
  const [refreshing, setRefreshing] = useState(false)

  // 週間ダイヤ（今日を含む 7 日）。ホームの帯と全画面の両方がこの 1 つの結果を使う。
  // 画面ごとにフックを呼ぶと、同じ 7 日分を二重に取りに行くことになる。
  // 本文の取得は週間ダイヤ画面を開いている間だけ（ホームの帯は種別しか使わない）。
  const week = useWeekTimetables(now, true, 7, weeklyOpen)

  // ヘッダーのアイコンボタンの押下フィードバック
  // （index.css の -webkit-tap-highlight-color: transparent の代替）
  const menuPress = usePressable()
  const refreshPress = usePressable(refreshing)

  // いずれかのオーバーレイが開いている間、背後（ヘッダー・本文・バナー）を
  // Tab 順とアクセシビリティツリーから外す。WAI-ARIA の modal dialog パターン。
  const anyOverlayOpen = drawerOpen || newsOpen || weeklyOpen || settingsOpen || helpOpen || pwaGuideOpen
  const backgroundRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setInert(backgroundRef.current, anyOverlayOpen)
  }, [anyOverlayOpen])

  // Android等の戻るジェスチャー/ハードウェア戻るボタンでオーバーレイを閉じられるようにする。
  // 最前面から順（実際の z-index の高い順: ドロワー30 < 各画面50 < PWA案内100）に渡す。
  useOverlayBackGesture([
    { open: pwaGuideOpen, close: () => setPwaGuideOpen(false) },
    { open: helpOpen, close: () => setHelpOpen(false) },
    { open: settingsOpen, close: () => setSettingsOpen(false) },
    { open: weeklyOpen, close: () => setWeeklyOpen(false) },
    { open: newsOpen, close: () => setNewsOpen(false) },
    { open: drawerOpen, close: () => setDrawerOpen(false) },
  ])

  // PWA更新検知（registerType: 'prompt'）
  // コールドスタート時(=起動から COLD_START_GRACE_MS 以内)に新SWを検知した場合は
  // 自動で skipWaiting + reload を行う。それ以降の検知は UpdateBanner で手動更新。
  const COLD_START_GRACE_MS = 5000
  const launchTimeRef = useRef(Date.now())
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null)
  const [showUpdateBanner, setShowUpdateBanner] = useState(false)
  const {
    needRefresh: [needRefresh], updateServiceWorker
  } = useRegisterSW({
    onRegistered(r) {
      if (r) swRegRef.current = r
    },
    onRegisterError(error) {
      console.error('SW registration error', error)
    },
  })

  // needRefresh が立った時の分岐:
  //   コールドスタート相当 → 自動適用
  //   セッション中         → UpdateBanner 表示
  useEffect(() => {
    if (!needRefresh) return
    const elapsed = Date.now() - launchTimeRef.current
    if (elapsed < COLD_START_GRACE_MS) {
      updateServiceWorker(true)
    } else {
      setShowUpdateBanner(true)
    }
  }, [needRefresh, updateServiceWorker])

  // 起動時フォールバック: useRegisterSW の通知に依存せず、既に waiting 状態の
  // SW を直接検出して skipWaiting する。iOS PWA の standalone モードで
  // needRefresh が発火しないケースを救済する目的。
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let reloaded = false
    const onControllerChange = () => {
      if (reloaded) return
      const elapsed = Date.now() - launchTimeRef.current
      if (elapsed < COLD_START_GRACE_MS) {
        reloaded = true
        window.location.reload()
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      }
    }).catch(() => { /* noop */ })
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  // アプリがフォアグラウンド復帰したタイミングで SW 更新チェックを走らせる
  // （addEventListener はマウント中のみ。アンマウント時に確実に外す）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const reg = swRegRef.current
      if (!reg) return
      reg.update().catch((err) => {
        console.error('更新チェック中にエラーが発生しました:', err)
      })
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // 時刻計算
  const currentRoute = timetable?.routes[route]
  const schedule = currentRoute?.schedule ?? []
  const nowMinutes = now.hour() * 60 + now.minute()
  const nextBus = schedule.length > 0 ? findNextBus(schedule, now) : null
  const remainingCount = countRemainingBuses(schedule, now)
  const upcoming = nextBus ? findUpcomingBuses(schedule, nextBus.index, 4) : []
  const isEndOfService = schedule.length > 0 && nextBus === null
  // 全便運休日: 時刻表は取得できているが本日の schedule が空
  const isNoService = !!currentRoute && schedule.length === 0
  const tomorrowSchedule = tomorrowTimetable?.routes[route]?.schedule ?? []
  const tomorrowFirstBus = findFirstBus(tomorrowSchedule)

  // ダイヤ種別バッジ
  const diagramType = timetable ? resolveDiagramType(timetable.id) : 'weekday'

  // 特別ダイヤ: 既定のフォーマットで表現できないダイヤの日（お盆期間など）。
  // 発車時刻は出さずに大学ホームページへ誘導する。schedule が空になる点は
  // 運休日(isNoService)と同じなので、描画側では isSpecial を先に判定すること。
  // 直近4本(nextBus が null)と全時刻表(FullTimetable が null を返す)は
  // 空 schedule のガードで自動的に消えるため、追加の分岐は要らない。
  const isSpecial = diagramType === 'special'

  // 日付が変わったのに当日分をまだ取得できていない間（オフラインでの日付跨ぎなど）は、
  // 前日のダイヤを当日の日付見出しの下に出さない。正典の「推測するより出さない」に合わせる。
  // 前日に翌日分を prefetch できていれば useTimetable が昇格させるので、ここへは来ない。
  const showTimes = !loading && !!currentRoute && !stale

  // データの状態を 1 つに畳む。上から順に判定し、最初に該当したものだけを描く。
  // 以前は error と stale の分岐が独立しており、日付跨ぎ＋取得失敗でカードが 2 枚出ていた。
  // 時刻を出せない状態はカードが主役なので StatusCard、時刻を出せる状態は時刻が主役なので
  // ヘッダー直下の StatusBand と、状態の重さで表現を分ける。
  const dataStatus = deriveDataStatus({
    loading,
    refetching,
    error,
    stale,
    hasTimetable: !!timetable,
    isOnline,
    // 「取得できた」と「その本文が新しい」は別。SW の NetworkFirst は 3 秒で
    // キャッシュへ成功フォールバックするため、成功のまま古い本文を出しうる
    fetchedAt,
    nowMs: now.valueOf(),
  })

  // フォントサイズクラス（CSS変数経由ではなくコンポーネントprops渡し）
  const fontSize = settings.fontSize

  // 更新ボタン（window.location.reload() は使用しない）
  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    showToast('⟳ 時刻データを更新しています...', 1600)
    try {
      const ok = await refresh()
      showToast(ok ? '✓ 最新の時刻データに更新しました' : '⚠ 更新に失敗しました（オフライン？）')
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

    try {
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
    } catch (e) {
      console.error('アプリの初期化中にエラーが発生しました:', e)
    } finally {
      // 4. 強制リロード（初期化時のみ reload を許可。途中で失敗しても
      //    掃除できた分を反映しつつ復旧を優先するため必ず実行する）
      window.location.reload()
    }
  }, [])

  // 端末のカラーモード（prefers-color-scheme）を購読
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // テーマ（system は端末設定を反映し、OS のモード切替に追従する）
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark)

  // .dark クラスは <html> に付与する。CSS 変数 (--bg-page 等) がここから全体にカスケードし、
  // マウント前は index.html のインラインスクリプトが同じ判定で初期値を設定済み（FOUC 防止）。
  // ここでは設定変更・OS のカラーモード切替に追従して同期する。
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // オーバースクロール表現は OS ネイティブに委譲する（useNativeBounce）:
  // iOS はルートのネイティブバウンスを解放（html.bounce-native）し、上端露出は
  // .header-cushion が塗る。Android はネイティブのストレッチ（html.bounce-stretch、
  // 端をピン留めして引き伸ばす表現のため隙間が開かず露出色の同期は不要）。
  // PC は従来どおりバウンス無し（html,body の overscroll-behavior: none）。
  const headerRef = useRef<HTMLElement>(null)
  const cushionRef = useRef<HTMLDivElement>(null)
  useNativeBounce(headerRef, cushionRef)

  return (
    /*
      レスポンシブ戦略（ブレークポイント判定は CSS メディアクエリではなく
      main.tsx の syncBpActiveClass が付与する html.bp-active クラスで行う。
      条件: 画面幅 1024px 以上、または landscape かつ 480px 以上）:
      - モバイル（bp 未満）        : 全画面・縦1カラム表示
      - PC/横向き（html.bp-active）: 時刻表（左）・地図（右）の2カラム + 全時刻表は下段フル幅
    */
    <>
      {/* アプリ外枠（.dark は <html> 側で管理） */}
      <div>
        {/* シェル: モバイル=全画面、PC/横向き=全幅 */}
        <div
          className="relative w-full"
          style={{
            // 実ビューポート高さ(--app-height)を下限に。未設定環境では 100vh にフォールバック
            minHeight: 'var(--app-height, 100vh)',
          }}
        >
          {/* 角丸・影の付与/解除は index.css の html.bp-active .phone-shell-inner で制御する */}
          <div
            // isolate: 子要素の z-index をこのコンテナ内に閉じ込め、角丸クリップと重なり順を安定させる
            className="phone-shell-inner w-full overflow-hidden isolate"
            style={{
              position: 'relative',
              background: 'var(--bg-page)', // 背景は内側だけで描画する
              transition: 'background 0.35s',
              minHeight: 'var(--app-height, 100vh)',
            }}
          >
        {/* Toast */}
        <Toast message={toast.message} visible={toast.visible} />

        {/* ドロワーメニュー */}
        <DrawerMenu
          open={drawerOpen}
          covered={newsOpen || weeklyOpen || settingsOpen || helpOpen}
          hasUnread={hasUnread}
          onClose={() => setDrawerOpen(false)}
          onOpenNews={() => setNewsOpen(true)}
          onOpenWeekly={() => setWeeklyOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          onInitApp={handleInitApp}
        />

        {/* お知らせ（状態は App で一元管理して受け渡す） */}
        <NewsScreen open={newsOpen} onClose={() => setNewsOpen(false)} {...newsState} />

        {/* 週間ダイヤ（ホームの帯と同じ week の結果を使う） */}
        <WeeklyScreen
          open={weeklyOpen}
          onClose={() => setWeeklyOpen(false)}
          days={week.days}
          loading={week.loading}
          error={week.error}
          onReload={week.reload}
          route={route}
          onChangeRoute={setRoute}
          now={now}
          isOnline={isOnline}
        />

        {/* 設定 */}
        <SettingsScreen
          open={settingsOpen}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSetDefaultRoute={setDefaultRoute}
          onSetTheme={setTheme}
          onSetFontSize={setFontSize}
          push={{
            status: push.status,
            busy: push.busy,
            error: push.error,
            enable: () => void push.enable(),
            disable: () => void push.disable(),
          }}
          updateAvailable={showUpdateBanner}
        />

        {/* ヘルプ */}
        <HelpScreen
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
        />

        {/* 背面レイヤー（ヘッダー・本文・バナー）。オーバーレイが開いている間は inert。
            phone-shell-inner は flex/grid ではなく、バナーと PWA 案内は position:fixed なので
            この div を挟んでもレイアウトは変わらない。 */}
        <div ref={backgroundRef}>

        {/* ヘッダー */}
        <header
          ref={headerRef}
          className={route === 'campus_to_station' ? 'header campus' : 'header station'}
          style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 22px 22px', transition: 'background 0.55s' }}
        >
          <div className="flex items-center justify-between mb-1">
            {/* ハンバーガーボタン */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setDrawerOpen(true)}
                {...menuPress.pressHandlers}
                aria-label={hasUnread ? 'メニューを開く（未読のお知らせがあります）' : 'メニューを開く'}
                className="flex flex-col gap-[4.5px] items-center justify-center frost-icon-btn"
                style={{
                  width: 43, height: 43, borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,.38)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.45), 0 2px 6px rgba(0,0,0,.14)',
                  transform: menuPress.pressed ? 'scale(.92)' : 'scale(1)',
                  transition: 'transform .12s ease-out',
                }}
              >
                <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
                <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
                <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
              </button>

              {/* 未読インジケーター（A4: パルスリング・フチなし） */}
              {hasUnread && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', top: 1, right: 1,
                    width: 11, height: 11, pointerEvents: 'none',
                  }}
                >
                  {/* 広がるリング（prefers-reduced-motion で停止） */}
                  <span
                    className="unread-pulse-ring"
                    style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#0ea5e9', opacity: 0.55 }}
                  />
                  {/* 中心ドット（フチなし） */}
                  <span
                    style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#0ea5e9' }}
                  />
                </span>
              )}
            </div>

            {/* 中央：タイトル・日付・バッジ */}
            <div className="flex-1 text-center">
              <h1 className="text-[28px] font-bold text-white" style={{ letterSpacing: '-.4px' }}>
                {timetable?.routes[route].origin ?? (route === 'campus_to_station' ? '大学発' : '松永発')}
              </h1>
              <div className="flex items-center justify-center gap-[7px] mt-1">
                {/* 白のまま不透明にする。88% だとヘッダーのグラデ上で地に沈む */}
                <span className="text-[18px] font-medium" style={{ color: '#fff' }}>
                  {now.month() + 1}/{now.date()}（{DAYS_JA[now.day()]}）
                </span>
                {/* stale の間はその日のダイヤ種別が分かっていない。前日の種別を
                    今日のバッジとして出さない（時刻を出さないのと同じ理由）。
                    timetable が無いときも同様で、diagramType は既定値 'weekday' を
                    返すため、実データを見ずに「授業日ダイヤ」と名乗ってしまう */}
                {!stale && !!timetable && <DayBadge type={diagramType} />}
              </div>
            </div>

            {/* 更新ボタン */}
            {/* 回転は <svg> 側に持たせる。button 自身は押下の scale を使うため、
                同じ要素に 2 つの transform を書くと片方が消える */}
            <button
              onClick={() => { if (!refreshing) tapFeedback(10); handleRefresh() }}
              {...refreshPress.pressHandlers}
              disabled={refreshing}
              aria-label="時刻データを更新"
              className="frost-icon-btn"
              style={{
                width: 43, height: 43, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                border: '1px solid rgba(255,255,255,.38)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.45), 0 2px 6px rgba(0,0,0,.14)',
                transform: refreshPress.pressed ? 'scale(.92)' : 'scale(1)',
                transition: 'transform .12s ease-out',
              }}
            >
              <svg
                width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  transition: 'transform 0.7s linear',
                  transform: refreshing ? 'rotate(720deg)' : 'rotate(0deg)',
                }}
              >
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>

          {/* セグメントコントロール */}
          <RouteToggle route={route} onChange={setRoute} />
        </header>

        {/* 時刻は出せるが状態を伝えたいとき（オフライン・取得失敗）は、カードではなく
            ヘッダー直下の帯で伝える。main の外に置くので全幅になり、bp-active の
            2 カラムでもその上に載る。通常フローなので safe-area・header-cushion・
            iOS のネイティブバウンスとは干渉しない。 */}
        {showsBand(dataStatus) && (
          <StatusBand
            status={dataStatus}
            fetchedAt={fetchedAt}
            now={now}
            refreshing={refreshing}
            onRetry={handleRefresh}
          />
        )}

        {/* メインコンテンツ */}
        <main className="flex flex-col gap-[10px] p-[14px] bp:p-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>

          {/* bp: 左右2カラムエリア */}
          {/* bp 時は align-items: stretch（既定）。右カラムの地図を左カラムの高さに
              追従させて下端を揃えるため、items-start は付けない */}
          <div className="flex flex-col gap-[10px] bp:flex-row bp:gap-6">

            {/* 左カラム: ローディング / エラー / 時刻カード群 */}
            <div className="flex flex-col gap-[10px] bp:flex-1 bp:min-w-0">

              {/* ローディング */}
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                  <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>時刻表を読み込み中...</p>
                </div>
              )}

              {/* 時刻を出せない状態（未取得・日付跨ぎ）。この間はカードが画面の主役になる */}
              {hidesTimes(dataStatus) && (
                <StatusCard
                  status={dataStatus}
                  isOnline={isOnline}
                  fetchedAt={fetchedAt}
                  now={now}
                  refreshing={refreshing}
                  onRetry={handleRefresh}
                  errorMessage={error}
                />
              )}

              {/* 次のバス / 終バス後 / 運休日 / 特別ダイヤ */}
              {showTimes && (
                <>
                  {isSpecial ? (
                    <SpecialScheduleCard isOnline={isOnline} />
                  ) : isNoService ? (
                    <EndOfServiceCard
                      message="本日の運行はありません"
                      tomorrowFirstBus={tomorrowFirstBus}
                      tomorrowTimetableName={tomorrowTimetable?.name}
                    />
                  ) : isEndOfService ? (
                    <EndOfServiceCard
                      tomorrowFirstBus={tomorrowFirstBus}
                      tomorrowTimetableName={tomorrowTimetable?.name}
                    />
                  ) : (
                    nextBus && (
                      <NextBusCard
                        next={nextBus}
                        route={route}
                        fontSize={fontSize}
                        remaining={remainingCount}
                        // reminders.marked は今選んでいるルートの当日ぶんなので、次発と直接突き合わせられる
                        reminded={reminders.marked.has(nextBus.entry.departure)}
                      />
                    )
                  )}

                  {/* 直近4本 */}
                  {!isEndOfService && nextBus && (
                    <UpcomingList
                      buses={upcoming}
                      route={route}
                      nowMinutes={nowMinutes}
                      fontSize={fontSize}
                      marked={reminders.marked}
                    />
                  )}
                </>
              )}
              {/* モバイルのみ表示: 全時刻表をマップより上に配置 */}
              {showTimes && (
                <div className="bp:hidden">
                  <FullTimetable
                    schedule={schedule}
                    route={route}
                    currentDeparture={nextBus?.entry.departure}
                    nowMinutes={nowMinutes}
                    marked={reminders.marked}
                    reminderReady={push.status === 'subscribed'}
                    reminderLoadState={reminders.loadState}
                    onReloadReminders={reminders.reload}
                    lead={reminders.lead}
                    onChangeLead={reminders.changeLead}
                    onSave={reminders.save}
                    saving={reminders.saving}
                    reminderError={reminders.error}
                  />
                </div>
              )}

              {/* 週間ダイヤの帯。モバイルでは「本日の全時刻表」の下・「乗り場マップ」の直前、
                  bp-active では左カラムの末尾に入る。表示条件を showTimes に合わせるのは、
                  日付跨ぎで当日分が未取得の間に前日起点の週を出さないため
                  （時刻を出さないのと同じ理由）。 */}
              {showTimes && (
                <WeekStrip
                  days={week.days}
                  todayKey={now.format('YYYY-MM-DD')}
                  onOpen={() => setWeeklyOpen(true)}
                />
              )}
            </div>{/* / 左カラム */}

            {/* 右カラム: 地図 */}
            {!loading && currentRoute && (
              <div className="bp:flex-1 bp:min-w-0 bp:flex bp:flex-col">
                <section className="bp:flex-1 bp:flex bp:flex-col bp:min-h-0">
                  <p className="text-[11px] font-bold tracking-widest uppercase mb-3 bp:shrink-0" style={{ color: 'var(--text-muted)' }}>
                    乗り場マップ
                  </p>
                  {/* オフラインでも地図はマウントする。タイルは osm-tiles キャッシュ（CacheFirst）
                      から出るため、一度表示した範囲はそのまま閲覧できる（README・ヘルプの説明どおり）。
                      未取得の範囲は空白になるので、その旨をオフライン時だけ注記する。 */}
                  <Suspense
                    fallback={
                      <div className="section-card rounded-[20px] flex items-center justify-center h-[220px] bp:h-auto bp:flex-1 bp:min-h-[300px]">
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
                  {!isOnline && (
                    <p className="text-[11px] mt-2 text-center bp:shrink-0" style={{ color: 'var(--text-muted)' }}>
                      オフラインのため、以前表示した範囲のみ表示されます（乗り場：{currentRoute.bus_stop_name}）
                    </p>
                  )}
                </section>
              </div>
            )}{/* / 右カラム */}

          </div>{/* / 2カラムエリア */}

          {/* PC版のみ表示: 全幅展開（2カラムの下） */}
          {showTimes && (
            <div className="hidden bp:block">
              <FullTimetable
                schedule={schedule}
                route={route}
                currentDeparture={nextBus?.entry.departure}
                nowMinutes={nowMinutes}
                marked={reminders.marked}
                reminderReady={push.status === 'subscribed'}
                reminderLoadState={reminders.loadState}
                onReloadReminders={reminders.reload}
                lead={reminders.lead}
                onChangeLead={reminders.changeLead}
                onSave={reminders.save}
                saving={reminders.saving}
                reminderError={reminders.error}
              />
            </div>
          )}

          <footer className="text-center pt-4">
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              &copy; 2026 campus-bus-navi
            </p>
          </footer>

        </main>

        </div>{/* 背面レイヤー */}

        {/* モバイル端末向け：ホーム画面追加 / アプリインストール案内。
            背面レイヤーの外に置く。中に置くと、自分自身も inert の対象になり、
            aria-modal が求める「背面だけを隔離する」が成立しない */}
        <MobilePwaGuide open={pwaGuideOpen} onClose={() => setPwaGuideOpen(false)} />

        {/* PWA更新通知バナー（registerType: 'prompt'）。
            コールドスタート時は自動適用されるため、セッション中の更新検知時のみ表示する。
            MobilePwaGuide と同じ理由で背面レイヤーの外に置く: ドロワー・お知らせ・週間ダイヤ・
            設定・ヘルプのいずれかが開いている間も、UpdateBanner はそれらより手前に出る設計
            （重なり順は index.css のヘッダーコメント、DrawerMenu 30・各画面 50・PWA案内 100・
            バナー 110・Toast 200 のとおり）なので、backgroundRef の inert に巻き込まれてはいけない。 */}
        {showUpdateBanner && (
          <UpdateBanner
            onUpdate={() => updateServiceWorker(true)}
            onDismiss={() => setShowUpdateBanner(false)}
          />
        )}
          </div>{/* phone-shell-inner */}

          {/* ホーム上端バウンスのグラデ継続クッション（iOS ネイティブバウンス専用、
              スタイルは index.css の .header-cushion）。viewport 固定・z-index:-1 の
              背面レイヤーで、静止時はオペークな shell に覆われて不可視。ネイティブ
              バウンスがページごと押し下げた隙間から覗く（ヘッダー上端行と同一の
              色プロファイル）。Android はストレッチ表現（隙間が開かない）のため
              display:none のまま使われない。 */}
          <div
            ref={cushionRef}
            aria-hidden="true"
            className={route === 'campus_to_station' ? 'header-cushion campus' : 'header-cushion station'}
          />
        </div>{/* phone outer */}
      </div>{/* app wrapper */}
    </>
  )
}
