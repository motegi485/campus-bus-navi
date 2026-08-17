import { useEffect, useRef, useState } from 'react'
import type dayjs from 'dayjs'
import type { RouteKey } from '../types/timetable'
import type { WeekDay } from '../hooks/useWeekTimetables'
import { setInert, useOverlayA11y } from '../hooks/useOverlayA11y'
import { usePressable } from '../hooks/usePressable'
import { tapFeedback } from '../utils/haptics'
import { DayBadge } from './DayBadge'
import { RouteSwitch } from './RouteSwitch'
import { TimetableGrid } from './TimetableGrid'
import { EndOfServiceCard } from './EndOfServiceCard'
import { SpecialScheduleCard } from './SpecialScheduleCard'
import { StatusIcon, RetryButton } from './StatusParts'

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

/** 当日を示す線・戻るボタンに使う色。既存画面の BackButton と同じ値 */
const ACCENT = '#10b981'

interface Props {
  open: boolean
  onClose: () => void
  /** 週の各日。取得は App の useWeekTimetables が 1 回だけ行い、ここへ渡す */
  days: WeekDay[]
  /** calendar_rules.json を取得中（＝日付もダイヤ種別も出せない） */
  loading: boolean
  /** calendar_rules.json 自体が取得できなかった */
  error: string | null
  onReload: () => Promise<void>
  route: RouteKey
  onChangeRoute: (route: RouteKey) => void
  now: dayjs.Dayjs
  isOnline: boolean
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: ACCENT, fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}
    >
      <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
        <path d="M8.5 1.5L1.5 8L8.5 14.5" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {label}
    </button>
  )
}

/** 選択中ルートの発車本数。時刻表が無ければ null */
function countFor(day: WeekDay, route: RouteKey): number | null {
  const schedule = day.timetable?.routes[route]?.schedule
  return schedule ? schedule.length : null
}

/**
 * 一覧の 1 行。
 *
 * ダイヤ種別は DayBadge をそのまま置く。ラベルと色をここへ写し取ると
 * ホームと食い違いうるため、コンポーネントごと使うことで一致を構造的に保証する。
 */
function WeekRow({
  day,
  route,
  isToday,
  onSelect,
}: {
  day: WeekDay
  route: RouteKey
  isToday: boolean
  onSelect: () => void
}) {
  const { pressed, pressHandlers } = usePressable()
  const count = countFor(day, route)

  // 運休日・特別ダイヤは面を一段沈めて、時刻がある日と並んだときに区別が付くようにする
  const sunken = day.diagramType === 'closed' || day.diagramType === 'special'

  // 右端。取得できていないものを他の日で埋めない。
  // 状態を伝える文字は --chip-text で揃える。--text-secondary は運休・特別の行の面
  // （--bg-card2）に対して 4.48:1 と AA を割り、--icon-red-fg は白面でも 3.76:1 と届かない。
  // 赤で目立たせないのは StatusCard と同じ判断で、色ではなく語で状態を伝える。
  let right: React.ReactNode
  let rightLabel: string
  if (day.status === 'loading') {
    right = <span aria-hidden="true" style={{ display: 'block', width: 34, height: 11, borderRadius: 6, background: 'var(--bg-input)' }} />
    rightLabel = '本数を取得中'
  } else if (day.status === 'error') {
    right = <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--chip-text)', whiteSpace: 'nowrap' }}>取得できません</span>
    rightLabel = '取得できません'
  } else if (day.diagramType === 'closed') {
    right = <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--chip-text)', whiteSpace: 'nowrap' }}>運行なし</span>
    rightLabel = '運行なし'
  } else if (day.diagramType === 'special') {
    right = <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--chip-text)', whiteSpace: 'nowrap' }}>時刻なし</span>
    rightLabel = '発車時刻は大学ホームページで確認'
  } else {
    right = (
      <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
        {count ?? 0}
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 1 }}>本</span>
      </span>
    )
    rightLabel = `${count ?? 0}本`
  }

  const weekday = day.date.day()
  // 土日だけ色を変える。日付と曜日の文字自体は残るので、情報は色だけに依存しない。
  // 平日に --text-secondary を使わないのは、運休・特別の行の面（--bg-card2）で
  // 4.48:1 と AA を割るため（--chip-text は 7.01:1）
  const weekdayColor =
    weekday === 6 ? 'var(--dow-sat)' : weekday === 0 ? 'var(--dow-sun)' : 'var(--chip-text)'

  return (
    <button
      type="button"
      onClick={() => { tapFeedback(8); onSelect() }}
      {...pressHandlers}
      aria-label={`${day.date.month() + 1}月${day.date.date()}日（${DAYS_JA[weekday]}）${isToday ? ' 今日' : ''} ${rightLabel}`}
      style={{
        width: '100%',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 16,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        background: pressed ? 'var(--row-active)' : sunken ? 'var(--bg-card2)' : 'var(--bg-card)',
        // 当日は行全体を細く囲う。border ではなく inset の影にすることで、
        // 他の行と内側の余白・行高が 1px も変わらない
        boxShadow: isToday ? `inset 0 0 0 1.5px ${ACCENT}` : 'none',
        transition: pressed ? 'none' : 'background 0.3s',
      }}
    >
      <div style={{ width: 50, flexShrink: 0 }}>
        <div className="tabular-nums" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.4px', lineHeight: 1.1, color: 'var(--text-primary)' }}>
          {day.date.month() + 1}/{day.date.date()}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, marginTop: 1, color: weekdayColor }}>
          {DAYS_JA[weekday]}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
        <DayBadge type={day.diagramType} />
        {isToday && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: ACCENT, color: '#fff' }}>
            今日
          </span>
        )}
      </div>

      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        {right}
        <span aria-hidden="true" style={{ fontSize: 13, color: 'var(--text-muted)' }}>›</span>
      </div>
    </button>
  )
}

