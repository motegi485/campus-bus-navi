/**
 * OCR 後の純粋な計画作成（組み立て → 検証 → state 更新 → カレンダー再計算）。
 *
 * ネットワークにも書き込みにも触れないので、fixtures を使ったエンドツーエンド検証ができる。
 * index.ts（オーケストレータ）と test/integration.test.ts の双方がここを通る。
 */

import { assemble } from './assemble.js'
import { calculateOverrides, eventIdForDate, type CalendarResult } from './calendar.js'
import { CONFIG } from './config.js'
import { pruneEvents, type ChangeDecision } from './detectChanges.js'
import { readTimetable as readTimetableFromRepo, timetableExists as timetableExistsInRepo } from './files.js'
import { eachDate, isAfter, isBefore } from './time.js'
import { validateTimetable } from './validate.js'
import type {
  ClassifiedLink,
  FilePlan,
  Holiday,
  Intermediate,
  State,
  StateEvent,
  StateSpecial,
  Timetable,
  Warning,
} from './types.js'

export interface PlanInput {
  decisions: ChangeDecision[]
  /** 論理キー → OCR 中間構造（読み取りに成功したものだけ） */
  intermediates: Map<string, Intermediate>
  /** 論理キー → OCR 失敗理由 */
  ocrFailures?: Map<string, string>
  /** 分類できなかったリンク。期間が読めているものは特別ダイヤで塗り潰す */
  needsReviewLinks?: ClassifiedLink[]
  state: State
  liveOverrides: Record<string, string>
  holidays: Holiday[]
  today: string
  runAt: string
  /**
   * ページからの抽出が正常だったか（時刻表リンクを1件以上取れたか）。
   * false のときは「掲載から消えたイベント」の連続確認カウントを進めない。
   * ページ構造の変更で全リンクを見失った回に、有効なイベントを撤去しないため。
   */
  extractionHealthy?: boolean
  /** 差し替え可能なリポジトリアクセス（テスト用） */
  readTimetable?: (fileName: string) => Timetable | null
  timetableExists?: (fileName: string) => boolean
}

export interface PlanOutput {
  filePlans: FilePlan[]
  calendar: CalendarResult
  nextState: State
  validationFailures: string[]
  warnings: Warning[]
}

function counts(timetable: Timetable): { station: number; campus: number } {
  return {
    station: timetable.routes.station_to_campus.schedule.length,
    campus: timetable.routes.campus_to_station.schedule.length,
  }
}

function existingDerived(state: State, decision: ChangeDecision): string[] {
  const { link } = decision
  if (link.kind === 'regular') return state.regular?.derived ?? []
  if (link.kind === 'vacation' && link.season) return state.vacations?.[link.season]?.derived ?? []
  if (link.kind === 'event' && link.dates?.[0]) return state.events?.[link.dates[0]]?.derived ?? []
  return []
}

