/**
 * `public/push-sw.js` の便同定ロジックの回帰テスト。
 *
 * push-sw.js は「ビルドを通らない素の JS」としてそのまま配信されるため import できない。
 * ここではソースをテキストで読み、`self` / `indexedDB` / `caches` / `fetch` / `Date` を
 * 差し替えて評価し、内部関数を取り出して検証する。
 *
 * 【なぜ server/test に置くのか】
 * リポジトリ直下にはテストランナーが無い（package.json にテストスクリプトが無い）。
 * push の同定はサーバの送信判定（schedule.ts）と対になる関心事なので、
 * 通知まわりのテストが 1 か所にまとまるこちらへ置く。
 *
 * 守っている反例（2026-08-17 のレビュー由来）:
 *   - 松永発 08:10 を 10 分前で予約 → 08:00 の push で「大学発 08:20」を出さない
 *   - 同じ便を 20 分前で予約 → 07:50 の push で「松永発 08:00」を出さない
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = new URL('../../', import.meta.url)
const PUSH_SW_PATH = fileURLToPath(new URL('public/push-sw.js', REPO_ROOT))
const TIMETABLE_PATH = fileURLToPath(
  new URL('public/data/timetables/timetable_vacation_summer_weekday.json', REPO_ROOT)
)

const TIMETABLE_ID = 'timetable_vacation_summer_weekday'
const TIMETABLE = JSON.parse(readFileSync(TIMETABLE_PATH, 'utf-8')) as {
  routes: Record<string, { schedule: { departure: string }[] }>
}

/** push-sw.js が読む予約の写し（src/utils/pushMirror.ts が書く形） */
interface Mirror {
  dateKey: string
  updatedAt: number
  reminders: { route: string; departure: string; leadMinutes: number }[]
}

interface Notification {
  title: string
  body: string
  tag: string
}

interface PushSwModule {
  selectReservations: (
    mirror: Mirror | null,
    todayKey: string,
    nowMinutes: number
  ) => { route: string; departure: string; minutes: number }[]
  buildNotifications: () => Promise<Notification[]>
}

/** `new Date()`（引数なし）だけを固定時刻にする Date。getTimezoneOffset 等は本物のまま */
function fixedDateClass(isoWithOffset: string): DateConstructor {
  const fixed = new Date(isoWithOffset).getTime()
  class FixedDate extends Date {
    constructor(...args: unknown[]) {
      // 引数ありの呼び出し（new Date(ms) など）は本物の挙動をそのまま使う
      if (args.length === 0) super(fixed)
      else super(...(args as [number]))
    }
    static override now(): number {
      return fixed
    }
  }
  return FixedDate as unknown as DateConstructor
}

/** open → onsuccess → get → onsuccess を最小限だけ再現する。null なら「読めない」を表す */
function fakeIndexedDb(mirror: Mirror | null) {
  return {
    open() {
      const request: Record<string, unknown> = {
        result: {
          objectStoreNames: { contains: () => mirror !== null },
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const get: Record<string, unknown> = { result: mirror }
                void Promise.resolve().then(() => (get.onsuccess as () => void)?.())
                return get
              },
            }),
          }),
        },
      }
      void Promise.resolve().then(() => (request.onsuccess as () => void)?.())
      return request
    },
  }
}

const SOURCE = readFileSync(PUSH_SW_PATH, 'utf-8')

/**
 * push-sw.js を評価して内部関数を取り出す。
 * 引数で渡した名前はローカル束縛になり、ソース中の同名グローバル参照を上書きする。
 */
function loadPushSw(options: {
  mirror: Mirror | null
  now: string
  timetableId?: string | null
  /** 時刻表 JSON を取得できない状況（ネットワークもキャッシュも空）を作る */
  timetableMissing?: boolean
}): PushSwModule {
  const timetableId = options.timetableId === undefined ? TIMETABLE_ID : options.timetableId

  const fetchStub = (path: string) => {
    if (path.startsWith('/data/calendar_rules.json')) {
      const rules = timetableId === null ? { default_rules: {} } : { overrides: {}, default_rules: {
        '0': timetableId, '1': timetableId, '2': timetableId, '3': timetableId,
        '4': timetableId, '5': timetableId, '6': timetableId,
      } }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(rules) })
    }
    if (options.timetableMissing) return Promise.reject(new Error('offline'))
    return Promise.resolve({ ok: true, json: () => Promise.resolve(TIMETABLE) })
  }

  const cachesStub = { open: () => Promise.resolve({ match: () => Promise.resolve(undefined) }) }
  const selfStub = { addEventListener: () => undefined, registration: {}, clients: {} }

  const factory = new Function(
    'self',
    'indexedDB',
    'caches',
    'fetch',
    'Date',
    `${SOURCE}\n;return { selectReservations: selectReservations, buildNotifications: buildNotifications };`
  )
  return factory(
    selfStub,
    fakeIndexedDb(options.mirror),
    cachesStub,
    fetchStub,
    fixedDateClass(options.now)
  ) as PushSwModule
}

function mirror(reminders: Mirror['reminders'], dateKey = '2026-08-17'): Mirror {
  return { dateKey, updatedAt: 0, reminders }
}

const FALLBACK_TITLE = 'まもなく発車です'

