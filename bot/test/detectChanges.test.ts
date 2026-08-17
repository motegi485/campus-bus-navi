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
import { detectChanges } from '../src/detectChanges.js'
import { CONFIG } from '../src/config.js'
import type { ClassifiedLink, State } from '../src/types.js'

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
