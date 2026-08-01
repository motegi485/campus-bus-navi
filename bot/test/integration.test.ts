/**
 * エンドツーエンド検証（ネットワーク・書き込みなし）。
 * 2026-08-01 のライブ凍結スナップショット＋ fixtures の中間構造を使って、
 * 抽出 → 分類 → 変更検知（画像取得はスタブ）→ 組み立て → 検証 → カレンダー → PR本文
 * までを通し、実走したときに何が起きるかを固定する。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractLinks, classifyLinks } from '../src/extractLinks.js'
import { logicalKey, type ChangeDecision } from '../src/detectChanges.js'
import { buildPlan } from '../src/plan.js'
import { buildPrBody } from '../src/prBody.js'
import { parseHolidayCsv } from '../src/holidays.js'
import type { CalendarRules, ClassifiedLink, Intermediate, State, Timetable } from '../src/types.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const read = (rel: string) => readFileSync(path.join(FIXTURES, rel), 'utf-8')
const readJson = <T>(rel: string): T => JSON.parse(read(rel)) as T

const TODAY = '2026-08-01'
const RUN_AT = '2026-08-01T07:00:00+09:00'

const liveRules = readJson<CalendarRules>('calendar_rules_live.json')
const holidays = parseHolidayCsv(readFileSync(path.join(FIXTURES, 'holidays_sample.csv')))

/** OCR 結果のスタンドイン（key → 中間構造） */
const INTERMEDIATES: Record<string, string> = {
  regular: 'intermediate/regular.json',
  'vacation:summer': 'intermediate/vacation_summer.json',
  'event:2026-08-23': 'intermediate/event_20260620.json', // OC ダイヤの代用
}

/** 全リンクを「新規（OCR 対象）」として decision に変換する（画像取得はスタブ） */
function decisionsFor(classified: ClassifiedLink[]): ChangeDecision[] {
  return classified
    .filter((link) => link.kind !== 'needs_review')
    .map((link) => {
      const key = logicalKey(link)!
      const decision: ChangeDecision = {
        key,
        link,
        action: 'ocr',
        reason: '新規の時刻表画像です。',
        sha256: `sha-${key}`,
        imageUrl: link.url,
      }
      if (link.kind === 'event') decision.effectiveDates = link.dates
      return decision
    })
}

/**
 * 「Bot 導入前のリポジトリ」を再現する。
 * 実リポジトリを読むと、Bot をローカル実走した後に vacation / event ファイルが
 * 実在してしまい create → update に変わるため、テストは常にこの初期状態から始める。
 */
const BASELINE: Record<string, string> = {
  'timetable_weekday.json': 'expected/timetable_weekday.json',
  'timetable_holiday.json': 'expected/timetable_holiday.json',
}
const baselineRead = (fileName: string) =>
  BASELINE[fileName] ? readJson<Timetable>(BASELINE[fileName]!) : null
// timetable_closed / timetable_special は手動運用の待機ファイルで、Bot 導入前から存在する
const baselineExists = (fileName: string) =>
  fileName in BASELINE || fileName === 'timetable_closed.json' || fileName === 'timetable_special.json'

function runPipeline(state: State = { version: 1 }) {
  const classified = classifyLinks(extractLinks(read('page_snapshot_20260801.html')).links, TODAY)
  const decisions = decisionsFor(classified)
  const intermediates = new Map<string, Intermediate>()
  for (const decision of decisions) {
    const fixture = INTERMEDIATES[decision.key]
    if (fixture) intermediates.set(decision.key, readJson<Intermediate>(fixture))
  }
  const planned = buildPlan({
    decisions,
    intermediates,
    needsReviewLinks: classified.filter((c) => c.kind === 'needs_review'),
    state,
    liveOverrides: { ...liveRules.overrides },
    holidays,
    today: TODAY,
    runAt: RUN_AT,
    readTimetable: baselineRead,
    timetableExists: baselineExists,
  })
  return { classified, decisions, planned }
}

