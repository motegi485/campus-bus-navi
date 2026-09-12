/**
 * plan.ts の新しい安全装置（Codex レビュー F-002 / F-007 / F-018 の回帰テスト）。
 * ネットワーク・書き込みには一切触れない。
 */

import { describe, it, expect } from 'vitest'
import { applySpecials, buildPlan, reconcileEvents, type PlanInput } from '../src/plan.js'
import { detectChanges, type ChangeDecision } from '../src/detectChanges.js'
import { CONFIG } from '../src/config.js'
import { eachDate } from '../src/time.js'
import type { ClassifiedLink, Intermediate, State, Timetable, Warning } from '../src/types.js'

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
  async function run(stateDates: string[], pageDates: string[], existingFiles: string[]) {
    const state = stateWithEvent(stateDates, stateDates.map((d) => `timetable_event_${d.replace(/-/g, '')}`))
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

  it('適用日から外れた日のファイルは削除計画に載る', async () => {
    const { planned } = await run(
      ['2026-08-23', '2026-08-24'],
      ['2026-08-23'],
      ['timetable_event_20260823.json', 'timetable_event_20260824.json'],
    )
    expect(planned.calendar.deletions).toContain('timetable_event_20260824.json')
    expect(planned.calendar.nextOverrides['2026-08-24']).toBeUndefined()
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