/** 始発・最終・本数（1 つのカードを 3 分割） */
function DayStats({ first, last, count }: { first: string; last: string; count: number }) {
  const cell = (label: string, value: React.ReactNode) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
        {label}
      </p>
      <p className="tabular-nums" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.3px', color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
  return (
    <div className="section-card rounded-[20px] p-[14px_12px]">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {cell('始発', first)}
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border2)' }} />
        {cell('最終', last)}
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border2)' }} />
        {cell('本数', <>{count}<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>本</span></>)}
      </div>
    </div>
  )
}

/**
 * 日別ビュー。お知らせの NewsDetail と同じ入れ子パネル。
 *
 * ルート切替はここには置かない。ルートは週一覧のヘッダーで切り替え、この画面はそれに追従する。
 */
function DayDetailView({
  day,
  route,
  nowMinutes,
  isOnline,
  reloading,
  onRetry,
  onBack,
}: {
  day: WeekDay
  route: RouteKey
  /** 当日なら 0 時からの分。当日以外は null（過去便のグレーアウトを効かせない） */
  nowMinutes: number | null
  isOnline: boolean
  reloading: boolean
  onRetry: () => void
  onBack: () => void
}) {
  const backRef = useRef<HTMLDivElement>(null)
  // 詳細を開いた直後は「週間ダイヤ」（戻る）へフォーカスを移す
  useEffect(() => {
    backRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])

  const schedule = day.timetable?.routes[route]?.schedule ?? []
  const weekday = day.date.day()

  // 次発のハイライトは当日だけ。運行終了後は該当が無いので undefined になる
  const currentDeparture =
    nowMinutes === null
      ? undefined
      : schedule.find(bus => {
          const [h, m] = bus.departure.split(':')
          return Number(h) * 60 + Number(m) > nowMinutes
        })?.departure

  let body: React.ReactNode
  if (day.status === 'error') {
    body = (
      <div
        className="rounded-[20px] p-5 text-center"
        style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="mb-0.5"><StatusIcon status="no-data" /></div>
          <p className="text-[14px] font-bold leading-normal" style={{ color: 'var(--text-primary)' }}>
            この日の時刻表を取得できませんでした
          </p>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--chip-text)' }}>
            通信環境をご確認のうえ、再試行してください。
            <br />
            他の日のダイヤで代用はしていません。
          </p>
          <RetryButton size="lg" refreshing={reloading} onRetry={onRetry} />
        </div>
      </div>
    )
  } else if (day.diagramType === 'special') {
    // special は closed より先に判定する（どちらも schedule が空になるため）
    body = (
      <SpecialScheduleCard
        isOnline={isOnline}
        eyebrow="この日のダイヤ"
        description="この日の発車時刻は特別な日程になっています。大学ホームページでご確認ください。"
      />
    )
  } else if (day.diagramType === 'closed' || schedule.length === 0) {
    body = (
      <EndOfServiceCard
        tomorrowFirstBus={null}
        eyebrow="この日のダイヤ"
        message="この日の運行はありません"
      />
    )
  } else {
    body = (
      <>
        <DayStats first={schedule[0].departure} last={schedule[schedule.length - 1].departure} count={schedule.length} />
        <div className="section-card rounded-[20px] p-[18px]">
          <div className="flex items-baseline justify-between mb-[14px]">
            <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
              {day.timetable?.routes[route]?.origin} → {day.timetable?.routes[route]?.destination}
            </span>
            {nowMinutes !== null && (
              <span className="text-[10.5px] font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:{String(nowMinutes % 60).padStart(2, '0')} 現在
              </span>
            )}
          </div>
          <TimetableGrid
            schedule={schedule}
            route={route}
            currentDeparture={currentDeparture}
            nowMinutes={nowMinutes}
          />
        </div>
      </>
    )
  }

  return (
    /* overflow:hidden の本パネル自体がスクロールコンテナ扱いになり親の touchAction が
       効かないため、ここにも touchAction を付けて NavBar 起点の貫通スクロールを防ぐ */
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-page)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 10, transition: 'background 0.35s', touchAction: 'pinch-zoom' }}>
      <div ref={backRef} style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
        <BackButton label="週間ダイヤ" onClick={onBack} />
      </div>

      {/* 見出し帯。ホームのヘッダーと同じグラデ（.header.campus / .header.station）を
          使うので、どちらのルートを見ているかが色で分かる。色と角度の定義は
          index.css が単一の真実源 */}
      <div
        className={route === 'campus_to_station' ? 'header campus' : 'header station'}
        style={{ padding: '18px 20px', flexShrink: 0, transition: 'background 0.55s' }}
      >
        <div className="flex items-center gap-[9px] flex-wrap">
          <span className="text-[26px] font-extrabold tabular-nums" style={{ color: '#fff', letterSpacing: '-.5px' }}>
            {day.date.month() + 1}/{day.date.date()}
          </span>
          <span className="text-[16px] font-semibold" style={{ color: '#fff' }}>
            （{DAYS_JA[weekday]}）
          </span>
          {nowMinutes !== null && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: 'rgba(255,255,255,.28)', color: '#fff' }}>
              今日
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <DayBadge type={day.diagramType} />
          {day.timetable && (
            <span className="text-[12px]" style={{ color: 'rgba(255,255,255,.88)' }}>
              {day.timetable.name}
            </span>
          )}
        </div>
      </div>

      {/* 本文スクローラ（contain + 常時スクロール可能化。露出色 = --bg-page） */}
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ minHeight: 'calc(100% + 1px)', padding: '14px 14px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {body}
        </div>
      </div>
    </div>
  )
}

