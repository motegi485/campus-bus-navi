/**
 * 同一 URL のまま画像が差し替わったときの検知（Codex レビュー S2-BOT-01 の回帰テスト）。
 *
 * 以前は「state の URL と今回の URL が同じ」だけで `unchanged` にしていたため、
 * 大学の CMS が同じ URL の内容を差し替えると、URL か state が別途変わるまで
 * 古い時刻表を出し続けた（見逃し期間に上限が無かった）。
 *
 * fetch はすべてスタブする。**このテストは実ネットワークへ出てはいけない**
 * （大学サイトへ無断でアクセスしないこと自体が Bot の要件）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  detectChanges,
  findEventStateKeys,
  ocrPriorityDate,
  sortOcrTargets,
  type ChangeDecision,
} from '../src/detectChanges.js'
import { CONFIG } from '../src/config.js'
import type { ClassifiedLink, State, StateEvent, Warning } from '../src/types.js'

const TODAY = '2026-08-01'
const URL_A = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/04/R8.jpg'

/** 実体が JPEG だと分かるバイト列（looksLikeImage が magic byte を見る） */
function jpeg(marker: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, marker, 0x00, 0x10])
}

/** JPEG の SHA-256（テスト側でも同じ計算をして state に入れる） */
async function sha256(buffer: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(buffer).digest('hex')
}

function regularLink(): ClassifiedLink {
  return {
    url: URL_A,
    rawHref: URL_A,
    anchorText: '時刻表はコチラ',
    lineText: '2026年4月4日（土）～ 通常授業日／休業日 時刻表はコチラ',
    normalizedLine: '2026年4月4日（土）～ 通常授業日／休業日 時刻表はコチラ',
    kind: 'regular',
    start: '2026-04-04',
  }
}

function stateWithRegular(extra: Partial<State['regular']> & { sha256: string }): State {
  return {
    version: 1,
    regular: {
      url: URL_A,
      start: '2026-04-04',
      derived: ['timetable_weekday', 'timetable_holiday'],
      processed_at: '2026-04-04T07:00:00+09:00',
      ...extra,
    } as State['regular'],
  }
}

/** fetch のスタブ。呼び出し回数とリクエストヘッダを記録する */
function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      return handler(url, init)
    })
  )
  return calls
}

function imageResponse(body: Buffer, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', ...headers },
  })
}

