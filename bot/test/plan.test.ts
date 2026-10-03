/**
 * plan.ts の新しい安全装置（Codex レビュー F-002 / F-007 / F-018 の回帰テスト）と、
 * 2026-10-03 の不具合対応（要件 v1.16: キー移行・日付縮小の猶予・取り込み失敗日の特別ダイヤ・拒否画像の記録）。
 * ネットワーク・書き込みには一切触れない。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { applySpecials, buildPlan, reconcileEvents, type PlanInput } from '../src/plan.js'
import { detectChanges, type ChangeDecision } from '../src/detectChanges.js'
import { CONFIG } from '../src/config.js'
import { eachDate } from '../src/time.js'
import type {
  ClassifiedLink,
  Intermediate,
  RejectedImage,
  State,
  StateEvent,
  Timetable,
  Warning,
} from '../src/types.js'

const TODAY = '2026-08-01'
const RUN_AT = '2026-08-01T07:00:00+09:00'
const EVENT_URL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0823.jpg'

function eventTimetable(id: string): Timetable {
  const route = (origin: string, destination: string) => ({
    origin,
    destination,
    bus_stop_name: `${origin} バス乗り場`,
    bus_stop_coords: { lat: 34.4, lng: 133.2 },
    schedule: [
      { departure: '08:00', note: '' },
      { departure: '09:00', note: '最終' },
    ],
  })
  return {
    id,
    name: 'オープンキャンパスダイヤ',
    routes: {
      station_to_campus: route('松永発', '大学行き'),
      campus_to_station: route('大学発', '松永行き'),
    },
  }
}

function eventLink(dates: string[]): ClassifiedLink {
  return {
    url: EVENT_URL,
    rawHref: EVENT_URL,
    anchorText: '時刻表はコチラ',
    lineText: 'オープンキャンパス 時刻表はコチラ',
    normalizedLine: 'オープンキャンパス 時刻表はコチラ',
    kind: 'event',
    dates,
    label: 'オープンキャンパス',
  }
}

function stateWithEvent(dates: string[], derived: string[], missingCount?: number): State {
  return {
    version: 1,
    events: {
      [dates[0]!]: {
        url: EVENT_URL,
        sha256: 'sha-event',
        label: 'オープンキャンパス',
        dates,
        derived,
        processed_at: '2026-07-20T07:00:00+09:00',
        // 【重要】今日の日付で「内容確認済み」にしておく。これが無いと detectChanges が
        // 同一 URL の再検証（S2-BOT-01）で実ネットワークへ出てしまう。
        // 再検証そのものの挙動は detectChanges.test.ts が fetch をスタブして検証する。
        checked_at: TODAY,
        ...(missingCount === undefined ? {} : { missing_count: missingCount }),
      },
    },
    managed_overrides: {
      special: {},
      event: Object.fromEntries(dates.map((d) => [d, `timetable_event_${d.replace(/-/g, '')}`])),
      vacation: {},
      holiday: {},
    },
  }
}

// ---------------------------------------------------------------------------
// F-007: 同一 URL のままイベント日が増減したとき
// ---------------------------------------------------------------------------

describe('同一URLでイベント日が変わったとき（F-007）', () => {
  /** detectChanges を実際に通す（URL が同じなので画像取得は発生しない） */
  async function run(
    stateDates: string[],
    pageDates: string[],
    existingFiles: string[],
    removedDates?: Record<string, number>,
  ) {
    const state = stateWithEvent(stateDates, stateDates.map((d) => `timetable_event_${d.replace(/-/g, '')}`))
    // 前回までに「掲示から消えた」と数えた回数（撤去の猶予中）を再現する
    if (removedDates) state.events![stateDates[0]!]!.removed_dates = removedDates
    const detected = await detectChanges([eventLink(pageDates)], state, TODAY)
    const files = new Set(existingFiles)
    const planned = buildPlan({
      decisions: detected.decisions,
      intermediates: new Map(),
      state,
      // 前回 Bot が張った override が calendar_rules.json に残っている状態を再現する
      // （残っていないと「人が消した」と判定されて suppressed に入る＝別の正しい挙動）
      liveOverrides: { ...state.managed_overrides!.event },
      holidays: [],
      today: TODAY,
      runAt: RUN_AT,
      readTimetable: (fileName) =>
        files.has(fileName) ? eventTimetable(fileName.replace(/\.json$/, '')) : null,
      timetableExists: (fileName) => files.has(fileName),
    })
    return { detected, planned }
  }

  it('日付だけ変わった掲載は meta_only になる（OCR しない）', async () => {
    const { detected } = await run(['2026-08-23'], ['2026-08-23', '2026-08-24'], ['timetable_event_20260823.json'])
    expect(detected.decisions).toHaveLength(1)
    expect(detected.decisions[0]!.action).toBe('meta_only')
  })

  it('追加された日の時刻表ファイルを既存分から複製し、override も生成する', async () => {
    const { planned } = await run(['2026-08-23'], ['2026-08-23', '2026-08-24'], ['timetable_event_20260823.json'])

    const created = planned.filePlans.filter((p) => p.op === 'create').map((p) => p.fileName)
    expect(created).toEqual(['timetable_event_20260824.json'])
    expect(planned.calendar.nextOverrides['2026-08-24']).toBe('timetable_event_20260824')
    expect(planned.calendar.nextOverrides['2026-08-23']).toBe('timetable_event_20260823')
    // 複製元と同じ内容（id だけ差し替え）
    const plan = planned.filePlans.find((p) => p.fileName === 'timetable_event_20260824.json')!
    expect(plan.timetable!.id).toBe('timetable_event_20260824')
    expect(plan.timetable!.routes.station_to_campus.schedule).toHaveLength(2)
  })

  // 【v1.16 で仕様変更】掲示から消えた今日以降の適用日は即時に撤去せず、
  // CONFIG.eventMissingRunsBeforeRemoval 回連続で消えていたときだけ撤去する（抽出の取りこぼし対策）
  const BOTH_FILES = ['timetable_event_20260823.json', 'timetable_event_20260824.json']

  it('掲示から消えた今日以降の適用日は、1 回目は削除せず removed_dates に数えて warn する', async () => {
    const { planned } = await run(['2026-08-23', '2026-08-24'], ['2026-08-23'], BOTH_FILES)

    // ファイルも override も残す（取りこぼしなら翌日戻る）
    expect(planned.calendar.deletions).not.toContain('timetable_event_20260824.json')
    expect(planned.filePlans.filter((p) => p.op === 'delete')).toEqual([])
    expect(planned.calendar.nextOverrides['2026-08-24']).toBe('timetable_event_20260824')
    expect(planned.calendar.nextOverrides['2026-08-23']).toBe('timetable_event_20260823')
    // state には猶予中の日付ごと残り、連続回数を持つ
    const entry = planned.nextState.events!['2026-08-23']!
    expect(entry.dates).toEqual(['2026-08-23', '2026-08-24'])
    expect(entry.derived).toEqual(['timetable_event_20260823', 'timetable_event_20260824'])
    expect(entry.removed_dates).toEqual({ '2026-08-24': 1 })
    expect(planned.warnings).toContainEqual(
      expect.objectContaining({ code: 'event_date_removed', level: 'warn', url: EVENT_URL }),
    )
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_date_retired')
  })

  it('連続回数がしきい値に達した回に撤去し、ファイルは削除計画に載る', async () => {
    const before = CONFIG.eventMissingRunsBeforeRemoval - 1
    const { planned } = await run(['2026-08-23', '2026-08-24'], ['2026-08-23'], BOTH_FILES, {
      '2026-08-24': before,
    })

    expect(planned.calendar.deletions).toContain('timetable_event_20260824.json')
    expect(planned.filePlans).toContainEqual(
      expect.objectContaining({ op: 'delete', fileName: 'timetable_event_20260824.json' }),
    )
    expect(planned.calendar.nextOverrides['2026-08-24']).toBeUndefined()
    expect(planned.calendar.nextOverrides['2026-08-23']).toBe('timetable_event_20260823')
    const entry = planned.nextState.events!['2026-08-23']!
    expect(entry.dates).toEqual(['2026-08-23'])
    expect(entry.derived).toEqual(['timetable_event_20260823'])
    expect(entry.removed_dates).toBeUndefined()
    expect(planned.warnings).toContainEqual(
      expect.objectContaining({ code: 'event_date_retired', level: 'warn', url: EVENT_URL }),
    )
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_date_removed')
  })

  it('消えていた日付が掲示に戻ったら removed_dates から外す', async () => {
    const { detected, planned } = await run(['2026-08-23', '2026-08-24'], ['2026-08-23', '2026-08-24'], BOTH_FILES, {
      '2026-08-24': 1,
    })

    expect(detected.decisions[0]!.action).toBe('unchanged')
    const entry = planned.nextState.events!['2026-08-23']!
    expect(entry.dates).toEqual(['2026-08-23', '2026-08-24'])
    expect(entry.removed_dates).toBeUndefined()
    expect(planned.calendar.nextOverrides['2026-08-24']).toBe('timetable_event_20260824')
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_date_removed')
  })

  it('過去日になって掲示から外れた日は猶予の対象にしない（数えずに撤去候補へ）', async () => {
    // 07-31 は TODAY（08-01）から見て過去日。先頭日付が変わるので旧キー 07-31 から引き継ぐ
    const { detected, planned } = await run(['2026-07-31', '2026-08-23'], ['2026-08-23'], [
      'timetable_event_20260731.json',
      'timetable_event_20260823.json',
    ])

    expect(detected.decisions[0]!.stateKeys).toEqual(['2026-07-31'])
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_date_removed')
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_date_retired')
    expect(Object.keys(planned.nextState.events!)).toEqual(['2026-08-23'])
    const entry = planned.nextState.events!['2026-08-23']!
    expect(entry.removed_dates).toBeUndefined()
    expect(entry.dates).toEqual(['2026-08-23'])
    expect(planned.calendar.deletions).toContain('timetable_event_20260731.json')
    expect(planned.calendar.nextOverrides['2026-08-23']).toBe('timetable_event_20260823')
  })

  it('複製元のファイルが無ければ警告を出して何も作らない', async () => {
    const { planned } = await run(['2026-08-23'], ['2026-08-23', '2026-08-24'], [])
    expect(planned.filePlans.filter((p) => p.op === 'create')).toHaveLength(0)
    expect(planned.warnings.map((w) => w.code)).toContain('event_source_missing')
  })
})

