/*
 * 発車リマインダーの push 受信ハンドラ。
 *
 * vite.config.ts の `workbox.importScripts` から、生成された Service Worker に
 * 読み込まれる。generateSW モードのまま push 対応を足すための構成で、
 * injectManifest へ移行しない（既存のキャッシュ設定を一切変えないため）。
 *
 * ビルドを通らない素の JS としてそのまま配信されるので、TypeScript も
 * バンドラの構文も使えない。
 *
 * ── ペイロードなし push ──────────────────────────────────────────────
 * サーバは本文を送らない（Workers 無料枠の CPU 10ms/実行に収めるため。詳細は
 * server/src/vapid.ts の冒頭）。したがって「どの便か」はここで組み立てる:
 *   - 何を表示すべきか（ルート・何分前）は IndexedDB から読む。購読時に本体が書く
 *   - 当日のダイヤはネットワーク優先で取得し、失敗したら timetable-data キャッシュ
 *
 * ── 必ず通知を出す ───────────────────────────────────────────────────
 * 購読は userVisibleOnly: true なので、push を受けたら必ず showNotification を
 * 呼ばなければならない。呼ばないとブラウザが汎用の文言を出すか、最悪は通知許可を
 * 取り消す。そのため全経路を try/catch で囲み、失敗時も必ず何かを出す。
 */

/**
 * ⚠️ vite.config.ts の runtimeCaching[0].options.cacheName と一致させること。
 *    src/hooks/useTimetable.ts の DATA_CACHE とも同じ値である。
 */
var DATA_CACHE = 'timetable-data'

/** 購読時の表示設定の置き場。src/hooks/usePushSubscription.ts が同じ名前で書く */
var IDB_NAME = 'campusBusNaviPush'
var IDB_STORE = 'settings'
var IDB_KEY = 'current'

var NOTIFICATION_TAG = 'departure-reminder'
var ICON_URL = '/icons/icon_192x192.png'

/** 通知に載せる便を探す幅。サーバは「N 分前」に送るが、実行遅延で数分ずれうる */
var LOOKAHEAD_MINUTES = 45

// ── JST ─────────────────────────────────────────────────────────────────────
// 端末のタイムゾーンは JST とは限らない。UTC+9 に固定して計算する。

function jstNow() {
  var now = new Date()
  return new Date(now.getTime() + (now.getTimezoneOffset() + 9 * 60) * 60000)
}

function two(n) {
  return n < 10 ? '0' + n : String(n)
}

function dateKeyOf(d) {
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
}

/**
 * "HH:mm" を 0 時基準の通算分にする。
 * src/utils/parseTime.ts の parseHHmmToMinutes と同じ規則（2 桁固定・範囲検査）。
 */
function parseHHmmToMinutes(value) {
  if (typeof value !== 'string') return null
  var m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  var h = Number(m[1])
  var min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

// ── IndexedDB ───────────────────────────────────────────────────────────────

function readSettings() {
  return new Promise(function (resolve) {
    var request
    try {
      request = indexedDB.open(IDB_NAME, 1)
    } catch (e) {
      resolve(null)
      return
    }
    request.onupgradeneeded = function () {
      var db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    request.onerror = function () {
      resolve(null)
    }
    request.onsuccess = function () {
      var db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        resolve(null)
        return
      }
      try {
        var get = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY)
        get.onsuccess = function () {
          resolve(get.result || null)
        }
        get.onerror = function () {
          resolve(null)
        }
      } catch (e) {
        resolve(null)
      }
    }
  })
}

// ── データ取得 ───────────────────────────────────────────────────────────────

/**
 * ネットワーク優先で JSON を取る。push が届いた直後は通信できていることが多いので、
 * まず最新を取りにいく。落ちたら timetable-data キャッシュへ落とす。
 * どちらも駄目なら null（呼び出し側が代替の通知を出す）。
 */