export function buildPlan(input: PlanInput): PlanOutput {
  const readTimetable = input.readTimetable ?? readTimetableFromRepo
  const timetableExists = input.timetableExists ?? timetableExistsInRepo
  const warnings: Warning[] = []
  const validationFailures: string[] = []
  const filePlans: FilePlan[] = []
  const plannedWrites = new Set<string>()
  const succeeded = new Map<string, { decision: ChangeDecision; derived: string[] }>()

  for (const [key, reason] of input.ocrFailures ?? new Map<string, string>()) {
    validationFailures.push(`${key}: ${reason}`)
  }

  /** 撤去されたイベントの時刻表 ID（override から外れていれば calculateOverrides が削除計画に載せる） */
  const retiredEventIds: string[] = []

  for (const decision of input.decisions) {
    if (decision.action === 'skip') continue

    if (decision.action !== 'ocr') {
      // 画像は同一。state のメタだけ更新し、override は既存 derived を使って再計算する。
      // ただし event は「画像は同じまま掲載テキストの日付だけ増減する」ことがあるので、
      // 日付ごとのファイル（timetable_event_YYYYMMDD）を揃え直す（FR-4）。
      if (decision.link.kind === 'event') {
        const synced = syncEventFiles(
          decision,
          existingDerived(input.state, decision),
          readTimetable,
          (fileName) => plannedWrites.has(fileName) || timetableExists(fileName),
          warnings,
        )
        for (const plan of synced.plans) {
          filePlans.push(plan)
          plannedWrites.add(plan.fileName)
        }
        retiredEventIds.push(...synced.retired)
        succeeded.set(decision.key, { decision, derived: synced.derived })
        continue
      }
      succeeded.set(decision.key, { decision, derived: existingDerived(input.state, decision) })
      continue
    }

    const intermediate = input.intermediates.get(decision.key)
    if (!intermediate) continue // OCR 失敗 or 未実施

    const result = assemble(decision.link, intermediate, decision.effectiveDates)
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        validationFailures.push(`${decision.key}: ${error}（元画像: ${decision.imageUrl}）`)
      }
      continue
    }

    const plans: FilePlan[] = []
    for (const output of result.outputs) {
      const existing = readTimetable(output.fileName)
      const prevCounts = existing ? counts(existing) : undefined
      const validation = validateTimetable(output.timetable, {
        fileName: output.fileName,
        ...(prevCounts ? { prevCounts } : {}),
        ocrVerified: true,
      })
      if (!validation.ok) {
        for (const error of validation.errors) {
          validationFailures.push(`${output.fileName}: ${error}（元画像: ${decision.imageUrl}）`)
        }
        continue
      }
      for (const warning of validation.warnings) {
        warnings.push({
          level: 'warn',
          code: 'count_delta',
          message: `${output.fileName}: ${warning}`,
          ...(decision.imageUrl ? { url: decision.imageUrl } : {}),
        })
      }
      plans.push({
        op: existing ? 'update' : 'create',
        fileName: output.fileName,
        kind: decision.link.kind,
        ...(decision.imageUrl ? { sourceUrl: decision.imageUrl } : {}),
        timetable: output.timetable,
        counts: counts(output.timetable),
        ...(prevCounts ? { prevCounts } : {}),
      })
    }

    // 1つでも検証に落ちたら、その画像由来のファイルは全部書かない（中途半端な取り込みを避ける）
    if (plans.length !== result.outputs.length) continue

    for (const plan of plans) {
      filePlans.push(plan)
      plannedWrites.add(plan.fileName)
    }
    succeeded.set(decision.key, { decision, derived: plans.map((p) => p.fileName.replace(/\.json$/, '')) })
  }

  let nextState = applyToState(input.state, succeeded, input.runAt)

  // 掲載から消えた／延期された未来イベントの撤去（連続確認方式）
  const reconciled = reconcileEvents(
    nextState,
    new Set(
      input.decisions
        .filter((d) => d.link.kind === 'event' && d.link.dates?.[0])
        .map((d) => d.link.dates![0]!),
    ),
    input.today,
    input.extractionHealthy ?? true,
    warnings,
  )
  nextState = reconciled.state
  retiredEventIds.push(...reconciled.retired)

  nextState = pruneEvents(nextState, input.today)
  nextState = applySpecials(nextState, input.needsReviewLinks ?? [], input.today, input.runAt, warnings)

  const calendar = calculateOverrides({
    liveOverrides: input.liveOverrides,
    ...(input.state.managed_overrides ? { prevManaged: input.state.managed_overrides } : {}),
    ...(input.state.suppressed_overrides ? { prevSuppressed: input.state.suppressed_overrides } : {}),
    state: nextState,
    holidays: input.holidays,
    today: input.today,
    retiredEventIds,
    timetableExists: (id) => plannedWrites.has(`${id}.json`) || timetableExists(`${id}.json`),
  })
  warnings.push(...calendar.warnings)

  nextState.managed_overrides = calendar.managed
  if (Object.keys(calendar.suppressed).length > 0) nextState.suppressed_overrides = calendar.suppressed
  else delete nextState.suppressed_overrides

  for (const fileName of calendar.deletions) {
    filePlans.push({ op: 'delete', fileName, kind: 'event' })
  }

  return { filePlans, calendar, nextState, validationFailures, warnings }
}

/**
 * 画像は同一だが掲載テキストの日付だけ変わった event の、日付ごとのファイルを揃える（FR-4）。
 *
 * event の時刻表は「1 枚の画像 → 適用日ごとに同内容のファイル」という作りなので
 * （assemble.ts の event 分岐）、日付が増えたときも既存ファイルの複製で足りる。
 * これをやらないと、追加された日の `timetable_event_YYYYMMDD` が存在せず、
 * calendar.ts の存在ゲートでその日の override が黙って落ちる。
 */
function syncEventFiles(
  decision: ChangeDecision,
  existing: string[],
  readTimetable: (fileName: string) => Timetable | null,
  exists: (fileName: string) => boolean,
  warnings: Warning[],
): { plans: FilePlan[]; derived: string[]; retired: string[] } {
  const dates = decision.effectiveDates ?? decision.link.dates ?? []
  const wanted = dates.map((date) => eventIdForDate(date))
  const plans: FilePlan[] = []

  // 複製元は既存 derived のうち実在するもの。無ければ複製できない
  const sourceId = existing.find((id) => exists(`${id}.json`))

  for (const id of wanted) {
    const fileName = `${id}.json`
    if (exists(fileName)) continue
    if (!sourceId) {
      warnings.push({
        level: 'warn',
        code: 'event_source_missing',
        message:
          `イベントの適用日 ${id.replace('timetable_event_', '')} が追加されましたが、` +
          '複製元の時刻表ファイルが見つからないため作成できません。手動で確認してください。',
        ...(decision.imageUrl ? { url: decision.imageUrl } : {}),
      })
      continue
    }
    const source = readTimetable(`${sourceId}.json`)
    if (!source) continue
    const timetable = JSON.parse(JSON.stringify(source)) as Timetable
    timetable.id = id
    plans.push({
      op: 'create',
      fileName,
      kind: 'event',
      ...(decision.imageUrl ? { sourceUrl: decision.imageUrl } : {}),
      timetable,
      counts: counts(timetable),
    })
  }

  // 適用日から外れた日のファイルは撤去候補にする（override から外れていれば削除される）
  const retired = existing.filter((id) => !wanted.includes(id) && /^timetable_event_\d{8}$/.test(id))

  return { plans, derived: wanted.length > 0 ? wanted : existing, retired }
}

