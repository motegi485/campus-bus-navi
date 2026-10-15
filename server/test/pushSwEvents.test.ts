import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8')
const MIRROR_KEY = 'current'
const LEDGER_KEY = 'displayed-reminders'
const DATE_KEY = '2026-08-17'
const STATION_TAG = 'departure-reminder-station_to_campus-08:10'

interface Reservation { route: string; departure: string; leadMinutes: number }
interface DisplayOptions { tag: string; renotify?: boolean; silent?: boolean }

function storage(reminders: Reservation[]) {
  return new Map<string, unknown>([[MIRROR_KEY, { dateKey: DATE_KEY, reminders }]])
}

function load(options: {
  data: Map<string, unknown>
  now?: string
  openFails?: boolean
  ledgerWriteFails?: boolean
  show?: (title: string, options: DisplayOptions) => Promise<void>
}) {
  let nowMs = Date.parse(options.now ?? `${DATE_KEY}T08:00:00+09:00`)
  class FixedDate extends Date {
    constructor(value?: number) { super(value === undefined ? nowMs : value) }
    static override now() { return nowMs }
  }
  const show = vi.fn(options.show ?? (async () => undefined))
  const listeners = new Map<string, (event: { waitUntil: (promise: Promise<unknown>) => void }) => void>()
  const self = {
    addEventListener: (name: string, listener: (event: { waitUntil: (promise: Promise<unknown>) => void }) => void) => listeners.set(name, listener),
    registration: { showNotification: show },
    clients: {},
  }
  const indexedDb = {
    open() {
      if (options.openFails) throw new Error('IndexedDB unavailable')
      const db = {
        close: () => undefined,
        objectStoreNames: { contains: () => true },
        transaction() {
          const tx: { objectStore: () => unknown; oncomplete?: () => void; onabort?: () => void } = {
            objectStore: () => ({
              get(key: string) {
                const get: { result: unknown; onsuccess?: () => void } = { result: options.data.get(key) }
                queueMicrotask(() => get.onsuccess?.())
                return get
              },
              put(value: unknown, key: string) {
                if (options.ledgerWriteFails && key === LEDGER_KEY) throw new Error('quota exceeded')
                options.data.set(key, structuredClone(value))
                queueMicrotask(() => tx.oncomplete?.())
              },
            }),
          }
          return tx
        },
      }
      const request: { result: typeof db; onsuccess?: () => void } = { result: db }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
  const schedule = ['08:10', '08:11', '08:12', '08:13', '08:14', '08:15', '08:20'].map(departure => ({ departure }))
  const timetable = {
    routes: {
      station_to_campus: { origin: '松永', destination: '大学', schedule },
      campus_to_station: { origin: '大学', destination: '松永', schedule },
    },
  }
  const fetch = async (path: string) => ({
    ok: true,
    json: async () => path.includes('calendar_rules')
      ? { overrides: { [DATE_KEY]: 'timetable_weekday' } }
      : timetable,
  })
  const factory = new Function('self', 'indexedDB', 'caches', 'fetch', 'Date', SOURCE)
  factory(self, indexedDb, {}, fetch, FixedDate)
  return {
    show,
    setNow: (iso: string) => { nowMs = Date.parse(iso) },
    push() {
      let lifetime: Promise<unknown> | undefined
      listeners.get('push')!({ waitUntil: promise => { lifetime = promise } })
      return lifetime!
    },
  }
}

const reservation = (departure = '08:10'): Reservation => ({
  route: 'station_to_campus', departure, leadMinutes: 20,
})

describe('push イベントの表示履歴', () => {
  it('重なる次の便の push で、前の便は静かに更新し新しい便だけ再通知する', async () => {
    const data = storage([reservation(), { route: 'campus_to_station', departure: '08:20', leadMinutes: 20 }])
    const sw = load({ data, now: `${DATE_KEY}T07:50:00+09:00` })
    await sw.push()
    expect(sw.show).toHaveBeenCalledOnce()
    expect(sw.show.mock.calls[0][1]).toMatchObject({ tag: STATION_TAG, renotify: true })

    sw.setNow(`${DATE_KEY}T08:00:00+09:00`)
    await sw.push()
    expect(sw.show.mock.calls[1][1]).toMatchObject({ tag: 'departure-reminder-campus_to_station-08:20', renotify: true })
    expect(sw.show.mock.calls[2][1]).toMatchObject({ tag: STATION_TAG, renotify: false, silent: true })
    expect(data.get(LEDGER_KEY)).toEqual({ dateKey: DATE_KEY, tags: [STATION_TAG, 'departure-reminder-campus_to_station-08:20'] })
  })

  it('同時に届いた push を直列化し、同じ便を二度鳴らさない', async () => {
    const sw = load({ data: storage([reservation()]) })
    await Promise.all([sw.push(), sw.push()])
    expect(sw.show.mock.calls.map(call => call[1].renotify)).toEqual([true, false])
    // 重複イベントでも showNotification を呼び userVisibleOnly を満たす。
    expect(sw.show.mock.calls[1][1].silent).toBe(true)
  })

  it('SW が再起動しても台帳を復元し、ミラー再保存から独立する', async () => {
    const data = storage([reservation()])
    await load({ data }).push()
    data.set(MIRROR_KEY, { dateKey: DATE_KEY, reminders: [reservation()] })
    const restarted = load({ data })
    await restarted.push()
    expect(restarted.show.mock.calls[0][1]).toMatchObject({ tag: STATION_TAG, renotify: false, silent: true })
  })

  it('前日の台帳で当日の同じ便を抑制せず、保存時に古い日を置き換える', async () => {
    const data = storage([reservation()])
    data.set(LEDGER_KEY, { dateKey: '2026-08-16', tags: [STATION_TAG] })
    const sw = load({ data })
    await sw.push()
    expect(sw.show.mock.calls[0][1].renotify).toBe(true)
    expect(data.get(LEDGER_KEY)).toEqual({ dateKey: DATE_KEY, tags: [STATION_TAG] })
  })

  it('上限 4 件の後ろにある未表示便を次の push で優先する', async () => {
    const sw = load({ data: storage(['08:10', '08:11', '08:12', '08:13', '08:14', '08:15'].map(time => reservation(time))) })
    await sw.push()
    expect(sw.show).toHaveBeenCalledTimes(4)
    await sw.push()
    expect(sw.show).toHaveBeenCalledTimes(8)
    expect(sw.show.mock.calls.slice(4, 6).map(call => call[1])).toEqual([
      expect.objectContaining({ tag: 'departure-reminder-station_to_campus-08:14', renotify: true }),
      expect.objectContaining({ tag: 'departure-reminder-station_to_campus-08:15', renotify: true }),
    ])
  })

  it('IDB 書込みが失敗しても通知し、同じ SW ではメモリで再通知を抑える', async () => {
    const sw = load({ data: storage([reservation()]), ledgerWriteFails: true })
    await sw.push()
    await sw.push()
    expect(sw.show.mock.calls.map(call => call[1].renotify)).toEqual([true, false])
  })

  it('IDB 自体が使えない場合も必ず汎用通知を表示する', async () => {
    const sw = load({ data: storage([reservation()]), openFails: true })
    await sw.push()
    expect(sw.show).toHaveBeenCalledWith('まもなく発車です', expect.objectContaining({ tag: 'departure-reminder' }))
  })

  it('表示に失敗した便を表示済みにはせず、次回は初回として再試行する', async () => {
    let attempts = 0
    const sw = load({ data: storage([reservation()]), show: async () => {
      if (++attempts === 1) throw new Error('temporary notification failure')
    } })
    await sw.push()
    expect(sw.show.mock.calls[1][0]).toBe('まもなく発車です')
    await sw.push()
    expect(sw.show.mock.calls[2][1]).toMatchObject({ tag: STATION_TAG, renotify: true })
  })

  it('最終 fallback も失敗したイベントの後に、次の push を処理できる', async () => {
    let attempts = 0
    const sw = load({ data: storage([reservation()]), show: async () => {
      if (++attempts <= 2) throw new Error('temporary notification failure')
    } })
    await expect(sw.push()).rejects.toThrow('temporary notification failure')
    await sw.push()
    expect(sw.show.mock.calls[2][1]).toMatchObject({ tag: STATION_TAG, renotify: true })
  })
})