export function WeeklyScreen({
  open,
  onClose,
  days,
  loading,
  error,
  onReload,
  route,
  onChangeRoute,
  now,
  isOnline,
}: Props) {
  // 選択中の日は「オブジェクト」ではなく日付キーで持つ。詳細を開いたまま時刻表の取得が
  // 完了したときに、古いスナップショットを見続けないようにするため
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  const selected = selectedKey ? days.find(d => d.dateKey === selectedKey) ?? null : null

  // 閉時の inert 化、開いた直後の初期フォーカス、閉時のフォーカス復帰。
  // Escape は詳細を開いていれば詳細を、そうでなければ画面を閉じる。
  const rootRef = useOverlayA11y(open, {
    onEscape: () => { if (selected) closeDetail(); else onClose() },
  })

  // 詳細パネルを開いている間は、その背後のナビバーと一覧を操作対象から外す
  const navRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    setInert(navRef.current, selected !== null)
    setInert(listRef.current, selected !== null)
  }, [selected])

  // 画面を閉じたら詳細も畳む（次に開いたとき一覧から始まるように）
  useEffect(() => { if (!open) setSelectedKey(null) }, [open])

  // 日付が変わって選択中の日が週から外れたら詳細を閉じる（存在しない日を見続けない）
  useEffect(() => {
    if (selectedKey && days.length > 0 && !days.some(d => d.dateKey === selectedKey)) {
      setSelectedKey(null)
    }
  }, [days, selectedKey])

  const openDetail = (day: WeekDay) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    setSelectedKey(day.dateKey)
  }

  const closeDetail = () => {
    setSelectedKey(null)
    const prev = returnFocusRef.current
    returnFocusRef.current = null
    // 一覧の inert 解除（再描画後の effect）を待ってから戻す
    setTimeout(() => {
      if (prev && document.contains(prev)) prev.focus()
    }, 0)
  }

  const handleRetry = () => {
    if (reloading) return
    setReloading(true)
    void onReload().finally(() => setReloading(false))
  }

  const todayKey = now.format('YYYY-MM-DD')
  const nowMinutes = now.hour() * 60 + now.minute()

  return (
    /* fixed: ビューポート基準の全画面パネル（absolute だとドキュメント全高になり
       内部スクローラが機能しない）。touchAction: NavBar 等の非スクロール部起点の
       タッチによる背後 body への貫通スクロールを防ぐ（ピンチズームは許可）。 */
    <div ref={rootRef} aria-hidden={!open} style={{
      position: 'fixed', inset: 0, background: 'var(--bg-page)',
      transform: open ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.32s cubic-bezier(.4,0,.2,1), background 0.35s',
      zIndex: 50, display: 'flex', flexDirection: 'column',
      touchAction: 'pinch-zoom',
    }}>
      {/* ナビバー */}
      <div ref={navRef} style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
        <BackButton label="戻る" onClick={onClose} />
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.3px' }}>週間ダイヤ</span>
      </div>

      {/* 一覧。contain で外への連鎖を遮断し、内側ラッパーの minHeight 100%+1px で
          内容が短くても常にスクロール可能にする（iOS の連鎖遮断の成立条件） */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ minHeight: 'calc(100% + 1px)', padding: '14px 14px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '0 2px 6px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              今日から7日間
            </span>
            <RouteSwitch route={route} onChange={onChangeRoute} />
          </div>

          {loading && days.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>運行予定を読み込み中...</p>
            </div>
          )}

          {error && days.length === 0 && !loading && (
            <div
              className="rounded-[20px] p-5 text-center"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex flex-col items-center gap-2">
                <div className="mb-0.5"><StatusIcon status="no-data" /></div>
                <p className="text-[14px] font-bold leading-normal" style={{ color: 'var(--text-primary)' }}>
                  運行予定を取得できませんでした
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--chip-text)' }}>
                  通信環境をご確認のうえ、再試行してください。
                </p>
                <RetryButton size="lg" refreshing={reloading} onRetry={handleRetry} />
              </div>
            </div>
          )}

          {days.map(day => (
            <WeekRow
              key={day.dateKey}
              day={day}
              route={route}
              isToday={day.dateKey === todayKey}
              onSelect={() => openDetail(day)}
            />
          ))}

          {days.length > 0 && (
            <p className="text-[11px] leading-relaxed text-center" style={{ color: 'var(--text-muted)', padding: '12px 8px 0' }}>
              表示できるのは今日を含む 7 日間（6 日先まで）です。
              <br />
              予定は変更されることがあります。
            </p>
          )}
        </div>{/* / 内側ラッパー */}
      </div>

      {/* 日別ビュー */}
      {selected && (
        <DayDetailView
          key={selected.dateKey}
          day={selected}
          route={route}
          nowMinutes={selected.dateKey === todayKey ? nowMinutes : null}
          isOnline={isOnline}
          reloading={reloading}
          onRetry={handleRetry}
          onBack={closeDetail}
        />
      )}
    </div>
  )
}
