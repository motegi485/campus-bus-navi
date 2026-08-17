/**
 * FR-4: 変更検知。
 * state.json と URL / SHA-256 を突合して OCR 対象を決める。
 * 「安全側 default」に従い、判定できないものは取り込まず警告に落とす。
 */

import { CONFIG } from './config.js'
import { fetchImage, revalidateImage, type ImageResult } from './fetchImage.js'
import { isAfter, isBefore, parseDate, todayJst } from './time.js'
import type { ClassifiedLink, Season, State, StateFetchCheck, Warning } from './types.js'

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
  /** 次回の条件付き GET に使う検証子と、内容一致を確認できた日（state へ引き継ぐ） */
  check?: StateFetchCheck
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

function stateEntry(
  state: State,
  link: ClassifiedLink,
): ({ url: string; sha256: string } & StateFetchCheck) | undefined {
  if (link.kind === 'regular') return state.regular
  if (link.kind === 'vacation' && link.season) return state.vacations?.[link.season]
  if (link.kind === 'event' && link.dates?.[0]) return state.events?.[link.dates[0]]
  return undefined
}

/** a から b までの経過日数（負にならないよう 0 で下げ止める） */
function daysSince(from: string | undefined, today: string): number | null {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null
  return Math.max(0, parseDate(today).diff(parseDate(from), 'day'))
}

/**
 * URL が同じエントリを、今回の実行で再検証するべきか。
 *
 * - 検証子がある → 毎回確かめる（304 が返るだけで画像本体は流れない）
 * - 検証子が無い → 最後に確認できた日から間隔が空いたときだけ（大学サイトへの配慮）
 * - 一度も確認していない（古い state） → 確かめる
 */
