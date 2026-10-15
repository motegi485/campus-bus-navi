// 実行: node --test scripts/frontend-regressions.test.mjs
// 既存の TypeScript と React JSX を使い、通信・DOM・hook の時系列を局所的に制御する。
// 実ブラウザの描画・Service Worker・IndexedDB の検証は別途必要。
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dayjs = require('dayjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const timetable = JSON.parse(readFileSync(path.join(root, 'public/data/timetables/timetable_weekday.json'), 'utf8'))

function createRunner() {
  const slots = []
  let cursor = 0, pending = [], dirty = false, currentFn, currentProps, result
  const changed = (a, b) => !a || !b || b.some((value, i) => !Object.is(value, a[i]))
  const hooks = {
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true }
      }]
    },
    useRef(initial) {
      const i = cursor++
      return (slots[i] ??= { current: initial })
    },
    useMemo(fn, deps) {
      const i = cursor++
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }
      return slots[i].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const i = cursor++
      if (!slots[i] || changed(slots[i].deps, deps)) pending.push({ i, fn, deps })
    },
  }
  hooks.useLayoutEffect = hooks.useEffect
  function renderOnce(fn = currentFn, props = currentProps) {
    currentFn = fn; currentProps = props; cursor = 0; pending = []; dirty = false
    result = fn(props)
    return result
  }
  function flush(fn = currentFn, props = currentProps) {
    for (let limit = 0; limit < 25; limit++) {
      renderOnce(fn, props)
      for (const { i, fn: effect, deps } of pending) {
        slots[i]?.cleanup?.()
        slots[i] = { deps, cleanup: effect() }
      }
      if (!dirty) return result
    }
    throw new Error('hook の再描画が収束しません')
  }
  return { hooks, renderOnce, flush, unmount: () => slots.forEach(slot => slot?.cleanup?.()) }
}

function loader(runner, overrides = {}, expose = {}) {
  const modules = new Map()
  function load(file) {
    const absolute = path.resolve(root, file)
    if (modules.has(absolute)) return modules.get(absolute)
    const module = { exports: {} }
    modules.set(absolute, module.exports)
    const source = readFileSync(absolute, 'utf8') + (expose[file] ?? '')
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: absolute,
    }).outputText
    function localRequire(specifier) {
      if (specifier === 'react') return runner.hooks
      if (specifier in overrides) return overrides[specifier]
      if (!specifier.startsWith('.')) return require(specifier)
      const base = path.resolve(path.dirname(absolute), specifier)
      const target = ['.ts', '.tsx'].map(ext => base + ext).find(existsSync)
      if (!target) throw new Error(`テスト用 import を解決できません: ${specifier}`)
      return load(path.relative(root, target).replaceAll('\\', '/'))
    }
    new Function('require', 'module', 'exports', output)(localRequire, module, module.exports)
    return module.exports
  }
  return load
}