describe('統合: 2026-08-01 のライブ状態を実走したらどうなるか', () => {
  const { planned } = runPipeline()

  it('生成される時刻表ファイルは5件（weekday/holiday 更新 + 夏季休暇2件 + OC 1件 新規）', () => {
    const writes = planned.filePlans.filter((f) => f.op !== 'delete')
    expect(writes.map((f) => `${f.op}:${f.fileName}`).sort()).toEqual([
      'create:timetable_event_20260823.json',
      'create:timetable_vacation_summer_holiday.json',
      'create:timetable_vacation_summer_weekday.json',
      'update:timetable_holiday.json',
      'update:timetable_weekday.json',
    ])
    expect(planned.validationFailures).toEqual([])
  })

  it('通常ダイヤの schedule は fixtures/expected と一致し、既存本番データと同一（＝差分ゼロ）', () => {
    for (const name of ['timetable_weekday', 'timetable_holiday']) {
      const plan = planned.filePlans.find((f) => f.fileName === `${name}.json`)!
      const want = readJson<{ routes: Record<string, { schedule: unknown }> }>(`expected/${name}.json`)
      expect(plan.timetable!.routes.station_to_campus.schedule, name).toEqual(want.routes.station_to_campus!.schedule)
      expect(plan.timetable!.routes.campus_to_station.schedule, name).toEqual(want.routes.campus_to_station!.schedule)
      // 便数の増減がない＝本番データと同じ内容
      expect(plan.counts, name).toEqual(plan.prevCounts)
    }
  })

  it('夏季休暇の override が 8/17〜9/23 の全日に付き、平日/休日が正しく振り分けられる', () => {
    const o = planned.calendar.nextOverrides
    expect(o['2026-08-17']).toBe('timetable_vacation_summer_weekday') // 月
    expect(o['2026-08-21']).toBe('timetable_vacation_summer_weekday') // 金
    expect(o['2026-08-22']).toBe('timetable_vacation_summer_holiday') // 土
    expect(o['2026-09-21']).toBe('timetable_vacation_summer_holiday') // 月・敬老の日
    expect(o['2026-09-22']).toBe('timetable_vacation_summer_holiday') // 火・休日
    expect(o['2026-09-23']).toBe('timetable_vacation_summer_holiday') // 水・秋分の日
    expect(o['2026-09-24']).toBeUndefined() // 期間外
    // 期間は 8/17〜9/23 の 38 日。うち 8/23 は event が優先するので vacation の管理下は 37 日
    expect(Object.keys(planned.calendar.managed.vacation)).toHaveLength(37)
    expect(planned.calendar.managed.vacation['2026-08-23']).toBeUndefined()
  })

  it('オープンキャンパス（8/23）は vacation 期間内でも event が優先される', () => {
    expect(planned.calendar.nextOverrides['2026-08-23']).toBe('timetable_event_20260823')
    expect(planned.calendar.managed.event).toEqual({ '2026-08-23': 'timetable_event_20260823' })
  })

  it('祝日は祝日 baseline で休業日ダイヤになる（10/12 スポーツの日・月）', () => {
    expect(planned.calendar.nextOverrides['2026-10-12']).toBe('timetable_holiday')
    expect(planned.calendar.managed.holiday['2026-10-12']).toBe('timetable_holiday')
  })

  it('山の日（8/11・火）はお盆期間内なので祝日 baseline より特別ダイヤが優先される', () => {
    expect(planned.calendar.nextOverrides['2026-08-11']).toBe('timetable_special')
    expect(planned.calendar.managed.holiday['2026-08-11']).toBeUndefined()
  })

  it('既存の手動 override 10件はすべて保持される', () => {
    for (const [date, id] of Object.entries(liveRules.overrides)) {
      expect(planned.calendar.nextOverrides[date], date).toBe(id)
    }
  })

  it('お盆ダイヤ（needs_review）は時刻を取り込まず、8/8〜8/16 を特別ダイヤで塗り潰す', () => {
    // 時刻表ファイルは一切作らない
    expect(planned.filePlans.some((f) => f.sourceUrl?.includes('0808'))).toBe(false)
    for (const date of ['2026-08-08', '2026-08-10', '2026-08-13', '2026-08-16']) {
      expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
    }
    expect(planned.calendar.nextOverrides['2026-08-07']).toBeUndefined() // 期間外
    expect(Object.keys(planned.calendar.managed.special)).toHaveLength(9)
    expect(planned.nextState.specials?.['2026-08-08']).toMatchObject({
      period: { start: '2026-08-08', end: '2026-08-16' },
    })
    // 人が対応すべき事項として PR に出す
    expect(planned.warnings.some((w) => w.code === 'special_applied' && w.level === 'warn')).toBe(true)
  })

  it('state に記録する URL は「リンクの正規化 URL」（毎回の再ダウンロードを防ぐ要）', () => {
    // 取得 URL（% エンコード / 原寸フォールバック後）を保存すると detectChanges と一致せず、
    // 日次実行のたびに画像を DL してしまう
    expect(planned.nextState.regular!.url).toBe(
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/04/R8スクールバス時刻表.jpg',
    )
    expect(planned.nextState.vacations!.summer!.url).toBe(
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0817--1024x724.jpg',
    )
  })

  it('state に regular / vacations.summer / events が記録される', () => {
    expect(planned.nextState.regular).toMatchObject({
      start: '2026-04-04',
      derived: expect.arrayContaining(['timetable_weekday', 'timetable_holiday']),
    })
    expect(planned.nextState.vacations?.summer).toMatchObject({
      period: { start: '2026-08-17', end: '2026-09-23' },
      derived: ['timetable_vacation_summer_weekday', 'timetable_vacation_summer_holiday'],
    })
    expect(planned.nextState.events?.['2026-08-23']).toMatchObject({
      label: 'オープンキャンパス',
      dates: ['2026-08-23'],
      derived: ['timetable_event_20260823'],
    })
  })

  it('削除計画は空（初回実行なので消すものが無い）', () => {
    expect(planned.calendar.deletions).toEqual([])
  })

  it('PR 本文がテンプレートどおり生成される', () => {
    const body = buildPrBody({
      runAt: RUN_AT,
      modelUsed: 'gemini-3.6-flash',
      fallbackUsed: false,
      files: planned.filePlans,
      overrideChanges: planned.calendar.changes,
      deletions: planned.calendar.deletions,
      warnings: planned.warnings,
      ocrStats: { matched: 3, total: 3, majority: 0 },
      validationFailures: planned.validationFailures,
    })
    expect(body).toContain('## 概要')
    expect(body).toContain('モデル: gemini-3.6-flash')
    expect(body).toContain('| vacation | timetable_vacation_summer_weekday.json | 新規 |')
    expect(body).toContain('| regular | timetable_weekday.json | 更新 |')
    expect(body).toContain('### calendar_rules.overrides')
    expect(body).toContain('- 追加: 2026-08-23 → timetable_event_20260823')
    expect(body).toContain('- 2回読み照合: 一致 3/3')
    expect(body).toContain('- スキーマ検証: すべて合格')
    expect(body).toContain('## レビュー観点')
  })
})

