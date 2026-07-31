/**
 * FR-4: 変更検知。
 * state.json と URL / SHA-256 を突合して OCR 対象を決める。
 * 「安全側 default」に従い、判定できないものは取り込まず警告に落とす。
 */

import { fetchImage, type ImageResult } from './fetchImage.js'
import { isAfter, isBefore, todayJst } from './time.js'
import type { ClassifiedLink, Season, State, Warning } from './types.js'

/** 画像に対して行う処理 */
export type ChangeAction =
  | 'ocr' // 新規 or 画像が変わった → OCR する
  | 'url_only' // 画像は同一で URL だけ変わった → state の URL を更新するだけ
  | 'meta_only' // 画像は同一で期間・日付だけ変わった → override 再計算のみ
  | 'unchanged' // 変化なし（override 再計算のみ）
  | 'skip' // 取り込まない（将来開始の regular・全日過去の event など）

export interface ChangeDecision {
  /** 論理キー: `regular` / `vacation:{season}` / `event:{最初の日付}` */
  key: string
  link: ClassifiedLink
  action: ChangeAction
  reason: string
  /** action==='ocr' のとき必ず入る */
  image?: Extract<ImageResult, { ok: true }>
  /** 既知 or 取得した画像の SHA-256 */
  sha256?: string
  /** 実際に取得した URL（原寸フォールバック後） */
  imageUrl?: string
  /** event: today 以降に絞った適用日 */
  effectiveDates?: string[]
}

export interface DetectResult {
  decisions: ChangeDecision[]
  warnings: Warning[]
}

export function logicalKey(link: ClassifiedLink): string | null {
  if (link.kind === 'regular') return 'regular'
  if (link.kind === 'vacation') return link.season ? `vacation:${link.season}` : null
  if (link.kind === 'event') return link.dates?.[0] ? `event:${link.dates[0]}` : null
  return null
}

function stateEntry(state: State, link: ClassifiedLink): { url: string; sha256: string } | undefined {
  if (link.kind === 'regular') return state.regular
  if (link.kind === 'vacation' && link.season) return state.vacations?.[link.season]
  if (link.kind === 'event' && link.dates?.[0]) return state.events?.[link.dates[0]]
  return undefined
}

/** 期間・日付などテキスト側のメタが state と変わったか */
function metaChanged(state: State, link: ClassifiedLink): boolean {
  if (link.kind === 'regular') return state.regular?.start !== link.start
  if (link.kind === 'vacation' && link.season) {
    const v = state.vacations?.[link.season]
    if (!v) return false
    return v.period.start !== link.start || v.period.end !== link.end
  }
  if (link.kind === 'event' && link.dates?.[0]) {
    const e = state.events?.[link.dates[0]]
    if (!e) return false
    return JSON.stringify(e.dates) !== JSON.stringify(link.dates)
  }
  return false
}

/**
 * regular が複数併存する場合（前期・後期の移行期等）は
 * start ≤ today のうち start が最新の1件を採用し、他はログに残す。
 */
function selectRegular(
  links: ClassifiedLink[],
  today: string,
  warnings: Warning[],
): { chosen: ClassifiedLink | null; future: ClassifiedLink[] } {
  const regulars = links.filter((l) => l.kind === 'regular')
  if (regulars.length === 0) return { chosen: null, future: [] }

  const parsable = regulars.filter((l) => Boolean(l.start))
  for (const l of regulars) {
    if (!l.start) {
      warnings.push({
        level: 'warn',
        code: 'regular_unparsable_start',
        message: `通常ダイヤの適用開始日が解析できません: 「${l.normalizedLine}」`,
        url: l.url,
      })
    }
  }

  const applicable = parsable.filter((l) => !isAfter(l.start!, today))
  const future = parsable.filter((l) => isAfter(l.start!, today))

  for (const l of future) {
    warnings.push({
      level: 'info',
      code: 'regular_future_start',
      message: `将来開始の通常ダイヤを検知しました（${l.start}〜）。開始日以降に自動取込します。`,
      url: l.url,
    })
  }

  if (applicable.length === 0) return { chosen: null, future }

  const chosen = applicable.reduce((a, b) => (isBefore(a.start!, b.start!) ? b : a))
  for (const l of applicable) {
    if (l !== chosen) {
      warnings.push({
        level: 'info',
        code: 'regular_superseded',
        message: `複数の通常ダイヤリンクがあるため、開始日が最新の ${chosen.start} を採用しました（不採用: ${l.start}）。`,
        url: l.url,
      })
    }
  }
  return { chosen, future }
}