describe('同一 URL の再検証（S2-BOT-01）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('検証子があるときは条件付き GET を投げ、304 なら変化なしのままにする', async () => {
    const state = stateWithRegular({ sha256: 'sha-known', etag: '"v1"', checked_at: '2026-07-31' })
    const calls = stubFetch(() => new Response(null, { status: 304, headers: { etag: '"v1"' } }))

    const { decisions, warnings } = await detectChanges([regularLink()], state, TODAY)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers['if-none-match']).toBe('"v1"')
    expect(decisions[0]!.action).toBe('unchanged')
    // 確認できた日を更新して、次の再取得を先送りする
    expect(decisions[0]!.check?.checked_at).toBe(TODAY)
    expect(warnings).toHaveLength(0)
  })

  it('同じ URL のまま中身が差し替わっていたら OCR し直す', async () => {
    const known = jpeg(0xe0)
    const replaced = jpeg(0xe1)
    const state = stateWithRegular({ sha256: await sha256(known), etag: '"v1"' })
    stubFetch(() => imageResponse(replaced, { etag: '"v2"' }))

    const { decisions, warnings } = await detectChanges([regularLink()], state, TODAY)

    expect(decisions[0]!.action).toBe('ocr')
    expect(decisions[0]!.sha256).toBe(await sha256(replaced))
    expect(decisions[0]!.check).toEqual({ etag: '"v2"', checked_at: TODAY })
    expect(warnings.map((w) => w.code)).toContain('image_replaced_same_url')
  })

  it('取得し直しても内容が同じなら変化なし', async () => {
    const known = jpeg(0xe0)
    const state = stateWithRegular({ sha256: await sha256(known), checked_at: '2026-07-01' })
    stubFetch(() => imageResponse(known, { etag: '"v9"' }))

    const { decisions } = await detectChanges([regularLink()], state, TODAY)

    expect(decisions[0]!.action).toBe('unchanged')
    // 次回からは条件付き GET が使えるよう検証子を覚える
    expect(decisions[0]!.check).toEqual({ etag: '"v9"', checked_at: TODAY })
  })

  it('検証子が無く、前回の確認から間もないときは取りに行かない（大学サイトへの配慮）', async () => {
    const state = stateWithRegular({ sha256: 'sha-known', checked_at: TODAY })
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))

    const { decisions } = await detectChanges([regularLink()], state, TODAY)

    expect(calls).toHaveLength(0)
    expect(decisions[0]!.action).toBe('unchanged')
    expect(decisions[0]!.check?.checked_at).toBe(TODAY)
  })

  it('検証子が無くても間隔が空いていれば取りに行く', async () => {
    const known = jpeg(0xe0)
    // 間隔ちょうど前の日付にする
    const old = new Date(Date.parse(`${TODAY}T00:00:00Z`) - CONFIG.imageRevalidateIntervalDays * 86400000)
      .toISOString()
      .slice(0, 10)
    const state = stateWithRegular({ sha256: await sha256(known), checked_at: old })
    const calls = stubFetch(() => imageResponse(known))

    await detectChanges([regularLink()], state, TODAY)
    expect(calls).toHaveLength(1)
  })

  it('確認日の記録が無い古い state は必ず一度確かめる', async () => {
    const known = jpeg(0xe0)
    const state = stateWithRegular({ sha256: await sha256(known) })
    const calls = stubFetch(() => imageResponse(known))

    await detectChanges([regularLink()], state, TODAY)
    expect(calls).toHaveLength(1)
  })

  it('再検証に失敗しても既存データは触らず、まだ日が浅ければ info に留める', async () => {
    const state = stateWithRegular({ sha256: 'sha-known', etag: '"v1"', checked_at: '2026-07-31' })
    stubFetch(() => new Response('oops', { status: 500 }))

    const { decisions, warnings } = await detectChanges([regularLink()], state, TODAY)

    expect(decisions[0]!.action).toBe('unchanged')
    // 確認できていないので checked_at は進めない
    expect(decisions[0]!.check?.checked_at).toBe('2026-07-31')
    const w = warnings.find((x) => x.code === 'image_revalidate_failed')
    expect(w?.level).toBe('info')
  })

  it('長く確認できていない状態で再検証が失敗したら警告へ格上げする', async () => {
    const stale = new Date(Date.parse(`${TODAY}T00:00:00Z`) - (CONFIG.imageRecheckStaleDays + 1) * 86400000)
      .toISOString()
      .slice(0, 10)
    const state = stateWithRegular({ sha256: 'sha-known', etag: '"v1"', checked_at: stale })
    stubFetch(() => new Response('oops', { status: 500 }))

    const { warnings } = await detectChanges([regularLink()], state, TODAY)
    const w = warnings.find((x) => x.code === 'image_revalidate_failed')
    expect(w?.level).toBe('warn')
  })

  /**
   * state の sha256 は、原寸フォールバック（FR-5）を経て実際に取得できた URL のバイト列から作る。
   * 再検証がリンク記載 URL（リサイズ版）を直接取り直すと、同じ画像でも別バイト列になり、
   * **毎回「差し替わった」と誤判定して無駄な OCR が走る**（実際に DRY RUN で踏んだ）。
   */
  it('再検証も原寸フォールバックを経る（リサイズ版と原寸を取り違えない）', async () => {
    const RESIZED = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0817--1024x724.jpg'
    const ORIGINAL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0817-.jpg'
    const originalBytes = jpeg(0xe0)
    const resizedBytes = jpeg(0xe1)

    const link = { ...regularLink(), url: RESIZED, rawHref: RESIZED }
    const state: State = {
      version: 1,
      regular: {
        url: RESIZED,
        // 前回は原寸を取得できたので、その内容のハッシュが入っている
        sha256: await sha256(originalBytes),
        start: '2026-04-04',
        derived: ['timetable_weekday', 'timetable_holiday'],
        processed_at: '2026-04-04T07:00:00+09:00',
      },
    }
    const calls = stubFetch((url) =>
      imageResponse(url === ORIGINAL ? originalBytes : resizedBytes)
    )

    const { decisions, warnings } = await detectChanges([link], state, TODAY)

    expect(calls[0]!.url).toBe(ORIGINAL)
    expect(decisions[0]!.action).toBe('unchanged')
    expect(warnings.map((w) => w.code)).not.toContain('image_replaced_same_url')
  })

  it('取得の締切に達したら新しい取得を始めず、既存データを維持して警告する', async () => {
    const state = stateWithRegular({ sha256: 'sha-known', etag: '"v1"' })
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))

    // 既に過ぎた締切を渡す
    const { decisions, warnings } = await detectChanges([regularLink()], state, TODAY, {
      deadlineAt: Date.now() - 1,
    })

    expect(calls).toHaveLength(0)
    expect(decisions[0]!.action).toBe('unchanged')
    expect(warnings.map((w) => w.code)).toContain('fetch_budget_exhausted')
    expect(warnings.find((w) => w.code === 'fetch_budget_exhausted')?.level).toBe('warn')
  })

  it('件数上限に達したら新規リンクは取り込まず skip にする（黙って切らない）', async () => {
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))

    // state が空＝新規リンク。上限 0 件なので取得は起きない
    const { decisions, warnings } = await detectChanges([regularLink()], { version: 1 }, TODAY, {
      maxFetches: 0,
    })

    expect(calls).toHaveLength(0)
    expect(decisions[0]!.action).toBe('skip')
    expect(warnings.map((w) => w.code)).toContain('fetch_budget_exhausted')
  })

  it('許可外ホストへは再検証も行わない', async () => {
    const link = { ...regularLink(), url: 'https://evil.example.com/a.jpg', rawHref: 'https://evil.example.com/a.jpg' }
    const state: State = {
      version: 1,
      regular: {
        url: link.url,
        sha256: 'sha-known',
        start: '2026-04-04',
        derived: [],
        processed_at: '2026-04-04T07:00:00+09:00',
      },
    }
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))

    const { decisions, warnings } = await detectChanges([link], state, TODAY)

    expect(calls).toHaveLength(0)
    expect(decisions[0]!.action).toBe('unchanged')
    expect(warnings.map((w) => w.code)).toContain('image_revalidate_failed')
  })
})