// ---------------------------------------------------------------------------
// F-002: 掲載から消えた／延期されたイベント
// ---------------------------------------------------------------------------

describe('掲載から消えたイベントの撤去（F-002）', () => {
  const derived = ['timetable_event_20260823']

  it('しきい値未満は警告のみで state に残す', () => {
    const warnings: Warning[] = []
    const result = reconcileEvents(stateWithEvent(['2026-08-23'], derived), new Set(), TODAY, true, warnings)
    expect(result.state.events!['2026-08-23']!.missing_count).toBe(1)
    expect(result.retired).toEqual([])
    expect(warnings.map((w) => w.code)).toContain('event_link_missing')
  })

  it('しきい値に達したら state から落として撤去対象にする', () => {
    const warnings: Warning[] = []
    const before = CONFIG.eventMissingRunsBeforeRemoval - 1
    const result = reconcileEvents(
      stateWithEvent(['2026-08-23'], derived, before),
      new Set(),
      TODAY,
      true,
      warnings,
    )
    expect(result.state.events!['2026-08-23']).toBeUndefined()
    expect(result.retired).toEqual(derived)
    expect(warnings.map((w) => w.code)).toContain('event_removed')
  })

  it('抽出が失敗した実行では回数を進めない', () => {
    const warnings: Warning[] = []
    const result = reconcileEvents(stateWithEvent(['2026-08-23'], derived, 2), new Set(), TODAY, false, warnings)
    expect(result.state.events!['2026-08-23']!.missing_count).toBe(2)
    expect(result.retired).toEqual([])
    expect(warnings.map((w) => w.code)).toContain('event_missing_unverified')
  })

  it('掲載が戻ったらカウントをリセットする', () => {
    const warnings: Warning[] = []
    const result = reconcileEvents(
      stateWithEvent(['2026-08-23'], derived, 2),
      new Set(['2026-08-23']),
      TODAY,
      true,
      warnings,
    )
    expect(result.state.events!['2026-08-23']!.missing_count).toBeUndefined()
    expect(warnings).toHaveLength(0)
  })

  it('適用日がすべて過去のイベントは撤去判定の対象にしない（prune に任せる）', () => {
    const warnings: Warning[] = []
    const result = reconcileEvents(stateWithEvent(['2026-06-20'], derived), new Set(), TODAY, true, warnings)
    expect(result.state.events!['2026-06-20']).toBeDefined()
    expect(warnings).toHaveLength(0)
  })

  it('buildPlan 経由でも override とファイルが撤去される', async () => {
    const state = stateWithEvent(['2026-08-23'], derived, CONFIG.eventMissingRunsBeforeRemoval - 1)
    const planned = buildPlan({
      decisions: [], // 今回のページにイベントリンクが無い
      intermediates: new Map(),
      state,
      liveOverrides: { '2026-08-23': 'timetable_event_20260823' },
      holidays: [],
      today: TODAY,
      runAt: RUN_AT,
      extractionHealthy: true,
      readTimetable: () => null,
      timetableExists: (fileName) => fileName === 'timetable_event_20260823.json',
    })
    expect(planned.calendar.nextOverrides['2026-08-23']).toBeUndefined()
    expect(planned.calendar.deletions).toContain('timetable_event_20260823.json')
    expect(planned.filePlans).toContainEqual(
      expect.objectContaining({ op: 'delete', fileName: 'timetable_event_20260823.json' }),
    )
  })
})

// ---------------------------------------------------------------------------
// F-018: 逆転期間
// ---------------------------------------------------------------------------

describe('逆転期間の特別ダイヤ（F-018）', () => {
  const reviewLink = (start: string, end: string): ClassifiedLink => ({
    url: 'https://www.fukuyama-u.ac.jp/x.jpg',
    rawHref: 'https://www.fukuyama-u.ac.jp/x.jpg',
    anchorText: '時刻表はコチラ',
    lineText: '読めない掲示',
    normalizedLine: '読めない掲示',
    kind: 'needs_review',
    start,
    end,
    reason: 'テスト',
  })

  it('start > end のときは適用せず警告を出す', () => {
    const warnings: Warning[] = []
    const next = applySpecials({ version: 1 }, [reviewLink('2026-08-16', '2026-08-08')], TODAY, RUN_AT, warnings)
    expect(next.specials).toBeUndefined()
    expect(warnings.map((w) => w.code)).toEqual(['special_range_invalid'])
  })

  it('正しい向きの期間は従来どおり適用する', () => {
    const warnings: Warning[] = []
    const next = applySpecials({ version: 1 }, [reviewLink('2026-08-08', '2026-08-16')], TODAY, RUN_AT, warnings)
    expect(next.specials!['2026-08-08']!.period).toEqual({ start: '2026-08-08', end: '2026-08-16' })
    expect(warnings.map((w) => w.code)).toEqual(['special_applied'])
  })
})