const savedGlobals = new WeakMap()
function globals(t, values) {
  let originals = savedGlobals.get(t)
  if (!originals) {
    originals = new Map()
    savedGlobals.set(t, originals)
    t.after(() => {
      for (const [key, previous] of originals) {
        if (previous) Object.defineProperty(globalThis, key, previous)
        else delete globalThis[key]
      }
    })
  }
  for (const [key, value] of Object.entries(values)) {
    if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}
const storage = () => ({ getItem: () => null, setItem: () => {} })
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const response = (body, date) => ({ ok: true, json: async () => body, headers: { get: () => date ?? null } })
const marker = name => Object.defineProperty(() => null, 'name', { value: name })
const components = Object.fromEntries(['FullTimetableSheet', 'TimetableGrid', 'RouteToggle', 'DayBadge', 'Spinner', 'RouteSwitch', 'EndOfServiceCard', 'SpecialScheduleCard', 'StatusIcon', 'RetryButton', 'BellIcon'].map(name => [name, marker(name)]))
const componentMocks = {
  '@phosphor-icons/react': new Proxy({}, { get: (_, name) => name === '__esModule' ? false : marker(name) }),
  '../hooks/useOverlayA11y': { useOverlayA11y: () => ({ current: null }), setInert: () => {} },
  '../hooks/useBodyScrollLock': { useBodyScrollLock: () => {} },
  '../hooks/useSheetDragToClose': { useSheetDragToClose: () => {} },
  '../hooks/useIsDesktop': { useIsDesktop: () => true },
  '../hooks/usePressable': { usePressable: () => ({ pressed: false, pressHandlers: {} }) },
  '../hooks/useDepartureReminders': { LEAD_OPTIONS: [5, 10, 15, 20] },
  '../utils/haptics': { tapFeedback: () => {} },
  '../utils/fontScale': { fs: value => value },
  './StatusParts': components,
  ...Object.fromEntries(Object.entries(components).map(([name, component]) => [`./${name}`, { [name]: component }])),
}
function walk(node, accept) {
  if (Array.isArray(node)) return node.flatMap(child => walk(child, accept))
  if (!node || typeof node !== 'object') return []
  return [...(accept(node) ? [node] : []), ...walk(node.props?.children, accept)]
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('')
  if (node == null || typeof node === 'boolean') return ''
  return typeof node === 'object' ? text(node.props?.children) : String(node)
}
const findButton = (tree, label) => walk(tree, node => node.type === 'button' && text(node).includes(label))[0]
function sheetProps() {
  return {
    open: true, dataAvailable: true, onClose() {}, route: 'campus_to_station', onChangeRoute() {},
    schedule: timetable.routes.campus_to_station.schedule, now: dayjs('2026-10-15T07:00'),
    diagramType: 'weekday', nowMinutes: 420, remaining: 30, marked: new Set(['08:10']),
    reminderReady: true, reminderLoadState: 'ok', onReloadReminders() {}, lead: 10,
    onChangeLead() {}, onSave: async () => true, saving: false, reminderError: null,
  }
}

test('全時刻表の選択は方向・日付・便一覧変更直後の描画から破棄される', () => {
  for (const change of [{ route: 'station_to_campus', marked: new Set(['08:35']) }, { now: dayjs('2026-10-16T00:00') }, { schedule: [{ departure: '08:20', note: '' }] }]) {
    const runner = createRunner(), load = loader(runner, componentMocks)
    const { FullTimetableSheet } = load('src/components/FullTimetableSheet.tsx')
    const props = sheetProps()
    let tree = runner.flush(FullTimetableSheet, props)
    findButton(tree, '通知を変更').props.onClick()
    tree = runner.flush()
    assert.equal(walk(tree, n => n.type === components.TimetableGrid)[0].props.selectMode, true)
    tree = runner.renderOnce(FullTimetableSheet, { ...props, ...change })
    assert.equal(walk(tree, n => n.type === components.TimetableGrid)[0].props.selectMode, false)
    assert.equal(findButton(tree, '件の通知を設定'), undefined)
  }
})

test('変更後の時刻表に存在しない予約を不可視のまま再保存しない', () => {
  const runner = createRunner(), load = loader(runner, componentMocks)
  const { FullTimetableSheet } = load('src/components/FullTimetableSheet.tsx')
  let tree = runner.flush(FullTimetableSheet, { ...sheetProps(), marked: new Set(['08:10', '23:59']) })
  findButton(tree, '通知を変更').props.onClick()
  tree = runner.flush()
  assert.deepEqual([...walk(tree, n => n.type === components.TimetableGrid)[0].props.selected], ['08:10'])
})

test('保存中は方向・リード時間・便選択を変更できない', () => {
  const runner = createRunner(), load = loader(runner, componentMocks)
  const { FullTimetableSheet } = load('src/components/FullTimetableSheet.tsx')
  let changes = 0
  const props = { ...sheetProps(), onChangeRoute: () => changes++, onChangeLead: () => changes++ }
  let tree = runner.flush(FullTimetableSheet, props)
  findButton(tree, '通知を変更').props.onClick()
  tree = runner.flush(FullTimetableSheet, { ...props, saving: true })
  walk(tree, n => n.type === components.RouteToggle)[0].props.onChange('station_to_campus')
  findButton(tree, '5分前').props.onClick()
  walk(tree, n => n.type === components.TimetableGrid)[0].props.onToggle('08:20')
  tree = runner.flush()
  assert.equal(changes, 0)
  assert.deepEqual([...walk(tree, n => n.type === components.TimetableGrid)[0].props.selected], ['08:10'])
  assert.equal(walk(tree, n => n.type === 'fieldset' && n.props.disabled).length, 2)
})

test('不正な対象日のシートは閉じアニメーション中も旧便を見せない', () => {
  const runner = createRunner(), load = loader(runner, componentMocks)
  const { FullTimetableSheet } = load('src/components/FullTimetableSheet.tsx')
  runner.flush(FullTimetableSheet, sheetProps())
  const tree = runner.renderOnce(FullTimetableSheet, { ...sheetProps(), dataAvailable: false })
  const dialog = walk(tree, node => node.props.role === 'dialog')[0]
  assert.equal(dialog.props['aria-hidden'], true)
  assert.equal(dialog.props.style.visibility, 'hidden')
})

test('週間ダイヤ本文の取得中は運休と表示しない', () => {
  const runner = createRunner()
  const load = loader(runner, componentMocks, { 'src/components/WeeklyScreen.tsx': '\nexports.DayDetailView = DayDetailView' })
  const { DayDetailView } = load('src/components/WeeklyScreen.tsx')
  const tree = runner.flush(DayDetailView, {
    day: { date: dayjs('2026-10-15'), dateKey: '2026-10-15', diagramType: 'weekday', status: 'loading', timetable: null },
    route: 'campus_to_station', nowMinutes: 420, isOnline: true, reloading: false, onRetry() {}, onBack() {},
  })
  assert.equal(walk(tree, n => n.type === components.EndOfServiceCard).length, 0)
  assert.equal(walk(tree, n => n.type === components.Spinner).length, 1)
})

function reminderHarness(t) {
  const runner = createRunner(), calls = [], mirrors = []
  globals(t, { localStorage: storage(), fetch: (url, options) => {
    const pending = deferred(); calls.push({ url, options, ...pending }); return pending.promise
  } })
  const load = loader(runner, { '../utils/pushMirror': {
    writePushMirror: async (dateKey, reminders) => { mirrors.push({ dateKey, reminders }) },
    clearPushMirror: async () => { mirrors.push(null) },
  } })
  const { useDepartureReminders } = load('src/hooks/useDepartureReminders.ts')
  const props = { endpoint: 'https://push.example.test/subscription', dateKey: '2026-10-15', route: 'campus_to_station' }
  return { runner, calls, mirrors, hook: useDepartureReminders, props }
}

test('古いGETと方向変更直後の予約を新方向の状態へ適用しない', async t => {
  const { runner, calls, mirrors, hook, props } = reminderHarness(t)
  runner.flush(hook, props); await tick()
  runner.flush(hook, { ...props, route: 'station_to_campus' }); await tick()
  calls[1].resolve(response({ reminders: [{ route: 'station_to_campus', departure: '08:35', leadMinutes: 10 }] }))
  await tick(); let value = runner.flush()
  assert.deepEqual([...value.marked], ['08:35'])
  calls[0].resolve(response({ reminders: [{ route: 'campus_to_station', departure: '08:10', leadMinutes: 5 }] }))
  await tick(); value = runner.flush()
  assert.deepEqual([...value.marked], ['08:35'])
  assert.equal(mirrors.length, 1)
  value = runner.renderOnce(hook, { ...props, dateKey: '2026-10-16' })
  assert.equal(value.marked.size, 0)
  assert.equal(value.loadState, 'loading')
})

test('保存を二重送信せず、旧POST後に新方向を読み直してミラーへ反映する', async t => {
  const { runner, calls, mirrors, hook, props } = reminderHarness(t)
  runner.flush(hook, props); await tick()
  calls[0].resolve(response({ reminders: [{ route: 'campus_to_station', departure: '08:10', leadMinutes: 10 }] }))
  await tick(); let value = runner.flush()
  const save = value.save(['08:20'])
  assert.equal(await value.save(['08:10']), false)
  assert.equal(calls.filter(call => call.options?.method === 'POST').length, 1)
  runner.flush(hook, { ...props, route: 'station_to_campus' }); await tick()
  assert.equal(calls.length, 2, '旧POSTの確定前にGETしてはいけない')
  calls[1].resolve(response({ ok: true }))
  assert.equal(await save, false, '旧方向の保存完了を新画面の成功にしない')
  await tick()
  assert.equal(mirrors.length, 1, '旧POSTはミラーを書き換えない')
  calls[2].resolve(response({ reminders: [{ route: 'station_to_campus', departure: '08:35', leadMinutes: 15 }] }))
  await tick(); value = runner.flush()
  assert.deepEqual([...value.marked], ['08:35'])
  assert.equal(value.lead, 15)
  assert.equal(value.saving, false)
  assert.equal(mirrors.length, 2)
})

test('日付・端末の変更やunmount後に旧POSTをミラーへ書き戻さない', async t => {
  for (const change of [{ dateKey: '2026-10-16' }, { endpoint: null }, null]) {
    const { runner, calls, mirrors, hook, props } = reminderHarness(t)
    runner.flush(hook, props); await tick()
    calls[0].resolve(response({ reminders: [] })); await tick()
    const value = runner.flush(), saved = value.save(['08:20'])
    if (change) runner.flush(hook, { ...props, ...change })
    else runner.unmount()
    calls[1].resolve(response({ ok: true })); await saved; await tick()
    assert.equal(mirrors.filter(Boolean).length, 1)
    if (change?.endpoint === null) assert.equal(mirrors.at(-1), null)
  }
})

test('同方向の保存中に再読込しても古いGETは保存結果を消さない', async t => {
  const { runner, calls, mirrors, hook, props } = reminderHarness(t)
  runner.flush(hook, props); await tick()
  calls[0].resolve(response({ reminders: [] })); await tick()
  const value = runner.flush(), saved = value.save(['08:20'])
  value.reload(); runner.flush(); await tick()
  assert.equal(calls.length, 2)
  calls[1].resolve(response({ ok: true })); await saved; await tick()
  calls[2].resolve(response({ reminders: [{ route: props.route, departure: '08:20', leadMinutes: 10 }] }))
  await tick()
  assert.deepEqual([...runner.flush().marked], ['08:20'])
  assert.equal(mirrors.length, 2)
})

test('GET失敗中は総入替保存せず、POST失敗時も既存の印とミラーを維持する', async t => {
  const { runner, calls, mirrors, hook, props } = reminderHarness(t)
  runner.flush(hook, props); await tick()
  calls[0].reject(new Error('offline')); await tick()
  let value = runner.flush()
  assert.equal(value.loadState, 'error')
  assert.equal(await value.save(['08:20']), false)
  assert.equal(calls.length, 1)
  value.reload(); runner.flush(); await tick()
  calls[1].resolve(response({ reminders: [{ route: props.route, departure: '08:10', leadMinutes: 10 }] }))
  await tick(); value = runner.flush()
  const saved = value.save(['08:20'])
  calls[2].resolve({ ok: false, json: async () => ({ error: '保存できません' }) })
  assert.equal(await saved, false)
  value = runner.flush()
  assert.deepEqual([...value.marked], ['08:10'])
  assert.equal(value.error, '保存できません')
  assert.equal(value.saving, false)
  assert.equal(mirrors.length, 1)
})

test('お知らせの古い応答が後着しても最新の再取得を上書きしない', async t => {
  const runner = createRunner(), calls = []
  globals(t, { localStorage: storage(), fetch: () => { const pending = deferred(); calls.push(pending); return pending.promise } })
  const { useNews } = loader(runner)('src/hooks/useNews.ts')
  let value = runner.flush(useNews)
  const reloaded = value.reload()
  calls[1].resolve(response([{ id: 2 }]))
  await reloaded; await tick(); value = runner.flush()
  calls[0].resolve(response([{ id: 1 }]))
  await tick(); value = runner.flush()
  assert.equal(value.news[0].id, 2)
  assert.equal(value.loading, false)
})

test('鮮度はカレンダーと本文の古い妥当Dateを使う', t => {
  globals(t, { navigator: { onLine: true } })
  const runner = createRunner()
  const { resolveFetchedAt } = loader(runner, {}, { 'src/hooks/useTimetable.ts': '\nexports.resolveFetchedAt = resolveFetchedAt' })('src/hooks/useTimetable.ts')
  const now = Date.now(), old = now - 2 * 24 * 60 * 60 * 1000
  assert.equal(resolveFetchedAt(old, now), old)
  assert.equal(resolveFetchedAt(now, old), old)
  assert.equal(resolveFetchedAt(null, old), old)
  assert.equal(resolveFetchedAt(Number.NaN, now + 10 * 60 * 1000, old), old)
  globalThis.navigator.onLine = false
  assert.equal(resolveFetchedAt(null, null), null)
})

test('時刻表フックは新しい本文だけで古いカレンダーの鮮度を上書きしない', async t => {
  const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toUTCString()
  const rules = { default_rules: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(day => [day, 'timetable_weekday'])), overrides: {} }
  globals(t, {
    localStorage: storage(), navigator: { onLine: true },
    fetch: async url => url.includes('calendar_rules')
      ? response(rules, oldDate) : response(structuredClone(timetable), new Date().toUTCString()),
  })
  const runner = createRunner(), { useTimetable } = loader(runner)('src/hooks/useTimetable.ts')
  const hook = () => useTimetable(dayjs('2026-10-15T07:00'))
  runner.flush(hook); await tick()
  const value = runner.flush()
  assert.equal(value.loading, false)
  assert.equal(value.error, null)
  assert.equal(value.fetchedAt, Date.parse(oldDate))
})