// ---------------------------------------------------------------------------
// 通常ダイヤのリンクが無いときの警告レベル（FR-2 の 6(b)）。
// 大学ページは長期休暇中、通常ダイヤの掲示そのものを外すのが通常（2026-09-12 ユーザー説明）。
// 休暇期間中まで warn にすると、差分ゼロの日も毎日「⚠ 要確認」メールが届いてしまう。
// ---------------------------------------------------------------------------

describe('通常ダイヤのリンクが無いときの警告レベル', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const VACATION_URL = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/07/0817.jpg'

  function vacationLink(start = '2026-07-20', end = '2026-09-23'): ClassifiedLink {
    return {
      url: VACATION_URL,
      rawHref: VACATION_URL,
      anchorText: '時刻表はコチラ',
      lineText: `夏季休業 ${start}～${end} 時刻表はコチラ`,
      normalizedLine: `夏季休業 ${start}～${end} 時刻表はコチラ`,
      kind: 'vacation',
      season: 'summer',
      start,
      end,
    }
  }

  /** state に記録済みの夏季休暇。checked_at を今日にして、再検証の fetch を発生させない */
  function stateWithVacation(period: { start: string; end?: string }): State {
    return {
      ...stateWithRegular({ sha256: 'sha-regular', checked_at: TODAY }),
      vacations: {
        summer: {
          url: VACATION_URL,
          sha256: 'sha-vacation',
          period,
          derived: ['timetable_vacation_summer_weekday', 'timetable_vacation_summer_holiday'],
          processed_at: '2026-07-20T07:00:00+09:00',
          checked_at: TODAY,
        },
      },
    }
  }

  const regularMissing = (warnings: Warning[]) => warnings.filter((w) => w.code === 'regular_link_missing')

  it('休暇期間外に消えたら warn（従来どおり）', async () => {
    const { warnings } = await detectChanges([], stateWithRegular({ sha256: 'sha-regular' }), TODAY)
    expect(regularMissing(warnings).map((w) => w.level)).toEqual(['warn'])
  })

  it('state に記録済みの休暇期間に今日が含まれていれば info に落とす', async () => {
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))
    const { warnings } = await detectChanges([vacationLink()], stateWithVacation({ start: '2026-07-20', end: '2026-09-23' }), TODAY)
    expect(calls).toHaveLength(0)
    expect(regularMissing(warnings).map((w) => w.level)).toEqual(['info'])
    expect(regularMissing(warnings)[0]!.message).toContain('長期休暇の期間中')
  })

  it('休暇の初日など state に入る前でも、今回の掲示の期間に今日が含まれていれば info', async () => {
    stubFetch(() => imageResponse(jpeg(0xe0)))
    const { decisions, warnings } = await detectChanges([vacationLink()], stateWithRegular({ sha256: 'sha-regular' }), TODAY)
    expect(decisions[0]!.action).toBe('ocr') // 新規の休暇画像として取り込みに進む
    expect(regularMissing(warnings).map((w) => w.level)).toEqual(['info'])
  })

  it('休暇期間が終わった後に消えたままなら warn に戻る', async () => {
    const { warnings } = await detectChanges([], stateWithVacation({ start: '2026-06-01', end: '2026-07-31' }), TODAY)
    expect(regularMissing(warnings).map((w) => w.level)).toEqual(['warn'])
  })

  it('休暇の終了日が読めていない期間は数えない（warn のまま）', async () => {
    const { warnings } = await detectChanges([], stateWithVacation({ start: '2026-07-20' }), TODAY)
    expect(regularMissing(warnings).map((w) => w.level)).toEqual(['warn'])
  })

  it('通常ダイヤのリンクがあれば何も出さない', async () => {
    const state = stateWithRegular({ sha256: 'sha-regular', checked_at: TODAY })
    const { warnings } = await detectChanges([regularLink()], state, TODAY)
    expect(regularMissing(warnings)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// event の state キー移行・取り込み失敗・拒否記録（FR-4 / FR-7 / FR-9【v1.16】）。
// 2026-10-03 の事象（掲示が複数行に分かれ、先頭日付が 10/31 → 10/03 に変わった）を土台にする。
// ---------------------------------------------------------------------------

const EV_TODAY = '2026-10-03'
const URL_LECTURE = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/09/kouza.jpg'
const URL_OTHER = 'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/09/other.jpg'

function eventLink(dates: string[], url = URL_LECTURE, extra: Partial<ClassifiedLink> = {}): ClassifiedLink {
  return {
    url,
    rawHref: url,
    anchorText: '時刻表はコチラ',
    lineText: `● 公開講座 ${dates.join(' ')} 時刻表はコチラ`,
    normalizedLine: `● 公開講座 ${dates.join(' ')} 時刻表はコチラ`,
    kind: 'event',
    dates,
    label: '公開講座',
    ...extra,
  }
}

function stateEvent(url: string, dates: string[], extra: Partial<StateEvent> = {}): StateEvent {
  return {
    url,
    sha256: 'sha-event',
    label: '公開講座',
    dates,
    derived: [`timetable_event_${dates[0]!.replace(/-/g, '')}`],
    processed_at: '2026-09-29T07:00:00+09:00',
    ...extra,
  }
}

function stateWithEvents(events: Record<string, StateEvent>, extra: Partial<State> = {}): State {
  return { version: 1, events, ...extra }
}

/** detectChanges の決定を単体で組み立てる（並べ替え関数のテスト用） */
function decisionOf(link: ClassifiedLink, extra: Partial<ChangeDecision> = {}): ChangeDecision {
  return { key: link.kind, link, action: 'ocr', reason: '', ...extra }
}

describe('findEventStateKeys: event の state キーの探し方', () => {
  // 先頭日付が変わっても同じ画像の項目を見失わない（見失うと同じ画像を新規として読み直し、
  // 旧キーは「掲示から消えた」と数えられて撤去される）
  it('同じ URL の項目を最優先する（キーが今回の先頭日付と別でも、先頭日付キーに別 URL があっても）', () => {
    const state = stateWithEvents({
      '2026-10-03': stateEvent(URL_OTHER, ['2026-10-03']),
      '2026-10-31': stateEvent(URL_LECTURE, ['2026-10-31']),
    })
    expect(findEventStateKeys(state, eventLink(['2026-10-03', '2026-10-10', '2026-10-31']))).toEqual(['2026-10-31'])
  })

  it('同じ URL の項目が複数あればすべて返し、今回の先頭日付と同じキーを先頭にする', () => {
    const state = stateWithEvents({
      '2026-10-31': stateEvent(URL_LECTURE, ['2026-10-31']),
      '2026-10-10': stateEvent(URL_LECTURE, ['2026-10-10']),
      '2026-10-03': stateEvent(URL_LECTURE, ['2026-10-03']),
    })
    const keys = findEventStateKeys(state, eventLink(['2026-10-03', '2026-10-10', '2026-10-31']))
    expect(keys[0]).toBe('2026-10-03')
    expect([...keys].sort()).toEqual(['2026-10-03', '2026-10-10', '2026-10-31'])
  })

  it('同じ URL が無ければ今回の先頭日付のキーを返す（従来どおり）', () => {
    const state = stateWithEvents({ '2026-10-03': stateEvent(URL_OTHER, ['2026-10-03']) })
    expect(findEventStateKeys(state, eventLink(['2026-10-03']))).toEqual(['2026-10-03'])
  })

  it('URL も先頭日付キーも一致しなければ空', () => {
    const state = stateWithEvents({ '2026-10-31': stateEvent(URL_OTHER, ['2026-10-31']) })
    expect(findEventStateKeys(state, eventLink(['2026-10-03']))).toEqual([])
    expect(findEventStateKeys({ version: 1 }, eventLink(['2026-10-03']))).toEqual([])
  })

  it('event 以外のリンクには空を返す', () => {
    const state = stateWithEvents({ '2026-10-31': stateEvent(URL_A, ['2026-10-31']) })
    expect(findEventStateKeys(state, regularLink())).toEqual([])
  })
})

describe('先頭日付が変わった公開講座の引き継ぎ（2026-10-03 の事象）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // 10/31 だけ取り込めていた画像に、10/03・10/10 が読めるようになった。
  // 同じ画像なので Gemini を使わず、メタ変更として旧キーから複製させる
  it('同じ URL・同じ内容（304）なら meta_only になり、旧キーを stateKeys に載せ、OCR しない', async () => {
    const state = stateWithEvents({
      '2026-10-31': stateEvent(URL_LECTURE, ['2026-10-31'], { etag: '"v1"', checked_at: '2026-10-02' }),
    })
    const calls = stubFetch(() => new Response(null, { status: 304, headers: { etag: '"v1"' } }))

    const link = eventLink(['2026-10-03', '2026-10-10', '2026-10-31'])
    const { decisions } = await detectChanges([link], state, EV_TODAY)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers['if-none-match']).toBe('"v1"')
    expect(decisions).toHaveLength(1)
    const d = decisions[0]!
    expect(d.key).toBe('event:2026-10-03')
    expect(d.action).toBe('meta_only')
    expect(d.stateKeys).toEqual(['2026-10-31'])
    expect(d.sha256).toBe('sha-event')
    expect(d.effectiveDates).toEqual(['2026-10-03', '2026-10-10', '2026-10-31'])
    // Gemini の対象にならない（画像本体を持たない）
    expect(d.image).toBeUndefined()
    expect(d.failure).toBeUndefined()
  })
})

describe('拒否記録（rejected_images）による読み直しの抑止', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const rejectedState = (sha: string, extra: Partial<State> = {}): State => ({
    version: 1,
    rejected_images: {
      [URL_LECTURE]: {
        sha256: sha,
        reason_code: 'multi_table',
        reason: '日付ごとの別表があります',
        etag: '"r1"',
        checked_at: '2026-10-02',
      },
    },
    ...extra,
  })

  // 内容が同じ間は同じ理由で拒否されるだけなので、Gemini の枠を毎日使わない
  it('新規経路: 条件付き GET が 304 なら skip（rejected・再試行しない）で、画像本体は取りに行かない', async () => {
    const calls = stubFetch(() => new Response(null, { status: 304, headers: { etag: '"r1"' } }))

    const { decisions } = await detectChanges([eventLink(['2026-10-11', '2026-10-12'])], rejectedState('sha-rejected'), EV_TODAY)

    // 条件付き GET の 1 回だけ（fetchImage による本体取得が続かない）
    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers['if-none-match']).toBe('"r1"')
    const d = decisions[0]!
    expect(d.action).toBe('skip')
    expect(d.failure).toEqual({ code: 'rejected', retry: false })
    expect(d.image).toBeUndefined()
    expect(d.sha256).toBe('sha-rejected')
    expect(d.effectiveDates).toEqual(['2026-10-11', '2026-10-12'])
    expect(d.check?.checked_at).toBe(EV_TODAY)
  })

  it('新規経路: 検証子が効かず本体が返っても、sha が拒否記録と同じなら skip（rejected）', async () => {
    const body = jpeg(0xe0)
    const calls = stubFetch(() => imageResponse(body))

    const { decisions } = await detectChanges([eventLink(['2026-10-11'])], rejectedState(await sha256(body)), EV_TODAY)

    // 確認の 1 回だけで、続けて fetchImage が呼ばれない
    expect(calls).toHaveLength(1)
    expect(decisions[0]!.action).toBe('skip')
    expect(decisions[0]!.failure).toEqual({ code: 'rejected', retry: false })
    expect(decisions[0]!.image).toBeUndefined()
  })

  it('新規経路: 内容が変わっていたら拒否は引き継がず OCR する', async () => {
    const changed = jpeg(0xe1)
    stubFetch(() => imageResponse(changed, { etag: '"r2"' }))

    const { decisions } = await detectChanges([eventLink(['2026-10-11'])], rejectedState('sha-rejected'), EV_TODAY)

    const d = decisions[0]!
    expect(d.action).toBe('ocr')
    expect(d.sha256).toBe(await sha256(changed))
    expect(d.image).toBeDefined()
    expect(d.failure).toBeUndefined()
  })

  it('新規経路: 確認の取得に失敗したら skip（fetch_failed・翌日再試行）', async () => {
    stubFetch(() => new Response('oops', { status: 500 }))

    const { decisions, warnings } = await detectChanges([eventLink(['2026-10-11'])], rejectedState('sha-rejected'), EV_TODAY)

    expect(decisions[0]!.action).toBe('skip')
    expect(decisions[0]!.failure).toEqual({ code: 'fetch_failed', retry: true })
    expect(warnings.map((w) => w.code)).toContain('image_fetch_failed')
  })

  it('同 URL 経路: state の画像から差し替わっていても、拒否記録と同じ sha なら skip（rejected）', async () => {
    const replaced = jpeg(0xe1)
    const state = rejectedState(await sha256(replaced), {
      events: { '2026-10-11': stateEvent(URL_LECTURE, ['2026-10-11'], { sha256: 'sha-old', etag: '"v1"' }) },
    })
    stubFetch(() => imageResponse(replaced, { etag: '"v2"' }))

    const { decisions, warnings } = await detectChanges([eventLink(['2026-10-11'])], state, EV_TODAY)

    const d = decisions[0]!
    expect(d.action).toBe('skip')
    expect(d.failure).toEqual({ code: 'rejected', retry: false })
    expect(d.sha256).toBe(await sha256(replaced))
    expect(d.image).toBeUndefined()
    expect(d.stateKeys).toEqual(['2026-10-11'])
    // 読み直さないので「差し替わったので読み直す」とは言わない
    expect(warnings.map((w) => w.code)).not.toContain('image_replaced_same_url')
  })
})

