/**
 * OCR 後の純粋な計画作成（組み立て → 検証 → state 更新 → カレンダー再計算）。
 *
 * ネットワークにも書き込みにも触れないので、fixtures を使ったエンドツーエンド検証ができる。
 * index.ts（オーケストレータ）と test/integration.test.ts の双方がここを通る。
 */

import { assemble } from './assemble.js'
import { calculateOverrides, type CalendarResult } from './calendar.js'
import { pruneEvents, type ChangeDecision } from './detectChanges.js'
import { readTimetable as readTimetableFromRepo, timetableExists as timetableExistsInRepo } from './files.js'
import { validateTimetable } from './validate.js'
import type { FilePlan, Holiday, Intermediate, State, Timetable, Warning } from './types.js'

export interface PlanInput {
  decisions: ChangeDecision[]
  /** 論理キー → OCR 中間構造（読み取りに成功したものだけ） */
  intermediates: Map<string, Intermediate>
  /** 論理キー → OCR 失敗理由 */
  ocrFailures?: Map<string, string>
  state: State
  liveOverrides: Record<string, string>
  holidays: Holiday[]
  today: string
  runAt: string
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

  for (const decision of input.decisions) {
    if (decision.action === 'skip') continue

    if (decision.action !== 'ocr') {
      // 画像は同一。state のメタだけ更新し、override は既存 derived を使って再計算する
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
  nextState = pruneEvents(nextState, input.today)

  const calendar = calculateOverrides({
    liveOverrides: input.liveOverrides,
    ...(input.state.managed_overrides ? { prevManaged: input.state.managed_overrides } : {}),
    ...(input.state.suppressed_overrides ? { prevSuppressed: input.state.suppressed_overrides } : {}),
    state: nextState,
    holidays: input.holidays,
    today: input.today,
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
