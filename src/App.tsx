import { ArrowsClockwise, CalendarDots, CaretRight } from '@phosphor-icons/react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { RouteKey } from './types/timetable'
import { useJSTClock } from './hooks/useJSTClock'
import { useTimetable } from './hooks/useTimetable'
import { useWeekTimetables } from './hooks/useWeekTimetables'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { useSettings } from './hooks/useSettings'
import { usePushSubscription, type PushStatus } from './hooks/usePushSubscription'
import { useDepartureReminders } from './hooks/useDepartureReminders'
import { useNews } from './hooks/useNews'
import { useNativeBounce } from './hooks/useNativeBounce'
import { setInert } from './hooks/useOverlayA11y'
import { usePressable } from './hooks/usePressable'
import { tapFeedback } from './utils/haptics'
import { findNextBus, findUpcomingBuses, findFirstBus, countRemainingBuses } from './utils/findNextBus'
import { deriveDataStatus, hidesTimes, showsBand } from './utils/deriveDataStatus'
import { StatusCard } from './components/StatusCard'
import { StatusBand } from './components/StatusBand'
import { RouteToggle } from './components/RouteToggle'
import { NextBusCard } from './components/NextBusCard'
import { UpcomingList } from './components/UpcomingList'
import { FullTimetableSheet } from './components/FullTimetableSheet'
import { BellIcon } from './components/BellIcon'
import { EndOfServiceCard } from './components/EndOfServiceCard'
import { SpecialScheduleCard } from './components/SpecialScheduleCard'
import { BottomTabBar, type AppTab } from './components/BottomTabBar'
import { MapTab } from './components/MapTab'
import { MenuTab } from './components/MenuTab'
import { NewsScreen } from './components/NewsScreen'
import { WeeklyScreen } from './components/WeeklyScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { HelpScreen } from './components/HelpScreen'
import { Toast, useToast } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'
import { DayBadge, resolveDiagramType } from './components/DayBadge'
import { MobilePwaGuide, shouldShowMobilePwaGuide } from './components/MobilePwaGuide'

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

/**
 * 通知が未購読のときに「発車前に通知」行へ出す説明。
 * 到達条件を誤解させないため、状態ごとに理由を書き分ける（ReminderSection と同じ方針）。
 * この状態で行をタップしたときの行き先はいずれも設定画面（通知トグル）。
 */
