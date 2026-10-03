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
  RejectedImage,
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
  /**
   * 今回ページから抽出した【全】時刻表リンクの正規化 URL（分類・採否を問わない）。
   * applySpecials が「前回 special にした掲示がまだ載っているか」を判定するのに使う。
   * decisions には needs_review や不採用の regular が含まれないため、別に受け取る。
   * 省略すると「掲示の有無」を判定できず、前回の special は従来どおり今回の
   * needs_review だけで置き換わる。
   */
  presentUrls?: Set<string>
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

/**
 * 掲示はあるのに取り込めなかったイベント（FR-9【v1.16】）。
 * 今日以降の適用日を特別ダイヤにする。state には保存せず、毎回の決定から求め直す
 * （成功・掲示の消失・全日過去で自然に外れる。state が毎日書き換わることもない）。
 */
export interface FailedEvent {
  key: string
  url: string
  line: string
  /** 今日以降の適用日 */
  dates: string[]
  reason: string
  /** false は画像の内容による拒否（同じ内容の間は読み直さない） */
  retry: boolean
  /** 実際に特別ダイヤの override を張れた日（手動 override・人の削除がある日は含まない） */
  specialDates: string[]
}

export interface PlanOutput {
  filePlans: FilePlan[]
  calendar: CalendarResult
  nextState: State
  validationFailures: string[]
  warnings: Warning[]
  /** 取り込めなかったイベント（通知メールに特別ダイヤにした日として載せる） */
  failedEvents: FailedEvent[]
}

function counts(timetable: Timetable): { station: number; campus: number } {
  return {
    station: timetable.routes.station_to_campus.schedule.length,
    campus: timetable.routes.campus_to_station.schedule.length,
  }
}

/** event の決定に対応する state の項目（旧キーを含む。同じ画像 URL のものを先頭に） */
function prevEventEntries(state: State, decision: ChangeDecision): StateEvent[] {
  return (decision.stateKeys ?? [])
    .map((key) => state.events?.[key])
    .filter((entry): entry is StateEvent => Boolean(entry))
}

function existingDerived(state: State, decision: ChangeDecision): string[] {
  const { link } = decision
  if (link.kind === 'regular') return state.regular?.derived ?? []
  if (link.kind === 'vacation' && link.season) return state.vacations?.[link.season]?.derived ?? []
  if (link.kind === 'event') return [...new Set(prevEventEntries(state, decision).flatMap((entry) => entry.derived))]
  return []
}

/** 成功として state へ書く内容（event は適用日と猶予中の日を上書きで渡す） */
interface Succeeded {
  decision: ChangeDecision
  derived: string[]
  /** event: state に記録する適用日（今日以降の掲示の日付 ＋ 撤去を猶予中の日付） */
  dates?: string[]
  /** event: 掲示から消えて撤去を猶予中の日付と連続回数 */
  removedDates?: Record<string, number>
}

/**
 * 掲示から消えた今日以降の適用日を、すぐには撤去しない（FR-4【v1.16】）。
 *
 * 先頭日付が変わった掲示を同じ画像 URL で引き継ぐようになったため、抽出の取りこぼしで
 * 適用日が減って見えると、それがそのまま「適用日から外れた」としてファイルと override の
 * 即時削除につながる（改修前は別キー扱いで、3 回連続の確認という猶予があった）。
 * 消えた日は CONFIG.eventMissingRunsBeforeRemoval 回連続で確認できるまで残す。
 */
