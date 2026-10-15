import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPushMirror, writePushMirror } from '../../src/utils/pushMirror'

/** DBを開く応答を保留し、保存直後の通知オフが追い越されないことを調べる。 */
function deferredDatabase() {
  const values = new Map<string, unknown>()
  const operations: string[] = []
  const openings: (() => void)[] = []
  const indexedDB = {
    open() {
      const request: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {}
      const db = {
        objectStoreNames: { contains: () => true },
        close() {},
        transaction() {
          const tx: { oncomplete?: () => void; objectStore?: () => unknown } = {}
          tx.objectStore = () => ({
            put(value: unknown, key: string) {
              operations.push('put')
              values.set(key, value)
              queueMicrotask(() => tx.oncomplete?.())
            },
            delete(key: string) {
              operations.push('delete')
              values.delete(key)
              queueMicrotask(() => tx.oncomplete?.())
            },
          })
          return tx
        },
      }
      request.result = db
      openings.push(() => request.onsuccess?.())
      return request
    },
  }
  return { indexedDB, values, operations, openings }
}

afterEach(() => vi.unstubAllGlobals())

describe('予約ミラーの保存と削除', () => {
  it('保存のDB接続が遅れても通知オフの削除を後から上書きしない', async () => {
    const fake = deferredDatabase()
    vi.stubGlobal('indexedDB', fake.indexedDB)
    const saving = writePushMirror('2026-10-15', [
      { route: 'campus_to_station', departure: '18:10', leadMinutes: 10 },
    ])
    const clearing = clearPushMirror()
    await Promise.resolve()
    expect(fake.openings).toHaveLength(1)
    fake.openings[0]()
    await saving
    await Promise.resolve()
    expect(fake.openings).toHaveLength(2)
    fake.openings[1]()
    await clearing
    expect(fake.operations).toEqual(['put', 'delete'])
    expect(fake.values.has('current')).toBe(false)
  })

  it('IndexedDBが使えない場合も後続の保存や削除が完了する', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(writePushMirror('2026-10-15', [])).resolves.toBeUndefined()
    await expect(clearPushMirror()).resolves.toBeUndefined()
  })
})