const REMINDER_OFF_TEXT: Record<Exclude<PushStatus, 'subscribed'>, string> = {
  idle: 'オフ ・ タップして通知をオンにする',
  'ios-needs-install': 'ホーム画面に追加すると使えます',
  denied: '通知が拒否されています',
  unsupported: 'この環境では利用できません',
}

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

  // お知らせ状態はここ（App）で一元管理し、NewsScreen とメニュータブへ受け渡す。
  // 両方の未読インジケーターと NewsScreen の既読状態を同一ソースで同期させるため。
  const newsState = useNews()
  const hasUnread = newsState.news.some(item => item.unread && !newsState.readIds.has(item.id))

  // 3タブ（バス/マップ/メニュー）の現在表示
  const [activeTab, setActiveTab] = useState<AppTab>('bus')
  // 画面表示状態
  const [fullTimetableOpen, setFullTimetableOpen] = useState(false)
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
  const refreshPress = usePressable(refreshing)

  // いずれかのオーバーレイが開いている間、背後（タブ本文・バナー）を
  // Tab 順とアクセシビリティツリーから外す。WAI-ARIA の modal dialog パターン。
  const anyOverlayOpen = fullTimetableOpen || newsOpen || weeklyOpen || settingsOpen || helpOpen || pwaGuideOpen
  const backgroundRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setInert(backgroundRef.current, anyOverlayOpen)
  }, [anyOverlayOpen])

  // オーバーレイの開閉に history entry を積まない（意図的）。積むと、その履歴を
  // 端末側のブラウザ戻る/進むジェスチャー（iOS の画面端スワイプなど）が拾い、
  // ページがめくれる Web ページ然とした挙動になってネイティブ感を損なう。
  // オーバーレイを閉じる手段は ×ボタン・背面タップ・Escape（各画面の useOverlayA11y）。

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
  const upcoming = nextBus ? findUpcomingBuses(schedule, nextBus.index, 3) : []
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
  const isSpecial = diagramType === 'special'

  // 日付が変わったのに当日分をまだ取得できていない間（オフラインでの日付跨ぎなど）は、
  // 前日のダイヤを当日の日付見出しの下に出さない。正典の「推測するより出さない」に合わせる。
  const showTimes = !loading && !!currentRoute && !stale

  // 「発車前に通知」行（改修たたき台 1a）。たたき台どおり通知がオフでも行自体は必ず出し、
  // 説明とタップ先だけを状態で変える。オフのまま行を隠すと、機能の存在に気づけない。
  const reminderReady = push.status === 'subscribed'
  // reminderReady ではなく push.status を直接見る（boolean では union が絞り込めない）
  const reminderSummary = push.status !== 'subscribed'
    ? REMINDER_OFF_TEXT[push.status]
    : reminders.loadState === 'loading'
    ? '設定を読み込み中...'
    : reminders.loadState === 'error'
    // 読めていない状態を「未設定」と言い換えない（useDepartureReminders と同じ方針）
    ? '設定を読み込めませんでした'
    : reminders.marked.size > 0
    ? `本日 ${reminders.marked.size} 件設定中 ・ ${reminders.lead}分前`
    : '未設定'

  // データの状態を 1 つに畳む。上から順に判定し、最初に該当したものだけを描く。
  const dataStatus = deriveDataStatus({
    loading,
    refetching,
    error,
    stale,
    hasTimetable: !!timetable,
    isOnline,
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
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // オーバースクロール表現は OS ネイティブに委譲する（useNativeBounce）:
  // iOS はルートのネイティブバウンスを解放（html.bounce-native）し、上端露出は
  // .header-cushion が塗る。Android はネイティブのストレッチ（html.bounce-stretch）。
  const headerRef = useRef<HTMLElement>(null)
  const cushionRef = useRef<HTMLDivElement>(null)
  useNativeBounce(headerRef, cushionRef)

  const destination = currentRoute?.destination ?? (route === 'campus_to_station' ? '松永行き' : '大学行き')
  const originLabel = currentRoute?.origin ?? (route === 'campus_to_station' ? '大学発' : '松永発')

  return (
    <>
      <div>
        <div
          className="relative w-full"
          style={{ minHeight: 'var(--app-height, 100vh)' }}
        >
          <div
            className="phone-shell-inner w-full overflow-hidden isolate"
            style={{
              position: 'relative',
              background: 'var(--bg-page)',
              transition: 'background 0.35s',
              minHeight: 'var(--app-height, 100vh)',
            }}
          >
            {/* Toast */}
            <Toast message={toast.message} visible={toast.visible} />

            {/* 全時刻表シート（ホームの「全時刻表 ›」から開く） */}
            <FullTimetableSheet
              open={fullTimetableOpen}
              onClose={() => setFullTimetableOpen(false)}
              schedule={schedule}
              route={route}
              onChangeRoute={setRoute}
              now={now}
              diagramType={diagramType}
              currentDeparture={nextBus?.entry.departure}
              nowMinutes={nowMinutes}
              remaining={remainingCount}
              marked={reminders.marked}
              reminderReady={reminderReady}
              reminderLoadState={reminders.loadState}
              onReloadReminders={reminders.reload}
              lead={reminders.lead}
              onChangeLead={reminders.changeLead}
              onSave={reminders.save}
              saving={reminders.saving}
              reminderError={reminders.error}
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

            {/* 背面レイヤー（タブ本文・バナー）。オーバーレイが開いている間は inert。 */}
            <div ref={backgroundRef} className="flex flex-col" style={{ minHeight: 'var(--app-height, 100vh)' }}>

              {/* バスタブのヘッダー（マップ/メニュータブは各コンポーネントが自前のヘッダーを持つ）。
                  改修たたき台 1a はタイトル行・ルートトグル・日付ピル行の3つを同じ
                  padding:22px 20px 0 のブロック内にまとめて持つ（横の余白を揃えるため）。 */}
              {activeTab === 'bus' && (
                <header
                  ref={headerRef}
                  className="header-plain"
                  style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 22px) 20px 0' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h1 className="text-[27px] font-extrabold" style={{ color: 'var(--text-primary)', letterSpacing: '-.7px' }}>
                        {originLabel} → {destination}
                      </h1>
                      <p className="text-[14px] font-medium mt-[2px]" style={{ color: 'var(--text-muted)' }}>
                        {route === 'campus_to_station' ? 'スクールバス乗り場（緑のこかげ）' : 'スクールバス発着場'}
                      </p>
                    </div>
                    <button
                      onClick={() => { if (!refreshing) tapFeedback(10); handleRefresh() }}
                      {...refreshPress.pressHandlers}
                      disabled={refreshing}
                      aria-label="時刻データを更新"
                      style={{
                        width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--bg-input)', border: 'none', cursor: 'pointer',
                        transform: refreshPress.pressed ? 'scale(.92)' : 'scale(1)',
                        transition: 'transform .12s ease-out',
                      }}
                    >
                      <ArrowsClockwise size={22} weight="bold" color="var(--chip-text)" aria-hidden="true"
                        style={{ transition: 'transform 0.7s linear', transform: refreshing ? 'rotate(720deg)' : 'rotate(0deg)' }} />
                    </button>
                  </div>

                  <div className="mt-5">
                    <RouteToggle route={route} onChange={setRoute} />
                  </div>

                  {/* 日付ピル（タップで週間ダイヤへ）＋「今日」。改修たたき台には無いタップ導線だが、
                      見た目に手を加えずに週間ダイヤ帯（今回廃止）の代わりの入口として追加した
                      （ターン2チャットでの確定指示）。 */}
                  {!loading && !!timetable && !stale && (
                    <div className="flex items-center justify-between gap-[10px]" style={{ padding: '16px 0 14px' }}>
                      <button
                        type="button"
                        onClick={() => { tapFeedback(8); setWeeklyOpen(true) }}
                        // 表示は「9/10（木）」と短くしたので、読み上げには日付の全形を渡す
                        aria-label={`${now.month() + 1}月${now.date()}日（${DAYS_JA[now.day()]}）・週間ダイヤを開く`}
                        className="flex items-center gap-2 rounded-[14px]"
                        style={{ background: 'var(--bg-input)', padding: '10px 13px', border: 'none', cursor: 'pointer', font: 'inherit' }}
                      >
                        <CalendarDots size={18} weight="regular" color="var(--text-muted)" aria-hidden="true" />
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {now.month() + 1}/{now.date()}（{DAYS_JA[now.day()]}）
                        </span>
                        <DayBadge type={diagramType} />
                        {/* 押せることが見た目で分からなかったため、行カード（メニュー・
                            発車前の通知）と同じ「›」を右端に置く（ユーザー指示）。 */}
                        <CaretRight size={18} weight="bold" color="var(--text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
                      </button>
                      <span className="text-[13.5px] font-bold" style={{ color: 'var(--route-solid-campus)' }}>今日</span>
                    </div>
                  )}
                </header>
              )}

              {activeTab === 'bus' && showsBand(dataStatus) && (
                <StatusBand
                  status={dataStatus}
                  fetchedAt={fetchedAt}
                  now={now}
                  refreshing={refreshing}
                  onRetry={handleRefresh}
                />
              )}

              {/* バスタブ本文。横パディングは改修たたき台どおりセクションごとに異なる
                  （ヒーローカード枠 16px／それ以外 20px）ため、main 自体には持たせず、
                  各セクションが個別に持つ。縦の間隔は gap（14px、原本のセクション間
                  padding-top と同じ値）で作る。 */}
              {activeTab === 'bus' && (
              <main
                className="flex flex-col"
                style={{ gap: 14, paddingBottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 16px)' }}
              >
                {loading && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ padding: '0 20px' }}>
                    <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                    <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>時刻表を読み込み中...</p>
                  </div>
                )}

                {hidesTimes(dataStatus) && (
                  <div style={{ padding: '0 20px' }}>
                    <StatusCard
                      status={dataStatus}
                      isOnline={isOnline}
                      fetchedAt={fetchedAt}
                      now={now}
                      refreshing={refreshing}
                      onRetry={handleRefresh}
                      errorMessage={error}
                    />
                  </div>
                )}

                {showTimes && (
                  <>
                    <div style={{ padding: '0 16px' }}>
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
                            fontSize={fontSize}
                            remaining={remainingCount}
                            reminded={reminders.marked.has(nextBus.entry.departure)}
                          />
                        )
                      )}
                    </div>

                    {!isEndOfService && nextBus && (
                      <div style={{ padding: '0 20px' }}>
                        <div className="flex items-baseline justify-between" style={{ marginBottom: 2 }}>
                          <h2 className="text-[15px] font-bold" style={{ color: 'var(--chip-text)' }}>今後の発車時刻</h2>
                          <button
                            type="button"
                            onClick={() => { tapFeedback(8); setFullTimetableOpen(true) }}
                            className="text-[13px] font-semibold"
                            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
                          >
                            全時刻表 <CaretRight size={18} weight="bold" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} />
                          </button>
                        </div>
                        <UpcomingList
                          buses={[nextBus.entry, ...upcoming]}
                          nowMinutes={nowMinutes}
                          fontSize={fontSize}
                          marked={reminders.marked}
                        />

                        {/* 発車前の通知の入口。購読済みなら本日の予約状況を1行で見せて
                            全時刻表シート（便ごとの指定）へ、未購読なら理由を出して
                            設定画面の通知トグルへ導く。 */}
                        <button
                          type="button"
                          onClick={() => { tapFeedback(8); reminderReady ? setFullTimetableOpen(true) : setSettingsOpen(true) }}
                          className="flex items-center w-full"
                          style={{
                            gap: 12, margin: '14px 0 22px', padding: '13px 14px', borderRadius: 16,
                            background: 'var(--menu-group-bg)', border: '1px solid var(--row-card-border)',
                            cursor: 'pointer', font: 'inherit', textAlign: 'left',
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
                            <BellIcon width={20} height={20} />
                          </span>
                          <span className="min-w-0" style={{ flex: 1 }}>
                            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>発車前に通知</p>
                            <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                              {reminderSummary}
                            </p>
                          </span>
                          <CaretRight size={18} weight="bold" color="var(--text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </main>
              )}

              {/* マップタブ本文。地図・Street ViewともGoogle埋め込みiframeのため、
                  他の2タブのように常時マウントしておく必然性はないが、非アクティブ時に
                  iframeを都度破棄・再読み込みする無駄を避けるため、アクティブな間だけ
                  マウントする現状の方式のまま維持する。 */}
              {activeTab === 'map' && !loading && currentRoute && (
                <div className="flex-1 flex flex-col">
                  <MapTab
                    coords={currentRoute.bus_stop_coords}
                    stopName={currentRoute.bus_stop_name}
                    destination={destination}
                    route={route}
                    onChangeRoute={setRoute}
                  />
                </div>
              )}

              {/* メニュータブ本文 */}
              {activeTab === 'menu' && (
                <MenuTab
                  hasUnread={hasUnread}
                  onOpenNews={() => setNewsOpen(true)}
                  onOpenWeekly={() => setWeeklyOpen(true)}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenHelp={() => setHelpOpen(true)}
                  onInitApp={handleInitApp}
                />
              )}

              {/* ボトムタブバー（index.css の .bottom-tab-bar で position:fixed。
                  各タブ本文側が --tabbar-h ぶんの下パディングを確保する） */}
              <BottomTabBar active={activeTab} onChange={setActiveTab} hasUnread={hasUnread} />

            </div>{/* 背面レイヤー */}

            {/* モバイル端末向け：ホーム画面追加 / アプリインストール案内。
                背面レイヤーの外に置く。中に置くと、自分自身も inert の対象になり、
                aria-modal が求める「背面だけを隔離する」が成立しない */}
            <MobilePwaGuide open={pwaGuideOpen} onClose={() => setPwaGuideOpen(false)} />

            {/* PWA更新通知バナー（registerType: 'prompt'）。
                コールドスタート時は自動適用されるため、セッション中の更新検知時のみ表示する。 */}
            {showUpdateBanner && (
              <UpdateBanner
                onUpdate={() => updateServiceWorker(true)}
                onDismiss={() => setShowUpdateBanner(false)}
              />
            )}
          </div>{/* phone-shell-inner */}

          {/* ホーム上端バウンスのグラデ継続クッション（iOS ネイティブバウンス専用、
              スタイルは index.css の .header-cushion）。ヘッダーは白基調に統一したため、
              route による色分岐は持たない。 */}
          <div ref={cushionRef} aria-hidden="true" className="header-cushion" />
        </div>{/* phone outer */}
      </div>{/* app wrapper */}
    </>
  )
}