describe('取り込めなかった理由（failure）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // failure を持つ event の適用日は buildPlan で特別ダイヤになる。理由文を解析させないための構造化
  it('予算切れで取得しなかった新規 event は fetch_deferred（再試行あり）', async () => {
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))

    const { decisions } = await detectChanges([eventLink(['2026-10-16'])], { version: 1 }, EV_TODAY, { maxFetches: 0 })

    expect(calls).toHaveLength(0)
    expect(decisions[0]!.action).toBe('skip')
    expect(decisions[0]!.failure).toEqual({ code: 'fetch_deferred', retry: true })
    expect(decisions[0]!.effectiveDates).toEqual(['2026-10-16'])
  })

  it('画像の取得に失敗した新規 event は fetch_failed（再試行あり）', async () => {
    stubFetch(() => new Response('oops', { status: 500 }))

    const { decisions } = await detectChanges([eventLink(['2026-10-16'])], { version: 1 }, EV_TODAY)

    expect(decisions[0]!.action).toBe('skip')
    expect(decisions[0]!.failure).toEqual({ code: 'fetch_failed', retry: true })
  })

  it('適用日がすべて過去の event の skip には failure を付けない（特別ダイヤにしない）', async () => {
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))

    const { decisions } = await detectChanges([eventLink(['2026-09-20', '2026-09-21'])], { version: 1 }, EV_TODAY)

    expect(calls).toHaveLength(0)
    expect(decisions[0]!.action).toBe('skip')
    expect(decisions[0]!.failure).toBeUndefined()
  })
})

