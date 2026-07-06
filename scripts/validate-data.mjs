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

  const overrides = rules.overrides
  if (overrides !== undefined) {
    if (typeof overrides !== 'object' || Array.isArray(overrides)) {
      errors.push(`${file}: overrides はオブジェクトである必要があります`)
    } else {
      for (const [key, id] of Object.entries(overrides)) {
        if (!DATE_RE.test(key)) {
          errors.push(`${file}: overrides のキー "${key}" は YYYY-MM-DD 形式ではありません`)
        }
        if (typeof id !== 'string') {
          errors.push(`${file}: overrides["${key}"] の値が文字列ではありません`)
        } else {
          referencedIds.add(id)
        }
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

    const routes = data.routes
    if (!routes || typeof routes !== 'object') {
      errors.push(`timetables/${file}: routes が存在しません`)
      continue
    }

    for (const key of ROUTE_KEYS) {
      const route = routes[key]
      if (!route) {
        errors.push(`timetables/${file}: routes.${key} が存在しません`)
        continue
      }
      const schedule = route.schedule
      if (!Array.isArray(schedule)) {
        errors.push(`timetables/${file}: routes.${key}.schedule が配列ではありません`)
        continue
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
  const requiredFields = ['tagLabel', 'date', 'title', 'preview', 'body', 'unread']
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

    for (const field of requiredFields) {
      if (!(field in item)) {
        errors.push(`${file}: [${i}] に必須フィールド "${field}" がありません`)
      }
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