function applyRemovalGrace(
  prevEntries: StateEvent[],
  wantedDates: string[],
  today: string,
  decision: ChangeDecision,
  warnings: Warning[],
): { keptDates: string[]; removedDates: Record<string, number> } {
  const prevRemoved: Record<string, number> = {}
  for (const entry of prevEntries) Object.assign(prevRemoved, entry.removed_dates ?? {})
  const prevFuture = [...new Set(prevEntries.flatMap((entry) => entry.dates))].filter((d) => !isBefore(d, today))

  const keptDates: string[] = []
  const removedDates: Record<string, number> = {}
  for (const date of prevFuture.sort()) {
    if (wantedDates.includes(date)) continue
    const count = (prevRemoved[date] ?? 0) + 1
    const label = decision.link.label || decision.link.normalizedLine
    if (count >= CONFIG.eventMissingRunsBeforeRemoval) {
      warnings.push({
        level: 'warn',
        code: 'event_date_retired',
        message:
          `イベント（${label}）の適用日 ${date} が ${count} 回連続で掲示から見つからなかったため、` +
          'その日の時刻表と override を撤去します。実際には運行される場合は掲載ページを確認してください。',
        url: decision.link.url,
      })
      continue
    }
    keptDates.push(date)
    removedDates[date] = count
    warnings.push({
      level: 'warn',
      code: 'event_date_removed',
      message:
        `イベント（${label}）の適用日 ${date} が掲示から見つかりません（${count} 回連続 / ` +
        `${CONFIG.eventMissingRunsBeforeRemoval} 回で撤去）。読み取りの取りこぼしの可能性もあるため、それまでは残します。`,
      url: decision.link.url,
    })
  }
  return { keptDates, removedDates }
}