test('週間カレンダーの再取得失敗はloading行を残さず、再試行できる', async t => {
  const runner = createRunner(), calls = []
  globals(t, { fetch: () => { const pending = deferred(); calls.push(pending); return pending.promise } })
  const { useWeekTimetables } = loader(runner)('src/hooks/useWeekTimetables.ts')
  const hook = () => useWeekTimetables(dayjs('2026-10-15'), true, 1, true)
  runner.flush(hook)
  const rules = { default_rules: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(day => [day, 'timetable_weekday'])), overrides: {} }
  calls[0].resolve(response(rules)); await tick()
  let value = runner.flush()
  assert.equal(value.days[0].status, 'loading')
  const retry = value.reload(); runner.flush()
  calls[2].reject(new Error('offline')); await retry; await tick()
  value = runner.flush()
  assert.equal(value.days.length, 0)
  assert.equal(value.loading, false)
  assert.equal(value.error, 'offline')
  calls[1].resolve(response(timetable)); await tick()
  assert.equal(runner.flush().days.length, 0, '旧本文の成功は失敗した新世代を上書きしない')
  const again = value.reload(); runner.flush()
  calls[3].resolve(response(rules)); await again; await tick(); runner.flush()
  calls[4].resolve(response(timetable)); await tick()
  assert.equal(runner.flush().days[0].status, 'ok')
})

