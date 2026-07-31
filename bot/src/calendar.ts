/**
 * FR-9: calendar_rules.overrides の再構築（中核アルゴリズム）。
 * 優先順位: 手動 > イベント > 長期休暇 > 祝日(baseline) > default_rules
 *
 * 大原則「手動データ不可侵」: Bot は state.managed_overrides に記録した自分の管理分だけを
 * 変更・削除する。それ以外のキー（手動 override）は読み取り専用として素通しする。
 */

import type { Holiday, ManagedOverrides, OverrideChange, Season, State, Warning } from './types.js'
import { dayOfWeek, eachDate, isBefore, todayJst } from './time.js'

export interface CalendarInput {
  /** live の overrides（リポジトリ HEAD の calendar_rules.json） */
  liveOverrides: Record<string, string>
  /** 前回の管理 override（state.managed_overrides） */
  prevManaged?: ManagedOverrides
  /** 前回までに人が削除した管理 override（state.suppressed_overrides） */
  prevSuppressed?: Record<string, string>
  /** 本実行の結果を反映した後の state（全既知エントリを入力にする） */
  state: State
  holidays: Holiday[]
  today?: string
  /** 書き込み後に {id}.json が存在するか */
  timetableExists: (id: string) => boolean
}

export interface CalendarResult {
  nextOverrides: Record<string, string>
  managed: ManagedOverrides
  /** 人が削除した管理 override の記録（今後 Bot は再生成しない） */
  suppressed: Record<string, string>
  changes: OverrideChange[]
  warnings: Warning[]
  /** 削除すべき event ファイル名 */
  deletions: string[]
}

const emptyManaged = (): ManagedOverrides => ({ event: {}, vacation: {}, holiday: {} })

function flatten(managed: ManagedOverrides): Record<string, string> {
  return { ...managed.event, ...managed.vacation, ...managed.holiday }
}

export function eventIdForDate(date: string): string {
  return `timetable_event_${date.replace(/-/g, '')}`
}