/**
 * 掲載ページから消えた／延期された未来イベントを撤去する（連続確認方式）。
 *
 * イベントが中止・延期されると掲載行ごと消えるが、state に残ったままだと
 * その日に存在しない便を表示し続けてしまう。一方 1 回消えただけで撤去すると
 * ページ側の一時的な編集で有効なイベントを落とすため、CONFIG.eventMissingRunsBeforeRemoval 回
 * 連続で消えていることを確認してから撤去する。撤去は PR に載るので人のレビューを必ず通る。
 *
 * 延期（同じ URL のまま日付だけ変更）は「旧キーが消える → 新しい日付が新規イベントとして
 * 取り込まれる」の組み合わせで処理される。
 */
export function reconcileEvents(
  state: State,
  presentKeys: Set<string>,
  today: string,
  extractionHealthy: boolean,
  warnings: Warning[],
): { state: State; retired: string[] } {
  if (!state.events) return { state, retired: [] }

  const events: Record<string, StateEvent> = {}
  const retired: string[] = []

  for (const [key, entry] of Object.entries(state.events)) {
    const hasFuture = entry.dates.some((d) => !isBefore(d, today))

    // 見つかった or もう未来の適用日が無い（pruneEvents に任せる）→ カウントを消す
    if (presentKeys.has(key) || !hasFuture) {
      const { missing_count: _dropped, ...rest } = entry
      events[key] = rest
      continue
    }

    if (!extractionHealthy) {
      warnings.push({
        level: 'info',
        code: 'event_missing_unverified',
        message:
          `イベント（${entry.label || key}）のリンクが見つかりませんでしたが、` +
          'ページから時刻表リンクを1件も抽出できていないため撤去の判定には数えません。',
      })
      events[key] = entry
      continue
    }

    const count = (entry.missing_count ?? 0) + 1
    if (count >= CONFIG.eventMissingRunsBeforeRemoval) {
      warnings.push({
        level: 'warn',
        code: 'event_removed',
        message:
          `イベント（${entry.label || key} / ${entry.dates.join(', ')}）のリンクが ${count} 回連続で` +
          '掲載ページから見つかりませんでした。中止・延期と判断して override と時刻表ファイルを撤去します。' +
          '実際には開催される場合は、この PR を取り込まずに掲載ページを確認してください。',
        url: entry.url,
      })
      retired.push(...entry.derived.filter((id) => /^timetable_event_\d{8}$/.test(id)))
      continue
    }

    warnings.push({
      level: 'warn',
      code: 'event_link_missing',
      message:
        `イベント（${entry.label || key} / ${entry.dates.join(', ')}）のリンクが掲載ページから見つかりません` +
        `（${count} 回連続 / ${CONFIG.eventMissingRunsBeforeRemoval} 回で撤去）。掲載ページを確認してください。`,
      url: entry.url,
    })
    events[key] = { ...entry, missing_count: count }
  }

  return { state: { ...state, events }, retired }
}

/**
 * 分類できなかった掲示（needs_review）のうち【期間の両端が読めているもの】を state に記録する。
 * calculateOverrides がこれを見て timetable_special の override を張り、アプリはその日
 * 発車時刻を出さずに大学ホームページへ誘導する。PR を見落としても誤った時刻を出さないための保険。
 *
 * 【適用日リストではなく period を持つ理由】
 * 適用日を展開して持つと、日が進むたびに state.json が書き換わり
 * 「state だけが変わった PR」が期間中ずっと毎日立つ。過去日の切り捨ては
 * calculateOverrides の put() が行うので、ここは掲示の内容だけを写し取る。
 */