export function buildPlan(input: PlanInput): PlanOutput {
  const readTimetable = input.readTimetable ?? readTimetableFromRepo
  const timetableExists = input.timetableExists ?? timetableExistsInRepo
  const warnings: Warning[] = []
  const validationFailures: string[] = []
  const filePlans: FilePlan[] = []
  const plannedWrites = new Set<string>()
  const succeeded = new Map<string, Succeeded>()
  /** 取り込めなかった決定の理由（論理キー → 理由）。特別ダイヤにした日の説明に使う */
  const failureReasons = new Map<string, string>()
  /** 画像の内容を理由に今回拒否した event（正規化 URL → 記録） */
  const newlyRejected = new Map<string, RejectedImage>()

  for (const [key, reason] of input.ocrFailures ?? new Map<string, string>()) {
    validationFailures.push(`${key}: ${reason}`)
    failureReasons.set(key, reason)
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
          prevEventEntries(input.state, decision),
          readTimetable,
          (fileName) => plannedWrites.has(fileName) || timetableExists(fileName),
          input.today,
          warnings,
        )
        for (const plan of synced.plans) {
          filePlans.push(plan)
          plannedWrites.add(plan.fileName)
        }
        retiredEventIds.push(...synced.retired)
        succeeded.set(decision.key, {
          decision,
          derived: synced.derived,
          dates: synced.dates,
          removedDates: synced.removedDates,
        })
        continue
      }
      succeeded.set(decision.key, { decision, derived: existingDerived(input.state, decision) })
      continue
    }

    const intermediate = input.intermediates.get(decision.key)
    if (!intermediate) continue // OCR 失敗 or 未実施

    // regular / vacation の特殊便の注記は、取り込みは止めずに知らせるだけ（既存の挙動を後退させない）
    if (decision.link.kind !== 'event' && intermediate.day_types.some((d) => d.irregular_notes === true)) {
      warnings.push({
        level: 'warn',
        code: 'irregular_notes_detected',
        message:
          '時刻表画像に、通常と違う乗り場・行先の注記が付いた便があると読み取りました。' +
          '取り込みは行いましたが、注記は時刻表に反映されません。元画像を確認してください。',
        ...(decision.imageUrl ? { url: decision.imageUrl } : {}),
      })
    }

    const result = assemble(decision.link, intermediate, decision.effectiveDates)
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        validationFailures.push(`${decision.key}: ${error}（元画像: ${decision.imageUrl}）`)
      }
      failureReasons.set(decision.key, result.errors.join(' '))
      if (result.rejectCode && decision.link.kind === 'event' && decision.sha256) {
        newlyRejected.set(decision.link.url, {
          sha256: decision.sha256,
          reason_code: result.rejectCode,
          reason: result.errors.join(' '),
          ...(decision.check?.etag ? { etag: decision.check.etag } : {}),
          ...(decision.check?.last_modified ? { last_modified: decision.check.last_modified } : {}),
          checked_at: input.today,
        })
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
        failureReasons.set(decision.key, `${output.fileName}: ${validation.errors.join(' ')}`)
        continue
      }
      plans.push({
        op: existing ? 'update' : 'create',
        fileName: output.fileName,
        kind: decision.link.kind,
        ...(decision.imageUrl ? { sourceUrl: decision.imageUrl } : {}),
        timetable: output.timetable,
        ...(existing ? { prevTimetable: existing } : {}),
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
    const newIds = plans.map((p) => p.fileName.replace(/\.json$/, ''))
    if (decision.link.kind !== 'event') {
      succeeded.set(decision.key, { decision, derived: newIds })
      continue
    }

    // event: 旧キーから引き継いだ日のうち、掲示から消えた今日以降の日は猶予の間だけ旧ファイルを残す。
    // 残さない旧ファイル（過去日・猶予切れ）は撤去候補にする（載せないと管理外の孤児として残り続ける）
    const prevEntries = prevEventEntries(input.state, decision)
    const wantedDates = decision.effectiveDates ?? decision.link.dates ?? []
    const grace = applyRemovalGrace(prevEntries, wantedDates, input.today, decision, warnings)
    const keptIds = grace.keptDates.map((date) => eventIdForDate(date))
    // 猶予で残す日のファイルも、今回読んだ画像の内容で書き直す。旧画像の内容のまま残すと、
    // 後で日付が増えたときにそれが複製元に選ばれ、新しい日に古い時刻を書いてしまう
    const template = plans[0]?.timetable
    for (const id of keptIds) {
      if (newIds.includes(id) || !template) continue
      const fileName = `${id}.json`
      const existing = readTimetable(fileName)
      const timetable: Timetable = { ...(JSON.parse(JSON.stringify(template)) as Timetable), id }
      if (existing) timetable.name = existing.name
      filePlans.push({
        op: existing ? 'update' : 'create',
        fileName,
        kind: 'event',
        ...(decision.imageUrl ? { sourceUrl: decision.imageUrl } : {}),
        timetable,
        ...(existing ? { prevTimetable: existing, prevCounts: counts(existing) } : {}),
        counts: counts(timetable),
      })
      plannedWrites.add(fileName)
    }
    const derived = [...new Set([...newIds, ...keptIds])].sort()
    retiredEventIds.push(
      ...existingDerived(input.state, decision).filter(
        (id) => !derived.includes(id) && /^timetable_event_\d{8}$/.test(id),
      ),
    )
    succeeded.set(decision.key, {
      decision,
      derived,
      dates: [...new Set([...wantedDates, ...grace.keptDates])].sort(),
      removedDates: grace.removedDates,
    })
  }

  let nextState = applyToState(input.state, succeeded, input.runAt)

  // 掲載から消えた／延期された未来イベントの撤去（連続確認方式）。
  // 今回の掲示に対応づけた旧キー（先頭日付が変わる前のキー）も「掲示にある」と数える。
  // 数えないと、取り込みに失敗した回に旧キーの項目が「消えた」と数えられ、3 回目に撤去される
  const presentEventKeys = new Set<string>()
  for (const d of input.decisions) {
    if (d.link.kind !== 'event') continue
    if (d.link.dates?.[0]) presentEventKeys.add(d.link.dates[0])
    for (const key of d.stateKeys ?? []) presentEventKeys.add(key)
  }
  const reconciled = reconcileEvents(
    nextState,
    presentEventKeys,
    input.today,
    input.extractionHealthy ?? true,
    warnings,
  )
  nextState = reconciled.state
  retiredEventIds.push(...reconciled.retired)

  // 全適用日が過ぎて state から落とす event のファイルも撤去候補にする。通常は過去日の管理キー
  // （managed.event）から削除されるが、取り込めなかった日を特別ダイヤで隠していた場合は
  // managed.event に載っていないため、ここで拾わないと孤児ファイルとして残り続ける（v1.16）
  for (const entry of Object.values(nextState.events ?? {})) {
    if (entry.dates.some((d) => !isBefore(d, input.today))) continue
    retiredEventIds.push(...entry.derived.filter((id) => /^timetable_event_\d{8}$/.test(id)))
  }
  nextState = pruneEvents(nextState, input.today)
  nextState = applySpecials(nextState, input.needsReviewLinks ?? [], input.today, input.runAt, warnings, {
    ...(input.presentUrls ? { presentUrls: input.presentUrls } : {}),
    // 今回「有効なデータとして扱えた」リンク（OCR 成功・画像同一・URL のみ変更を含む）
    succeededUrls: new Set([...succeeded.values()].map((s) => s.decision.link.url)),
    extractionHealthy: input.extractionHealthy ?? true,
  })

  // 掲示はあるのに取り込めなかったイベント（FR-9【v1.16】）。
  //   - OCR に回したのに成功しなかった（OCR 失敗・上限・締切・未実施・組み立て/検証失敗）
  //   - 画像を取得できなかった・取得の予算切れ・内容を理由に拒否済み（failure 付きの skip）
  // 全日過去の skip は failure を持たないので含まれない
  const failedEvents: FailedEvent[] = []
  for (const d of input.decisions) {
    if (d.link.kind !== 'event') continue
    const failed = (d.action === 'ocr' && !succeeded.has(d.key)) || (d.action === 'skip' && d.failure !== undefined)
    if (!failed) continue
    const dates = (d.link.dates ?? []).filter((date) => !isBefore(date, input.today))
    if (dates.length === 0) continue
    failedEvents.push({
      key: d.key,
      url: d.link.url,
      line: d.link.normalizedLine,
      dates,
      reason:
        failureReasons.get(d.key) ??
        (d.action === 'ocr' ? 'OCR を実施していません（SKIP_OCR・鍵なし等）。' : d.reason),
      // 拒否記録がある掲示は、今回が取得失敗でも、回復後は内容が変わるまで読み直さない
      retry:
        !newlyRejected.has(d.link.url) &&
        input.state.rejected_images?.[d.link.url] === undefined &&
        (d.failure?.retry ?? true),
      specialDates: [],
    })
  }

  nextState = applyRejectedImages(nextState, input.decisions, newlyRejected, succeeded, input.presentUrls)
  nextState = markPendingReplacements(nextState, input.decisions, succeeded)

  const calendar = calculateOverrides({
    liveOverrides: input.liveOverrides,
    ...(input.state.managed_overrides ? { prevManaged: input.state.managed_overrides } : {}),
    ...(input.state.suppressed_overrides ? { prevSuppressed: input.state.suppressed_overrides } : {}),
    state: nextState,
    holidays: input.holidays,
    today: input.today,
    retiredEventIds,
    failedEventDates: failedEvents.flatMap((f) => f.dates),
    timetableExists: (id) => plannedWrites.has(`${id}.json`) || timetableExists(`${id}.json`),
  })
  warnings.push(...calendar.warnings)

  // 実際に特別ダイヤを張れた日だけを報告する（手動 override や人が消した日は put で落ちる）
  for (const failed of failedEvents) {
    failed.specialDates = failed.dates.filter((date) => calendar.nextOverrides[date] === CONFIG.specialTimetableId)
    const label = failed.line
    if (failed.specialDates.length > 0) {
      warnings.push({
        level: 'warn',
        code: 'event_failed_special',
        message:
          `イベントの時刻表を取り込めなかったため、${failed.specialDates.join(', ')} を特別ダイヤにしました` +
          '（アプリは発車時刻を出さず大学ホームページへ誘導します）。' +
          (failed.retry
            ? '翌日以降の実行で読み取りを再試行し、成功すればイベントダイヤに置き換わります。'
            : '画像の内容が変わるまで読み直しません。必要なら手動で override と時刻表を設定してください。') +
          `理由: ${failed.reason}「${label}」`,
        url: failed.url,
      })
    }
    const notSpecial = failed.dates.filter((date) => !failed.specialDates.includes(date))
    if (notSpecial.length > 0) {
      warnings.push({
        level: 'info',
        code: 'event_failed_manual_kept',
        message:
          `イベントの時刻表を取り込めませんでしたが、${notSpecial.join(', ')} は手動 override または人が削除した日付のため、` +
          `特別ダイヤにしていません「${label}」。`,
        url: failed.url,
      })
    }
  }

  nextState.managed_overrides = calendar.managed
  if (Object.keys(calendar.suppressed).length > 0) nextState.suppressed_overrides = calendar.suppressed
  else delete nextState.suppressed_overrides

  for (const fileName of calendar.deletions) {
    filePlans.push({ op: 'delete', fileName, kind: 'event' })
  }

  return { filePlans, calendar, nextState, validationFailures, warnings, failedEvents }
}

