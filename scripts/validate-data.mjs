#!/usr/bin/env node
// public/data 配下の静的データを検証する（Node 標準モジュールのみ、依存追加なし）。
// ダイヤ改正・お知らせ追加はすべて手編集運用のため、ID の参照切れや
// 時刻フォーマット崩れ・順序崩れをビルド前に機械的に検出する。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'public', 'data')
const TIMETABLES_DIR = path.join(DATA_DIR, 'timetables')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ROUTE_KEYS = ['station_to_campus', 'campus_to_station']
const VALID_TAGS = ['important', 'info', 'change', 'event']

const errors = []

function readJSON(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

/**
 * YYYY-MM-DD が実在する日付かどうか。
 * 形式が合っていても 2026-02-30 のような非実在日は Date が別日へ正規化してしまうため、
 * 組み立て直した文字列と一致するかで判定する。
 */
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** そのフィールドが空でない文字列か */
function requireString(label, value) {
  if (typeof value !== 'string' || value === '') {
    errors.push(`${label} が文字列ではありません（実際の値: ${JSON.stringify(value)}）`)
    return false
  }
  return true
}

function validateCalendarRules() {
  const file = 'calendar_rules.json'
  const filePath = path.join(DATA_DIR, file)
  const referencedIds = new Set()

  if (!existsSync(filePath)) {
    errors.push(`${file}: ファイルが存在しません`)
    return referencedIds
  }

  let rules
  try {
    rules = readJSON(filePath)
  } catch (e) {
    errors.push(`${file}: JSON の parse に失敗しました (${e.message})`)
    return referencedIds
  }

  const defaultRules = rules.default_rules
  if (!defaultRules || typeof defaultRules !== 'object') {
    errors.push(`${file}: default_rules が存在しません`)
  } else {
    for (const day of ['0', '1', '2', '3', '4', '5', '6']) {
      if (typeof defaultRules[day] !== 'string') {
        errors.push(`${file}: default_rules に "${day}" が存在しません`)
      } else {
        referencedIds.add(defaultRules[day])
      }
    }
  }

  // overrides は resolveCalendar が直接参照する。欠落するとランタイムで壊れるため必須にする。
  const overrides = rules.overrides
  if (overrides === undefined) {
    errors.push(`${file}: overrides が存在しません（空でも {} を置くこと）`)
  } else if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    errors.push(`${file}: overrides はオブジェクトである必要があります`)
  } else {
    for (const [key, id] of Object.entries(overrides)) {
      if (!DATE_RE.test(key)) {
        errors.push(`${file}: overrides のキー "${key}" は YYYY-MM-DD 形式ではありません`)
      } else if (!isRealDate(key)) {
        errors.push(`${file}: overrides のキー "${key}" は実在しない日付です`)
      }
      if (typeof id !== 'string') {
        errors.push(`${file}: overrides["${key}"] の値が文字列ではありません`)
      } else {
        referencedIds.add(id)
      }
    }
  }

  for (const id of referencedIds) {
    const timetablePath = path.join(TIMETABLES_DIR, `${id}.json`)
    if (!existsSync(timetablePath)) {
      errors.push(`${file}: 参照されている時刻表 ID "${id}" に対応する public/data/timetables/${id}.json が存在しません`)
    }
  }

  return referencedIds
}