export async function detectChanges(
  links: ClassifiedLink[],
  state: State,
  today: string = todayJst(),
): Promise<DetectResult> {
  const warnings: Warning[] = []
  const decisions: ChangeDecision[] = []

  // needs_review はここで警告に落として以降の処理から外す
  for (const l of links.filter((x) => x.kind === 'needs_review')) {
    warnings.push({
      level: 'warn',
      code: 'needs_review_link',
      message: l.reason ?? '分類不能の時刻表リンクがあります。',
      url: l.url,
    })
  }

  // FR-2 の 6(b): state に regular があるのに今回1件も抽出できなかった
  if (state.regular && !links.some((l) => l.kind === 'regular')) {
    warnings.push({
      level: 'info',
      code: 'regular_link_missing',
      message:
        '前回まで存在した通常ダイヤのリンクが今回のページから見つかりませんでした。' +
        '既存の timetable_weekday / timetable_holiday は変更しません（ページ文言の変更を確認してください）。',
    })
  }

  const { chosen: chosenRegular } = selectRegular(links, today, warnings)

  const targets: ClassifiedLink[] = []
  if (chosenRegular) targets.push(chosenRegular)
  targets.push(...links.filter((l) => l.kind === 'vacation' || l.kind === 'event'))

  const seenSeasons = new Set<Season>()

  for (const link of targets) {
    const key = logicalKey(link)
    if (!key) {
      warnings.push({
        level: 'warn',
        code: 'logical_key_unresolved',
        message: `論理キーを決められないリンクをスキップしました: 「${link.normalizedLine}」`,
        url: link.url,
      })
      continue
    }

    // 同一季節の vacation が複数ある場合は最初の1件のみ採用
    if (link.kind === 'vacation' && link.season) {
      if (seenSeasons.has(link.season)) {
        warnings.push({
          level: 'warn',
          code: 'vacation_duplicate_season',
          message: `同じ季節（${link.season}）の長期休暇リンクが複数あります。2件目以降は取り込みません: 「${link.normalizedLine}」`,
          url: link.url,
        })
        continue
      }
      seenSeasons.add(link.season)
    }

    // event: 全日付が過去ならスキップ、一部過去なら today 以降のみ
    let effectiveDates: string[] | undefined
    if (link.kind === 'event') {
      const dates = link.dates ?? []
      effectiveDates = dates.filter((d) => !isBefore(d, today))
      if (effectiveDates.length === 0) {
        decisions.push({
          key,
          link,
          action: 'skip',
          reason: `適用日がすべて過去のイベントのため取り込みません（${dates.join(', ')}）。`,
        })
        continue
      }
      if (effectiveDates.length < dates.length) {
        const past = dates.filter((d) => isBefore(d, today))
        warnings.push({
          level: 'info',
          code: 'event_partially_past',
          message: `複数日イベントのうち過去日はスキップしました（スキップ: ${past.join(', ')} / 取込: ${effectiveDates.join(', ')}）。`,
          url: link.url,
        })
      }
    }

    const prev = stateEntry(state, link)

    // 変化なし（URL 同一）→ Gemini 呼び出し 0 回
    if (prev && prev.url === link.url) {
      decisions.push({
        key,
        link,
        action: metaChanged(state, link) ? 'meta_only' : 'unchanged',
        reason: metaChanged(state, link)
          ? '画像は同一で掲載テキストの日付・期間のみ変わったため、override を再計算します。'
          : '前回から変化なし。',
        sha256: prev.sha256,
        imageUrl: prev.url,
        ...(effectiveDates ? { effectiveDates } : {}),
      })
      continue
    }

    // 新規 or URL 変更 → 画像を取得して SHA-256 を突合
    const image = await fetchImage(link.rawHref)
    if (!image.ok) {
      warnings.push({
        level: 'warn',
        code: 'image_fetch_failed',
        message: `${image.reason}（${link.kind}: 「${link.normalizedLine}」）`,
        url: image.url,
      })
      decisions.push({ key, link, action: 'skip', reason: image.reason })
      continue
    }

    if (prev && prev.sha256 === image.sha256) {
      decisions.push({
        key,
        link,
        action: 'url_only',
        reason: '画像の内容は同一で URL だけが変わったため、OCR せず state の URL を更新します。',
        sha256: image.sha256,
        imageUrl: image.url,
        ...(effectiveDates ? { effectiveDates } : {}),
      })
      continue
    }

    decisions.push({
      key,
      link,
      action: 'ocr',
      reason: prev ? '画像が変更されたため再 OCR します。' : '新規の時刻表画像です。',
      image,
      sha256: image.sha256,
      imageUrl: image.url,
      ...(effectiveDates ? { effectiveDates } : {}),
    })
  }

  return { decisions, warnings }
}

/** writeState 時の event プルーニング: dates が全日過去のエントリを落とす */
export function pruneEvents(state: State, today: string = todayJst()): State {
  if (!state.events) return state
  const kept: Record<string, (typeof state.events)[string]> = {}
  for (const [key, entry] of Object.entries(state.events)) {
    if (entry.dates.some((d) => !isBefore(d, today))) kept[key] = entry
  }
  return { ...state, events: kept }
}
