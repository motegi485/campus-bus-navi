/**
 * FR-8: 出力前の検証。1つでも失敗したらそのファイルは書かず、対応する override も生成しない。
 * 「安全側 default」(NFR-3) に従い、失敗は必ず通知メール / ログに顕在化させる。
 */

import { z } from 'zod'
import { EARLIEST_DEPARTURE, LATEST_DEPARTURE } from './config.js'
import type { Timetable } from './types.js'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const scheduleEntrySchema = z.object({
  departure: z.string().regex(TIME_RE, 'departure は HH:mm 形式である必要があります'),
  note: z.string(),
})

const routeSchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  bus_stop_name: z.string().min(1),
  bus_stop_coords: z.object({ lat: z.number(), lng: z.number() }),
  schedule: z.array(scheduleEntrySchema).min(1, '発車時刻が1件もありません'),
})

const timetableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  routes: z
    .object({
      station_to_campus: routeSchema,
      campus_to_station: routeSchema,
    })
    .strict(),
})

export interface ValidateResult {
  ok: boolean
  errors: string[]
}

export interface ValidateOptions {
  /** 出力先ファイル名（id との一致検証に使う） */
  fileName: string
  /** 既存ファイルの便数（±50% チェック用） */
  prevCounts?: { station: number; campus: number }
  /** 2回読み照合が成立しているか（§8.5.4） */
  ocrVerified: boolean
}

export function validateTimetable(timetable: Timetable, options: ValidateOptions): ValidateResult {
  const errors: string[] = []

  const parsed = timetableSchema.safeParse(timetable)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    return { ok: false, errors }
  }

  // id === ファイル名（拡張子なし）
  const expectedId = options.fileName.replace(/\.json$/, '')
  if (timetable.id !== expectedId) {
    errors.push(`id「${timetable.id}」がファイル名「${options.fileName}」と一致しません。`)
  }

  for (const [key, route] of Object.entries(timetable.routes)) {
    const label = key === 'station_to_campus' ? '松永発' : '大学発'
    const schedule = route.schedule

    // 厳密昇順（重複不可）
    for (let i = 1; i < schedule.length; i++) {
      if (schedule[i]!.departure <= schedule[i - 1]!.departure) {
        errors.push(`${label}: 発車時刻が昇順ではありません（${schedule[i - 1]!.departure} → ${schedule[i]!.departure}）。`)
        break
      }
    }

    // 許容時間帯
    for (const entry of schedule) {
      if (entry.departure < EARLIEST_DEPARTURE || entry.departure > LATEST_DEPARTURE) {
        errors.push(
          `${label}: 発車時刻 ${entry.departure} が許容範囲（${EARLIEST_DEPARTURE}〜${LATEST_DEPARTURE}）の外です。`,
        )
      }
    }

    // note: 末尾のみ「最終」
    schedule.forEach((entry, i) => {
      const isLast = i === schedule.length - 1
      if (isLast && entry.note !== '最終') {
        errors.push(`${label}: 最終便（${entry.departure}）の note が「最終」ではありません。`)
      }
      if (!isLast && entry.note !== '') {
        errors.push(`${label}: 最終便以外（${entry.departure}）の note が空ではありません。`)
      }
    })
  }

  if (!options.ocrVerified) {
    errors.push('2回読み照合が成立していません。')
  }

  /**
   * 便数が ±50% を超えて変化したら書き込みを止める。
   *
   * 【要件定義 v1.8 からの変更・2026-08-16 の自動適用化に伴い承認済み】
   * 元は「警告するが書き込みは止めない」SHOULD 条件だった。人間の PR レビューが
   * 最終ゲートとして存在し、そこで元画像と突き合わせられる前提だったためである。
   * 自動適用ではそのゲートが無くなるため、NFR-3「判定不能・検証失敗は書かない・
   * 消さない・顕在化させる」に合わせて MUST へ格上げする。
   * 実データの便数は 1 ルートあたり 10〜32 便なので、±50% は誤読を疑うに足る幅である
   * （最小の 10 便でも 5 便以下 / 16 便以上でしか発火しない）。
   *
   * 正しい改正でここに落ちた場合は、bot/state.json の該当キーを消して再実行するか、
   * 手動でデータを投入する。復旧手順は通知メールにも載せる。
   */
  if (options.prevCounts) {
    const counts = {
      station: timetable.routes.station_to_campus.schedule.length,
      campus: timetable.routes.campus_to_station.schedule.length,
    }
    for (const [key, label] of [
      ['station', '松永発'],
      ['campus', '大学発'],
    ] as const) {
      const prev = options.prevCounts[key]
      const now = counts[key]
      if (prev > 0 && Math.abs(now - prev) / prev > 0.5) {
        errors.push(
          `${label}の便数が大きく変化しました（${prev} → ${now}）。` +
            '読み取り誤り（JR 列の混入など）の可能性があるため取り込みを見送りました。' +
            '元画像を確認し、正しい改正であれば bot/state.json の該当キーを削除して再実行してください。',
        )
      }
    }
  }

  return { ok: errors.length === 0, errors }
}