describe('統合: 2回目の実行（冪等性・AC-3）', () => {
  it('前回と同じ state・同じ画像なら差分が出ない', () => {
    const first = runPipeline()
    // 1回目の結果を「マージ済みの main」とみなして再実行する
    const merged: State = JSON.parse(JSON.stringify(first.planned.nextState)) as State
    const classified = classifyLinks(extractLinks(read('page_snapshot_20260801.html')).links, TODAY)
    const decisions = decisionsFor(classified).map((d) => ({
      ...d,
      action: 'unchanged' as const,
      reason: '前回から変化なし。',
      sha256: `sha-${d.key}`,
    }))

    const second = buildPlan({
      decisions,
      intermediates: new Map(),
      // ページに掲示が残っている以上、needs_review も毎回同じものが渡される
      needsReviewLinks: classified.filter((c) => c.kind === 'needs_review'),
      state: merged,
      liveOverrides: { ...first.planned.calendar.nextOverrides },
      holidays,
      today: TODAY,
      runAt: RUN_AT,
      // 1回目で書き込まれたファイル ＋ 元から在るファイル（待機ファイル含む）が存在する前提にする
      timetableExists: (fileName) =>
        first.planned.filePlans.some((f) => f.fileName === fileName) || baselineExists(fileName),
      readTimetable: () => null,
    })

    expect(second.filePlans).toEqual([])
    expect(second.calendar.changes).toEqual([])
    expect(second.calendar.nextOverrides).toEqual(first.planned.calendar.nextOverrides)
    expect(second.nextState.managed_overrides).toEqual(first.planned.nextState.managed_overrides)
  })
})
