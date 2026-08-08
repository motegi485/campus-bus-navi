/** Bot 内で共有する型定義。フロントの src/types/timetable.d.ts と互換の形を保つ。 */

import type { Season, DayKind } from './config.js'

export type { Season, DayKind }

export type RouteKey = 'station_to_campus' | 'campus_to_station'

export interface ScheduleEntry {
  departure: string // "HH:mm"
  note: string // "" | "最終"
}

export interface Route {
  origin: string
  destination: string
  bus_stop_name: string
  bus_stop_coords: { lat: number; lng: number }
  schedule: ScheduleEntry[]
}

export interface Timetable {
  id: string
  name: string
  routes: Record<RouteKey, Route>
}

export interface CalendarRules {
  default_rules: Record<string, string>
  overrides: Record<string, string>
}

// ---------------------------------------------------------------------------
// リンク抽出・分類（FR-2 / FR-3）
// ---------------------------------------------------------------------------

/** 抽出直後のリンク情報 */
export interface LinkInfo {
  /** decodeURIComponent + 絶対化した URL（重複排除のキー） */
  url: string
  /** ページに書かれていた生の href（実際のフェッチにはこちらを使う） */
  rawHref: string
  /** アンカーのテキスト */
  anchorText: string
  /** アンカーを含む行（ブロック要素 or <br> セグメント）のテキスト */
  lineText: string
}

export type LinkKind = 'regular' | 'vacation' | 'event' | 'needs_review'

/** 分類結果を載せたリンク情報 */
export interface ClassifiedLink extends LinkInfo {
  kind: LinkKind
  /** 正規化後の lineText（分類に使った文字列。ログ・PR 表示用） */
  normalizedLine: string
  /** vacation のみ */
  season?: Season
  /** regular / vacation の適用開始日 YYYY-MM-DD */
  start?: string
  /** vacation の適用終了日 YYYY-MM-DD */
  end?: string
  /** event の適用日（複数可） YYYY-MM-DD */
  dates?: string[]
  /** event の見出しラベル（lineText 由来。PR 表示・OCR ラベル欠損時のフォールバック） */
  label?: string
  /** 年が書かれておらず推定した場合 true（PR に「年推定」フラグ） */
  yearGuessed?: boolean
  /** needs_review の理由 */
  reason?: string
}

// ---------------------------------------------------------------------------
// OCR 中間構造（§8.5.2）
// ---------------------------------------------------------------------------

export interface IntermediateRow {
  hour: number
  minutes: number[]
}

export interface IntermediateDayType {
  label: string
  /** 松永発 */
  matsunaga: IntermediateRow[]
  /** 大学発 */
  university: IntermediateRow[]
}

export interface Intermediate {
  day_types: IntermediateDayType[]
}

// ---------------------------------------------------------------------------
// 状態ファイル（§9）
// ---------------------------------------------------------------------------

export interface StateRegular {
  url: string
  sha256: string
  start?: string
  derived: string[]
  processed_at: string
}

export interface StateVacation {
  url: string
  sha256: string
  period: { start: string; end?: string }
  derived: string[]
  processed_at: string
}

export interface StateEvent {
  url: string
  sha256: string
  label: string
  dates: string[]
  derived: string[]
  processed_at: string
  /**
   * 掲載ページからこのイベントのリンクが見つからなかった連続回数。
   * CONFIG.eventMissingRunsBeforeRemoval に達したら「取消・延期」と判断して撤去する。
   * 見つかった回に 0 へ戻す（＝キー自体を消す）。
   */
  missing_count?: number
}

export interface StateSpecial {
  url: string
  /** 掲示行のテキスト（PR 表示用） */
  line: string
  /** 特別ダイヤを適用する期間。過去日の切り捨ては calendar.ts が行う */
  period: { start: string; end: string }
  /** needs_review と判定した理由 */
  reason: string
  processed_at: string
}

export interface ManagedOverrides {
  /** 読めない掲示の期間を塗り潰した特別ダイヤ（最優先） */
  special: Record<string, string>
  event: Record<string, string>
  vacation: Record<string, string>
  holiday: Record<string, string>
}

export interface State {
  version: 1
  regular?: StateRegular
  vacations?: Partial<Record<Season, StateVacation>>
  events?: Record<string, StateEvent>
  /**
   * 読み取れなかった掲示（needs_review）のうち、期間が判明しているもの。
   * キーは期間の開始日。calculateOverrides がここから timetable_special の override を張る。
   * 掲示がページから消えればこの記録も消え、override も自動で外れる。
   */
  specials?: Record<string, StateSpecial>
  managed_overrides?: ManagedOverrides
  /**
   * 人が削除した管理 override の記録（日付 → 削除時点の時刻表 ID）。
   *
   * 【要件定義 §9 への追加・2026-08-01 承認済み】
   * FR-9 の「人が削除した管理キーは再追加しない」は、記録を残さないと1実行分しか効かない
   * （翌日の実行では未知の日付として祝日 baseline 等が再生成され、削除が復活してしまう）。
   * ここに残すことで人の削除判断を恒久的に尊重する。過去日になったエントリは自動的に捨てる。
   */
  suppressed_overrides?: Record<string, string>
  holidays_source?: { fetched_at: string; sha256: string }
}

// ---------------------------------------------------------------------------
// 祝日（FR-10）
// ---------------------------------------------------------------------------

export interface Holiday {
  date: string // YYYY-MM-DD
  name: string
}

export interface HolidaysCache {
  fetched_at: string
  source_sha256: string
  holidays: Holiday[]
}

// ---------------------------------------------------------------------------
// 警告・実行結果
// ---------------------------------------------------------------------------

export type WarnLevel = 'warn' | 'info'

export interface Warning {
  level: WarnLevel
  /** 機械可読な分類コード（ログ検索用） */
  code: string
  message: string
  url?: string
}

export type FileOp = 'create' | 'update' | 'delete'

/** 書き込み計画の1件（ドライランではこれを出力するだけ） */
export interface FilePlan {
  op: FileOp
  /** timetables/ 配下のファイル名（例 timetable_weekday.json） */
  fileName: string
  kind: LinkKind
  /** 元画像 URL（削除計画では undefined） */
  sourceUrl?: string
  /** 生成した timetable（削除計画では undefined） */
  timetable?: Timetable
  /** 便数（松永発 / 大学発）と既存との差分 */
  counts?: { station: number; campus: number }
  prevCounts?: { station: number; campus: number }
}

export interface OverrideChange {
  date: string
  op: 'add' | 'remove' | 'skip'
  id?: string
  reason?: string
}

export interface RunPlan {
  files: FilePlan[]
  overrideChanges: OverrideChange[]
  nextOverrides: Record<string, string>
  nextState: State
  warnings: Warning[]
  /** OCR 照合の集計（PR 本文の「検証」節） */
  ocrStats: { matched: number; total: number; majority: number }
  modelUsed: string
  fallbackUsed: boolean
}
