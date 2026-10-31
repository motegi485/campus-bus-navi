/**
 * 手置きの event ファイルの保護（§1.4-4、セキュリティ監査 2026-11-01 の L4）。
 *
 * state.events のどの derived にも記録の無い既存の timetable_event_YYYYMMDD.json は、人が置いたもの。
 * Bot はそれを OCR 結果で上書きせず、state にも取り込まず、適用日を過ぎても削除しない。
 * ネットワークには出ない（checked_at=TODAY と fetch のスタブを使う）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPlan } from '../src/plan.js'
import { detectChanges, type ChangeDecision } from '../src/detectChanges.js'
import { botOwnedEventIds, isManualEventDate } from '../src/calendar.js'
import type { ClassifiedLink, Intermediate, State, Timetable } from '../src/types.js'

const TODAY = '2026-08-01'
const RUN_AT = '2026-08-01T07:00:00+09:00'
const URL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0823.jpg'

function tt(id: string, first = '08:00'): Timetable {
  const route = (origin: string) => ({
    origin,
    destination: 'x',
    bus_stop_name: `${origin} 乗り場`,
    bus_stop_coords: { lat: 34.4, lng: 133.2 },
    schedule: [
      { departure: first, note: '' },
      { departure: '09:00', note: '最終' },
    ],
  })
  return { id, name: '手置きダイヤ', routes: { station_to_campus: route('松永発'), campus_to_station: route('大学発') } }
}

function link(dates: string[]): ClassifiedLink {
  return { url: URL, rawHref: URL, anchorText: 'a', lineText: 'OC', normalizedLine: 'OC', kind: 'event', dates, label: 'OC' }
}

const rows = [
  { hour: 8, minutes: [30] },
  { hour: 9, minutes: [0] },
]
const inter: Intermediate = { day_types: [{ label: 'OC', matsunaga: rows, university: rows }] }

function plan(
  dates: string[],
  files: Record<string, Timetable>,
  live: Record<string, string> = {},
  state: State = { version: 1 },
) {
  const decision: ChangeDecision = {
    key: `event:${dates[0]}`,
    link: link(dates),
    action: 'ocr',
    reason: '新規',
    sha256: 'sha-new',
    imageUrl: URL,
    effectiveDates: dates,
  }
  return buildPlan({
    decisions: [decision],
    intermediates: new Map([[decision.key, inter]]),
    state,
    liveOverrides: live,
    holidays: [],
    today: TODAY,
    runAt: RUN_AT,
    presentUrls: new Set([URL]),
    readTimetable: (f) => files[f] ?? null,
    timetableExists: (f) => f in files || f === 'timetable_special.json',
  })
}

describe('手置きの event ファイル（§1.4-4）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('state に記録の無い既存ファイルは OCR 結果で上書きせず、手動 override に任せる', () => {
    const files = { 'timetable_event_20260823.json': tt('timetable_event_20260823', '07:00') }
    const p = plan(['2026-08-23'], files, { '2026-08-23': 'timetable_event_20260823' })
    expect(p.filePlans.filter((f) => f.op !== 'delete')).toEqual([])
    expect(p.nextState.events ?? {}).toEqual({})
    expect(p.calendar.nextOverrides['2026-08-23']).toBe('timetable_event_20260823')
    expect(p.warnings).toContainEqual(expect.objectContaining({ code: 'event_manual_file_kept', level: 'info' }))
    expect(p.failedEvents).toEqual([])
  })

  it('override の無い手置きファイルの日は特別ダイヤにして warn。翌日も維持する', () => {
    const files = { 'timetable_event_20260823.json': tt('timetable_event_20260823') }
    const p = plan(['2026-08-23'], files)
    expect(p.filePlans.filter((f) => f.op !== 'delete')).toEqual([])
    expect(p.calendar.nextOverrides['2026-08-23']).toBe('timetable_special')
    expect(p.warnings).toContainEqual(expect.objectContaining({ code: 'event_manual_file_unreferenced', level: 'warn' }))
    // 前回 Bot が張った special を人の override と誤認せず、付いたり外れたりしないこと
    const next = plan(['2026-08-23'], files, p.calendar.nextOverrides, p.nextState)
    expect(next.calendar.nextOverrides['2026-08-23']).toBe('timetable_special')
  })

  it('複数日の掲示では手置きの日だけを外し、他の日は作成して state に記録する', () => {
    const files = { 'timetable_event_20260824.json': tt('timetable_event_20260824', '07:00') }
    const p = plan(['2026-08-23', '2026-08-24'], files, { '2026-08-24': 'timetable_event_20260824' })
    expect(p.filePlans.map((f) => `${f.op}:${f.fileName}`)).toEqual(['create:timetable_event_20260823.json'])
    expect(p.nextState.events!['2026-08-23']).toMatchObject({
      dates: ['2026-08-23'],
      derived: ['timetable_event_20260823'],
    })
  })

  it('（対照）state の derived にあるファイルは従来どおり update する', () => {
    const files = { 'timetable_event_20260823.json': tt('timetable_event_20260823', '07:00') }
    const state: State = {
      version: 1,
      events: {
        '2026-08-23': {
          url: URL,
          sha256: 'old',
          label: 'OC',
          dates: ['2026-08-23'],
          derived: ['timetable_event_20260823'],
          processed_at: RUN_AT,
        },
      },
    }
    const p = plan(['2026-08-23'], files, {}, state)
    expect(p.filePlans.map((f) => `${f.op}:${f.fileName}`)).toEqual(['update:timetable_event_20260823.json'])
  })

  it('同じ画像で日付が増えても（meta_only）、手置きファイルの日を derived に取り込まず、過ぎても削除しない', async () => {
    const state: State = {
      version: 1,
      events: {
        '2026-08-23': {
          url: URL,
          sha256: 's',
          label: 'OC',
          dates: ['2026-08-23'],
          derived: ['timetable_event_20260823'],
          processed_at: RUN_AT,
          checked_at: TODAY,
        },
      },
      managed_overrides: { special: {}, event: { '2026-08-23': 'timetable_event_20260823' }, vacation: {}, holiday: {} },
    }
    const files: Record<string, Timetable> = {
      'timetable_event_20260823.json': tt('timetable_event_20260823'),
      'timetable_event_20260824.json': tt('timetable_event_20260824', '07:00'),
    }
    const exists = (f: string) => f in files || f === 'timetable_special.json'
    const owned = botOwnedEventIds(state)
    const detected = await detectChanges([link(['2026-08-23', '2026-08-24'])], state, TODAY, {
      isManualEventDate: (d) => isManualEventDate(d, owned, exists),
    })
    const p = buildPlan({
      decisions: detected.decisions,
      intermediates: new Map(),
      state,
      liveOverrides: { '2026-08-23': 'timetable_event_20260823', '2026-08-24': 'timetable_event_20260824' },
      holidays: [],
      today: TODAY,
      runAt: RUN_AT,
      presentUrls: new Set([URL]),
      readTimetable: (f) => files[f] ?? null,
      timetableExists: exists,
    })
    expect(p.filePlans).toEqual([])
    expect(p.nextState.events!['2026-08-23']!.derived).toEqual(['timetable_event_20260823'])
    expect(p.nextState.events!['2026-08-23']!.dates).toEqual(['2026-08-23'])
    // 適用日を過ぎた後の実行でも、手置きファイルは削除計画に載らない（Bot のファイルだけが消える）
    const later = buildPlan({
      decisions: [],
      intermediates: new Map(),
      state: p.nextState,
      liveOverrides: p.calendar.nextOverrides,
      holidays: [],
      today: '2026-08-25',
      runAt: '2026-08-25T07:00:00+09:00',
      presentUrls: new Set([URL]),
      readTimetable: () => null,
      timetableExists: exists,
    })
    expect(later.calendar.deletions).toEqual(['timetable_event_20260823.json'])
  })

  it('detectChanges: 今日以降の適用日がすべて手置きなら、画像を取得せず skip（failure なし）', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new Error('取得してはいけない'))
    vi.stubGlobal('fetch', fetchStub)
    const detected = await detectChanges([link(['2026-08-23'])], { version: 1 }, TODAY, {
      isManualEventDate: () => true,
    })
    expect(fetchStub).not.toHaveBeenCalled()
    expect(detected.decisions[0]).toMatchObject({ action: 'skip', effectiveDates: [] })
    expect(detected.decisions[0]!.failure).toBeUndefined()
  })
})