function loadJson(path) {
  return fetch(path, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    })
    .catch(function () {
      return caches
        .open(DATA_CACHE)
        .then(function (cache) {
          return cache.match(path)
        })
        .then(function (res) {
          return res ? res.json() : null
        })
        .catch(function () {
          return null
        })
    })
}

/**
 * 適用すべき時刻表 ID を返す。
 * src/utils/resolveCalendar.ts と同じ規則（overrides > 曜日ルール）。
 * push-sw.js は素の JS として配信されるため src/ を import できず、ここだけ実装が重複する。
 * calendar_rules.json の解釈を変えるときは両方を直すこと。
 */
function resolveTimetableId(rules, jst) {
  if (!rules) return null
  var key = dateKeyOf(jst)
  if (rules.overrides && rules.overrides[key]) return rules.overrides[key]
  if (!rules.default_rules) return null
  return rules.default_rules[String(jst.getDay())] || null
}

/** 現在時刻より後の最初の便を返す。findNextBus.ts と同じ判定（> であって >= ではない） */
function findNextDeparture(schedule, nowMinutes) {
  if (!Array.isArray(schedule)) return null
  var best = null
  for (var i = 0; i < schedule.length; i++) {
    var minutes = parseHHmmToMinutes(schedule[i] && schedule[i].departure)
    if (minutes === null || minutes <= nowMinutes) continue
    if (best === null || minutes < best.minutes) {
      best = { departure: schedule[i].departure, minutes: minutes }
    }
  }
  return best
}

// ── 通知の組み立て ───────────────────────────────────────────────────────────

var FALLBACK = {
  title: 'まもなく発車です',
  body: 'アプリを開いて時刻表を確認してください',
}

function buildNotification() {
  return readSettings().then(function (settings) {
    var routeKey = (settings && settings.route) || 'campus_to_station'
    var jst = jstNow()
    var nowMinutes = jst.getHours() * 60 + jst.getMinutes()

    return loadJson('/data/calendar_rules.json').then(function (rules) {
      var id = resolveTimetableId(rules, jst)
      if (!id) return FALLBACK

      // 運休日・特別ダイヤはサーバ側でも送信対象から外しているが、
      // 念のためここでも「存在しない便を知らせない」を守る
      if (id.indexOf('closed') !== -1 || id.indexOf('special') !== -1) return FALLBACK

      return loadJson('/data/timetables/' + id + '.json').then(function (timetable) {
        if (!timetable || !timetable.routes || !timetable.routes[routeKey]) return FALLBACK
        var route = timetable.routes[routeKey]
        var next = findNextDeparture(route.schedule, nowMinutes)
        if (!next || next.minutes - nowMinutes > LOOKAHEAD_MINUTES) return FALLBACK

        var remaining = next.minutes - nowMinutes
        return {
          title: next.departure + ' 発  あと ' + remaining + ' 分',
          body: (route.origin || '') + ' → ' + (route.destination || '') + '（' + (route.bus_stop_name || '') + '）',
        }
      })
    })
  })
}

function showDepartureNotification() {
  return buildNotification()
    .catch(function () {
      return FALLBACK
    })
    .then(function (content) {
      return self.registration.showNotification(content.title, {
        body: content.body,
        icon: ICON_URL,
        badge: ICON_URL,
        tag: NOTIFICATION_TAG,
        renotify: true,
        data: { url: '/' },
      })
    })
    .catch(function () {
      // showNotification 自体が落ちたときの最後の砦。ここで握りつぶすと
      // 「通知を出さなかった」ことになるので、素の文言でもう一度だけ試す
      return self.registration.showNotification(FALLBACK.title, { body: FALLBACK.body, tag: NOTIFICATION_TAG })
    })
}

// ── イベント ─────────────────────────────────────────────────────────────────

self.addEventListener('push', function (event) {
  event.waitUntil(showDepartureNotification())
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        // 既に開いているタブ・PWA があればそれを前面に出す（二重に開かない）
        if ('focus' in list[i]) return list[i].focus()
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined
    })
  )
})