describe('まとめたことで種別が変わった掲示の警告（grouping_changed_kind）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const groupingWarnings = (warnings: Warning[]) => warnings.filter((w) => w.code === 'grouping_changed_kind')

  // リンク行だけでは分類できず、見出し・日付行とまとめて初めて読める形は正常（2026-10-03 の掲示）
  it('リンク行だけでは needs_review だったものは警告しない', async () => {
    stubFetch(() => imageResponse(jpeg(0xe0)))
    const { warnings } = await detectChanges(
      [eventLink(['2026-10-16'], URL_LECTURE, { ungroupedKind: 'needs_review' })],
      { version: 1 },
      EV_TODAY,
    )
    expect(groupingWarnings(warnings)).toEqual([])
  })

  it('まとめる前後で種別が同じ・まとめていない場合は警告しない', async () => {
    stubFetch(() => imageResponse(jpeg(0xe0)))
    const { warnings } = await detectChanges(
      [eventLink(['2026-10-16'], URL_LECTURE, { ungroupedKind: 'event' }), eventLink(['2026-10-19'], URL_OTHER)],
      { version: 1 },
      EV_TODAY,
    )
    expect(groupingWarnings(warnings)).toEqual([])
  })

  it('まとめる前後で種別が変わったら warn（見出しの語を巻き込んだ可能性）', async () => {
    stubFetch(() => imageResponse(jpeg(0xe0)))
    const { warnings } = await detectChanges(
      [eventLink(['2026-10-16'], URL_LECTURE, { ungroupedKind: 'regular' })],
      { version: 1 },
      EV_TODAY,
    )
    const w = groupingWarnings(warnings)
    expect(w).toHaveLength(1)
    expect(w[0]!.level).toBe('warn')
    expect(w[0]!.url).toBe(URL_LECTURE)
  })
})

