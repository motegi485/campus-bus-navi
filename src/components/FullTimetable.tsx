import { useEffect, useState } from 'react'
import type { ScheduleEntry, RouteKey } from '../types/timetable'
import { usePressable } from '../hooks/usePressable'
import { tapFeedback } from '../utils/haptics'
import { LEAD_OPTIONS, type ReminderLead } from '../hooks/useDepartureReminders'
import { TimetableGrid } from './TimetableGrid'

interface Props {
  schedule: ScheduleEntry[]
  route: RouteKey
  currentDeparture?: string
  nowMinutes: number
  /** 通知を設定済みの便（"HH:mm"） */
  marked: ReadonlySet<string>
  /** 通知が使える状態か（設定画面のトグルがオン） */
  reminderReady: boolean
  lead: ReminderLead
  onChangeLead: (value: ReminderLead) => void
  /** 選んだ便を保存する。成功したら true */
  onSave: (departures: string[]) => Promise<boolean>
  saving: boolean
  /** 保存に失敗したときのメッセージ */
  reminderError: string | null
}

export function FullTimetable({
  schedule,
  route,
  currentDeparture,
  nowMinutes,
  marked,
  reminderReady,
  lead,
  onChangeLead,
  onSave,
  saving,
  reminderError,
}: Props) {
  const [open, setOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // 早期 return より前に呼ぶ（フックの呼び出し順を固定するため）
  const { pressed, pressHandlers } = usePressable()

  // 表を閉じたら選択モードも畳む。開き直したときに前回の選択が残っていると
  // 「保存したつもり」の取り違えが起きる
  useEffect(() => {
    if (!open) setSelectMode(false)
  }, [open])

  if (schedule.length === 0) return null

  const enterSelectMode = () => {
    tapFeedback(8)
    // 保存済みの指定を初期選択にする。解除もこの画面で行えるようにするため
    setSelected(new Set(marked))
    setSelectMode(true)
  }

  const toggle = (departure: string) => {
    tapFeedback(6)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(departure) ? next.delete(departure) : next.add(departure)
      return next
    })
  }

  const commit = async () => {
    tapFeedback(10)
    const ok = await onSave(Array.from(selected))
    if (ok) setSelectMode(false)
  }

  return (
    <div className="section-card rounded-[20px] p-[18px]">
      <button
        onClick={() => { tapFeedback(8); setOpen(v => !v) }}
        {...pressHandlers}
        className="w-full flex items-center justify-between select-none"
      >
        <span className="text-[11px] text-[var(--text-muted)] font-bold tracking-widest uppercase">
          本日の全時刻表
        </span>
        <div
          className="flex items-center gap-[5px] rounded-[20px] px-3 py-[6px] text-[12px] font-bold"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--chip-text)',
            border: '1px solid var(--chip-border)',
            boxShadow: pressed
              ? 'inset 0 1px 2px var(--chip-rim)'
              : 'inset 0 1px 0 var(--chip-highlight), 0 1.5px 0 var(--chip-rim), 0 2px 4px rgba(15,23,42,.10)',
            transform: pressed ? 'translateY(1px)' : 'translateY(0)',
            transition: 'transform .12s ease-out, box-shadow .12s ease-out',
          }}
        >
          <svg
            style={{ transform: open ? 'rotate(180deg)' : '', transition: 'transform 0.22s', width: 9, height: 9 }}
            fill="currentColor" viewBox="0 0 10 6" aria-hidden="true"
          >
            <path d="M0 0l5 6 5-6z" />
          </svg>
          <span>{open ? '閉じる' : '表示する'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-4">
          {/* 選択モードの操作バー。何分前かを先に決めてから便をタップする */}
          {selectMode && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>
                  🔔 通知する便を選ぶ
                </span>
                <button
                  type="button"
                  onClick={() => { tapFeedback(8); setSelectMode(false) }}
                  className="text-[12px] font-bold"
                  style={{ color: '#10b981', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  キャンセル
                </button>
              </div>

              <p className="text-[11px] mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                何分前に通知しますか
              </p>
              <div
                className="flex gap-[2px] rounded-[20px] p-[3px] mb-3"
                style={{ background: 'var(--bg-input)' }}
              >
                {LEAD_OPTIONS.map(option => {
                  const active = option === lead
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => { tapFeedback(6); onChangeLead(option) }}
                      aria-pressed={active}
                      className="flex-1 rounded-[18px] py-[5px] text-[11.5px] font-bold tabular-nums"
                      style={{
                        background: active ? 'var(--bg-card)' : 'transparent',
                        color: active ? '#047857' : 'var(--chip-text)',
                        border: 'none',
                        boxShadow: active ? '0 1px 2px rgba(15,23,42,.14)' : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {option}分前
                    </button>
                  )
                })}
              </div>

              <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                通知したい便をタップしてください（複数選べます）。過ぎた便は選べません。
              </p>
            </div>
          )}

          <TimetableGrid
            schedule={schedule}
            route={route}
            currentDeparture={currentDeparture}
            nowMinutes={nowMinutes}
            marked={marked}
            selectMode={selectMode}
            selected={selected}
            onToggle={toggle}
          />

          {selectMode ? (
            <>
              <button
                type="button"
                onClick={commit}
                disabled={saving}
                className="w-full mt-3 rounded-[12px] py-[11px] text-[13px] font-extrabold"
                style={{
                  background: 'linear-gradient(135deg,#0d9966,#34d399)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving
                  ? '保存中...'
                  : selected.size === 0
                  ? 'この日の通知をすべて解除'
                  : `${selected.size} 件の通知を設定`}
              </button>
              {reminderError && (
                <p role="alert" className="text-[11.5px] mt-2 leading-relaxed" style={{ color: 'var(--icon-red-fg)' }}>
                  {reminderError}
                </p>
              )}
            </>
          ) : reminderReady ? (
            <button
              type="button"
              onClick={enterSelectMode}
              className="w-full mt-3 rounded-[12px] py-[10px] text-[12px] font-bold flex items-center justify-center gap-1.5"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px dashed var(--chip-border)',
                cursor: 'pointer',
              }}
            >
              🔔 {marked.size > 0 ? `通知を変更（${marked.size} 件設定中）` : '通知を設定'}
            </button>
          ) : (
            // トグルがオフのときは操作させず、どこで有効化するかだけを伝える
            <p className="text-[11px] mt-3 text-center leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              発車前の通知を使うには、メニューの「表示・通知オプション」で通知をオンにしてください。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