/**
 * 同じ URL のまま差し替わった画像を取り込めなかった event に、差し替え後の SHA-256 を記録する（FR-4【v1.16】）。
 *
 * state の sha256 は前回取り込めた画像のまま残る（取り込めていないので更新しない）。記録が無いと、
 * 翌日の再確認が取得失敗・予算切れになった回に「変化なし」と扱われ、特別ダイヤが外れて差し替え前の
 * 古い時刻に戻る。記録がある間、detectChanges は内容を確かめられなかった回も失敗として扱う。
 * 取り込めた回は applyToState が項目を書き直すので、記録は自然に消える。
 */
function markPendingReplacements(
  state: State,
  decisions: ChangeDecision[],
  succeeded: Map<string, Succeeded>,
): State {
  let next = state
  for (const d of decisions) {
    if (d.link.kind !== 'event' || d.action !== 'ocr' || succeeded.has(d.key) || !d.sha256) continue
    const key = (d.stateKeys ?? []).find((k) => next.events?.[k]?.url === d.link.url)
    const entry = key ? next.events?.[key] : undefined
    if (!key || !entry || entry.sha256 === d.sha256 || entry.pending_sha256 === d.sha256) continue
    next = { ...next, events: { ...next.events, [key]: { ...entry, pending_sha256: d.sha256 } } }
  }
  return next
}

