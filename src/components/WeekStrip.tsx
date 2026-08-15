import type { WeekDay } from '../hooks/useWeekTimetables'
import { badgeColor } from './DayBadge'
import { usePressable } from '../hooks/usePressable'
import { tapFeedback } from '../utils/haptics'

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  days: WeekDay[]
  /** 当日の日付キー（YYYY-MM-DD）。App の JST 時計から渡す */
  todayKey: string
  onOpen: () => void
}

/**
 * ホームに置く週間ダイヤの帯。「本日の全時刻表」の下、「乗り場マップ」の直前。
 *
 * 出すのは「この先 7 日がどの種類のダイヤで動くか」だけに絞ってある。
 * 日付の下に本数を重ねると数字が縦に 2 つ並び、どちらが日付か一目で分からなくなるため、
 * 本数は週間ダイヤ画面（1 行 1 日で横に余裕がある）の担当にした。
 * 帯そのものはルートによって変わらない（ダイヤ種別は両ルート共通）ので route を受け取らない。
 *
 * 画面遷移は「すべて見る」チップだけが担う。カード全体を押せるようにすると、
 * スクロール中の指の接触で意図しない遷移が起きる。
 *
 * 支援技術には帯ではなくチップの用途だけを伝える（帯は aria-hidden）。
 * 7 日 × 3 項目を読み上げても行動につながらず、同じ情報は遷移先の週間ダイヤ画面が
 * 1 日 1 ボタンとして正しくラベル付けして持っているため。
 */
export function WeekStrip({ days, todayKey, onOpen }: Props) {
  const { pressed, pressHandlers } = usePressable()

  // 取得前は器ごと出さない（空の枠が一瞬出ると、運行が無い週に見える）
  if (days.length === 0) return null

  return (
    <div className="section-card rounded-[20px] p-[16px_14px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
          週間ダイヤ
        </span>

        {/* 押せる範囲はこのチップだけ。材質は「本日の全時刻表」の開閉チップと同じ */}
        <button
          type="button"
          onClick={() => { tapFeedback(8); onOpen() }}
          {...pressHandlers}
          aria-label="週間ダイヤをすべて見る（7日先までの運行予定）"
          className="flex items-center gap-[5px] rounded-[20px] px-3 py-[6px] text-[12px] font-bold select-none"
          style={{
            border: '1px solid var(--chip-border)',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            background: 'var(--bg-input)',
            color: 'var(--chip-text)',
            boxShadow: pressed
              ? 'inset 0 1px 2px var(--chip-rim)'
              : 'inset 0 1px 0 var(--chip-highlight), 0 1.5px 0 var(--chip-rim), 0 2px 4px rgba(15,23,42,.10)',
            transform: pressed ? 'translateY(1px)' : 'translateY(0)',
            transition: 'transform .12s ease-out, box-shadow .12s ease-out',
          }}
        >
          <span>すべて見る</span>
          <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>›</span>
        </button>
      </div>

      <div aria-hidden="true" className="flex gap-[2px]">
        {days.map(day => {
          const weekday = day.date.day()
          const isToday = day.dateKey === todayKey
          // 平日は --chip-text。--text-muted (#aaaaaa) は 10px の文字に対し 2.32:1 しかなく、
          // 当日セルの面（--bg-card2）ではさらに落ちる
          const weekdayColor =
            weekday === 6 ? 'var(--dow-sat)' : weekday === 0 ? 'var(--dow-sun)' : 'var(--chip-text)'

          return (
            <div
              key={day.dateKey}
              className="flex-1 min-w-0 text-center"
              style={{
                padding: '7px 2px 9px',
                borderRadius: 11,
                background: isToday ? 'var(--bg-card2)' : 'transparent',
                boxShadow: isToday ? 'inset 0 0 0 1.5px #10b981' : 'none',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: weekdayColor }}>{DAYS_JA[weekday]}</div>
              <div className="tabular-nums" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.4px', color: 'var(--text-primary)', marginTop: 1 }}>
                {day.date.date()}
              </div>
              {/* ダイヤ種別の色。days が存在する時点で calendar_rules は解決済みなので、
                  時刻表ファイルの取得に失敗した日でも種別は分かっている（種別はカレンダーの
                  割当であって時刻表の中身ではない）。よって取得状況で薄くはしない */}
              <div
                style={{
                  height: 5,
                  borderRadius: 3,
                  margin: '7px 3px 0',
                  background: badgeColor(day.diagramType),
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
