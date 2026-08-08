/**
 * FR-10: 内閣府「国民の祝日」CSV の取得とキャッシュ。
 * Shift_JIS・CRLF・ヘッダ1行・`YYYY/M/D,名称`（ゼロ埋めなし）。振替休日込み。
 * 取得失敗時は既存キャッシュで続行する（黙って成功扱いにはせず必ず警告を出す）。
 */

import iconv from 'iconv-lite'
import { createHash } from 'node:crypto'
import { CONFIG } from './config.js'
import { fetchWithTimeout } from './fetchPage.js'
import { readHolidaysCache } from './files.js'
import { formatDate, nowIsoJst, parseDate, todayJst } from './time.js'
import type { Holiday, HolidaysCache, Warning } from './types.js'

/** Shift_JIS の CSV バッファを Holiday[] にする。CRLF・最終行の改行欠落を許容する。 */
export function parseHolidayCsv(buffer: Buffer): Holiday[] {
  const text = iconv.decode(buffer, 'Shift_JIS')
  const lines = text.split(/\r?\n/)
  const holidays: Holiday[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue
    if (i === 0) continue // ヘッダ行（国民の祝日・休日月日,国民の祝日・休日名称）
    const m = line.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.*)$/)
    if (!m) {
      throw new Error(`祝日CSVの行を解釈できません（${i + 1}行目）: ${line}`)
    }
    holidays.push({
      date: formatDate(Number(m[1]), Number(m[2]), Number(m[3])),
      name: m[4]!.trim(),
    })
  }

  if (holidays.length === 0) throw new Error('祝日CSVにデータ行がありません')
  return holidays
}

export interface HolidaysResult {
  holidays: Holiday[]
  /** 書き込むべきキャッシュ。null なら holidays.json を更新しない */
  cacheToWrite: HolidaysCache | null
  /** state.holidays_source に記録する値（キャッシュも無い場合は undefined） */
  source?: { fetched_at: string; sha256: string }
  warnings: Warning[]
}

/**
 * 祝日データの将来カバレッジを検査する。
 *
 * 収録が今日から `holidayCoverageMinDays` 先に届かないまま気づかないと、
 * カバレッジが尽きた先の祝日を平日として扱い、誤った発車時刻を表示してしまう。
 * CSV の公開範囲は年に1回まとめて延びるため、閾値は余裕をもって設ける。
 */
function checkCoverage(holidays: Holiday[], warnings: Warning[], today: string): void {
  if (holidays.length === 0) return
  const last = holidays.reduce((a, b) => (a.date > b.date ? a : b)).date
  const horizon = parseDate(today).add(CONFIG.holidayCoverageMinDays, 'day').format('YYYY-MM-DD')
  if (last < horizon) {
    warnings.push({
      level: 'warn',
      code: 'holiday_coverage_short',
      message:
        `祝日データの収録が ${last} までしかありません（${today} から ${CONFIG.holidayCoverageMinDays} 日先までを期待）。` +
        'それ以降の祝日は平日ダイヤとして扱われます。内閣府CSVの公開状況と取得経路を確認してください。',
      url: CONFIG.holidayCsvUrl,
    })
  }
}

export async function fetchHolidays(today: string = todayJst()): Promise<HolidaysResult> {
  const warnings: Warning[] = []
  const cached = readHolidaysCache()

  let buffer: Buffer | null = null
  try {
    const res = await fetchWithTimeout(CONFIG.holidayCsvUrl, {
      allowedHostSuffixes: CONFIG.allowedHolidayHostSuffixes,
      maxBytes: CONFIG.maxCsvBytes,
    })
    if (res.ok) {
      buffer = res.buffer
    } else {
      warnings.push({
        level: 'warn',
        code: 'holiday_csv_http_error',
        message: `祝日CSVの取得に失敗しました（HTTP ${res.status}）。`,
        url: CONFIG.holidayCsvUrl,
      })
    }
  } catch (e) {
    warnings.push({
      level: 'warn',
      code: 'holiday_csv_network_error',
      message: `祝日CSVの取得に失敗しました（ネットワークエラー: ${(e as Error).message}）。`,
      url: CONFIG.holidayCsvUrl,
    })
  }

  if (buffer) {
    try {
      const holidays = parseHolidayCsv(buffer)
      const sha256 = createHash('sha256').update(buffer).digest('hex')

      // 冪等性（NFR-1）: 内容が変わっていなければ holidays.json を書き換えない。
      // 毎回 fetched_at を更新すると、データ変更が無い日でも差分が出て PR が作られてしまう。
      if (cached && cached.source_sha256 === sha256) {
        checkCoverage(cached.holidays, warnings, today)
        return {
          holidays: cached.holidays,
          cacheToWrite: null,
          source: { fetched_at: cached.fetched_at, sha256 },
          warnings,
        }
      }

      checkCoverage(holidays, warnings, today)
      const cache: HolidaysCache = { fetched_at: nowIsoJst(), source_sha256: sha256, holidays }
      return { holidays, cacheToWrite: cache, source: { fetched_at: cache.fetched_at, sha256 }, warnings }
    } catch (e) {
      warnings.push({
        level: 'warn',
        code: 'holiday_csv_parse_error',
        message: `祝日CSVの解釈に失敗しました: ${(e as Error).message}`,
        url: CONFIG.holidayCsvUrl,
      })
    }
  }

  if (cached) {
    warnings.push({
      level: 'warn',
      code: 'holiday_csv_cache_fallback',
      message: `祝日CSVを取得できなかったため既存キャッシュ（${cached.fetched_at} 取得・${cached.holidays.length}件）を使用します。`,
    })
    // 取得失敗が続いても `if (cached)` だけで無期限に古いキャッシュを使い続けてしまうため、
    // 経過日数と将来カバレッジの両方を見張る（取得経路の恒久障害を見落とさないため）。
    const ageDays = parseDate(today).diff(parseDate(cached.fetched_at.slice(0, 10)), 'day')
    if (ageDays > CONFIG.holidayCacheMaxAgeDays) {
      warnings.push({
        level: 'warn',
        code: 'holiday_cache_stale',
        message:
          `祝日キャッシュの取得日から ${ageDays} 日経過しています（上限 ${CONFIG.holidayCacheMaxAgeDays} 日）。` +
          '内閣府CSVの URL 変更や恒久的な取得障害が疑われます。',
        url: CONFIG.holidayCsvUrl,
      })
    }
    checkCoverage(cached.holidays, warnings, today)
    return {
      holidays: cached.holidays,
      cacheToWrite: null,
      source: { fetched_at: cached.fetched_at, sha256: cached.source_sha256 },
      warnings,
    }
  }

  warnings.push({
    level: 'warn',
    code: 'holiday_baseline_skipped',
    message: '祝日CSVを取得できずキャッシュもないため、祝日 baseline の override 生成をスキップします。',
  })
  return { holidays: [], cacheToWrite: null, warnings }
}