function appHarness(t) {
  const runner = createRunner(), state = {
    now: dayjs('2026-10-15T07:00'), stale: false, refresh: async () => true,
    weekReloads: 0, newsReloads: 0, rejectRelated: false, pendingRelated: null,
  }
  globals(t, { window: { matchMedia: () => ({ matches: false }), setTimeout, clearTimeout } })
  const componentNames = ['StatusCard', 'StatusBand', 'RouteToggle', 'NextBusCard', 'UpcomingList', 'FullTimetableSheet', 'BellIcon', 'EndOfServiceCard', 'SpecialScheduleCard', 'BottomTabBar', 'Sidebar', 'MapTab', 'MenuTab', 'NewsScreen', 'WeeklyScreen', 'SettingsScreen', 'HelpScreen', 'UpdateBanner']
  const mocks = {
    '@phosphor-icons/react': componentMocks['@phosphor-icons/react'],
    'virtual:pwa-register/react': { useRegisterSW: () => ({ needRefresh: [false], updateServiceWorker() {} }) },
    './hooks/useSettings': { useSettings: () => ({ settings: { defaultRoute: 'campus_to_station', fontSize: 'medium', theme: 'light' } }) },
    './hooks/useJSTClock': { useJSTClock: () => state.now },
    './hooks/useTimetable': { useTimetable: () => ({ timetable, tomorrowTimetable: null, loading: false, refetching: false, error: null, stale: state.stale, fetchedAt: Date.now(), refresh: () => state.refresh() }) },
    './hooks/useOnlineStatus': { useOnlineStatus: () => true },
    './hooks/usePushSubscription': { usePushSubscription: () => ({ status: 'idle', endpoint: null }) },
    './hooks/useDepartureReminders': { useDepartureReminders: () => ({ marked: new Set(), loadState: 'idle' }) },
    './hooks/useNews': { useNews: () => ({ news: [], readIds: new Set(), reload: async () => { state.newsReloads++; if (state.rejectRelated) throw new Error('news offline'); await state.pendingRelated } }) },
    './hooks/useWeekTimetables': { useWeekTimetables: () => ({ days: [], reload: async () => { state.weekReloads++; if (state.rejectRelated) throw new Error('week offline'); await state.pendingRelated } }) },
    './hooks/useNativeBounce': { useNativeBounce() {} },
    './hooks/useOverlayA11y': { setInert() {} },
    './hooks/usePressable': { usePressable: () => ({ pressHandlers: {} }) },
    './components/StatusParts': components,
    './components/Toast': { Toast: marker('Toast'), useToast: () => ({ toast: {}, showToast() {} }) },
    './components/DayBadge': { DayBadge: components.DayBadge, resolveDiagramType: () => 'weekday' },
    './components/MobilePwaGuide': { MobilePwaGuide: marker('MobilePwaGuide'), shouldShowMobilePwaGuide: () => false },
    ...Object.fromEntries(componentNames.map(name => [`./components/${name}`, { [name]: components[name] ?? marker(name) }])),
  }
  const { default: App } = loader(runner, mocks)('src/App.tsx')
  return { runner, App, state }
}

