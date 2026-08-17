/**
 * plan.ts の新しい安全装置（Codex レビュー F-002 / F-007 / F-018 の回帰テスト）。
 * ネットワーク・書き込みには一切触れない。
 */

import { describe, it, expect } from 'vitest'
import { applySpecials, buildPlan, reconcileEvents } from '../src/plan.js'
import { detectChanges } from '../src/detectChanges.js'
import { CONFIG } from '../src/config.js'
import type { ClassifiedLink, State, Timetable, Warning } from '../src/types.js'

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
