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
 * server/src/vapid.ts の冒頭）。したがって「どの便か」はここで組み立てる。
 *
 * ── 便の同定 ─────────────────────────────────────────────────────────
 * **受信時刻から次便を推測してはいけない。** 予約した便より前の便や、
 * 逆方向の便を断定してしまう（例: 松永発 08:10 を 10 分前で予約すると、
 * 08:00 の push で既定ルートの大学発 08:20 を出す）。
 *
 * 代わりに、本体が IndexedDB へ写した「当日の予約一覧」を読み、
 * 受信時刻が通知の窓に入る予約だけを名指しする。写しの形と鍵は
 * src/utils/pushMirror.ts と結合しているので、片方だけ変えてはいけない。
 *
 * 同定できないとき（写しが無い・当日でない・当日ダイヤにその便が実在しない）は
 * 便を断定せず、汎用の文言に落とす。これは「推測するより表示しない」という
 * 時刻表側の原則を通知へ適用したもの。
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

/** 予約の写しの置き場。⚠️ src/utils/pushMirror.ts が同じ名前で書く */
var IDB_NAME = 'campusBusNaviPush'
var IDB_STORE = 'settings'
var IDB_KEY = 'current'

/** 便を同定できなかったときの通知タグ。便ごとの通知とは別枠にする */
var FALLBACK_TAG = 'departure-reminder'
var ICON_URL = '/icons/icon_192x192.png'

/**
 * 予約と受信時刻を突き合わせる窓。
 *
 * サーバの送信窓は `[発車 − リード分, 発車)` だが、端末時計のズレと push の配送遅延で
 * 受信時刻はその外へ出うる。前後に少しだけ余裕を持たせて同じ予約に辿り着けるようにする。
 * 広げすぎると「まだ送られていない予約」まで拾うため、最小限に留める。
 */
var WINDOW_EARLY_SLACK_MINUTES = 1
var WINDOW_LATE_SLACK_MINUTES = 3

/** 1 回の push で出す通知の上限。写しが壊れていても通知で埋め尽くさないための歯止め */
var MAX_NOTIFICATIONS = 4

/** サーバが受け付けるリード時間（server/src/schedule.ts の VALID_LEAD_MINUTES と対） */
var VALID_LEAD_MINUTES = [5, 10, 15, 20]

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

/** 予約の写しを読む。読めない・形が違う場合は null（呼び出し側が汎用通知へ落とす） */
function readMirror() {
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
          var value = get.result
          if (!value || typeof value.dateKey !== 'string' || !Array.isArray(value.reminders)) {
            resolve(null)
            return
          }
          resolve(value)
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

// ── 予約の選択 ───────────────────────────────────────────────────────────────

/**
 * 受信時刻が通知の窓に入る予約を、発車の早い順に返す。
 *
 * 純関数にしてあるのはテストのため（server/test/pushSw.test.ts が直接呼ぶ）。
 * 不正な値は黙って落とす。0 件なら呼び出し側が便を断定しない通知へ落ちる。
 */
function selectReservations(mirror, todayKey, nowMinutes) {
  if (!mirror || mirror.dateKey !== todayKey) return []
  var out = []
  for (var i = 0; i < mirror.reminders.length; i++) {
    var r = mirror.reminders[i]
    if (!r || (r.route !== 'campus_to_station' && r.route !== 'station_to_campus')) continue
    var target = parseHHmmToMinutes(r.departure)
    if (target === null) continue
    var lead = Number(r.leadMinutes)
    if (VALID_LEAD_MINUTES.indexOf(lead) === -1) continue
    var from = target - lead - WINDOW_EARLY_SLACK_MINUTES
    var to = target + WINDOW_LATE_SLACK_MINUTES
    if (nowMinutes < from || nowMinutes > to) continue
    out.push({ route: r.route, departure: r.departure, minutes: target })
  }
  out.sort(function (a, b) {
    if (a.minutes !== b.minutes) return a.minutes - b.minutes
    return a.route < b.route ? -1 : a.route > b.route ? 1 : 0
  })
  return out.slice(0, MAX_NOTIFICATIONS)
}

/** 当日のダイヤに、その route のその時刻の便が実在するか */
function departureExists(timetable, route, departure) {
  if (!timetable || !timetable.routes) return false
  var entry = timetable.routes[route]
  if (!entry || !Array.isArray(entry.schedule)) return false
  for (var i = 0; i < entry.schedule.length; i++) {
    if (entry.schedule[i] && entry.schedule[i].departure === departure) return true
  }
  return false
}

// ── 通知の組み立て ───────────────────────────────────────────────────────────

var FALLBACK = {
  title: 'まもなく発車です',
  body: 'アプリを開いて時刻表を確認してください',
  tag: FALLBACK_TAG,
}

function buildFor(reservation, timetable, nowMinutes) {
  var route = timetable.routes[reservation.route]
  var remaining = reservation.minutes - nowMinutes
  return {
    // 受信が発車時刻を過ぎている場合に「あと -2 分」と書かない
    title:
      remaining > 0
        ? reservation.departure + ' 発  あと ' + remaining + ' 分'
        : reservation.departure + ' 発  まもなく発車です',
    body: (route.origin || '') + ' → ' + (route.destination || '') + '（' + (route.bus_stop_name || '') + '）',
    // 便ごとに分ける。同じ push が二度届いても置き換わるだけで増えず、
    // 別の便の通知を押しのけることもない
    tag: 'departure-reminder-' + reservation.route + '-' + reservation.departure,
  }
}

/**
 * 出すべき通知の一覧を返す。必ず 1 件以上返す（userVisibleOnly の約束）。
 * 便を同定できない経路はすべて FALLBACK 1 件に収束する。
 */
function buildNotifications() {
  return readMirror().then(function (mirror) {
    var jst = jstNow()
    var todayKey = dateKeyOf(jst)
    var nowMinutes = jst.getHours() * 60 + jst.getMinutes()

    var reservations = selectReservations(mirror, todayKey, nowMinutes)
    if (reservations.length === 0) return [FALLBACK]

    return loadJson('/data/calendar_rules.json').then(function (rules) {
      var id = resolveTimetableId(rules, jst)
      if (!id) return [FALLBACK]

      // 運休日・特別ダイヤはサーバ側でも送信対象から外しているが、
      // 念のためここでも「存在しない便を知らせない」を守る
      if (id.indexOf('closed') !== -1 || id.indexOf('special') !== -1) return [FALLBACK]

      return loadJson('/data/timetables/' + id + '.json').then(function (timetable) {
        var out = []
        for (var i = 0; i < reservations.length; i++) {
          // ダイヤが差し替わって消えた便は名指ししない
          if (!departureExists(timetable, reservations[i].route, reservations[i].departure)) continue
          out.push(buildFor(reservations[i], timetable, nowMinutes))
        }
        return out.length > 0 ? out : [FALLBACK]
      })
    })
  })
}

function showDepartureNotification() {
  return buildNotifications()
    .catch(function () {
      return [FALLBACK]
    })
    .then(function (list) {
      return Promise.all(
        list.map(function (content) {
          return self.registration.showNotification(content.title, {
            body: content.body,
            icon: ICON_URL,
            badge: ICON_URL,
            tag: content.tag,
            renotify: true,
            data: { url: '/' },
          })
        })
      )
    })
    .catch(function () {
      // showNotification 自体が落ちたときの最後の砦。ここで握りつぶすと
      // 「通知を出さなかった」ことになるので、素の文言でもう一度だけ試す
      return self.registration.showNotification(FALLBACK.title, { body: FALLBACK.body, tag: FALLBACK_TAG })
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
