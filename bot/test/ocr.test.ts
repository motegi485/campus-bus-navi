/**
 * 実行時間の締切（F-021）と画像実体の検査（F-017）。
 * どちらもネットワークへ出る前に判定されることを固定する。
 */

import { describe, it, expect, vi } from 'vitest'
import { Type } from '@google/genai'
import {
  INTERMEDIATE_SCHEMA,
  OCR_PROMPT,
  OcrClient,
  normalizeIntermediate,
  withIrregularNotes,
} from '../src/ocr.js'
import { looksLikeImage } from '../src/fetchImage.js'
import type { Intermediate, IntermediateDayType } from '../src/types.js'

function dayType(label: string, matsunagaMinute: number, irregular?: boolean): IntermediateDayType {
  return {
    label,
    matsunaga: [{ hour: 8, minutes: [matsunagaMinute] }],
    university: [{ hour: 9, minutes: [10] }],
    ...(irregular === undefined ? {} : { irregular_notes: irregular }),
  }
}

describe('OCR の実行時間の締切（F-021）', () => {
  it('締切を過ぎていたら Gemini を呼ばずに失敗として返す', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      // 締切を過去に設定 → 最初の callOnce が RunDeadlineExceededError を投げる
      const client = new OcrClient('dummy-key', undefined, Date.now() - 1)
      const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

      expect(outcome.ok).toBe(false)
      expect(outcome.reason).toMatch(/実行時間の上限/)
      expect(client.deadlineExceeded).toBe(true)
      expect(client.calls).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/**
 * FR-6【v1.16】irregular_notes（通常と違う乗り場・行先の注記付きの便）。
 * 2 回読み照合の比較からは外し、各回の OR で付け直す（安全側）。
 */
describe('2回読み照合の正規化と irregular_notes（FR-6 v1.16）', () => {
  it('normalizeIntermediate は irregular_notes を落とす（照合の対象にしない）', () => {
    const normalized = normalizeIntermediate({ day_types: [dayType('公開講座', 0, true)] })
    expect(normalized.day_types[0]).not.toHaveProperty('irregular_notes')
    // 注記の有無だけが違う 2 回の読みは、正規化後に一致する
    expect(JSON.stringify(normalizeIntermediate({ day_types: [dayType('公開講座', 0, true)] }))).toBe(
      JSON.stringify(normalizeIntermediate({ day_types: [dayType('公開講座', 0, false)] })),
    )
  })

  it('ラベルが同じ 2 種別（日付ごとの別表でラベルが両方空など）の並びが入力順に依存しない', () => {
    const a = dayType('', 0)
    const b = dayType('', 30)
    const ab = normalizeIntermediate({ day_types: [a, b] })
    const ba = normalizeIntermediate({ day_types: [b, a] })
    expect(JSON.stringify(ab)).toBe(JSON.stringify(ba))
    expect(ab.day_types).toHaveLength(2)
  })

  it('ラベルが違う種別は従来どおりラベル順に並ぶ', () => {
    const normalized = normalizeIntermediate({ day_types: [dayType('休業日', 0), dayType('授業日', 30)] })
    expect(normalized.day_types.map((d) => d.label)).toEqual(['休業日', '授業日'].sort((x, y) => x.localeCompare(y)))
  })

  it('withIrregularNotes: どれか 1 回でも true と読んだら、採用した結果の全種別を true にする', () => {
    const chosen = normalizeIntermediate({ day_types: [dayType('授業日', 0), dayType('休業日', 30)] })
    const reads: Intermediate[] = [
      { day_types: [dayType('授業日', 0, false), dayType('休業日', 30)] },
      { day_types: [dayType('授業日', 0), dayType('休業日', 30, true)] },
    ]
    const result = withIrregularNotes(chosen, reads)
    expect(result.day_types.map((d) => d.irregular_notes)).toEqual([true, true])
    // 時刻・ラベルは変えない
    expect(result.day_types.map(({ irregular_notes: _, ...rest }) => rest)).toEqual(chosen.day_types)
    // 元のオブジェクトは書き換えない
    expect(chosen.day_types[0]).not.toHaveProperty('irregular_notes')
  })

  // withIrregularNotes 自体は「渡された読みすべての OR」。どの読みを渡すか（採用した一致ペアだけ）は
  // read() 側の責務で、下の「read() の irregular_notes」で守る。
  it('withIrregularNotes: 渡した読みのうち 1 回だけが true でも true（渡されたものはすべて OR）', () => {
    const chosen = normalizeIntermediate({ day_types: [dayType('公開講座', 0)] })
    const reads: Intermediate[] = [
      { day_types: [dayType('公開講座', 0, false)] },
      { day_types: [dayType('公開講座', 5, false)] },
      { day_types: [dayType('公開講座', 0, true)] },
    ]
    expect(withIrregularNotes(chosen, reads).day_types[0]!.irregular_notes).toBe(true)
  })

  it('withIrregularNotes: 全回 false・未定義なら元の結果をそのまま返す', () => {
    const chosen = normalizeIntermediate({ day_types: [dayType('公開講座', 0)] })
    const reads: Intermediate[] = [
      { day_types: [dayType('公開講座', 0, false)] },
      { day_types: [dayType('公開講座', 0)] },
    ]
    const result = withIrregularNotes(chosen, reads)
    expect(result).toBe(chosen)
    expect(result.day_types[0]).not.toHaveProperty('irregular_notes')
  })

  it('INTERMEDIATE_SCHEMA の day_type に任意の irregular_notes（BOOLEAN）がある', () => {
    const items = (INTERMEDIATE_SCHEMA.properties!.day_types!.items ?? {}) as {
      required?: string[]
      properties?: Record<string, { type?: unknown }>
    }
    expect(items.properties?.irregular_notes?.type).toBe(Type.BOOLEAN)
    // 既存の正解 fixture はこの項目を持たないので、required に含めない
    expect(items.required).toEqual(['label', 'matsunaga', 'university'])
    expect(items.required).not.toContain('irregular_notes')
  })

  it('OCR_PROMPT に irregular_notes を指示する規則9がある', () => {
    // 規則9 は最後の規則で、その本文に irregular_notes が出てくる
    expect(OCR_PROMPT).toMatch(/^9\. [\s\S]*irregular_notes[\s\S]*$/m)
    expect(OCR_PROMPT.indexOf('\n9. ')).toBeGreaterThan(OCR_PROMPT.indexOf('\n8. '))
    expect(OCR_PROMPT).toContain('irregular_notes を true')
    expect(OCR_PROMPT).toContain('無ければ false')
    // 注記付きの便も時刻としては読む（規則6 の「注記は時刻ではない」と取り違えない）
    expect(OCR_PROMPT).toContain('注記付きの便の時刻も、書かれているとおり minutes に含めます')
  })
})

/**
 * read() が irregular_notes を付け直すときは、採用した一致ペアの 2 回だけで OR を取る。
 * 多数決で捨てた外れ値の読みの判断（true/false）は採用結果に混ぜない。
 * readOnce（1 回読み）をモックし、Gemini 呼び出し・待機を伴わずに照合の分岐だけを検証する。
 */
describe('read() の irregular_notes（採用した一致ペアだけで OR）', () => {
  type ReadOnceHost = { readOnce: (buffer: Buffer, mimeType: string) => Promise<Intermediate> }

  async function readWith(...reads: Intermediate[]) {
    const spy = vi.spyOn(OcrClient.prototype as unknown as ReadOnceHost, 'readOnce')
    for (const r of reads) spy.mockResolvedValueOnce(r)
    try {
      const client = new OcrClient('dummy-key')
      const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')
      return { outcome, readCount: spy.mock.calls.length }
    } finally {
      spy.mockRestore()
    }
  }

  const one = (minute: number, irregular?: boolean): Intermediate => ({
    day_types: [dayType('公開講座', minute, irregular)],
  })

  it('1 回目と 3 回目が一致（false）、外れ値の 2 回目だけが true → 採用結果に irregular_notes が付かない', async () => {
    const { outcome, readCount } = await readWith(one(0, false), one(5, true), one(0, false))
    expect(readCount).toBe(3)
    expect(outcome.ok).toBe(true)
    expect(outcome.majority).toBe(true)
    expect(outcome.attempts).toBe(3)
    // 採用されたのは 1 回目・3 回目の内容（8:00）
    expect(outcome.intermediate!.day_types[0]!.matsunaga).toEqual([{ hour: 8, minutes: [0] }])
    expect(outcome.intermediate!.day_types[0]).not.toHaveProperty('irregular_notes')
  })

  it('外れ値が 1 回目（true）で、2 回目と 3 回目が一致（false）→ 付かない', async () => {
    const { outcome } = await readWith(one(5, true), one(0, false), one(0))
    expect(outcome.ok).toBe(true)
    expect(outcome.majority).toBe(true)
    expect(outcome.intermediate!.day_types[0]!.matsunaga).toEqual([{ hour: 8, minutes: [0] }])
    expect(outcome.intermediate!.day_types[0]).not.toHaveProperty('irregular_notes')
  })

  it('一致ペア（1 回目・3 回目）の片方が true なら付く', async () => {
    const { outcome } = await readWith(one(0, false), one(5, false), one(0, true))
    expect(outcome.ok).toBe(true)
    expect(outcome.majority).toBe(true)
    expect(outcome.intermediate!.day_types[0]!.irregular_notes).toBe(true)
  })

  it('一致ペア（2 回目・3 回目）の片方が true なら付く', async () => {
    const { outcome } = await readWith(one(0, false), one(5, true), one(5, false))
    expect(outcome.ok).toBe(true)
    expect(outcome.majority).toBe(true)
    expect(outcome.intermediate!.day_types[0]!.matsunaga).toEqual([{ hour: 8, minutes: [5] }])
    expect(outcome.intermediate!.day_types[0]!.irregular_notes).toBe(true)
  })

  it('2 回一致で片方が true なら付く（3 回目は読まない）', async () => {
    const { outcome, readCount } = await readWith(one(0, false), one(0, true))
    expect(readCount).toBe(2)
    expect(outcome.ok).toBe(true)
    expect(outcome.majority).toBe(false)
    expect(outcome.attempts).toBe(2)
    expect(outcome.intermediate!.day_types[0]!.irregular_notes).toBe(true)
  })

  it('2 回一致で両方 false・未定義なら付かない', async () => {
    const { outcome } = await readWith(one(0, false), one(0))
    expect(outcome.ok).toBe(true)
    expect(outcome.intermediate!.day_types[0]).not.toHaveProperty('irregular_notes')
  })
})

describe('画像の実体検査（F-017）', () => {
  it('JPEG / PNG のシグネチャを認識する', () => {
    expect(looksLikeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(true)
    expect(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  })

  it('Content-Type が image でも中身が HTML なら弾く', () => {
    expect(looksLikeImage(Buffer.from('<!doctype html><html>', 'utf-8'))).toBe(false)
  })

  it('短すぎるデータは弾く', () => {
    expect(looksLikeImage(Buffer.from([0xff, 0xd8]))).toBe(false)
    expect(looksLikeImage(Buffer.alloc(0))).toBe(false)
  })
})
