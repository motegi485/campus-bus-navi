import { X, CalendarBlank } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
import type { ScheduleEntry, RouteKey, DiagramType } from '../types/timetable'
import { tapFeedback } from '../utils/haptics'
import { LEAD_OPTIONS, type ReminderLead, type ReminderLoadState } from '../hooks/useDepartureReminders'
import { TimetableGrid } from './TimetableGrid'
import { RouteToggle } from './RouteToggle'
import { DayBadge } from './DayBadge'
import { Spinner } from './StatusParts'
import { BellIcon } from './BellIcon'
import { useOverlayA11y } from '../hooks/useOverlayA11y'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useSheetDragToClose } from '../hooks/useSheetDragToClose'
import { useIsDesktop } from '../hooks/useIsDesktop'
import { fs } from '../utils/fontScale'

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  open: boolean
  onClose: () => void
  schedule: ScheduleEntry[]
  route: RouteKey
  onChangeRoute: (route: RouteKey) => void
  now: Dayjs
  diagramType: DiagramType
  currentDeparture?: string
  nowMinutes: number
  remaining: number
  marked: ReadonlySet<string>
  reminderReady: boolean
  reminderLoadState: ReminderLoadState
  onReloadReminders: () => void
  lead: ReminderLead
  onChangeLead: (value: ReminderLead) => void
  onSave: (departures: string[]) => Promise<boolean>
  saving: boolean
  reminderError: string | null
}

/**
 * 「本日の全時刻表」を下から出す全画面シート（改修デザイン §10, §20 画面別メモ 2a）。
 * ホームの「全時刻表 ›」から開く。ルートトグルと日付ピルはシート内にも置き、
 * ホームを閉じなくてもルートや日付の文脈を保てるようにする。
 */