export function calculateOverrides(input: CalendarInput): CalendarResult {
  const today = input.today ?? todayJst()
  const O = input.liveOverrides
  const prevManaged = input.prevManaged ?? emptyManaged()
  const warnings: Warning[] = []

  // 人が削除した管理キーの記録。過去日になったものは捨てる。
  const suppressed: Record<string, string> = {}
  for (const [date, id] of Object.entries(input.prevSuppressed ?? {})) {
    if (!isBefore(date, today)) suppressed[date] = id
  }

  // ---------------------------------------------------------------------
  // 1) 改ざん検査: 人が触った管理キーは「手動化」して以後 Bot は触らない
  // ---------------------------------------------------------------------
  const survivingManaged: Record<string, string> = {}
  for (const [key, value] of Object.entries(flatten(prevManaged))) {
    if (!(key in O)) {
      // 削除は恒久的に尊重する（記録しないと翌実行で再生成されて復活してしまう）
      if (!isBefore(key, today)) suppressed[key] = value
      warnings.push({
        level: 'warn',
        code: 'managed_override_deleted',
        message: `管理していた override ${key} が calendar_rules.json から削除されていました。Bot は今後この日付の override を再生成しません。`,
      })
      continue
    }
    if (O[key] !== value) {
      warnings.push({
        level: 'warn',
        code: 'managed_override_modified',
        message: `管理していた override ${key} が手動で変更されています（${value} → ${O[key]}）。手動キーとして扱い、以後 Bot は触りません。`,
      })
      continue
    }
    survivingManaged[key] = value
  }

  // ---------------------------------------------------------------------
  // 2) 手動キー集合 H（Bot は一切触らない）
  // ---------------------------------------------------------------------
  const H: Record<string, string> = {}
  for (const [key, value] of Object.entries(O)) {
    if (!(key in survivingManaged)) H[key] = value
  }

  // ---------------------------------------------------------------------
  // 3) 望ましい管理集合 D を優先順に構築（today 以降の日付のみ）
  // ---------------------------------------------------------------------
  const D: Record<string, string> = {}
  const category: Record<string, keyof ManagedOverrides> = {}
  const holidaySet = new Set(input.holidays.map((h) => h.date))
  const put = (date: string, id: string, cat: keyof ManagedOverrides): void => {
    if (isBefore(date, today)) return
    if (date in D) return
    if (date in suppressed) return // 人が削除した日付は再生成しない
    D[date] = id
    category[date] = cat
  }

  // 3a. event（最優先）
  for (const entry of Object.values(input.state.events ?? {})) {
    for (const date of entry.dates) put(date, eventIdForDate(date), 'event')
  }

  // 3b. vacation（期間内。月〜金かつ祝日でなければ平日ダイヤ、土日または祝日なら休日ダイヤ）
  for (const [season, entry] of Object.entries(input.state.vacations ?? {}) as [Season, NonNullable<State['vacations']>[Season]][]) {
    if (!entry) continue
    if (!entry.period.end) {
      warnings.push({
        level: 'warn',
        code: 'vacation_period_unknown',
        message: `長期休暇（${season}）の終了日が不明なため override を生成しません。手動で追加してください（開始: ${entry.period.start}）。`,
      })
      continue
    }
    for (const date of eachDate(entry.period.start, entry.period.end)) {
      const dow = dayOfWeek(date)
      const isHolidayLike = dow === 0 || dow === 6 || holidaySet.has(date)
      put(date, `timetable_vacation_${season}_${isHolidayLike ? 'holiday' : 'weekday'}`, 'vacation')
    }
  }

  // 3c. 祝日 baseline（月〜金の祝日のみ。土日は default_rules で既に休業日ダイヤ）
  for (const holiday of input.holidays) {
    const dow = dayOfWeek(holiday.date)
    if (dow === 0 || dow === 6) continue
    put(holiday.date, 'timetable_holiday', 'holiday')
  }

  // ---------------------------------------------------------------------
  // 4) 衝突解決: 手動が勝つ
  // ---------------------------------------------------------------------
  const changes: OverrideChange[] = []
  for (const date of Object.keys(D)) {
    if (date in H) {
      if (H[date] !== D[date]) {
        warnings.push({
          level: 'info',
          code: 'override_conflict_manual_wins',
          message: `${date} は手動 override（${H[date]}）があるため、Bot の計算値（${D[date]}）を適用しません。`,
        })
        changes.push({ date, op: 'skip', id: D[date], reason: `手動キーと衝突（既存値: ${H[date]}）` })
      }
      delete D[date]
      delete category[date]
    }
  }

  // ---------------------------------------------------------------------
  // 5) 整合: 参照先ファイルが存在しない管理キーは外す
  // ---------------------------------------------------------------------
  for (const [date, id] of Object.entries(D)) {
    if (!input.timetableExists(id)) {
      warnings.push({
        level: 'warn',
        code: 'override_target_missing',
        message: `${date} → ${id} は対応する時刻表ファイルが無いため override を追加しません。`,
      })
      changes.push({ date, op: 'skip', id, reason: '参照先の時刻表ファイルが存在しない' })
      delete D[date]
      delete category[date]
    }
  }

  // SHOULD（情報）: 手動キーの参照先が存在しない場合は列挙のみ（修正・削除はしない）
  for (const [date, id] of Object.entries(H)) {
    if (!input.timetableExists(id)) {
      warnings.push({
        level: 'info',
        code: 'manual_override_target_missing',
        message: `手動 override ${date} → ${id} に対応する時刻表ファイルがありません（Bot は変更しません）。`,
      })
    }
  }

  // ---------------------------------------------------------------------
  // 6) 新 overrides = H ∪ D を日付昇順で
  // ---------------------------------------------------------------------
  const merged = { ...H, ...D }
  const nextOverrides: Record<string, string> = {}
  for (const date of Object.keys(merged).sort()) nextOverrides[date] = merged[date]!

  // 差分（PR 表示用）
  for (const [date, id] of Object.entries(nextOverrides)) {
    if (!(date in O)) changes.push({ date, op: 'add', id })
    else if (O[date] !== id) changes.push({ date, op: 'add', id, reason: `変更（${O[date]} → ${id}）` })
  }
  for (const date of Object.keys(O)) {
    if (!(date in nextOverrides)) {
      changes.push({ date, op: 'remove', id: O[date], reason: '過去日付の管理キー' })
    }
  }

  // ---------------------------------------------------------------------
  // 7) 管理集合をカテゴリ別に記録
  // ---------------------------------------------------------------------
  const managed = emptyManaged()
  for (const [date, id] of Object.entries(D)) {
    managed[category[date]!][date] = id
  }
  for (const cat of ['event', 'vacation', 'holiday'] as const) {
    const sorted: Record<string, string> = {}
    for (const date of Object.keys(managed[cat]).sort()) sorted[date] = managed[cat][date]!
    managed[cat] = sorted
  }

  // ---------------------------------------------------------------------
  // event ファイルの削除計画
  // 旧管理キーにあり、適用日が過去で、state に記録のあるものだけを消す。
  // 人が手置きした event ファイルは state に無いので消さない。
  // ---------------------------------------------------------------------
  const deletions: string[] = []
  const stillNeeded = new Set(Object.values(nextOverrides))
  for (const [date, id] of Object.entries(prevManaged.event ?? {})) {
    if (!isBefore(date, today)) continue
    if (stillNeeded.has(id)) continue
    const fileName = `${id}.json`
    if (!/^timetable_event_\d{8}\.json$/.test(fileName)) continue
    if (!deletions.includes(fileName)) deletions.push(fileName)
  }

  const sortedSuppressed: Record<string, string> = {}
  for (const date of Object.keys(suppressed).sort()) sortedSuppressed[date] = suppressed[date]!

  return { nextOverrides, managed, suppressed: sortedSuppressed, changes, warnings, deletions }
}