function shouldRevalidate(prev: StateFetchCheck, today: string): boolean {
  if (prev.etag || prev.last_modified) return true
  const age = daysSince(prev.checked_at, today)
  if (age === null) return true
  return age >= CONFIG.imageRevalidateIntervalDays
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

export interface DetectOptions {
  /**
   * 取得フェーズの締切（epoch ミリ秒）。これを過ぎたら新たな取得を始めない。
   * 省略すると締切なし（テスト・ドライラン用）。
   */
  deadlineAt?: number
  /** 1 実行で画像を取得しにいくリンク数の上限。省略すると CONFIG の値 */
  maxFetches?: number
}

export async function detectChanges(
  links: ClassifiedLink[],
  state: State,
  today: string = todayJst(),
  options: DetectOptions = {},
): Promise<DetectResult> {
  const warnings: Warning[] = []
  const decisions: ChangeDecision[] = []

  // ── 取得の予算 ──────────────────────────────────────────────────────────
  // 逐次取得には全体の上限が要る。無いと、遅い新規リンクが並ぶだけで取得だけに
  // 実行時間を使い切り、レポートもメールも残さずジョブごと強制終了される。
  const maxFetches = options.maxFetches ?? CONFIG.maxImageFetchesPerRun
  let fetchCount = 0
  /** 予算切れで取り込まなかったリンク（まとめて 1 件の警告にする） */
  const deferred: { link: ClassifiedLink; reason: string }[] = []

  /** いま新しい取得を始めてよいか。駄目なら理由を返す */
  const budgetBlock = (): string | null => {
    if (fetchCount >= maxFetches) {
      return `1 実行で取得できるリンク数の上限（${maxFetches} 件）に達しました`
    }
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      return `取得フェーズの締切（${Math.round(CONFIG.fetchDeadlineMs / 60000)} 分）に達しました`
    }
    return null
  }

  // needs_review はここで警告に落として以降の処理から外す
  for (const l of links.filter((x) => x.kind === 'needs_review')) {
    warnings.push({
      level: 'warn',
      code: 'needs_review_link',
      message: l.reason ?? '分類不能の時刻表リンクがあります。',
      url: l.url,
    })
  }

  // FR-2 の 6(b): state に regular があるのに今回1件も抽出できなかった。
  //
  // 【level は warn】通常ダイヤは平日・休日の 2 系列を支える土台で、リンクを見失うと
  // URL か state が変わるまで古い表を出し続ける。info のままだと、他に差分が無い日は
  // メールの送信条件に入らず、「書かなかった判断も通知する」という約束から漏れる。
  // 掲示の一時的な揺れでも鳴るが、古い表が数週間居座るより誤報の方が安い。
  if (state.regular && !links.some((l) => l.kind === 'regular')) {
    warnings.push({
      level: 'warn',
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

    // URL 同一。ただし「URL が同じ ＝ 中身も同じ」とは限らないので、
    // 検証子つきの条件付き GET（または間隔を空けた再取得）で確かめる。
    // 変わっていなければ Gemini 呼び出しは 0 回のまま。
    if (prev && prev.url === link.url) {
      const meta = metaChanged(state, link)
      const baseReason = meta
        ? '画像は同一で掲載テキストの日付・期間のみ変わったため、override を再計算します。'
        : '前回から変化なし。'
      const unchangedDecision = (check: StateFetchCheck, note: string) => {
        decisions.push({
          key,
          link,
          action: meta ? 'meta_only' : 'unchanged',
          reason: `${baseReason}${note}`,
          sha256: prev.sha256,
          imageUrl: prev.url,
          check,
          ...(effectiveDates ? { effectiveDates } : {}),
        })
      }

      const blocked = budgetBlock()
      if (blocked) {
        // 予算切れ。既存データはそのまま維持し、確認できていないことだけ記録する
        deferred.push({ link, reason: blocked })
        unchangedDecision(
          {
            ...(prev.etag ? { etag: prev.etag } : {}),
            ...(prev.last_modified ? { last_modified: prev.last_modified } : {}),
            ...(prev.checked_at ? { checked_at: prev.checked_at } : {}),
          },
          '（予算切れのため再確認せず）',
        )
        continue
      }

      if (!shouldRevalidate(prev, today)) {
        // 前回の確認から間もない。検証子を持たない配信元への配慮で毎日は取りに行かない
        unchangedDecision(
          {
            ...(prev.etag ? { etag: prev.etag } : {}),
            ...(prev.last_modified ? { last_modified: prev.last_modified } : {}),
            ...(prev.checked_at ? { checked_at: prev.checked_at } : {}),
          },
          '',
        )
        continue
      }

      fetchCount += 1
      const revalidated = await revalidateImage(link.rawHref, {
        sha256: prev.sha256,
        ...(prev.etag ? { etag: prev.etag } : {}),
        ...(prev.last_modified ? { lastModified: prev.last_modified } : {}),
      })

      if (revalidated.status === 'unchanged') {
        unchangedDecision(
          {
            ...(revalidated.etag ? { etag: revalidated.etag } : {}),
            ...(revalidated.lastModified ? { last_modified: revalidated.lastModified } : {}),
            checked_at: today,
          },
          '（同一 URL の内容も再確認済み）',
        )
        continue
      }

      if (revalidated.status === 'unknown') {
        // 確かめられなかった。既存データは触らないが、黙って「変化なし」とはしない。
        // 一時障害で毎日メールを鳴らさないよう、長く確認できていないときだけ warn へ上げる
        const age = daysSince(prev.checked_at, today)
        const stale = age === null || age >= CONFIG.imageRecheckStaleDays
        warnings.push({
          level: stale ? 'warn' : 'info',
          code: 'image_revalidate_failed',
          message:
            `同一 URL の画像が差し替わっていないかを確認できませんでした（${revalidated.reason}）。` +
            (stale
              ? `最後に内容を確認できてから ${age === null ? '記録がありません' : `${age} 日経過しています`}。` +
                '掲載ページと配信ホストの状態を確認してください。'
              : '既存のデータはそのまま維持します。'),
          url: link.url,
        })
        unchangedDecision(
          {
            ...(prev.etag ? { etag: prev.etag } : {}),
            ...(prev.last_modified ? { last_modified: prev.last_modified } : {}),
            ...(prev.checked_at ? { checked_at: prev.checked_at } : {}),
          },
          '（再確認は失敗）',
        )
        continue
      }

      // 中身が差し替わっていた。URL は同じでも OCR し直す
      warnings.push({
        level: 'info',
        code: 'image_replaced_same_url',
        message: '同じ URL のまま画像が差し替わっていました。読み直します。',
        url: link.url,
      })
      decisions.push({
        key,
        link,
        action: 'ocr',
        reason: '同一 URL のまま画像が差し替わっていたため再 OCR します。',
        image: revalidated.image,
        sha256: revalidated.image.sha256,
        imageUrl: revalidated.image.url,
        check: {
          ...(revalidated.image.etag ? { etag: revalidated.image.etag } : {}),
          ...(revalidated.image.lastModified ? { last_modified: revalidated.image.lastModified } : {}),
          checked_at: today,
        },
        ...(effectiveDates ? { effectiveDates } : {}),
      })
      continue
    }

    // 新規 or URL 変更 → 画像を取得して SHA-256 を突合
    const blockedNew = budgetBlock()
    if (blockedNew) {
      // 新規は既存データが無いので取り込めない。翌日の実行で再試行される
      deferred.push({ link, reason: blockedNew })
      decisions.push({ key, link, action: 'skip', reason: `${blockedNew}。翌日の実行で再試行します。` })
      continue
    }

    fetchCount += 1
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

    // 取得できた回は必ず検証子と確認日を残す（次回以降の再検証の起点になる）
    const check: StateFetchCheck = {
      ...(image.etag ? { etag: image.etag } : {}),
      ...(image.lastModified ? { last_modified: image.lastModified } : {}),
      checked_at: today,
    }

    if (prev && prev.sha256 === image.sha256) {
      decisions.push({
        key,
        link,
        action: 'url_only',
        reason: '画像の内容は同一で URL だけが変わったため、OCR せず state の URL を更新します。',
        sha256: image.sha256,
        imageUrl: image.url,
        check,
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
      check,
      ...(effectiveDates ? { effectiveDates } : {}),
    })
  }

  // 予算切れで見送った分は必ず顕在化させる（黙って切らない）
  if (deferred.length > 0) {
    warnings.push({
      level: 'warn',
      code: 'fetch_budget_exhausted',
      message:
        `${deferred[0]!.reason}。${deferred.length} 件のリンクを今回は確認・取得しませんでした` +
        `（対象: ${deferred.map((d) => d.link.normalizedLine).join(' / ')}）。` +
        '既存のデータはそのまま維持し、翌日の実行で再試行します。',
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
