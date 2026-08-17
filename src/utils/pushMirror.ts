import type { RouteKey } from '../types/timetable'

/**
 * 発車リマインダーの「予約ミラー」。
 *
 * ペイロードなし push（本文を送らない）を採っているため、`public/push-sw.js` は
 * 「どの便の通知か」をサーバから受け取れない。**受信時の次便を推測すると、
 * 逆方向・別時刻の便を断定してしまう**（実例: 松永発 08:10 を 10 分前で予約すると、
 * 08:00 の push で既定ルートの大学発 08:20 を出す）。
 *
 * そこでサーバ（D1）が正である予約内容を、端末の IndexedDB へ写しておく。
 * push-sw はここを読み、受信時刻が通知の窓に入る予約だけを断定する。
 * 読めない・当日でない・当日ダイヤに実在しない場合は便を断定せず、汎用の文言に落とす。
 *
 * ⚠️ IDB_NAME / IDB_STORE / IDB_KEY と PushMirror の形は
 *    `public/push-sw.js` と結合している。片方だけ変えてはいけない。
 *    push-sw.js はビルドを通らない素の JS として配信されるため、この定義を import できない。
 */

/** ⚠️ public/push-sw.js の IDB_NAME と一致させること */
const IDB_NAME = 'campusBusNaviPush'
/** ⚠️ public/push-sw.js の IDB_STORE と一致させること */
const IDB_STORE = 'settings'
/** ⚠️ public/push-sw.js の IDB_KEY と一致させること */
const IDB_KEY = 'current'
/** ⚠️ public/push-sw.js の indexedDB.open() のバージョンと一致させること */
const IDB_VERSION = 1

/** 予約 1 件。サーバの reminders 行と 1:1 で対応する */
export interface MirroredReminder {
  route: RouteKey
  /** "HH:mm" */
  departure: string
  leadMinutes: number
}

export interface PushMirror {
  /** 予約の対象日（"YYYY-MM-DD" / JST）。当日以外は push-sw が採用しない */
  dateKey: string
  /** 書き込み時刻（epoch ミリ秒）。デバッグと古さの判断に使う */
  updatedAt: number
  /** その日の全ルートぶんの予約 */
  reminders: MirroredReminder[]
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(IDB_NAME, IDB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })
}

/**
 * 書き込み・削除の共通部分。
 * IndexedDB が使えない端末（プライベートモード等）でも例外を投げない。
 * 通知の表示品質は下がるが、その場合は push-sw が汎用の文言へ落ちるだけで安全側に倒れる。
 */
function write(value: PushMirror | null): Promise<void> {
  return openDb().then(
    db =>
      new Promise<void>(resolve => {
        if (!db || !db.objectStoreNames.contains(IDB_STORE)) {
          db?.close()
          resolve()
          return
        }
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite')
          const store = tx.objectStore(IDB_STORE)
          if (value === null) store.delete(IDB_KEY)
          else store.put(value, IDB_KEY)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            resolve()
          }
          tx.onabort = () => {
            db.close()
            resolve()
          }
        } catch {
          db.close()
          resolve()
        }
      })
  )
}

/** 予約ミラーを読む。無い・壊れている場合は null */
export function readPushMirror(): Promise<PushMirror | null> {
  return openDb().then(
    db =>
      new Promise<PushMirror | null>(resolve => {
        if (!db || !db.objectStoreNames.contains(IDB_STORE)) {
          db?.close()
          resolve(null)
          return
        }
        try {
          const get = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY)
          get.onsuccess = () => {
            const value = get.result as Partial<PushMirror> | undefined
            db.close()
            if (!value || typeof value.dateKey !== 'string' || !Array.isArray(value.reminders)) {
              resolve(null)
              return
            }
            resolve(value as PushMirror)
          }
          get.onerror = () => {
            db.close()
            resolve(null)
          }
        } catch {
          db.close()
          resolve(null)
        }
      })
  )
}

/** 予約ミラーを丸ごと置き換える。サーバの状態を写す用途なので差分更新はしない */
export function writePushMirror(dateKey: string, reminders: MirroredReminder[]): Promise<void> {
  return write({ dateKey, updatedAt: Date.now(), reminders })
}

/** 予約ミラーを消す。通知をオフにしたとき（サーバ側も全削除済み）に呼ぶ */
export function clearPushMirror(): Promise<void> {
  return write(null)
}