/**
 * 内容を理由に拒否した event 画像の記録を更新する（FR-7【v1.16】）。
 *
 *   - 今回拒否した画像 → 記録する（同じ内容の間は detectChanges が読み直さない）
 *   - 拒否済みと同じ内容だった画像 → 検証子と確認日を更新して残す
 *   - 掲示から消えた URL・有効なデータとして取り込めた URL → 捨てる
 *   - それ以外（今回は取得できなかった等）→ 前回の記録を残す
 */
function applyRejectedImages(
  state: State,
  decisions: ChangeDecision[],
  newlyRejected: Map<string, RejectedImage>,
  succeeded: Map<string, Succeeded>,
  presentUrls: Set<string> | undefined,
): State {
  const succeededUrls = new Set([...succeeded.values()].map((s) => s.decision.link.url))
  const next: Record<string, RejectedImage> = {}
  for (const [url, record] of Object.entries(state.rejected_images ?? {})) {
    if (presentUrls && !presentUrls.has(url)) continue
    if (succeededUrls.has(url)) continue
    next[url] = record
  }
  for (const d of decisions) {
    if (d.failure?.code !== 'rejected') continue
    const record = next[d.link.url]
    if (!record) continue
    next[d.link.url] = {
      ...record,
      ...(d.check?.etag ? { etag: d.check.etag } : {}),
      ...(d.check?.last_modified ? { last_modified: d.check.last_modified } : {}),
      checked_at: d.check?.checked_at ?? record.checked_at,
    }
  }
  for (const [url, record] of newlyRejected) next[url] = record

  const result: State = { ...state }
  const urls = Object.keys(next).sort()
  if (urls.length === 0) {
    delete result.rejected_images
    return result
  }
  result.rejected_images = {}
  for (const url of urls) result.rejected_images[url] = next[url]!
  return result
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
  prevEntries: StateEvent[],
  readTimetable: (fileName: string) => Timetable | null,
  exists: (fileName: string) => boolean,
  today: string,
  warnings: Warning[],
): { plans: FilePlan[]; derived: string[]; retired: string[]; dates: string[]; removedDates: Record<string, number> } {
  const existing = [...new Set(prevEntries.flatMap((entry) => entry.derived))]
  const wantedDates = decision.effectiveDates ?? decision.link.dates ?? []
  // 掲示から消えた今日以降の日は、猶予の間だけ残す（即時に撤去しない）
  const grace = applyRemovalGrace(prevEntries, wantedDates, today, decision, warnings)
  const dates = [...new Set([...wantedDates, ...grace.keptDates])].sort()
  const wanted = dates.map((date) => eventIdForDate(date))
  const plans: FilePlan[] = []

  // 複製元は既存 derived のうち実在するもの。今回も掲示にある日のファイルを優先する
  // （猶予中の日より、現在の掲示が指す日の方が今の画像から作られている見込みが高い）。無ければ複製できない
  const currentIds = new Set(wantedDates.map((date) => eventIdForDate(date)))
  const sourceId =
    existing.find((id) => currentIds.has(id) && exists(`${id}.json`)) ?? existing.find((id) => exists(`${id}.json`))

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

  // 適用日から外れた日（過去日・猶予切れ）のファイルは撤去候補にする（override から外れていれば削除される）
  const retired = existing.filter((id) => !wanted.includes(id) && /^timetable_event_\d{8}$/.test(id))

  return {
    plans,
    derived: wanted.length > 0 ? wanted : existing,
    retired,
    dates,
    removedDates: grace.removedDates,
  }
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

export interface ApplySpecialsOptions {
  /** 今回ページから抽出した全リンクの正規化 URL。無ければ「掲示の有無」は判定しない */
  presentUrls?: Set<string>
  /** 今回、有効なデータとして扱えた（OCR 成功・画像同一など）リンクの正規化 URL */
  succeededUrls?: Set<string>
  /** ページから時刻表リンクを 1 件以上抽出できたか（buildPlan と同じ意味） */
  extractionHealthy?: boolean
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
 *
 * 【前回の special を引き継ぐ条件・Codex レビュー FN-20260912-01】
 * 以前は「今回の needs_review 集合」で state.specials を丸ごと置き換えていた。すると、
 * 前回 needs_review だった掲示が同じ URL のまま文言の更新で vacation / regular / event に
 * 分類され、その画像の取得・OCR・検証に失敗した回に、成功したデータは何も無いのに
 * 保護だけが消えて、その期間が通常ダイヤ表示へ戻っていた（NFR-3「検証失敗は消さない」に反する）。
 * ページ構造の変更でリンクを 1 件も抽出できなかった回も同じ経路で全消去されていた
 * （reconcileEvents は extractionHealthy で守っていたが、こちらは守っていなかった）。
 * そこで前回の各エントリを、次の順で判定して引き継ぐ:
 *   1. 今回も同じ URL が needs_review にある → 今回の結果で置き換え済み（下のループが担当）
 *   2. 期間が終わっている → 捨てる
 *   3. 抽出が失敗した回 → 判定できないので維持（info）
 *   4. 掲示がページから消えた → 捨てる（従来どおり。掲示の消失＝解除）
 *   5. 同じ URL が有効なデータとして取り込めた → 置き換わったので捨てる
 *   6. それ以外（別分類になったが取り込みに失敗）→ 維持して warn で顕在化する
 */
export function applySpecials(
  state: State,
  links: ClassifiedLink[],
  today: string,
  runAt: string,
  warnings: Warning[],
  options: ApplySpecialsOptions = {},
): State {
  const next: State = { ...state }
  const specials: Record<string, StateSpecial> = {}
  /** 今回 needs_review として処理した URL。前回エントリの「置き換え済み」判定に使う */
  const reviewedUrls = new Set(links.map((link) => link.url))

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

  // 前回の special の引き継ぎ（関数コメントの判定順）。維持するときは processed_at ごと
  // そのまま残す（同じ日に 2 回実行しても state が変わらないように）
  for (const [start, prev] of Object.entries(state.specials ?? {})) {
    if (reviewedUrls.has(prev.url)) continue // 1. 今回の needs_review で置き換え済み
    if (isBefore(prev.period.end, today)) continue // 2. 期間終了
    if (start in specials) continue // 別の掲示が同じ開始日を取った（今回の結果を優先）

    const period = `${prev.period.start}〜${prev.period.end}`
    if (options.extractionHealthy === false) {
      // 3. 抽出失敗。掲示が消えたのか判定できないので消さない
      specials[start] = prev
      warnings.push({
        level: 'info',
        code: 'special_kept_unverified',
        message:
          `特別ダイヤ（${period}）の掲示が残っているか確認できませんでした` +
          '（ページから時刻表リンクを 1 件も抽出できていないため）。前回の特別ダイヤをそのまま維持します。',
        url: prev.url,
      })
      continue
    }
    if (options.presentUrls && !options.presentUrls.has(prev.url)) continue // 4. 掲示が消えた
    if (options.succeededUrls?.has(prev.url)) continue // 5. 有効なデータに置き換わった
    if (!options.presentUrls) continue // 掲示の有無を判定する材料が無い → 従来どおり置き換え

    // 6. 別の種別に分類されたが取り込めなかった。保護を外すと通常/休暇ダイヤを出してしまう
    specials[start] = prev
    warnings.push({
      level: 'warn',
      code: 'special_kept_unreplaced',
      message:
        `特別ダイヤ（${period}）の掲示は残っていますが、今回は時刻表として取り込めませんでした。` +
        '読み取りに成功するまで前回の特別ダイヤを維持します（アプリは発車時刻を出さず大学ホームページへ誘導します）。' +
        `掲示を確認し、必要なら手動で override を設定してください: 「${prev.line}」`,
      url: prev.url,
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
  succeeded: Map<string, Succeeded>,
  runAt: string,
): State {
  const next: State = JSON.parse(JSON.stringify(state)) as State

  /**
   * event の旧キー（先頭日付が変わる前のキー）を先にまとめて外す（FR-4【v1.16】）。
   * 書き込みと同じループで消すと、別の決定が先に同じキーへ書いた項目を消してしまう順序依存が残る。
   * 同じ画像 URL の項目であることを確かめてから外し、processed_at などは書き込み側で引き継ぐ。
   */
  const carried = new Map<string, StateEvent>()
  for (const { decision } of succeeded.values()) {
    const { link } = decision
    if (link.kind !== 'event' || !link.dates?.[0]) continue
    for (const oldKey of decision.stateKeys ?? []) {
      const entry = next.events?.[oldKey]
      if (!entry || entry.url !== link.url) continue
      if (!carried.has(link.url)) carried.set(link.url, entry)
      if (oldKey !== link.dates[0]) delete next.events![oldKey]
    }
  }

  for (const { decision, derived, dates, removedDates } of succeeded.values()) {
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
    /**
     * 再検証に使う検証子と、最後に内容一致を確認できた日（FR-4）。
     * detectChanges が決めた値をそのまま持ち越す。取れなかった項目は書かない
     * （空文字を残すと、次回の条件付き GET に無意味なヘッダを付けてしまう）。
     */
    const check = {
      ...(decision.check?.etag ? { etag: decision.check.etag } : {}),
      ...(decision.check?.last_modified ? { last_modified: decision.check.last_modified } : {}),
      ...(decision.check?.checked_at ? { checked_at: decision.check.checked_at } : {}),
    }

    if (link.kind === 'regular') {
      next.regular = {
        url,
        sha256,
        ...(link.start ? { start: link.start } : {}),
        derived: derived.length > 0 ? derived : (next.regular?.derived ?? []),
        processed_at: processedAt ?? next.regular?.processed_at ?? runAt,
        ...check,
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
        ...check,
      }
      continue
    }

    if (link.kind === 'event' && link.dates?.[0]) {
      const key = link.dates[0]
      next.events = next.events ?? {}
      const prev = carried.get(link.url) ?? next.events[key]
      next.events[key] = {
        url,
        sha256,
        label: link.label ?? '',
        dates: dates ?? decision.effectiveDates ?? link.dates,
        derived: derived.length > 0 ? derived : (prev?.derived ?? []),
        processed_at: processedAt ?? prev?.processed_at ?? runAt,
        ...check,
        ...(removedDates && Object.keys(removedDates).length > 0 ? { removed_dates: removedDates } : {}),
      }
    }
  }

  return next
}