describe('selectReservations', () => {
  const one = mirror([{ route: 'station_to_campus', departure: '08:10', leadMinutes: 10 }])

  it('通知の窓に入る予約を返す', () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    expect(sw.selectReservations(one, '2026-08-17', 8 * 60)).toEqual([
      { route: 'station_to_campus', departure: '08:10', minutes: 490 },
    ])
  })

  it('窓より前の時刻では返さない', () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    // 08:10 − 10 分 − 早側の余裕 1 分 = 07:59 が下端
    expect(sw.selectReservations(one, '2026-08-17', 7 * 60 + 58)).toEqual([])
  })

  it('窓より後の時刻では返さない', () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    // 08:10 + 遅側の余裕 3 分 = 08:13 が上端
    expect(sw.selectReservations(one, '2026-08-17', 8 * 60 + 14)).toEqual([])
  })

  it('対象日が違う写しは採用しない', () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    expect(sw.selectReservations(mirror(one.reminders, '2026-08-16'), '2026-08-17', 8 * 60)).toEqual([])
  })

  it('写しが無いときは空', () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    expect(sw.selectReservations(null, '2026-08-17', 8 * 60)).toEqual([])
  })

  it('不正な route / departure / leadMinutes は落とす', () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    const broken = mirror([
      { route: 'unknown_route', departure: '08:10', leadMinutes: 10 },
      { route: 'station_to_campus', departure: '8:10', leadMinutes: 10 },
      { route: 'station_to_campus', departure: '08:10', leadMinutes: 7 },
    ])
    expect(sw.selectReservations(broken, '2026-08-17', 8 * 60)).toEqual([])
  })

  it('複数が該当したら発車の早い順で、上限 4 件まで返す', () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    const many = mirror([
      { route: 'campus_to_station', departure: '08:20', leadMinutes: 20 },
      { route: 'station_to_campus', departure: '08:10', leadMinutes: 10 },
    ])
    expect(sw.selectReservations(many, '2026-08-17', 8 * 60).map(r => r.departure)).toEqual(['08:10', '08:20'])
  })
})

describe('buildNotifications（レビューの反例）', () => {
  it('松永発 08:10 の 10 分前予約で、08:00 の push が大学発 08:20 を出さない', async () => {
    const sw = loadPushSw({
      mirror: mirror([{ route: 'station_to_campus', departure: '08:10', leadMinutes: 10 }]),
      now: '2026-08-17T08:00:00+09:00',
    })
    const list = await sw.buildNotifications()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('08:10 発  あと 10 分')
    expect(list[0].body).toContain('松永発')
    expect(list[0].body).toContain('大学行き')
    expect(list[0].tag).toBe('departure-reminder-station_to_campus-08:10')
  })

  it('松永発 08:10 の 20 分前予約で、07:50 の push が松永発 08:00 を出さない', async () => {
    const sw = loadPushSw({
      mirror: mirror([{ route: 'station_to_campus', departure: '08:10', leadMinutes: 20 }]),
      now: '2026-08-17T07:50:00+09:00',
    })
    const list = await sw.buildNotifications()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('08:10 発  あと 20 分')
  })

  it('写しが無ければ便を断定しない', async () => {
    const sw = loadPushSw({ mirror: null, now: '2026-08-17T08:00:00+09:00' })
    const list = await sw.buildNotifications()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe(FALLBACK_TITLE)
  })

  it('当日のダイヤにその便が実在しなければ断定しない', async () => {
    const sw = loadPushSw({
      // 08:12 発はどちらのルートにも存在しない
      mirror: mirror([{ route: 'station_to_campus', departure: '08:12', leadMinutes: 10 }]),
      now: '2026-08-17T08:02:00+09:00',
    })
    const list = await sw.buildNotifications()
    expect(list[0].title).toBe(FALLBACK_TITLE)
  })

  it('運休日・特別ダイヤでは断定しない', async () => {
    for (const id of ['timetable_closed', 'timetable_special']) {
      const sw = loadPushSw({
        mirror: mirror([{ route: 'station_to_campus', departure: '08:10', leadMinutes: 10 }]),
        now: '2026-08-17T08:00:00+09:00',
        timetableId: id,
      })
      const list = await sw.buildNotifications()
      expect(list[0].title).toBe(FALLBACK_TITLE)
    }
  })

  it('時刻表を取得できなければ断定しない', async () => {
    const sw = loadPushSw({
      mirror: mirror([{ route: 'station_to_campus', departure: '08:10', leadMinutes: 10 }]),
      now: '2026-08-17T08:00:00+09:00',
      timetableMissing: true,
    })
    const list = await sw.buildNotifications()
    expect(list[0].title).toBe(FALLBACK_TITLE)
  })

  it('両ルートが同時に該当したら、それぞれ別のタグで出す', async () => {
    const sw = loadPushSw({
      mirror: mirror([
        { route: 'station_to_campus', departure: '08:10', leadMinutes: 10 },
        { route: 'campus_to_station', departure: '08:20', leadMinutes: 20 },
      ]),
      now: '2026-08-17T08:00:00+09:00',
    })
    const list = await sw.buildNotifications()
    expect(list.map(n => n.tag)).toEqual([
      'departure-reminder-station_to_campus-08:10',
      'departure-reminder-campus_to_station-08:20',
    ])
  })

  it('発車時刻を過ぎて届いた push で「あと -N 分」と書かない', async () => {
    const sw = loadPushSw({
      mirror: mirror([{ route: 'station_to_campus', departure: '08:10', leadMinutes: 10 }]),
      now: '2026-08-17T08:12:00+09:00',
    })
    const list = await sw.buildNotifications()
    expect(list[0].title).toBe('08:10 発  まもなく発車です')
  })
})