// ---------------------------------------------------------------------------
// Codex FN-20260912-01: 前回の特別ダイヤを、掲示が読めるようになるまで消さない
// ---------------------------------------------------------------------------

describe('前回の特別ダイヤの維持（Codex FN-20260912-01）', () => {
  const SPECIAL_URL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0808.jpg'
  const START = '2026-08-08'
  const END = '2026-08-16'
  const PROCESSED_AT = '2026-07-20T07:00:00+09:00'

  /** 前回の実行で 8/8〜8/16 を特別ダイヤにした state（override も張られている） */
  function stateWithSpecial(): State {
    return {
      version: 1,
      specials: {
        [START]: {
          url: SPECIAL_URL,
          line: '特別運行 8月8日～8月16日',
          period: { start: START, end: END },
          reason: 'テスト',
          processed_at: PROCESSED_AT,
        },
      },
      managed_overrides: {
        special: Object.fromEntries(eachDate(START, END).map((d) => [d, 'timetable_special'])),
        event: {},
        vacation: {},
        holiday: {},
      },
    }
  }

  /** 同じ URL の掲示が、文言の更新で「夏季休業」として vacation に分類されたリンク */
  function vacationLink(): ClassifiedLink {
    return {
      url: SPECIAL_URL,
      rawHref: SPECIAL_URL,
      anchorText: '時刻表はコチラ',
      lineText: '夏季休業 8月8日～8月16日',
      normalizedLine: '夏季休業 8月8日～8月16日',
      kind: 'vacation',
      season: 'summer',
      start: START,
      end: END,
    }
  }

  /** 同じ URL が needs_review のまま、期間だけ読み替わったリンク */
  function reviewLink(start: string, end: string): ClassifiedLink {
    return {
      url: SPECIAL_URL,
      rawHref: SPECIAL_URL,
      anchorText: '時刻表はコチラ',
      lineText: '特別運行',
      normalizedLine: '特別運行',
      kind: 'needs_review',
      start,
      end,
      reason: 'テスト',
    }
  }

  /**
   * 「新規画像を取得して OCR する」判断を直接組む。detectChanges を通すと
   * state に無い URL の画像を実ネットワークへ取りに行ってしまうため。
   */
  function ocrDecision(link: ClassifiedLink): ChangeDecision {
    return { key: 'vacation:summer', link, action: 'ocr', reason: '新規の時刻表画像です。', sha256: 'sha-vacation', imageUrl: link.url }
  }

  /** 授業日・休業日の 2 種別を持つ、検証に通る最小の OCR 結果 */
  function vacationIntermediate(): Intermediate {
    const rows = [
      { hour: 8, minutes: [0] },
      { hour: 9, minutes: [0] },
    ]
    return {
      day_types: [
        { label: '授業日', matsunaga: rows, university: rows },
        { label: '休業日', matsunaga: rows, university: rows },
      ],
    }
  }

  function run(overrides: Partial<PlanInput>) {
    const state = stateWithSpecial()
    return buildPlan({
      decisions: [],
      intermediates: new Map(),
      needsReviewLinks: [],
      state,
      // 前回 Bot が張った special override が calendar_rules.json に残っている状態
      liveOverrides: { ...state.managed_overrides!.special },
      holidays: [],
      today: TODAY,
      runAt: RUN_AT,
      extractionHealthy: true,
      readTimetable: () => null,
      timetableExists: (fileName) => fileName === 'timetable_special.json',
      ...overrides,
    })
  }

  it('別分類になった掲示の OCR に失敗した回は、特別ダイヤを維持して warn で知らせる', () => {
    const link = vacationLink()
    const planned = run({
      decisions: [ocrDecision(link)],
      ocrFailures: new Map([['vacation:summer', 'OCR に失敗しました']]),
      presentUrls: new Set([SPECIAL_URL]),
    })

    // 有効なデータは何も書かれていない
    expect(planned.filePlans).toEqual([])
    // 保護は残る（processed_at も変えない＝同じ日に 2 回実行しても state は変わらない）
    expect(planned.nextState.specials![START]).toMatchObject({ period: { start: START, end: END }, processed_at: PROCESSED_AT })
    for (const date of ['2026-08-08', '2026-08-10', '2026-08-16']) {
      expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
    }
    expect(planned.warnings).toContainEqual(
      expect.objectContaining({ code: 'special_kept_unreplaced', level: 'warn', url: SPECIAL_URL }),
    )
  })

  it('別分類になった掲示の取り込みに成功したら、特別ダイヤは有効なデータに置き換わる', () => {
    const link = vacationLink()
    const planned = run({
      decisions: [ocrDecision(link)],
      intermediates: new Map([['vacation:summer', vacationIntermediate()]]),
      presentUrls: new Set([SPECIAL_URL]),
    })

    expect(planned.filePlans.map((p) => p.fileName).sort()).toEqual([
      'timetable_vacation_summer_holiday.json',
      'timetable_vacation_summer_weekday.json',
    ])
    expect(planned.nextState.specials).toBeUndefined()
    expect(planned.calendar.nextOverrides['2026-08-10']).toBe('timetable_vacation_summer_weekday') // 月
    expect(planned.calendar.nextOverrides['2026-08-15']).toBe('timetable_vacation_summer_holiday') // 土
    expect(planned.warnings.map((w) => w.code)).not.toContain('special_kept_unreplaced')
    expect(planned.warnings.map((w) => w.code)).not.toContain('special_kept_unverified')
  })

  it('画像取得に失敗して skip になった回も維持する', () => {
    const link = vacationLink()
    const planned = run({
      decisions: [{ key: 'vacation:summer', link, action: 'skip', reason: '画像を取得できませんでした' }],
      presentUrls: new Set([SPECIAL_URL]),
    })
    expect(planned.nextState.specials![START]).toBeDefined()
    expect(planned.calendar.nextOverrides['2026-08-10']).toBe('timetable_special')
    expect(planned.warnings.map((w) => w.code)).toContain('special_kept_unreplaced')
  })

  it('リンクを 1 件も抽出できなかった回は、掲示の有無を判定せず維持する（info）', () => {
    const planned = run({ presentUrls: new Set(), extractionHealthy: false })
    expect(planned.nextState.specials![START]).toBeDefined()
    expect(planned.calendar.nextOverrides['2026-08-10']).toBe('timetable_special')
    expect(planned.warnings).toContainEqual(expect.objectContaining({ code: 'special_kept_unverified', level: 'info' }))
    expect(planned.warnings.map((w) => w.code)).not.toContain('special_kept_unreplaced')
  })

  it('掲示そのものがページから消えたら、従来どおり特別ダイヤも外れる', () => {
    const planned = run({ presentUrls: new Set(), extractionHealthy: true })
    expect(planned.nextState.specials).toBeUndefined()
    expect(planned.calendar.nextOverrides['2026-08-10']).toBeUndefined()
    expect(planned.warnings.map((w) => w.code)).not.toContain('special_kept_unreplaced')
  })

  it('同じ URL が needs_review のまま期間だけ変わったら、新しい期間だけを残す（二重登録しない）', () => {
    const planned = run({
      needsReviewLinks: [reviewLink('2026-08-09', END)],
      presentUrls: new Set([SPECIAL_URL]),
    })
    expect(Object.keys(planned.nextState.specials!)).toEqual(['2026-08-09'])
    expect(planned.calendar.nextOverrides['2026-08-08']).toBeUndefined()
    expect(planned.calendar.nextOverrides['2026-08-09']).toBe('timetable_special')
  })

  it('期間が終わった前回の special は引き継がない', () => {
    const planned = run({
      state: {
        ...stateWithSpecial(),
        specials: {
          '2026-07-01': {
            url: SPECIAL_URL,
            line: '過去の掲示',
            period: { start: '2026-07-01', end: '2026-07-10' },
            reason: 'テスト',
            processed_at: PROCESSED_AT,
          },
        },
      },
      decisions: [ocrDecision(vacationLink())],
      ocrFailures: new Map([['vacation:summer', 'OCR に失敗しました']]),
      presentUrls: new Set([SPECIAL_URL]),
    })
    expect(planned.nextState.specials).toBeUndefined()
  })

  it('判定材料（presentUrls）を渡さない従来の呼び出しでは、今回の needs_review だけで置き換わる', () => {
    const warnings: Warning[] = []
    const next = applySpecials(stateWithSpecial(), [], TODAY, RUN_AT, warnings)
    expect(next.specials).toBeUndefined()
    expect(warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// v1.16（2026-10-03 の不具合対応）: 共通の部品
// ---------------------------------------------------------------------------

const OCT_TODAY = '2026-10-03'
const OCT_RUN_AT = '2026-10-03T07:00:00+09:00'
const OLD_PROCESSED_AT = '2026-09-29T07:00:00+09:00'
const KOUKAI_URL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/09/koukai.jpg'
const PHARM_URL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/09/yakugaku.jpg'

const idOf = (date: string) => `timetable_event_${date.replace(/-/g, '')}`

function octEventLink(url: string, dates: string[], label: string): ClassifiedLink {
  return {
    url,
    rawHref: url,
    anchorText: '時刻表はコチラ',
    // 警告文に含まれる日付を検査するため、掲示テキストには ISO 形式の日付を入れない
    lineText: `● ${label} 時刻表はコチラ`,
    normalizedLine: `● ${label} 時刻表はコチラ`,
    kind: 'event',
    dates,
    label,
  }
}

/** 前回までに取り込み済みのイベント項目（今日の日付で内容確認済み＝detectChanges がネットワークへ出ない） */
function octEventEntry(url: string, dates: string[], label: string, extra: Partial<StateEvent> = {}): StateEvent {
  return {
    url,
    sha256: 'sha-old',
    label,
    dates,
    derived: dates.map(idOf),
    processed_at: OLD_PROCESSED_AT,
    checked_at: OCT_TODAY,
    ...extra,
  }
}

/** 「画像を取得して OCR する」判断を直接組む（detectChanges を通すと実ネットワークへ出るため） */
function ocrEventDecision(link: ClassifiedLink, extra: Partial<ChangeDecision> = {}): ChangeDecision {
  return {
    key: `event:${link.dates![0]}`,
    link,
    action: 'ocr',
    reason: '新規の時刻表画像です。',
    sha256: 'sha-new',
    imageUrl: link.url,
    effectiveDates: link.dates!.filter((d) => d >= OCT_TODAY),
    check: { checked_at: OCT_TODAY },
    ...extra,
  }
}

/** 1 種別だけの、検証に通る最小のイベント OCR 結果 */
function eventIntermediate(label: string): Intermediate {
  const rows = [
    { hour: 8, minutes: [0] },
    { hour: 9, minutes: [0] },
  ]
  return { day_types: [{ label, matsunaga: rows, university: rows }] }
}

/** 既存ファイル集合を与えて buildPlan を呼ぶ（timetable_special.json は常に存在する） */
function runOct(overrides: Partial<PlanInput> & { files?: string[] }) {
  const { files: fileList = [], ...rest } = overrides
  const files = new Set([...fileList, 'timetable_special.json'])
  return buildPlan({
    decisions: [],
    intermediates: new Map(),
    state: { version: 1 },
    liveOverrides: {},
    holidays: [],
    today: OCT_TODAY,
    runAt: OCT_RUN_AT,
    extractionHealthy: true,
    readTimetable: (fileName) => (files.has(fileName) ? eventTimetable(fileName.replace(/\.json$/, '')) : null),
    timetableExists: (fileName) => files.has(fileName),
    ...rest,
  })
}

/** 前回 Bot が張った event override を managed と calendar_rules.json の両方に持つ state */
function withManagedEvents(state: State, dates: string[]): { state: State; liveOverrides: Record<string, string> } {
  const event = Object.fromEntries(dates.map((d) => [d, idOf(d)]))
  return {
    state: { ...state, managed_overrides: { special: {}, event, vacation: {}, holiday: {} } },
    liveOverrides: { ...event },
  }
}

// ---------------------------------------------------------------------------
// FR-4【v1.16】: 先頭日付が変わった掲示を、同じ画像 URL の旧キーから引き継ぐ
// ---------------------------------------------------------------------------

describe('event の state キー移行（同じ画像で先頭日付が変わった掲示）', () => {
  const DATES = ['2026-10-03', '2026-10-10', '2026-10-31']

  it('旧キーから引き継いで増えた日を複製し、旧キーは外すが旧ファイルは撤去しない（OCR しない）', async () => {
    // 前回は 10/31 しか読めておらず、キー 2026-10-31 で記録されていた（2026-10-03 の事象）
    const base = withManagedEvents(
      { version: 1, events: { '2026-10-31': octEventEntry(KOUKAI_URL, ['2026-10-31'], '公開講座') } },
      ['2026-10-31'],
    )
    const link = octEventLink(KOUKAI_URL, DATES, '公開講座')
    const detected = await detectChanges([link], base.state, OCT_TODAY)

    // 同じ画像 URL の旧キーを見つけ、メタ変更扱い（OCR なし）になる
    expect(detected.decisions).toHaveLength(1)
    const decision = detected.decisions[0]!
    expect(decision.key).toBe('event:2026-10-03')
    expect(decision.action).toBe('meta_only')
    expect(decision.stateKeys).toEqual(['2026-10-31'])

    const planned = runOct({
      decisions: detected.decisions,
      state: base.state,
      liveOverrides: base.liveOverrides,
      presentUrls: new Set([KOUKAI_URL]),
      files: ['timetable_event_20261031.json'],
    })

    // 10/03・10/10 を 10/31 の複製で作る（id だけ書き換え）
    const created = planned.filePlans.filter((p) => p.op === 'create')
    expect(created.map((p) => p.fileName).sort()).toEqual(['timetable_event_20261003.json', 'timetable_event_20261010.json'])
    for (const plan of created) {
      expect(plan.timetable!.id).toBe(plan.fileName.replace(/\.json$/, ''))
      expect(plan.timetable!.routes.station_to_campus.schedule).toEqual(
        eventTimetable('timetable_event_20261031').routes.station_to_campus.schedule,
      )
    }

    // state は新キーだけ。旧キーの processed_at を引き継ぐ
    expect(Object.keys(planned.nextState.events!)).toEqual(['2026-10-03'])
    const entry = planned.nextState.events!['2026-10-03']!
    expect(entry.dates).toEqual(DATES)
    expect(entry.derived).toEqual(DATES.map(idOf))
    expect(entry.processed_at).toBe(OLD_PROCESSED_AT)
    expect(entry.url).toBe(KOUKAI_URL)
    expect(entry.sha256).toBe('sha-old')

    // 旧ファイル 20261031 は新しい項目も使うので撤去しない
    expect(planned.filePlans.filter((p) => p.op === 'delete')).toEqual([])
    expect(planned.calendar.deletions).not.toContain('timetable_event_20261031.json')
    for (const date of DATES) expect(planned.calendar.nextOverrides[date], date).toBe(idOf(date))
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_link_missing')
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_removed')
    expect(planned.failedEvents).toEqual([])
  })

  it('移行する回に取り込みに失敗しても、旧キーは「掲示にある」と数えて撤去しない', () => {
    // 旧キーはあと 1 回で撤去される状態。掲示にあると数えないと、この回で撤去されてしまう
    const base = withManagedEvents(
      {
        version: 1,
        events: {
          '2026-10-31': octEventEntry(KOUKAI_URL, ['2026-10-31'], '公開講座', {
            missing_count: CONFIG.eventMissingRunsBeforeRemoval - 1,
          }),
        },
      },
      ['2026-10-31'],
    )
    const link = octEventLink(KOUKAI_URL, DATES, '公開講座')
    const planned = runOct({
      decisions: [ocrEventDecision(link, { stateKeys: ['2026-10-31'] })],
      ocrFailures: new Map([['event:2026-10-03', 'OCR に失敗しました']]),
      state: base.state,
      liveOverrides: base.liveOverrides,
      presentUrls: new Set([KOUKAI_URL]),
      files: ['timetable_event_20261031.json'],
    })

    // 旧キーは残り、連続回数は進まない（掲示にあるので消える）
    expect(Object.keys(planned.nextState.events!)).toEqual(['2026-10-31'])
    const entry = planned.nextState.events!['2026-10-31']!
    expect(entry.missing_count).toBeUndefined()
    expect(entry.derived).toEqual(['timetable_event_20261031'])
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_link_missing')
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_removed')
    expect(planned.calendar.deletions).toEqual([])
    expect(planned.filePlans.filter((p) => p.op === 'delete')).toEqual([])
    // 取り込めなかった掲示の日は特別ダイヤ（旧ファイルは残したまま override で隠す）
    for (const date of DATES) expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
  })
})

// ---------------------------------------------------------------------------
// FR-9【v1.16】: 掲示はあるのに取り込めなかったイベント日を特別ダイヤにする
// ---------------------------------------------------------------------------

describe('取り込めなかったイベント日の特別ダイヤ（FR-9 v1.16）', () => {
  const PHARM_DATES = ['2026-10-11', '2026-10-12']
  const pharmLink = () => octEventLink(PHARM_URL, PHARM_DATES, '薬学ワークショップ')

  it('OCR に回したのに成功しなかった掲示の今日以降の日付を timetable_special にし、warn で知らせる', () => {
    const planned = runOct({
      decisions: [ocrEventDecision(pharmLink())],
      ocrFailures: new Map([['event:2026-10-11', 'OCR の呼び出し上限に達しました']]),
      presentUrls: new Set([PHARM_URL]),
    })

    for (const date of PHARM_DATES) {
      expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
      expect(planned.calendar.managed.special[date], date).toBe('timetable_special')
    }
    expect(planned.failedEvents).toHaveLength(1)
    expect(planned.failedEvents[0]).toMatchObject({
      key: 'event:2026-10-11',
      url: PHARM_URL,
      dates: PHARM_DATES,
      specialDates: PHARM_DATES,
      retry: true,
      reason: 'OCR の呼び出し上限に達しました',
    })
    expect(planned.warnings).toContainEqual(
      expect.objectContaining({ code: 'event_failed_special', level: 'warn', url: PHARM_URL }),
    )
    // state には保存しない（毎回の決定から求め直す）
    expect(planned.nextState.events ?? {}).toEqual({})
    expect(planned.filePlans).toEqual([])
  })

  it('前に取り込んだ event 項目がある日でも、取り込めなかった回は special が勝つ（ファイルと state は消さない）', () => {
    const base = withManagedEvents(
      { version: 1, events: { '2026-10-11': octEventEntry(PHARM_URL, PHARM_DATES, '薬学ワークショップ') } },
      PHARM_DATES,
    )
    const planned = runOct({
      // 同じ URL のまま画像が差し替わり、読み直しに失敗した
      decisions: [ocrEventDecision(pharmLink(), { stateKeys: ['2026-10-11'] })],
      ocrFailures: new Map([['event:2026-10-11', 'OCR に失敗しました']]),
      state: base.state,
      liveOverrides: base.liveOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_DATES.map((d) => `${idOf(d)}.json`),
    })

    for (const date of PHARM_DATES) expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
    expect(planned.calendar.managed.event).toEqual({})
    // 前の取り込み結果は state・ファイルとも残す（成功すれば戻る）
    expect(planned.nextState.events!['2026-10-11']).toMatchObject({ sha256: 'sha-old', derived: PHARM_DATES.map(idOf) })
    expect(planned.calendar.deletions).toEqual([])
    expect(planned.filePlans.filter((p) => p.op === 'delete')).toEqual([])
  })

  it('手動 override のある日は特別ダイヤにせず、info で知らせる', () => {
    const planned = runOct({
      decisions: [ocrEventDecision(pharmLink())],
      ocrFailures: new Map([['event:2026-10-11', 'OCR に失敗しました']]),
      // 10/11 は人が書いた override（管理外）
      liveOverrides: { '2026-10-11': 'timetable_weekday' },
      presentUrls: new Set([PHARM_URL]),
    })

    expect(planned.calendar.nextOverrides['2026-10-11']).toBe('timetable_weekday')
    expect(planned.calendar.nextOverrides['2026-10-12']).toBe('timetable_special')
    expect(planned.failedEvents[0]!.specialDates).toEqual(['2026-10-12'])
    const info = planned.warnings.find((w) => w.code === 'event_failed_manual_kept')
    expect(info).toMatchObject({ level: 'info', url: PHARM_URL })
    expect(info!.message).toContain('2026-10-11')
    // warn は実際に特別ダイヤにした日だけを載せる（手動の日を誤報しない）
    const warn = planned.warnings.find((w) => w.code === 'event_failed_special')!
    expect(warn.message).toContain('2026-10-12')
    expect(warn.message).not.toContain('2026-10-11')
  })

  it('適用日がすべて過去の掲示（failure の無い skip）は対象にしない', async () => {
    const link = octEventLink(PHARM_URL, ['2026-09-26', '2026-09-27'], '薬学ワークショップ')
    const detected = await detectChanges([link], { version: 1 }, OCT_TODAY)
    expect(detected.decisions[0]).toMatchObject({ action: 'skip' })
    expect(detected.decisions[0]!.failure).toBeUndefined()

    const planned = runOct({ decisions: detected.decisions, presentUrls: new Set([PHARM_URL]) })
    expect(planned.failedEvents).toEqual([])
    expect(planned.calendar.managed.special).toEqual({})
    expect(planned.warnings.map((w) => w.code)).not.toContain('event_failed_special')
  })

  it('一部の日付が過去の掲示は、今日以降の日付だけを特別ダイヤにする', () => {
    const link = octEventLink(PHARM_URL, ['2026-10-02', '2026-10-03'], '薬学ワークショップ')
    const planned = runOct({
      decisions: [ocrEventDecision(link)],
      ocrFailures: new Map([['event:2026-10-02', 'OCR に失敗しました']]),
      presentUrls: new Set([PHARM_URL]),
    })
    expect(planned.failedEvents[0]!.dates).toEqual(['2026-10-03'])
    expect(planned.calendar.nextOverrides['2026-10-02']).toBeUndefined()
    expect(planned.calendar.nextOverrides['2026-10-03']).toBe('timetable_special')
  })

  it('画像を取得できなかった skip（failure 付き）も対象にする', () => {
    const link = pharmLink()
    const planned = runOct({
      decisions: [
        {
          key: 'event:2026-10-11',
          link,
          action: 'skip',
          reason: '画像を取得できませんでした（HTTP 503）',
          failure: { code: 'fetch_failed', retry: true },
          effectiveDates: PHARM_DATES,
        },
      ],
      presentUrls: new Set([PHARM_URL]),
    })
    for (const date of PHARM_DATES) expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
    expect(planned.failedEvents[0]).toMatchObject({ retry: true, reason: '画像を取得できませんでした（HTTP 503）' })
  })

  it('翌日に取り込みに成功したら特別ダイヤを解除してイベントダイヤに置き換える', () => {
    const first = runOct({
      decisions: [ocrEventDecision(pharmLink())],
      ocrFailures: new Map([['event:2026-10-11', 'OCR に失敗しました']]),
      presentUrls: new Set([PHARM_URL]),
    })
    expect(first.calendar.managed.special).toEqual({
      '2026-10-11': 'timetable_special',
      '2026-10-12': 'timetable_special',
    })

    // 前回の結果（state と calendar_rules.json）から再実行し、今回は読めた
    const second = runOct({
      decisions: [ocrEventDecision(pharmLink())],
      intermediates: new Map([['event:2026-10-11', eventIntermediate('薬学ワークショップ')]]),
      state: first.nextState,
      liveOverrides: first.calendar.nextOverrides,
      presentUrls: new Set([PHARM_URL]),
    })
    for (const date of PHARM_DATES) {
      expect(second.calendar.nextOverrides[date], date).toBe(idOf(date))
      expect(second.calendar.managed.event[date], date).toBe(idOf(date))
    }
    expect(second.calendar.managed.special).toEqual({})
    expect(second.failedEvents).toEqual([])
    expect(second.warnings.map((w) => w.code)).not.toContain('event_failed_special')
    expect(second.filePlans.map((p) => p.fileName).sort()).toEqual(PHARM_DATES.map((d) => `${idOf(d)}.json`))
  })
})

// ---------------------------------------------------------------------------
// FR-7【v1.16】: 画像の内容を理由に拒否した event の記録（同じ内容の間は読み直さない）
// ---------------------------------------------------------------------------

describe('内容を理由に拒否した画像の記録（rejected_images）', () => {
  const PHARM_DATES = ['2026-10-11', '2026-10-12']
  const pharmLink = () => octEventLink(PHARM_URL, PHARM_DATES, '薬学ワークショップ')

  /** 日付ごとの別表が 2 つある画像の OCR 結果（10/11・12 の実例） */
  function multiTableIntermediate(): Intermediate {
    const rows = [
      { hour: 8, minutes: [0] },
      { hour: 9, minutes: [0] },
    ]
    return {
      day_types: [
        { label: '10月11日（日）', matsunaga: rows, university: rows },
        { label: '10月12日（月・祝）', matsunaga: rows, university: rows },
      ],
    }
  }

  const prevRecord: RejectedImage = {
    sha256: 'sha-multi',
    reason_code: 'multi_table',
    reason: 'イベントダイヤ画像からは1種別を期待しますが 2 件でした',
    etag: '"e1"',
    checked_at: '2026-10-01',
  }

  it('2 表の画像を拒否したら sha と理由コードを記録し、再試行しない失敗として特別ダイヤにする', () => {
    const planned = runOct({
      decisions: [
        ocrEventDecision(pharmLink(), {
          sha256: 'sha-multi',
          check: { etag: '"e1"', last_modified: 'Thu, 01 Oct 2026 00:00:00 GMT', checked_at: OCT_TODAY },
        }),
      ],
      intermediates: new Map([['event:2026-10-11', multiTableIntermediate()]]),
      presentUrls: new Set([PHARM_URL]),
    })

    expect(planned.nextState.rejected_images).toEqual({
      [PHARM_URL]: {
        sha256: 'sha-multi',
        reason_code: 'multi_table',
        reason: expect.stringContaining('1種別を期待しますが 2 件'),
        etag: '"e1"',
        last_modified: 'Thu, 01 Oct 2026 00:00:00 GMT',
        checked_at: OCT_TODAY,
      },
    })
    expect(planned.failedEvents).toHaveLength(1)
    expect(planned.failedEvents[0]!.retry).toBe(false)
    for (const date of PHARM_DATES) expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
    expect(planned.validationFailures.some((f) => f.startsWith('event:2026-10-11'))).toBe(true)
    const warn = planned.warnings.find((w) => w.code === 'event_failed_special')!
    expect(warn.message).toContain('画像の内容が変わるまで読み直しません')
  })

  it('特殊便の注記（irregular_notes）で拒否したときも理由コードを記録する', () => {
    const intermediate = eventIntermediate('薬学ワークショップ')
    intermediate.day_types[0]!.irregular_notes = true
    const planned = runOct({
      decisions: [ocrEventDecision(pharmLink(), { sha256: 'sha-notes' })],
      intermediates: new Map([['event:2026-10-11', intermediate]]),
      presentUrls: new Set([PHARM_URL]),
    })
    expect(planned.nextState.rejected_images![PHARM_URL]).toMatchObject({
      sha256: 'sha-notes',
      reason_code: 'irregular_notes',
    })
    expect(planned.failedEvents[0]!.retry).toBe(false)
    expect(planned.filePlans).toEqual([])
  })

  it('掲示から消えた URL（presentUrls に無い）の記録は捨てる', () => {
    const planned = runOct({
      state: { version: 1, rejected_images: { [PHARM_URL]: prevRecord } },
      presentUrls: new Set([KOUKAI_URL]),
    })
    expect(planned.nextState.rejected_images).toBeUndefined()
  })

  it('掲示に残っていれば、今回の決定が無くても（取得できなかった等）前回の記録を残す', () => {
    const planned = runOct({
      state: { version: 1, rejected_images: { [PHARM_URL]: prevRecord } },
      presentUrls: new Set([PHARM_URL]),
    })
    expect(planned.nextState.rejected_images).toEqual({ [PHARM_URL]: prevRecord })
  })

  it('拒否済みと同じ内容だった skip の決定で、検証子と確認日を更新して特別ダイヤを続ける', () => {
    const planned = runOct({
      decisions: [
        {
          key: 'event:2026-10-11',
          link: pharmLink(),
          action: 'skip',
          reason: '以前に取り込みを見送った画像と同じ内容です。読み直しません。',
          sha256: 'sha-multi',
          imageUrl: PHARM_URL,
          check: { etag: '"e2"', checked_at: OCT_TODAY },
          failure: { code: 'rejected', retry: false },
          effectiveDates: PHARM_DATES,
        },
      ],
      state: { version: 1, rejected_images: { [PHARM_URL]: prevRecord } },
      presentUrls: new Set([PHARM_URL]),
    })

    expect(planned.nextState.rejected_images![PHARM_URL]).toEqual({ ...prevRecord, etag: '"e2"', checked_at: OCT_TODAY })
    expect(planned.failedEvents[0]!.retry).toBe(false)
    for (const date of PHARM_DATES) expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
  })

  it('差し替わった画像を取り込めたら記録を消す', () => {
    const planned = runOct({
      decisions: [ocrEventDecision(pharmLink(), { sha256: 'sha-fixed' })],
      intermediates: new Map([['event:2026-10-11', eventIntermediate('薬学ワークショップ')]]),
      state: { version: 1, rejected_images: { [PHARM_URL]: prevRecord } },
      presentUrls: new Set([PHARM_URL]),
    })
    expect(planned.nextState.rejected_images).toBeUndefined()
    expect(planned.failedEvents).toEqual([])
    expect(planned.calendar.nextOverrides['2026-10-11']).toBe('timetable_event_20261011')
  })
})

// ---------------------------------------------------------------------------
// FR-4【v1.16】: 同じ URL のまま差し替わった画像を取り込めなかった event の pending_sha256。
// sha256 は前回取り込めた画像のまま残すので、記録が無いと翌日の再確認が失敗した回に
// 「変化なし」と扱われ、特別ダイヤが外れて差し替え前の古い時刻に戻ってしまう。
// ---------------------------------------------------------------------------

describe('差し替わった画像を取り込めなかった event（pending_sha256）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const PHARM_DATES = ['2026-10-11', '2026-10-12']
  const pharmLink = () => octEventLink(PHARM_URL, PHARM_DATES, '薬学ワークショップ')
  const PHARM_FILES = PHARM_DATES.map((d) => `${idOf(d)}.json`)

  /** 前回取り込めた（sha-old）event 項目と、その override を持つ state */
  const base = () =>
    withManagedEvents(
      {
        version: 1,
        events: { '2026-10-11': octEventEntry(PHARM_URL, PHARM_DATES, '薬学ワークショップ', { etag: '"v1"' }) },
      },
      PHARM_DATES,
    )

  /** 日付ごとの別表が 2 つある画像の OCR 結果（内容による拒否 multi_table になる） */
  function multiTableIntermediate(): Intermediate {
    const rows = [
      { hour: 8, minutes: [0] },
      { hour: 9, minutes: [0] },
    ]
    return {
      day_types: [
        { label: '10月11日（日）', matsunaga: rows, university: rows },
        { label: '10月12日（月・祝）', matsunaga: rows, university: rows },
      ],
    }
  }

  /** fetch のスタブ（detectChanges が実ネットワークへ出ないようにする） */
  function stubFetch(response: () => Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    )
  }

  it('同じ URL の既存項目があり OCR に失敗したら、項目に pending_sha256 を記録する（sha256 は旧のまま）', () => {
    const { state, liveOverrides } = base()
    const planned = runOct({
      decisions: [ocrEventDecision(pharmLink(), { stateKeys: ['2026-10-11'], sha256: 'sha-new' })],
      ocrFailures: new Map([['event:2026-10-11', 'OCR に失敗しました']]),
      state,
      liveOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_FILES,
    })

    const entry = planned.nextState.events!['2026-10-11']!
    expect(entry.pending_sha256).toBe('sha-new')
    expect(entry.sha256).toBe('sha-old')
    expect(entry.derived).toEqual(PHARM_DATES.map(idOf))
    for (const date of PHARM_DATES) {
      expect(planned.calendar.nextOverrides[date], date).toBe('timetable_special')
      expect(planned.calendar.managed.special[date], date).toBe('timetable_special')
    }
  })

  it('既存項目が無い（新規）event の失敗では pending を作らない', () => {
    const planned = runOct({
      decisions: [ocrEventDecision(pharmLink(), { sha256: 'sha-new' })],
      ocrFailures: new Map([['event:2026-10-11', 'OCR に失敗しました']]),
      presentUrls: new Set([PHARM_URL]),
    })
    expect(planned.nextState.events ?? {}).toEqual({})
  })

  it('拒否した翌日に再確認が失敗しても特別ダイヤを続け、拒否記録と pending を保つ。読めた回に pending が消える', async () => {
    // 1 日目: 差し替わった画像を読んだら 2 表で拒否（multi_table）
    const day1Base = base()
    const day1 = runOct({
      decisions: [ocrEventDecision(pharmLink(), { stateKeys: ['2026-10-11'], sha256: 'sha-multi', check: { etag: '"v2"', checked_at: OCT_TODAY } })],
      intermediates: new Map([['event:2026-10-11', multiTableIntermediate()]]),
      state: day1Base.state,
      liveOverrides: day1Base.liveOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_FILES,
    })
    expect(day1.nextState.events!['2026-10-11']).toMatchObject({ sha256: 'sha-old', pending_sha256: 'sha-multi' })
    expect(day1.nextState.rejected_images![PHARM_URL]).toMatchObject({ sha256: 'sha-multi', reason_code: 'multi_table' })

    // 2 日目: pending があるので再確認するが、取得に失敗した（detectChanges を実際に通す）
    const DAY2 = '2026-10-04'
    stubFetch(() => new Response('oops', { status: 500 }))
    const detected = await detectChanges([pharmLink()], day1.nextState, DAY2)
    expect(detected.decisions[0]).toMatchObject({ action: 'skip', failure: { code: 'fetch_failed', retry: true } })

    const day2 = runOct({
      decisions: detected.decisions,
      state: day1.nextState,
      liveOverrides: day1.calendar.nextOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_FILES,
      today: DAY2,
      runAt: '2026-10-04T07:00:00+09:00',
    })
    // 差し替え前の古い時刻（timetable_event_*）に戻さない
    for (const date of PHARM_DATES) expect(day2.calendar.nextOverrides[date], date).toBe('timetable_special')
    expect(day2.calendar.managed.event).toEqual({})
    expect(day2.failedEvents).toHaveLength(1)
    // 今回は取得失敗（fetch_failed）だが、拒否記録があるので回復後も内容が変わるまで読み直さない。
    // 通知文が「翌日以降に再試行」と誤って案内しないよう retry は false
    expect(day2.failedEvents[0]!.retry).toBe(false)
    // 拒否記録・pending・前回の取り込み結果はそのまま
    expect(day2.nextState.rejected_images).toEqual(day1.nextState.rejected_images)
    expect(day2.nextState.events!['2026-10-11']).toMatchObject({ sha256: 'sha-old', pending_sha256: 'sha-multi' })
    expect(day2.filePlans).toEqual([])

    // 3 日目: 大学が画像を直し、読めた
    const DAY3 = '2026-10-05'
    const day3 = runOct({
      decisions: [ocrEventDecision(pharmLink(), { stateKeys: ['2026-10-11'], sha256: 'sha-fixed', check: { checked_at: DAY3 } })],
      intermediates: new Map([['event:2026-10-11', eventIntermediate('薬学ワークショップ')]]),
      state: day2.nextState,
      liveOverrides: day2.calendar.nextOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_FILES,
      today: DAY3,
      runAt: '2026-10-05T07:00:00+09:00',
    })
    const entry = day3.nextState.events!['2026-10-11']!
    expect(entry.pending_sha256).toBeUndefined()
    expect(entry.sha256).toBe('sha-fixed')
    expect(day3.nextState.rejected_images).toBeUndefined()
    for (const date of PHARM_DATES) expect(day3.calendar.nextOverrides[date], date).toBe(idOf(date))
    expect(day3.failedEvents).toEqual([])
  })

  it('元の内容のまま（304）と確認できた回も pending が消え、イベントダイヤに戻る', async () => {
    const day1Base = base()
    const day1 = runOct({
      decisions: [ocrEventDecision(pharmLink(), { stateKeys: ['2026-10-11'], sha256: 'sha-new' })],
      ocrFailures: new Map([['event:2026-10-11', 'OCR に失敗しました']]),
      state: day1Base.state,
      liveOverrides: day1Base.liveOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_FILES,
    })
    expect(day1.nextState.events!['2026-10-11']!.pending_sha256).toBe('sha-new')

    const DAY2 = '2026-10-04'
    stubFetch(() => new Response(null, { status: 304, headers: { etag: '"v1"' } }))
    const detected = await detectChanges([pharmLink()], day1.nextState, DAY2)
    expect(detected.decisions[0]!.action).toBe('unchanged')

    const day2 = runOct({
      decisions: detected.decisions,
      state: day1.nextState,
      liveOverrides: day1.calendar.nextOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_FILES,
      today: DAY2,
      runAt: '2026-10-04T07:00:00+09:00',
    })
    const entry = day2.nextState.events!['2026-10-11']!
    expect(entry.pending_sha256).toBeUndefined()
    expect(entry.sha256).toBe('sha-old')
    for (const date of PHARM_DATES) expect(day2.calendar.nextOverrides[date], date).toBe(idOf(date))
    expect(day2.failedEvents).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// FR-4【v1.16】: 猶予で残す日・複製元・全日過去の項目のファイル
// ---------------------------------------------------------------------------

describe('猶予で残す日のファイルと複製元（removed_dates）', () => {
  const PHARM_DATES = ['2026-10-11', '2026-10-12']

  /** 前回取り込んだ 10/11・10/12 の項目と override を持つ state */
  const base = () =>
    withManagedEvents(
      { version: 1, events: { '2026-10-11': octEventEntry(PHARM_URL, PHARM_DATES, '薬学ワークショップ') } },
      PHARM_DATES,
    )

  /** 既存ファイル（eventTimetable: 08:00 / 09:00）と区別できる、3 便の OCR 結果 */
  function newContentIntermediate(): Intermediate {
    const rows = [
      { hour: 8, minutes: [10] },
      { hour: 9, minutes: [10] },
      { hour: 10, minutes: [10] },
    ]
    return { day_types: [{ label: '薬学ワークショップ', matsunaga: rows, university: rows }] }
  }

  const departures = (timetable: Timetable | undefined) =>
    timetable!.routes.station_to_campus.schedule.map((s) => s.departure)

  // 旧画像の内容のまま残すと、後で日付が増えたときにそれが複製元に選ばれ、新しい日に古い時刻を書く
  it('OCR 成功時、猶予で残す日（掲示から消えた日）のファイルも今回の画像の内容で書き直す（name は既存を保持）', () => {
    const { state, liveOverrides } = base()
    const link = octEventLink(PHARM_URL, ['2026-10-11'], '薬学ワークショップ')
    const planned = runOct({
      decisions: [ocrEventDecision(link, { stateKeys: ['2026-10-11'], sha256: 'sha-new' })],
      intermediates: new Map([['event:2026-10-11', newContentIntermediate()]]),
      state,
      liveOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: PHARM_DATES.map((d) => `${idOf(d)}.json`),
    })

    const current = planned.filePlans.find((p) => p.fileName === 'timetable_event_20261011.json')!
    const kept = planned.filePlans.find((p) => p.fileName === 'timetable_event_20261012.json')!
    expect(current.op).toBe('update')
    expect(kept).toBeDefined()
    expect(kept.op).toBe('update')
    expect(kept.timetable!.id).toBe('timetable_event_20261012')
    // 時刻は今回の画像（08:10 / 09:10 / 10:10）
    expect(departures(kept.timetable)).toEqual(['08:10', '09:10', '10:10'])
    expect(kept.timetable!.routes).toEqual(current.timetable!.routes)
    // name は既存ファイルのもの（今回の掲示のラベルで上書きしない）
    expect(kept.timetable!.name).toBe('オープンキャンパスダイヤ')
    expect(kept.prevTimetable?.name).toBe('オープンキャンパスダイヤ')
    expect(kept.counts).toEqual({ station: 3, campus: 3 })
    expect(kept.prevCounts).toEqual({ station: 2, campus: 2 })

    // 猶予中なので撤去はしない
    const entry = planned.nextState.events!['2026-10-11']!
    expect(entry.removed_dates).toEqual({ '2026-10-12': 1 })
    expect(entry.derived).toEqual(PHARM_DATES.map(idOf))
    expect(planned.calendar.nextOverrides['2026-10-12']).toBe('timetable_event_20261012')
    expect(planned.filePlans.filter((p) => p.op === 'delete')).toEqual([])
  })

  it('meta_only で日付を増やすとき、複製元は猶予中の日ではなく今回の掲示にある日のファイル', async () => {
    const { state, liveOverrides } = base()
    // 10/11 は掲示から消え（猶予）、10/13 が増えた。先頭日付が変わるので旧キー 10-11 から引き継ぐ
    const link = octEventLink(PHARM_URL, ['2026-10-12', '2026-10-13'], '薬学ワークショップ')
    const detected = await detectChanges([link], state, OCT_TODAY)
    expect(detected.decisions[0]).toMatchObject({ action: 'meta_only', stateKeys: ['2026-10-11'] })

    // 既存 derived の先頭（20261011）と今回の掲示の日（20261012）で内容を変えておく
    const files = new Set(PHARM_DATES.map((d) => `${idOf(d)}.json`))
    const readTimetable = (fileName: string): Timetable | null => {
      if (!files.has(fileName)) return null
      const tt = eventTimetable(fileName.replace(/\.json$/, ''))
      if (fileName === 'timetable_event_20261011.json') {
        tt.routes.station_to_campus.schedule = [{ departure: '07:00', note: '' }]
      }
      return tt
    }
    const planned = runOct({
      decisions: detected.decisions,
      state,
      liveOverrides,
      presentUrls: new Set([PHARM_URL]),
      files: [...files],
      readTimetable,
    })

    const created = planned.filePlans.filter((p) => p.op === 'create')
    expect(created.map((p) => p.fileName)).toEqual(['timetable_event_20261013.json'])
    expect(created[0]!.timetable!.id).toBe('timetable_event_20261013')
    // 20261012（今回の掲示の日）の複製。20261011（猶予中）の 07:00 ではない
    expect(departures(created[0]!.timetable)).toEqual(['08:00', '09:00'])
    expect(planned.nextState.events!['2026-10-12']!.removed_dates).toEqual({ '2026-10-11': 1 })
  })

  // 取り込めなかった日を特別ダイヤで隠していた項目は managed.event に載っていないため、
  // 全日が過ぎて state から落とすときに拾わないと孤児ファイルとして残り続ける
  it('全適用日が過ぎて prune される項目の derived を削除計画に載せる（managed.event に無いケース）', () => {
    const PAST = ['2026-10-01', '2026-10-02']
    const state: State = {
      version: 1,
      events: { '2026-10-01': octEventEntry(KOUKAI_URL, PAST, '公開講座') },
      managed_overrides: {
        special: Object.fromEntries(PAST.map((d) => [d, 'timetable_special'])),
        event: {},
        vacation: {},
        holiday: {},
      },
    }
    const planned = runOct({
      state,
      liveOverrides: { ...state.managed_overrides!.special },
      presentUrls: new Set([KOUKAI_URL]),
      files: PAST.map((d) => `${idOf(d)}.json`),
    })

    expect(planned.nextState.events ?? {}).toEqual({})
    expect([...planned.calendar.deletions].sort()).toEqual(PAST.map((d) => `${idOf(d)}.json`))
    for (const date of PAST) {
      expect(planned.filePlans).toContainEqual(expect.objectContaining({ op: 'delete', fileName: `${idOf(date)}.json` }))
    }
  })

  it('（対照）今日以降の日が残る項目のファイルは削除計画に載せない', () => {
    const DATES = ['2026-10-02', '2026-10-03']
    const planned = runOct({
      state: { version: 1, events: { '2026-10-02': octEventEntry(KOUKAI_URL, DATES, '公開講座') } },
      presentUrls: new Set([KOUKAI_URL]),
      files: DATES.map((d) => `${idOf(d)}.json`),
    })
    expect(planned.calendar.deletions).toEqual([])
  })
})
