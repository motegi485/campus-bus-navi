import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateOverrides, type CalendarInput } from '../src/calendar.js'
import type { CalendarRules, Holiday, ManagedOverrides, State } from '../src/types.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const liveRules = JSON.parse(readFileSync(path.join(FIXTURES, 'calendar_rules_live.json'), 'utf-8')) as CalendarRules

const TODAY = '2026-08-01'

/** 2026年の祝日（内閣府CSV由来の抜粋） */
const HOLIDAYS: Holiday[] = [
  { date: '2026-07-20', name: '海の日' },
  { date: '2026-08-11', name: '山の日' },
  { date: '2026-09-21', name: '敬老の日' },
  { date: '2026-09-22', name: '休日' },
  { date: '2026-09-23', name: '秋分の日' },
  { date: '2026-10-12', name: 'スポーツの日' },
]

const managed = (partial: Partial<ManagedOverrides> = {}): ManagedOverrides => ({
  event: {},
  vacation: {},
  holiday: {},
  ...partial,
})

function run(overrides: Partial<CalendarInput> = {}) {
  const input: CalendarInput = {
    liveOverrides: { ...liveRules.overrides },
    state: { version: 1 },
    holidays: HOLIDAYS,
    today: TODAY,
    timetableExists: () => true,
    ...overrides,
  }
  return calculateOverrides(input)
}

