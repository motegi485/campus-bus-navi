/**
 * ファイル読み書き・保護ガード・JSON 整形規約（§3.5 / §7.4 / NFR-2）。
 *
 * 整形について【要件定義 §3.5 からの意図的な調整・2026-08-01 承認済み】:
 * 要件定義は `JSON.stringify(obj, null, 2)` を指定しているが、既存の
 * public/data/timetables/*.json は `"bus_stop_coords": { "lat": …, "lng": … }` や
 * `{ "departure": "08:00", "note": "" }` を1行に収めるハウススタイルで書かれている。
 * 素の JSON.stringify を使うと Bot が触った全ファイルが全行書き換えになり、
 * 本システムの中核である人間の PR レビュー（H-5）が機能しなくなる。
 * そこで既存スタイルを再現するシリアライザを用意し、差分が実際に変わった
 * 発車時刻の行だけになるようにする。§3.5 の「schedule のみ置換・キー順保持」という
 * 意図は完全に満たす。
 */

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from './config.js'
import type { CalendarRules, HolidaysCache, State, Timetable } from './types.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** bot/src → bot → リポジトリルート */
export const REPO_ROOT = path.resolve(HERE, '..', '..')

export function repoPath(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts)
}

// ---------------------------------------------------------------------------
// 保護ガード（§7.4）— ホワイトリスト方式が正
// ---------------------------------------------------------------------------

const WRITABLE_PATTERNS = [
  /^timetable_(weekday|holiday)\.json$/,
  /^timetable_vacation_(spring|summer|winter)_(weekday|holiday)\.json$/,
  /^timetable_event_\d{8}\.json$/,
]

const DELETABLE_PATTERNS = [/^timetable_event_\d{8}\.json$/]

export function isWritableTimetableFile(fileName: string): boolean {
  if (CONFIG.protectedFiles.includes(fileName)) return false
  return WRITABLE_PATTERNS.some((re) => re.test(fileName))
}

export function isDeletableTimetableFile(fileName: string): boolean {
  if (CONFIG.protectedFiles.includes(fileName)) return false
  return DELETABLE_PATTERNS.some((re) => re.test(fileName))
}

export function assertWritable(fileName: string): void {
  if (!isWritableTimetableFile(fileName)) {
    throw new Error(`書込を許可されていないファイル名です: ${fileName}`)
  }
}

export function assertDeletable(fileName: string): void {
  if (!isDeletableTimetableFile(fileName)) {
    throw new Error(`削除を許可されていないファイル名です: ${fileName}`)
  }
}

// ---------------------------------------------------------------------------
// JSON 整形（NFR-2: UTF-8 BOM なし / LF / 2スペース / 末尾改行1つ）
// ---------------------------------------------------------------------------

type JsonValue = unknown
/** そのノードを1行に収めるか判定する。path は祖先のキー（配列は添字文字列）。 */
type InlineRule = (nodePath: string[], value: JsonValue) => boolean

function isPlainObject(v: JsonValue): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function inlineStringify(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(inlineStringify).join(', ')}]`
  if (isPlainObject(value)) {
    const inner = Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${inlineStringify(v)}`)
      .join(', ')
    return inner === '' ? '{}' : `{ ${inner} }`
  }
  return JSON.stringify(value) ?? 'null'
}

function stringifyNode(value: JsonValue, isInline: InlineRule, depth: number, nodePath: string[]): string {
  if (isInline(nodePath, value)) return inlineStringify(value)

  const pad = '  '.repeat(depth)
  const padInner = '  '.repeat(depth + 1)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((v, i) => padInner + stringifyNode(v, isInline, depth + 1, [...nodePath, String(i)]))
    return `[\n${items.join(',\n')}\n${pad}]`
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const items = entries.map(
      ([k, v]) => `${padInner}${JSON.stringify(k)}: ${stringifyNode(v, isInline, depth + 1, [...nodePath, k])}`,
    )
    return `{\n${items.join(',\n')}\n${pad}}`
  }

  return JSON.stringify(value) ?? 'null'
}

function serialize(value: JsonValue, isInline: InlineRule): string {
  return stringifyNode(value, isInline, 0, []) + '\n'
}

const NO_INLINE: InlineRule = () => false

/** 親キーが `parentKey` の配列要素なら true（例: schedule の各要素） */
function isChildOf(nodePath: string[], parentKey: string): boolean {
  return nodePath.length >= 2 && nodePath[nodePath.length - 2] === parentKey
}