export function FullTimetableSheet({
  open,
  onClose,
  schedule,
  route,
  onChangeRoute,
  now,
  diagramType,
  currentDeparture,
  nowMinutes,
  remaining,
  marked,
  reminderReady,
  reminderLoadState,
  onReloadReminders,
  lead,
  onChangeLead,
  onSave,
  saving,
  reminderError,
}: Props) {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const rootRef = useOverlayA11y(open, { covered: false, onEscape: onClose })
  const grabberRef = useRef<HTMLDivElement>(null)
  // 1024px以上は下からのシートではなく中央モーダル（見た目の入れ物だけの
  // 切替。背面スクロールロック・Escape・背景タップ・×ボタンで閉じる・
  // タップだけでは閉じない、という契約はここでは一切変更しない）。
  const desktop = useIsDesktop()

  // 開いている間は背面のホームを固定する（シートの非スクロール領域から背面が動くため）
  useBodyScrollLock(open)
  // 上グラバーを下へ引いて閉じる（PCではグラバー自体を描画しないため、
  // handleRef.current が null になり useSheetDragToClose は早期returnして無効化される）
  useSheetDragToClose(rootRef, grabberRef, open, onClose)

  // 閉じたら選択モードも畳む。開き直したときに前回の選択が残っていると
  // 「保存したつもり」の取り違えが起きる
  useEffect(() => {
    if (!open) setSelectMode(false)
  }, [open])

  const isLastBus = remaining === 1
  const lastEntry = schedule.length > 0 ? schedule[schedule.length - 1] : null

  const enterSelectMode = () => {
    if (reminderLoadState !== 'ok') return
    tapFeedback(8)
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
    <>
      <div
        aria-hidden="true"
        className="sheet-backdrop"
        style={{ zIndex: 45, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        onClick={onClose}
      />
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label="本日の全時刻表"
        aria-hidden={!open}
        className={`sheet-panel${open ? '' : ' sheet-panel-closed'}`}
        style={{ zIndex: 46, pointerEvents: open ? 'auto' : 'none' }}
      >
        {/* 上グラバー（下へ引くと閉じるハンドル）。PC（中央モーダル）では
            ドラッグクローズ自体が不要なため描画しない。
            当たり判定は横いっぱい・上下の余白込みで確保する。指で掴む対象なので
            見た目の 36×5 のままでは狭い。touchAction: none はハンドル上での
            ブラウザ既定のスクロールを止め、ドラッグを確実に拾うために必要。 */}
        {!desktop && (
          <div
            ref={grabberRef}
            aria-hidden="true"
            style={{
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              padding: '10px 0 12px', flexShrink: 0,
              touchAction: 'none', cursor: 'grab',
            }}
          >
            <div style={{ width: 36, height: 5, borderRadius: 9999, background: 'var(--sheet-grabber)' }} />
          </div>
        )}

        {/* 本文スクローラ。タイトルと閉じるボタンもこの中に入れる（外に固定すると
            下に引っ張ったとき本文だけが動き、見出しだけ取り残されて見えるため）。 */}
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {/* ヘッダー: タイトル + 閉じるボタン。グラバーが無い分、PCでは上の余白を足す */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: desktop ? '18px 20px 0' : '2px 20px 0' }}>
            <h2 style={{ fontSize: fs(20), fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-.4px' }}>本日の全時刻表</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'var(--past-bg)', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={15} weight="bold" color="var(--chip-text)" aria-hidden="true" />
            </button>
          </div>

          <div style={{ padding: '14px 20px 0' }}>
            {/* ルートトグル（シート内にも置く） */}
            <RouteToggle route={route} onChange={onChangeRoute} />

            {/* 日付ピル（種別バッジも同じピルの中に置く） */}
            <div
              className="flex items-center gap-[9px]"
              style={{ background: 'var(--past-bg)', borderRadius: 14, padding: '10px 13px', marginTop: 14 }}
            >
              <CalendarBlank size={18} weight="regular" color="var(--text-muted)" aria-hidden="true" />
              <span style={{ fontSize: fs(14.5), fontWeight: 700, color: 'var(--text-primary)' }}>
                {now.month() + 1}/{now.date()}（{DAYS_JA[now.day()]}）
              </span>
              <DayBadge type={diagramType} />
            </div>

            {/* 残り本数・最終便の情報ピル */}
            {schedule.length > 0 && (
              <div className="flex items-center" style={{ gap: 8, marginTop: 12 }}>
                <span
                  className="inline-flex items-center whitespace-nowrap"
                  style={{ gap: 6, borderRadius: 9999, padding: '7px 12px', fontSize: fs(12.5), fontWeight: 800, background: 'var(--slot-current-bg)', color: 'var(--slot-current-fg)' }}
                >
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--route-solid)', display: 'inline-block' }} />
                  {isLastBus ? '最終便' : `残り${remaining}本`}
                </span>
                {lastEntry && (
                  <span
                    className="whitespace-nowrap"
                    style={{ borderRadius: 9999, padding: '7px 12px', fontSize: fs(12.5), fontWeight: 800, background: 'var(--past-bg)', color: 'var(--text-secondary)' }}
                  >
                    最終 {lastEntry.departure}
                  </span>
                )}
              </div>
            )}
          </div>

          {schedule.length === 0 ? (
            <p className="text-[calc(13px*var(--font-scale))] text-center py-10" style={{ color: 'var(--text-muted)', padding: '0 20px' }}>
              本日の運行はありません
            </p>
          ) : (
            <>
              {selectMode && (
                <div className="mb-3" style={{ padding: '0 20px' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="inline-flex items-center gap-1.5 text-[calc(12.5px*var(--font-scale))] font-bold" style={{ color: 'var(--text-primary)' }}>
                      <BellIcon width={13} height={13} /> 通知する便を選ぶ
                    </span>
                    <button
                      type="button"
                      onClick={() => { tapFeedback(8); setSelectMode(false) }}
                      className="text-[calc(12px*var(--font-scale))] font-bold"
                      style={{ color: 'var(--route-accent-fg)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      キャンセル
                    </button>
                  </div>

                  <p className="text-[calc(11px*var(--font-scale))] mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    何分前に通知しますか
                  </p>
                  <div className="flex gap-[2px] rounded-[20px] p-[3px] mb-3" style={{ background: 'var(--bg-input)' }}>
                    {LEAD_OPTIONS.map(option => {
                      const active = option === lead
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => { tapFeedback(6); onChangeLead(option) }}
                          aria-pressed={active}
                          className="flex-1 rounded-[18px] py-[5px] text-[calc(11.5px*var(--font-scale))] font-bold tabular-nums"
                          style={{
                            background: active ? 'var(--bg-card)' : 'transparent',
                            color: active ? 'var(--route-accent-fg)' : 'var(--chip-text)',
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

                  <p className="text-[calc(11px*var(--font-scale))]" style={{ color: 'var(--text-secondary)' }}>
                    通知したい便をタップしてください（複数選べます）。過ぎた便は選べません。
                  </p>
                </div>
              )}

              <div style={{ padding: '14px 20px 22px' }}>
                <TimetableGrid
                  schedule={schedule}
                  currentDeparture={currentDeparture}
                  nowMinutes={nowMinutes}
                  marked={marked}
                  selectMode={selectMode}
                  selected={selected}
                  onToggle={toggle}
                  futureBg="var(--bg-card)"
                />
              </div>

              <div style={{ padding: '0 20px 24px' }}>
                {selectMode ? (
                  <>
                    <button
                      type="button"
                      onClick={commit}
                      disabled={saving}
                      className="w-full rounded-[12px] py-[11px] text-[calc(13px*var(--font-scale))] font-extrabold flex items-center justify-center gap-2"
                      style={{
                        background: 'var(--slot-current-fg)',
                        color: '#fff', border: 'none', cursor: saving ? 'default' : 'pointer',
                      }}
                    >
                      {/* 塗りつぶしボタンの上なので、中立色ではなくボタンの文字色（白）を継ぐ */}
                      {saving && <Spinner size={13} color="currentColor" />}
                      {saving
                        ? '保存中...'
                        : selected.size === 0
                        ? 'この日の通知をすべて解除'
                        : `${selected.size} 件の通知を設定`}
                    </button>
                    {reminderError && (
                      <p role="alert" className="text-[calc(11.5px*var(--font-scale))] mt-2 leading-relaxed" style={{ color: 'var(--status-danger-fg)' }}>
                        {reminderError}
                      </p>
                    )}
                  </>
                ) : reminderReady && reminderLoadState === 'error' ? (
                  <div>
                    <p className="text-[calc(11.5px*var(--font-scale))] text-center leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      設定済みの通知を読み込めませんでした。通信を確認して読み込み直してください。
                    </p>
                    <button
                      type="button"
                      onClick={() => { tapFeedback(8); onReloadReminders() }}
                      className="w-full mt-2 rounded-[12px] py-[10px] text-[calc(12px*var(--font-scale))] font-bold"
                      style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px dashed var(--chip-border)', cursor: 'pointer' }}
                    >
                      ↻ 読み込み直す
                    </button>
                  </div>
                ) : reminderReady ? (
                  <button
                    type="button"
                    onClick={enterSelectMode}
                    disabled={reminderLoadState !== 'ok'}
                    className="w-full rounded-[12px] py-[10px] text-[calc(12px*var(--font-scale))] font-bold flex items-center justify-center gap-1.5"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px dashed var(--chip-border)',
                      cursor: reminderLoadState === 'ok' ? 'pointer' : 'default',
                      opacity: reminderLoadState === 'ok' ? 1 : 0.6,
                    }}
                  >
                    {reminderLoadState === 'loading' ? (
                      '設定を読み込み中...'
                    ) : (
                      <>
                        <BellIcon width={13} height={13} />
                        {marked.size > 0 ? `通知を変更（${marked.size} 件設定中）` : '通知を設定'}
                      </>
                    )}
                  </button>
                ) : (
                  <p className="text-[calc(11px*var(--font-scale))] text-center leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    発車前の通知を使うには、メニューの「表示・通知オプション」で通知をオンにしてください。
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