describe('テスト6: calendar（FR-9）', () => {
  it('(a) 手動キーは不可侵（過去日でも保持し、値も変えない）', () => {
    const result = run()
    // live スナップショットの手動キーがすべて残る
    for (const [date, id] of Object.entries(liveRules.overrides)) {
      expect(result.nextOverrides[date], date).toBe(id)
    }
    expect(result.nextOverrides['2026-05-02']).toBe('timetable_weekday')
    // 管理集合には入れない
    expect(Object.keys(result.managed.holiday)).not.toContain('2026-05-02')
  })

  it('(b) 優先順位: 同日に event と vacation と祝日があれば event が勝つ', () => {
    const state: State = {
      version: 1,
      events: {
        '2026-09-21': {
          url: 'u',
          sha256: 's',
          label: 'OC',
          dates: ['2026-09-21'],
          derived: ['timetable_event_20260921'],
          processed_at: 'x',
        },
      },
      vacations: {
        summer: {
          url: 'u',
          sha256: 's',
          period: { start: '2026-08-17', end: '2026-09-23' },
          derived: [],
          processed_at: 'x',
        },
      },
    }
    const result = run({ state })
    expect(result.nextOverrides['2026-09-21']).toBe('timetable_event_20260921')
    expect(result.managed.event['2026-09-21']).toBe('timetable_event_20260921')
    // 祝日である 09-22/09-23 は vacation の休日ダイヤになる（祝日 baseline より vacation が優先）
    expect(result.nextOverrides['2026-09-22']).toBe('timetable_vacation_summer_holiday')
    expect(result.nextOverrides['2026-09-23']).toBe('timetable_vacation_summer_holiday')
    // 期間内の平日は平日ダイヤ、土日は休日ダイヤ
    expect(result.nextOverrides['2026-08-18']).toBe('timetable_vacation_summer_weekday') // 火
    expect(result.nextOverrides['2026-08-22']).toBe('timetable_vacation_summer_holiday') // 土
    // 期間内の祝日（山の日 8/11）は期間外なので祝日 baseline のまま
    expect(result.nextOverrides['2026-08-11']).toBe('timetable_holiday')
  })

  it('(b2) 長期休暇期間内の平日祝日は休日ダイヤになる', () => {
    const state: State = {
      version: 1,
      vacations: {
        summer: {
          url: 'u',
          sha256: 's',
          period: { start: '2026-08-10', end: '2026-08-14' },
          derived: [],
          processed_at: 'x',
        },
      },
    }
    const result = run({ state })
    expect(result.nextOverrides['2026-08-10']).toBe('timetable_vacation_summer_weekday') // 月
    expect(result.nextOverrides['2026-08-11']).toBe('timetable_vacation_summer_holiday') // 火・山の日
    expect(result.nextOverrides['2026-08-12']).toBe('timetable_vacation_summer_weekday') // 水
  })

  it('(c) 改ざん検知: 管理キーの値が変えられていたら手動化し、Bot は元に戻さない', () => {
    const liveOverrides = { ...liveRules.overrides, '2026-10-12': 'timetable_weekday' }
    const prevManaged = managed({ holiday: { '2026-10-12': 'timetable_holiday' } })
    const result = run({ liveOverrides, prevManaged })

    expect(result.nextOverrides['2026-10-12']).toBe('timetable_weekday') // 人の値のまま
    expect(result.managed.holiday['2026-10-12']).toBeUndefined() // 管理から外れる
    expect(result.warnings.some((w) => w.code === 'managed_override_modified')).toBe(true)
  })

  it('(c2) 管理キーが人に削除されていたら再追加せず、抑止リストに記録する', () => {
    const prevManaged = managed({ holiday: { '2026-10-12': 'timetable_holiday' } })
    // live には 2026-10-12 が無い（人が削除した）
    const result = run({ prevManaged })
    expect(result.nextOverrides['2026-10-12']).toBeUndefined()
    expect(result.suppressed['2026-10-12']).toBe('timetable_holiday')
    expect(result.warnings.some((w) => w.code === 'managed_override_deleted')).toBe(true)
  })

  it('(c3) 抑止リストにある日付は次回以降も再生成しない（削除が恒久的に効く）', () => {
    // 前回の実行で抑止リストに入った状態から再実行する
    const result = run({ prevSuppressed: { '2026-10-12': 'timetable_holiday' } })
    expect(result.nextOverrides['2026-10-12']).toBeUndefined()
    expect(result.suppressed['2026-10-12']).toBe('timetable_holiday')
    // 他の祝日は通常どおり生成される
    expect(result.nextOverrides['2026-08-11']).toBe('timetable_holiday')
  })

  it('(c4) 抑止リストの過去日エントリは自動的に捨てる', () => {
    const result = run({ prevSuppressed: { '2026-05-04': 'timetable_holiday' } })
    expect(result.suppressed['2026-05-04']).toBeUndefined()
  })

  it('(c5) 抑止された日付に人が改めて override を書いたらその値が使われる', () => {
    const liveOverrides = { ...liveRules.overrides, '2026-10-12': 'timetable_weekday' }
    const result = run({ liveOverrides, prevSuppressed: { '2026-10-12': 'timetable_holiday' } })
    expect(result.nextOverrides['2026-10-12']).toBe('timetable_weekday')
  })

  it('(d) 過去日付の管理キーは消え、対応する event ファイルは削除計画に載る', () => {
    const liveOverrides = {
      ...liveRules.overrides,
      '2026-06-14': 'timetable_event_20260614',
      '2026-09-05': 'timetable_event_20260905',
    }
    const prevManaged = managed({
      event: { '2026-06-14': 'timetable_event_20260614', '2026-09-05': 'timetable_event_20260905' },
    })
    const state: State = {
      version: 1,
      events: {
        '2026-09-05': {
          url: 'u',
          sha256: 's',
          label: 'OC',
          dates: ['2026-09-05'],
          derived: ['timetable_event_20260905'],
          processed_at: 'x',
        },
      },
    }
    const result = run({ liveOverrides, prevManaged, state })

    expect(result.nextOverrides['2026-06-14']).toBeUndefined() // 過去 → 消える
    expect(result.nextOverrides['2026-09-05']).toBe('timetable_event_20260905') // 未来 → 残る
    expect(result.deletions).toEqual(['timetable_event_20260614.json'])
    expect(result.changes).toContainEqual(
      expect.objectContaining({ date: '2026-06-14', op: 'remove' }),
    )
  })

  it('(d2) state に記録の無い event ファイルは削除しない', () => {
    const result = run({ prevManaged: managed() })
    expect(result.deletions).toEqual([])
  })

  it('(e) 祝日 baseline が手動キーと同日なら スキップする', () => {
    // 2026-10-12（スポーツの日・月）を手動で timetable_weekday にしている場合
    const liveOverrides = { ...liveRules.overrides, '2026-10-12': 'timetable_weekday' }
    const result = run({ liveOverrides })
    expect(result.nextOverrides['2026-10-12']).toBe('timetable_weekday')
    expect(result.changes).toContainEqual(
      expect.objectContaining({ date: '2026-10-12', op: 'skip', id: 'timetable_holiday' }),
    )
    expect(result.warnings.some((w) => w.code === 'override_conflict_manual_wins')).toBe(true)
  })

  it('(e2) 手動キーと値が同じなら警告を出さない', () => {
    const liveOverrides = { ...liveRules.overrides, '2026-10-12': 'timetable_holiday' }
    const result = run({ liveOverrides })
    expect(result.nextOverrides['2026-10-12']).toBe('timetable_holiday')
    expect(result.warnings.some((w) => w.code === 'override_conflict_manual_wins')).toBe(false)
  })

  it('土日の祝日は override を作らない（default_rules で既に休業日ダイヤ）', () => {
    const result = run({ holidays: [{ date: '2026-08-15', name: 'テスト祝日' }] }) // 土曜
    expect(result.nextOverrides['2026-08-15']).toBeUndefined()
  })

  it('参照先の時刻表ファイルが無い管理キーは追加せず警告する', () => {
    const result = run({ timetableExists: (id) => id !== 'timetable_holiday' })
    expect(result.nextOverrides['2026-08-11']).toBeUndefined()
    expect(result.warnings.some((w) => w.code === 'override_target_missing')).toBe(true)
  })

  it('手動キーの参照先が無い場合は情報警告のみ（修正・削除はしない）', () => {
    const liveOverrides = { ...liveRules.overrides, '2026-12-01': 'timetable_spring_vac_hld_2026' }
    const result = run({ liveOverrides, timetableExists: (id) => !id.includes('vac_hld') })
    expect(result.nextOverrides['2026-12-01']).toBe('timetable_spring_vac_hld_2026') // 触らない
    expect(result.warnings.some((w) => w.code === 'manual_override_target_missing')).toBe(true)
  })

  it('終了日不明の長期休暇は override を生成せず警告する', () => {
    const state: State = {
      version: 1,
      vacations: {
        summer: { url: 'u', sha256: 's', period: { start: '2026-08-17' }, derived: [], processed_at: 'x' },
      },
    }
    const result = run({ state })
    expect(result.warnings.some((w) => w.code === 'vacation_period_unknown')).toBe(true)
    expect(Object.keys(result.managed.vacation)).toEqual([])
  })

  it('overrides は日付昇順で出力される', () => {
    const keys = Object.keys(run().nextOverrides)
    expect(keys).toEqual([...keys].sort())
  })

  it('過去日のイベントは override を作らない', () => {
    const state: State = {
      version: 1,
      events: {
        '2026-06-14': {
          url: 'u',
          sha256: 's',
          label: '簿記',
          dates: ['2026-06-14'],
          derived: ['timetable_event_20260614'],
          processed_at: 'x',
        },
      },
    }
    expect(run({ state }).nextOverrides['2026-06-14']).toBeUndefined()
  })
})