/** timetable JSON: bus_stop_coords と schedule 各要素をインラインにする */
export function formatTimetable(timetable: Timetable | Record<string, unknown>): string {
  return serialize(timetable, (nodePath, value) => {
    if (!isPlainObject(value)) return false
    const last = nodePath[nodePath.length - 1]
    if (last === 'bus_stop_coords') return true
    if (isChildOf(nodePath, 'schedule')) return true
    return false
  })
}

/** calendar_rules.json: 素の 2 スペース整形（既存ファイルと同一） */
export function formatCalendarRules(rules: CalendarRules): string {
  return serialize(rules, NO_INLINE)
}

/** state.json: 素の 2 スペース整形 */
export function formatState(state: State): string {
  return serialize(state, NO_INLINE)
}

/** holidays.json: holidays 配列の各要素をインラインにする */
export function formatHolidaysCache(cache: HolidaysCache): string {
  return serialize(cache, (nodePath, value) => isPlainObject(value) && isChildOf(nodePath, 'holidays'))
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

export function readJsonFile<T>(relPath: string): T | null {
  const abs = repoPath(relPath)
  if (!existsSync(abs)) return null
  const raw = readFileSync(abs, 'utf-8').replace(/^﻿/, '')
  return JSON.parse(raw) as T
}

export function writeTextFile(relPath: string, text: string): void {
  const abs = repoPath(relPath)
  mkdirSync(path.dirname(abs), { recursive: true })
  // NFR-2: BOM なし・LF。改行は生成側で LF に統一済みだが念のため正規化する。
  writeFileSync(abs, text.replace(/\r\n/g, '\n'), { encoding: 'utf-8' })
}

export function timetableRelPath(fileName: string): string {
  return `${CONFIG.dataDir}/${fileName}`
}

export function timetableExists(fileName: string): boolean {
  return existsSync(repoPath(timetableRelPath(fileName)))
}

export function readTimetable(fileName: string): Timetable | null {
  return readJsonFile<Timetable>(timetableRelPath(fileName))
}

/**
 * §3.5: 既存ファイルは routes.*.schedule のみ置換し、その他のフィールドとキー順を保持する。
 * 新規作成時は呼び出し側が組み立てたオブジェクトをそのまま書く。
 */
export function writeTimetableFile(fileName: string, timetable: Timetable): void {
  assertWritable(fileName)
  const existing = readTimetable(fileName)
  if (existing) {
    const merged = existing as unknown as Record<string, unknown>
    const routes = merged.routes as Record<string, Record<string, unknown>>
    for (const key of Object.keys(timetable.routes) as (keyof typeof timetable.routes)[]) {
      if (routes[key]) {
        routes[key].schedule = timetable.routes[key].schedule
      } else {
        routes[key] = timetable.routes[key] as unknown as Record<string, unknown>
      }
    }
    writeTextFile(timetableRelPath(fileName), formatTimetable(merged))
    return
  }
  writeTextFile(timetableRelPath(fileName), formatTimetable(timetable))
}

export function deleteTimetableFile(fileName: string): void {
  assertDeletable(fileName)
  const abs = repoPath(timetableRelPath(fileName))
  if (existsSync(abs)) rmSync(abs)
}

export function readCalendarRules(): CalendarRules {
  const rules = readJsonFile<CalendarRules>(CONFIG.calendarRulesPath)
  if (!rules) throw new Error(`calendar_rules.json が見つかりません: ${CONFIG.calendarRulesPath}`)
  if (!rules.overrides) rules.overrides = {}
  return rules
}

export function writeCalendarRules(rules: CalendarRules): void {
  writeTextFile(CONFIG.calendarRulesPath, formatCalendarRules(rules))
}

export function readState(): State {
  const state = readJsonFile<State>(CONFIG.statePath)
  if (!state) return { version: 1 }
  return state
}

export function writeState(state: State): void {
  writeTextFile(CONFIG.statePath, formatState(state))
}

export function readHolidaysCache(): HolidaysCache | null {
  return readJsonFile<HolidaysCache>(CONFIG.holidaysCachePath)
}

export function writeHolidaysCache(cache: HolidaysCache): void {
  writeTextFile(CONFIG.holidaysCachePath, formatHolidaysCache(cache))
}