test('開いた全時刻表は日付変更・stale直後の描画から閉じる', t => {
  for (const change of [{ now: dayjs('2026-10-16T00:00') }, { stale: true }]) {
    const { runner, App, state } = appHarness(t)
    let tree = runner.renderOnce(App)
    findButton(tree, '全時刻表').props.onClick()
    tree = runner.renderOnce()
    assert.equal(walk(tree, n => n.type === components.FullTimetableSheet)[0].props.open, true)
    Object.assign(state, change)
    tree = runner.renderOnce()
    assert.equal(walk(tree, n => n.type === components.FullTimetableSheet)[0].props.open, false)
  }
})

test('ホーム更新成功で週間・お知らせも更新し、個別失敗を未処理rejectionにしない', async t => {
  const { runner, App, state } = appHarness(t)
  state.rejectRelated = true
  const tree = runner.renderOnce(App)
  walk(tree, n => n.type === 'button' && n.props['aria-label'] === '時刻データを更新')[0].props.onClick()
  await tick()
  assert.equal(state.weekReloads, 1)
  assert.equal(state.newsReloads, 1)
})

test('ホーム時刻表更新失敗では関連データの更新成功と取り違えない', async t => {
  const { runner, App, state } = appHarness(t)
  state.refresh = async () => false
  const tree = runner.renderOnce(App)
  walk(tree, n => n.type === 'button' && n.props['aria-label'] === '時刻データを更新')[0].props.onClick()
  await tick()
  assert.equal(state.weekReloads, 0)
  assert.equal(state.newsReloads, 0)
})