describe('OCR を読む順番（ocrPriorityDate / sortOcrTargets）', () => {
  // 呼び出し上限に当たっても直近の日の画像から読まれているようにする（2026-10-03 は 10/19 が読めなかった）
  const vacation = (start: string): ClassifiedLink => ({
    url: URL_OTHER,
    rawHref: URL_OTHER,
    anchorText: '時刻表はコチラ',
    lineText: '冬季休業',
    normalizedLine: '冬季休業',
    kind: 'vacation',
    season: 'winter',
    start,
    end: '2027-01-07',
  })

  it('event は今日以降で最も近い適用日', () => {
    expect(ocrPriorityDate(decisionOf(eventLink(['2026-09-29', '2026-10-10', '2026-10-31'])), EV_TODAY)).toBe('2026-10-10')
    // effectiveDates があればそれを使う
    expect(
      ocrPriorityDate(decisionOf(eventLink(['2026-10-03', '2026-10-10']), { effectiveDates: ['2026-10-10'] }), EV_TODAY),
    ).toBe('2026-10-10')
    // 今日そのものも対象
    expect(ocrPriorityDate(decisionOf(eventLink(['2026-10-03', '2026-10-10'])), EV_TODAY)).toBe(EV_TODAY)
  })

  it('vacation は開始日と今日の遅い方', () => {
    expect(ocrPriorityDate(decisionOf(vacation('2026-12-24')), EV_TODAY)).toBe('2026-12-24')
    expect(ocrPriorityDate(decisionOf(vacation('2026-09-01')), EV_TODAY)).toBe(EV_TODAY)
  })

  it('regular は今日', () => {
    expect(ocrPriorityDate(decisionOf(regularLink()), EV_TODAY)).toBe(EV_TODAY)
  })

  it('直近の日の順に並べ、同じ日なら元の順を保つ', () => {
    const ev19 = decisionOf(eventLink(['2026-10-19'], 'https://www.fukuyama-u.ac.jp/a19.jpg'))
    const ev11 = decisionOf(eventLink(['2026-10-11', '2026-10-12'], 'https://www.fukuyama-u.ac.jp/a11.jpg'))
    const vac = decisionOf(vacation('2026-12-24'))
    const reg = decisionOf(regularLink())
    const evToday = decisionOf(eventLink([EV_TODAY], 'https://www.fukuyama-u.ac.jp/a03.jpg'))
    const ev16 = decisionOf(eventLink(['2026-10-16'], 'https://www.fukuyama-u.ac.jp/a16.jpg'))

    const sorted = sortOcrTargets([ev19, vac, reg, ev11, evToday, ev16], EV_TODAY)

    // reg と evToday はどちらも今日。元の順（reg が先）を保つ
    expect(sorted).toEqual([reg, evToday, ev11, ev16, ev19, vac])
    // 逆の順で渡せば同日の 2 件も逆になる（安定ソート）
    expect(sortOcrTargets([evToday, reg], EV_TODAY)).toEqual([evToday, reg])
  })
})