function validateTimetables() {
  if (!existsSync(TIMETABLES_DIR)) {
    errors.push('timetables/: ディレクトリが存在しません')
    return
  }

  const files = readdirSync(TIMETABLES_DIR).filter(f => f.endsWith('.json'))
  for (const file of files) {
    const filePath = path.join(TIMETABLES_DIR, file)
    const idFromFilename = file.replace(/\.json$/, '')

    let data
    try {
      data = readJSON(filePath)
    } catch (e) {
      errors.push(`timetables/${file}: JSON の parse に失敗しました (${e.message})`)
      continue
    }

    if (data.id !== idFromFilename) {
      errors.push(`timetables/${file}: id ("${data.id}") がファイル名 ("${idFromFilename}") と一致しません`)
    }
    requireString(`timetables/${file}: name`, data.name)

    const routes = data.routes
    if (!routes || typeof routes !== 'object') {
      errors.push(`timetables/${file}: routes が存在しません`)
      continue
    }

    // 時刻を表示しない2つの状態（AGENTS.md「時刻を表示しない2つの状態」）。
    // どちらも schedule 空配列で表現するので、それ以外の表が空になっていたら
    // 「本日の運行はありません」と誤表示される事故なのでビルドを止める。
    const isEmptyByDesign = idFromFilename.includes('special') || idFromFilename.includes('closed')

    for (const key of ROUTE_KEYS) {
      const route = routes[key]
      if (!route) {
        errors.push(`timetables/${file}: routes.${key} が存在しません`)
        continue
      }
      requireString(`timetables/${file}: routes.${key}.origin`, route.origin)
      requireString(`timetables/${file}: routes.${key}.destination`, route.destination)
      requireString(`timetables/${file}: routes.${key}.bus_stop_name`, route.bus_stop_name)
      const coords = route.bus_stop_coords
      if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
        errors.push(`timetables/${file}: routes.${key}.bus_stop_coords の lat / lng が数値ではありません`)
      }

      const schedule = route.schedule
      if (!Array.isArray(schedule)) {
        errors.push(`timetables/${file}: routes.${key}.schedule が配列ではありません`)
        continue
      }

      // 特別ダイヤ（大学ホームページへ誘導する日）・全便運休日は発車時刻を表示しない。
      // 時刻を書いても画面に出ないため、書いてしまった事故をここで検出する。
      if (isEmptyByDesign && schedule.length > 0) {
        errors.push(`timetables/${file}: 時刻を表示しないダイヤ（id に "special" / "closed" を含む）の routes.${key}.schedule は空配列である必要があります`)
      }
      if (!isEmptyByDesign && schedule.length === 0) {
        errors.push(`timetables/${file}: routes.${key}.schedule が空です（空配列は運休日・特別ダイヤ専用の表現です）`)
      }

      let prevMinutes = -1
      schedule.forEach((entry, i) => {
        const dep = entry?.departure
        const depValid = typeof dep === 'string' && TIME_RE.test(dep)
        if (!depValid) {
          errors.push(`timetables/${file}: routes.${key}.schedule[${i}] の departure "${dep}" が HH:mm 形式(00:00-23:59)ではありません`)
        }
        if (typeof entry?.note !== 'string') {
          errors.push(`timetables/${file}: routes.${key}.schedule[${i}] の note が文字列ではありません`)
        }
        if (depValid) {
          const [h, m] = dep.split(':').map(Number)
          const minutes = h * 60 + m
          if (minutes < prevMinutes) {
            errors.push(`timetables/${file}: routes.${key}.schedule[${i}] (${dep}) が直前の時刻より前後しています（昇順ではありません）`)
          } else if (minutes === prevMinutes) {
            console.warn(`[警告] timetables/${file}: routes.${key}.schedule[${i}] (${dep}) が直前と同時刻です`)
          }
          prevMinutes = minutes
        }
      })
    }
  }
}

function validateNews() {
  const file = 'news.json'
  const filePath = path.join(DATA_DIR, file)
  if (!existsSync(filePath)) {
    errors.push(`${file}: ファイルが存在しません`)
    return
  }

  let news
  try {
    news = readJSON(filePath)
  } catch (e) {
    errors.push(`${file}: JSON の parse に失敗しました (${e.message})`)
    return
  }

  if (!Array.isArray(news)) {
    errors.push(`${file}: 配列である必要があります`)
    return
  }

  const seenIds = new Set()
  // 存在だけでなく型も見る。特に unread は truthy 判定なので、"false" という
  // 文字列が入ると既読にできない未読として表示され続ける。
  const stringFields = ['tagLabel', 'date', 'title', 'preview', 'body']
  news.forEach((item, i) => {
    if (typeof item.id !== 'number') {
      errors.push(`${file}: [${i}] の id が数値ではありません`)
    } else if (seenIds.has(item.id)) {
      errors.push(`${file}: [${i}] の id (${item.id}) が重複しています`)
    } else {
      seenIds.add(item.id)
    }

    if (!VALID_TAGS.includes(item.tag)) {
      errors.push(`${file}: [${i}] の tag "${item.tag}" が不正です（${VALID_TAGS.join('|')} のいずれかである必要があります）`)
    }

    for (const field of stringFields) {
      if (!(field in item)) {
        errors.push(`${file}: [${i}] に必須フィールド "${field}" がありません`)
      } else {
        requireString(`${file}: [${i}] の ${field}`, item[field])
      }
    }

    if (!('unread' in item)) {
      errors.push(`${file}: [${i}] に必須フィールド "unread" がありません`)
    } else if (typeof item.unread !== 'boolean') {
      errors.push(`${file}: [${i}] の unread が真偽値ではありません（実際の値: ${JSON.stringify(item.unread)}）`)
    }
  })
}

validateCalendarRules()
validateTimetables()
validateNews()

if (errors.length > 0) {
  console.error(`\n✗ データ検証に失敗しました (${errors.length} 件のエラー):\n`)
  for (const e of errors) {
    console.error(`  - ${e}`)
  }
  console.error('')
  process.exit(1)
}

console.log('✓ 静的データの検証に成功しました')