test('二次取得が応答しなくても主時刻表の更新後はボタンを再び操作できる', async t => {
  const { runner, App, state } = appHarness(t)
  const spinTimers = []
  globals(t, { window: { ...globalThis.window, setTimeout: callback => { spinTimers.push(callback); return 1 }, clearTimeout() {} } })
  state.pendingRelated = deferred().promise
  let tree = runner.renderOnce(App)
  const refreshButton = current => walk(current, n => n.type === 'button' && n.props['aria-label'] === '時刻データを更新')[0]
  refreshButton(tree).props.onClick()
  await tick()
  assert.equal(state.weekReloads, 1)
  assert.equal(state.newsReloads, 1)
  assert.equal(spinTimers.length, 1, '二次取得を待たずに主更新の終了処理へ進む')
  spinTimers[0]()
  tree = runner.renderOnce()
  assert.equal(refreshButton(tree).props.disabled, false)
})

test('お知らせ詳細をEscapeで閉じても元の行へフォーカスを戻す', async t => {
  const runner = createRunner()
  let escape, restored = 0
  const row = { focus: () => restored++ }
  globals(t, { document: { activeElement: row, contains: node => node === row } })
  const mocks = {
    ...componentMocks,
    '../hooks/useOverlayA11y': { useOverlayA11y: (_open, options) => { escape = options.onEscape; return { current: null } }, setInert() {} },
  }
  const { NewsScreen } = loader(runner, mocks)('src/components/NewsScreen.tsx')
  let tree = runner.flush(NewsScreen, { open: true, onClose() {}, news: [{ id: 1, title: 'お知らせ' }], loading: false, error: null, readIds: new Set(), markAsRead() {}, reload: async () => {} })
  walk(tree, node => node.type.name === 'NewsListItem')[0].props.onOpen()
  runner.flush(); escape(); runner.flush()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(restored, 1)
})