describe('複数日イベントの途中でのメタ比較（metaChanged）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // state の dates は今日以降に絞って保存される。掲示に残る過去日と比べると、
  // 複数日イベントの途中で毎日「日付が変わった」と誤判定してしまう
  it('掲示に過去日が残っていても、今日以降の日付が同じなら unchanged', async () => {
    const today = '2026-10-18'
    const state = stateWithEvents({
      '2026-10-17': stateEvent(URL_LECTURE, ['2026-10-17', '2026-10-18'], { etag: '"v1"', checked_at: '2026-10-17' }),
    })
    stubFetch(() => new Response(null, { status: 304, headers: { etag: '"v1"' } }))

    const { decisions } = await detectChanges([eventLink(['2026-10-17', '2026-10-18'])], state, today)

    const d = decisions[0]!
    expect(d.action).toBe('unchanged')
    expect(d.stateKeys).toEqual(['2026-10-17'])
    expect(d.effectiveDates).toEqual(['2026-10-18'])
  })

  it('今日以降の日付が増えていれば meta_only', async () => {
    const today = '2026-10-18'
    const state = stateWithEvents({
      '2026-10-17': stateEvent(URL_LECTURE, ['2026-10-17', '2026-10-18'], { etag: '"v1"', checked_at: '2026-10-17' }),
    })
    stubFetch(() => new Response(null, { status: 304, headers: { etag: '"v1"' } }))

    const { decisions } = await detectChanges([eventLink(['2026-10-17', '2026-10-18', '2026-10-25'])], state, today)

    expect(decisions[0]!.action).toBe('meta_only')
  })
})

// ---------------------------------------------------------------------------
// 差し替わった画像を取り込めていない event（state.events の pending_sha256・FR-4【v1.16】）。
// sha256 は前回取り込めた画像のまま残るため、記録がある間に「内容を確かめられなかった回」を
// 変化なしにすると、特別ダイヤが外れて差し替え前の古い時刻に戻ってしまう。
// ---------------------------------------------------------------------------