export function applySpecials(
  state: State,
  links: ClassifiedLink[],
  today: string,
  runAt: string,
  warnings: Warning[],
): State {
  const next: State = { ...state }
  const specials: Record<string, StateSpecial> = {}

  for (const link of links) {
    // 期間の両端が読めないものは適用先を決められない（needs_review 自体の警告は detectChanges が出す）
    if (!link.start || !link.end) continue
    // 掲示は残っているが期間は終わっている
    if (isBefore(link.end, today)) continue
    // 逆転期間は eachDate が 0 日を返すため、放置すると「特別ダイヤにしました」とだけ
    // 報告して実際には何も変えない誤報になる。分類側でも弾いているが state 経由の
    // 古い値が残る可能性があるのでここでも止める。
    if (isAfter(link.start, link.end)) {
      warnings.push({
        level: 'warn',
        code: 'special_range_invalid',
        message:
          `読み取れない時刻表の期間が逆転しています（${link.start}〜${link.end}）。` +
          `日付の誤読の可能性があるため特別ダイヤを適用しません: 「${link.normalizedLine}」`,
        url: link.url,
      })
      continue
    }

    const span = eachDate(link.start, link.end)
    if (span.length > CONFIG.specialMaxRangeDays) {
      warnings.push({
        level: 'warn',
        code: 'special_range_too_long',
        message:
          `読み取れない時刻表の期間が ${span.length} 日（${link.start}〜${link.end}）と長すぎるため、` +
          `特別ダイヤを適用しません。日付の誤読の可能性があります: 「${link.normalizedLine}」`,
        url: link.url,
      })
      continue
    }

    const prev = state.specials?.[link.start]
    specials[link.start] = {
      url: link.url,
      line: link.normalizedLine,
      period: { start: link.start, end: link.end },
      reason: link.reason ?? '',
      // 掲示が変わっていなければ前回値を保つ（同じ日に2回実行しても state が変わらないように）
      processed_at: prev && prev.url === link.url ? prev.processed_at : runAt,
    }

    warnings.push({
      level: 'warn',
      code: 'special_applied',
      message:
        `読み取れない時刻表のため ${link.start}〜${link.end} を特別ダイヤにしました` +
        '（アプリは発車時刻を出さず大学ホームページへ誘導します）。' +
        `掲示を確認し、通常どおり読める日があれば手動で override を設定してください: 「${link.normalizedLine}」`,
      url: link.url,
    })
  }

  const keys = Object.keys(specials).sort()
  if (keys.length === 0) {
    delete next.specials
    return next
  }
  const sorted: Record<string, StateSpecial> = {}
  for (const key of keys) sorted[key] = specials[key]!
  next.specials = sorted
  return next
}

export function applyToState(
  state: State,
  succeeded: Map<string, { decision: ChangeDecision; derived: string[] }>,
  runAt: string,
): State {
  const next: State = JSON.parse(JSON.stringify(state)) as State

  for (const { decision, derived } of succeeded.values()) {
    const { link } = decision
    /**
     * state に記録する URL は【リンクの正規化 URL】(link.url) であって、実際に取得した URL
     * (decision.imageUrl) ではない。detectChanges が突合するのが link.url だからである。
     *
     * 取得 URL を保存すると、
     *   - % エンコードの有無（link.url はデコード済み・取得は rawHref）
     *   - 原寸フォールバック（`0817--1024x724.jpg` → `0817-.jpg`）
     * の2点で構造的に一致せず、毎回「URL が変わった」と判定して画像を再ダウンロードしてしまう
     * （FR-4 の「URL 同一 → スキップ」と NFR-8「画像 DL は変更分のみ」が効かなくなる）。
     * §9 の state スキーマ例もデコード済みのリンク URL を示している。
     */
    const url = link.url
    const sha256 = decision.sha256 ?? ''
    const processedAt = decision.action === 'ocr' ? runAt : undefined

    if (link.kind === 'regular') {
      next.regular = {
        url,
        sha256,
        ...(link.start ? { start: link.start } : {}),
        derived: derived.length > 0 ? derived : (next.regular?.derived ?? []),
        processed_at: processedAt ?? next.regular?.processed_at ?? runAt,
      }
      continue
    }

    if (link.kind === 'vacation' && link.season) {
      next.vacations = next.vacations ?? {}
      next.vacations[link.season] = {
        url,
        sha256,
        period: { start: link.start!, ...(link.end ? { end: link.end } : {}) },
        derived: derived.length > 0 ? derived : (next.vacations[link.season]?.derived ?? []),
        processed_at: processedAt ?? next.vacations[link.season]?.processed_at ?? runAt,
      }
      continue
    }

    if (link.kind === 'event' && link.dates?.[0]) {
      const key = link.dates[0]
      next.events = next.events ?? {}
      next.events[key] = {
        url,
        sha256,
        label: link.label ?? '',
        dates: decision.effectiveDates ?? link.dates,
        derived: derived.length > 0 ? derived : (next.events[key]?.derived ?? []),
        processed_at: processedAt ?? next.events[key]?.processed_at ?? runAt,
      }
    }
  }

  return next
}
