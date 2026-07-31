/**
 * FR-7: 中間構造 → timetable JSON への組み立て。
 * 「最終」は画像に存在しない Bot 付与の推論情報（§4.3）。
 */

import { CONFIG, LABEL_KEYWORDS } from './config.js'
import type {
  ClassifiedLink,
  DayKind,
  Intermediate,
  IntermediateDayType,
  IntermediateRow,
  RouteKey,
  ScheduleEntry,
  Season,
  Timetable,
} from './types.js'

/** (hour, minutes[]) を HH:mm へ展開し、昇順整列・重複除去して note を付ける */
export function toSchedule(rows: IntermediateRow[]): ScheduleEntry[] {
  const times = new Set<string>()
  for (const row of rows) {
    for (const minute of row.minutes) {
      times.add(`${String(row.hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
    }
  }
  const sorted = [...times].sort()
  return sorted.map((departure, i) => ({ departure, note: i === sorted.length - 1 ? '最終' : '' }))
}

/**
 * ラベルが日付・期間・記号だけで、種別名として意味を持たないかを判定する。
 *
 * 実測（2026-08-01・0823 オープンキャンパス画像）では、種別ラベル枠を持たない画像に対して
 * OCR が「2026年8月23日(日)」を label として返した。そのまま使うと
 * name が「2026年8月23日(日)ダイヤ」になってしまうため、掲載行のラベルへフォールバックさせる。
 */
export function isMeaninglessLabel(label: string): boolean {
  const stripped = label
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
    .replace(/[（(][日月火水木金土][）)]/g, ' ')
    .replace(/[～〜~・,、.\-—–_/／|｜\s]/g, '')
  return stripped === ''
}

/** ダイヤ種別ラベルを weekday / holiday に振り分ける（FR-7 の 3） */
export function classifyDayLabel(label: string): DayKind | null {
  const isWeekday = LABEL_KEYWORDS.weekday.some((k) => label.includes(k))
  const isHoliday = LABEL_KEYWORDS.holiday.some((k) => label.includes(k))
  if (isWeekday && isHoliday) return null // 両方に振れる → 判定不能
  if (isWeekday) return 'weekday'
  if (isHoliday) return 'holiday'
  return null
}

function buildTimetable(id: string, name: string, dayType: IntermediateDayType): Timetable {
  const sources: Record<RouteKey, IntermediateRow[]> = {
    station_to_campus: dayType.matsunaga,
    campus_to_station: dayType.university,
  }
  const routes = {} as Timetable['routes']
  for (const key of Object.keys(CONFIG.busStops) as RouteKey[]) {
    const stop = CONFIG.busStops[key]
    routes[key] = {
      origin: stop.origin,
      destination: stop.destination,
      bus_stop_name: stop.bus_stop_name,
      bus_stop_coords: { ...stop.bus_stop_coords },
      schedule: toSchedule(sources[key]),
    }
  }
  return { id, name, routes }
}

export interface AssembleOutput {
  fileName: string
  timetable: Timetable
  /** 判定に使ったラベル（PR 表示用） */
  label: string
}

export interface AssembleResult {
  outputs: AssembleOutput[]
  errors: string[]
}

/** regular / vacation: 2種別（授業日・休業日）を weekday / holiday のファイルへ振り分ける */
function assembleTwoKinds(
  intermediate: Intermediate,
  idFor: (kind: DayKind) => string,
  nameFor: (kind: DayKind) => string,
): AssembleResult {
  const errors: string[] = []
  const outputs: AssembleOutput[] = []
  const assigned = new Map<DayKind, IntermediateDayType>()

  for (const dayType of intermediate.day_types) {
    const kind = classifyDayLabel(dayType.label)
    if (!kind) {
      errors.push(`ダイヤ種別ラベル「${dayType.label}」を授業日/休業日のどちらにも振り分けられません。`)
      continue
    }
    if (assigned.has(kind)) {
      errors.push(`ダイヤ種別ラベル「${dayType.label}」が ${kind} に重複して振り分けられました。`)
      continue
    }
    assigned.set(kind, dayType)
  }

  if (errors.length > 0) return { outputs: [], errors }

  for (const [kind, dayType] of assigned) {
    const id = idFor(kind)
    outputs.push({ fileName: `${id}.json`, timetable: buildTimetable(id, nameFor(kind), dayType), label: dayType.label })
  }
  return { outputs, errors }
}

export function assembleRegular(intermediate: Intermediate): AssembleResult {
  if (intermediate.day_types.length !== 2) {
    return {
      outputs: [],
      errors: [`通常ダイヤ画像からは2種別（授業日・休業日）を期待しますが ${intermediate.day_types.length} 件でした。`],
    }
  }
  return assembleTwoKinds(
    intermediate,
    (kind) => `timetable_${kind}`,
    (kind) => CONFIG.newFileNames[kind],
  )
}

export function assembleVacation(intermediate: Intermediate, season: Season): AssembleResult {
  if (intermediate.day_types.length !== 2) {
    return {
      outputs: [],
      errors: [`長期休暇ダイヤ画像からは2種別を期待しますが ${intermediate.day_types.length} 件でした。`],
    }
  }
  return assembleTwoKinds(
    intermediate,
    (kind) => `timetable_vacation_${season}_${kind}`,
    (kind) => CONFIG.newFileNames.vacation(season, kind),
  )
}

/** event: day_types は1要素。dates[] の各日付につき同内容のファイルを生成する */
export function assembleEvent(intermediate: Intermediate, dates: string[], fallbackLabel: string): AssembleResult {
  if (intermediate.day_types.length !== 1) {
    return {
      outputs: [],
      errors: [`イベントダイヤ画像からは1種別を期待しますが ${intermediate.day_types.length} 件でした。`],
    }
  }
  const dayType = intermediate.day_types[0]!
  // FR-7 の 5: name は OCR の day_type ラベル基準。
  // 空 or 日付だけのラベルなら lineText 由来のラベルにフォールバックする
  const ocrLabel = dayType.label.trim()
  const label = ocrLabel && !isMeaninglessLabel(ocrLabel) ? ocrLabel : fallbackLabel.trim()
  if (!label) {
    return { outputs: [], errors: ['イベント名を決められません（OCR ラベル・掲載行ラベルとも空）。'] }
  }
  const outputs = dates.map((date) => {
    const id = `timetable_event_${date.replace(/-/g, '')}`
    return { fileName: `${id}.json`, timetable: buildTimetable(id, CONFIG.newFileNames.event(label), dayType), label }
  })
  return { outputs, errors: [] }
}

/** 分類済みリンクと OCR 結果から出力を組み立てる */
export function assemble(link: ClassifiedLink, intermediate: Intermediate, effectiveDates?: string[]): AssembleResult {
  if (link.kind === 'regular') return assembleRegular(intermediate)
  if (link.kind === 'vacation') {
    if (!link.season) return { outputs: [], errors: ['長期休暇の季節が特定できていません。'] }
    return assembleVacation(intermediate, link.season)
  }
  if (link.kind === 'event') {
    const dates = effectiveDates ?? link.dates ?? []
    if (dates.length === 0) return { outputs: [], errors: ['イベントの適用日がありません。'] }
    return assembleEvent(intermediate, dates, link.label ?? '')
  }
  return { outputs: [], errors: [`組み立て対象外の種別です: ${link.kind}`] }
}