describe('取り込めていない差し替え（pending_sha256）がある event の再確認', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const DATES = ['2026-10-11', '2026-10-12']

  /** 前回、同じ URL のまま差し替わった画像を取り込めなかった state（pending を省くと対照用） */
  function pendingState(options: { pending?: string; noEtag?: boolean; checkedAt?: string } = {}): State {
    const { pending = 'sha-new', noEtag = false, checkedAt = '2026-10-02' } = options
    const entry = stateEvent(URL_LECTURE, DATES, { sha256: 'sha-old', etag: '"v1"', checked_at: checkedAt })
    if (noEtag) delete entry.etag
    if (pending) entry.pending_sha256 = pending
    return stateWithEvents({ '2026-10-11': entry })
  }
  const noPending = { pending: '' }

  it('再確認が失敗（unknown）したら unchanged にせず skip + fetch_failed（再試行あり）', async () => {
    stubFetch(() => new Response('oops', { status: 500 }))

    const { decisions, warnings } = await detectChanges([eventLink(DATES)], pendingState(), EV_TODAY)

    const d = decisions[0]!
    expect(d.action).toBe('skip')
    expect(d.failure).toEqual({ code: 'fetch_failed', retry: true })
    expect(d.effectiveDates).toEqual(DATES)
    expect(d.stateKeys).toEqual(['2026-10-11'])
    // 前回の時刻（sha-old の内容）を有効なデータとして扱わない
    expect(d.sha256).toBeUndefined()
    // 再確認できなかったこと自体は従来どおり知らせる
    expect(warnings.map((w) => w.code)).toContain('image_revalidate_failed')
  })

  it('（対照）pending が無ければ、再確認の失敗は従来どおり unchanged', async () => {
    stubFetch(() => new Response('oops', { status: 500 }))

    const { decisions } = await detectChanges([eventLink(DATES)], pendingState(noPending), EV_TODAY)

    expect(decisions[0]!.action).toBe('unchanged')
    expect(decisions[0]!.failure).toBeUndefined()
  })

  it('取得予算切れ（maxFetches: 0）なら skip + fetch_deferred（再試行あり）で、取得もしない', async () => {
    const calls = stubFetch(() => imageResponse(jpeg(0xe0)))

    const { decisions, warnings } = await detectChanges([eventLink(DATES)], pendingState(), EV_TODAY, { maxFetches: 0 })

    expect(calls).toHaveLength(0)
    const d = decisions[0]!
    expect(d.action).toBe('skip')
    expect(d.failure).toEqual({ code: 'fetch_deferred', retry: true })
    expect(d.effectiveDates).toEqual(DATES)
    expect(warnings.map((w) => w.code)).toContain('fetch_budget_exhausted')
  })

  it('（対照）pending が無ければ、予算切れは従来どおり unchanged', async () => {
    stubFetch(() => imageResponse(jpeg(0xe0)))

    const { decisions } = await detectChanges([eventLink(DATES)], pendingState(noPending), EV_TODAY, { maxFetches: 0 })

    expect(decisions[0]!.action).toBe('unchanged')
    expect(decisions[0]!.failure).toBeUndefined()
  })

  it('検証子が無く今日確認済みでも、pending があれば再確認する（差し替え後の画像なら OCR へ）', async () => {
    const replaced = jpeg(0xe1)
    const state = pendingState({ pending: await sha256(replaced), noEtag: true, checkedAt: EV_TODAY })
    const calls = stubFetch(() => imageResponse(replaced))

    const { decisions } = await detectChanges([eventLink(DATES)], state, EV_TODAY)

    // 間隔による取得の見送り（shouldRevalidate）を無視して取りに行く
    expect(calls).toHaveLength(1)
    const d = decisions[0]!
    expect(d.action).toBe('ocr')
    expect(d.sha256).toBe(await sha256(replaced))
    expect(d.image).toBeDefined()
  })

  // 再検証で見つかった非効率の回帰（2026-10-03）。差し替え後の画像を拒否済みなら、state の
  // （差し替え前の）検証子ではなく拒否記録の検証子で条件付き GET し、本体を毎回取り直さない
  it('差し替え後の画像を拒否済みなら、拒否記録の検証子で条件付き GET し、304 なら拒否を引き継ぐ', async () => {
    const state: State = {
      ...pendingState({ pending: 'sha-rejected' }),
      rejected_images: {
        [URL_LECTURE]: {
          sha256: 'sha-rejected',
          reason_code: 'multi_table',
          reason: '日付ごとの別表があります',
          etag: '"r1"',
          checked_at: '2026-10-02',
        },
      },
    }
    const calls = stubFetch(() => new Response(null, { status: 304 }))

    const { decisions } = await detectChanges([eventLink(DATES)], state, EV_TODAY)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers['if-none-match']).toBe('"r1"')
    const d = decisions[0]!
    expect(d.action).toBe('skip')
    expect(d.failure).toEqual({ code: 'rejected', retry: false })
    expect(d.sha256).toBe('sha-rejected')
    expect(d.check?.checked_at).toBe(EV_TODAY)
  })

  it('（対照）pending が無く検証子も無く今日確認済みなら、取りに行かず unchanged', async () => {
    const calls = stubFetch(() => imageResponse(jpeg(0xe1)))

    const { decisions } = await detectChanges(
      [eventLink(DATES)],
      pendingState({ ...noPending, noEtag: true, checkedAt: EV_TODAY }),
      EV_TODAY,
    )

    expect(calls).toHaveLength(0)
    expect(decisions[0]!.action).toBe('unchanged')
  })

  // 元の内容（sha-old）のままと確認できた回は、前回の時刻をそのまま使ってよい
  it('304（元の内容のまま）なら unchanged・failure なし・確認日を今日に進める', async () => {
    const calls = stubFetch(() => new Response(null, { status: 304, headers: { etag: '"v1"' } }))

    const { decisions } = await detectChanges([eventLink(DATES)], pendingState(), EV_TODAY)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers['if-none-match']).toBe('"v1"')
    const d = decisions[0]!
    expect(d.action).toBe('unchanged')
    expect(d.failure).toBeUndefined()
    expect(d.sha256).toBe('sha-old')
    expect(d.check?.checked_at).toBe(EV_TODAY)
  })

  it('304 で掲載テキストの日付だけ変わっていれば meta_only', async () => {
    stubFetch(() => new Response(null, { status: 304, headers: { etag: '"v1"' } }))

    const { decisions } = await detectChanges([eventLink([...DATES, '2026-10-18'])], pendingState(), EV_TODAY)

    expect(decisions[0]!.action).toBe('meta_only')
    expect(decisions[0]!.failure).toBeUndefined()
  })
})

describe('ocrPriorityDate は掲示の並び順に依存しない', () => {
  // 掲示テキストの日付が昇順とは限らない（先頭が最も近い日とは限らない）
  it('event の日付が降順・順不同でも、今日以降の最小日付を返す', () => {
    expect(ocrPriorityDate(decisionOf(eventLink(['2026-10-31', '2026-10-10', '2026-10-05'])), EV_TODAY)).toBe('2026-10-05')
    expect(ocrPriorityDate(decisionOf(eventLink(['2026-10-20', '2026-09-30', '2026-10-04'])), EV_TODAY)).toBe('2026-10-04')
    // effectiveDates が順不同でも同じ
    expect(
      ocrPriorityDate(decisionOf(eventLink(['2026-10-03']), { effectiveDates: ['2026-11-01', '2026-10-15'] }), EV_TODAY),
    ).toBe('2026-10-15')
  })

  it('sortOcrTargets も最小日付で並べる', () => {
    const late = decisionOf(eventLink(['2026-10-31', '2026-10-06'], 'https://www.fukuyama-u.ac.jp/late.jpg'))
    const mid = decisionOf(eventLink(['2026-10-08'], 'https://www.fukuyama-u.ac.jp/mid.jpg'))
    // late は先頭が 10/31 だが最小は 10/06 なので mid より先
    expect(sortOcrTargets([mid, late], EV_TODAY)).toEqual([late, mid])
  })
})
