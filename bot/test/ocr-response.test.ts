/**
 * Gemini 応答の実行時検証（§8.5.2、セキュリティ監査 2026-11-01 の I6）。
 *
 * responseSchema はモデルへの指示であって保証ではない。形の崩れた応答は、その画像の読み取り失敗
 * （ok:false）にして、実行全体を落とさず、再試行もしない。@google/genai はモックするので
 * ネットワークには出ない。
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }
    constructor(_o: unknown) {}
  },
  Type: { ARRAY: 'ARRAY', OBJECT: 'OBJECT', INTEGER: 'INTEGER', STRING: 'STRING', BOOLEAN: 'BOOLEAN' },
  ThinkingLevel: { LOW: 'LOW' },
  MediaResolution: { MEDIA_RESOLUTION_HIGH: 'MEDIA_RESOLUTION_HIGH' },
}))

import * as ocr from '../src/ocr.js'
import { OcrClient } from '../src/ocr.js'
import { CONFIG } from '../src/config.js'

const cfg = CONFIG as unknown as { geminiMinIntervalMs: number }
const orig = CONFIG.geminiMinIntervalMs
const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 修正前の ocr.ts には parseIntermediate が無いので、名前空間経由で取り出す */
function parseIntermediate(text: string): unknown {
  const fn = (ocr as unknown as { parseIntermediate?: (t: string) => unknown }).parseIntermediate
  if (typeof fn !== 'function') throw new Error('parseIntermediate が export されていません')
  return fn(text)
}

describe('Gemini 応答の実行時検証（I6）', () => {
  beforeEach(() => {
    mocks.generateContent.mockReset()
    cfg.geminiMinIntervalMs = 0
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    cfg.geminiMinIntervalMs = orig
    vi.restoreAllMocks()
  })

  it.each([
    ['JSON でない', 'not json'],
    ['day_types が無い', '{}'],
    ['day_types が配列でない', '{"day_types":{}}'],
    ['label が数値', '{"day_types":[{"label":1,"matsunaga":[],"university":[]}]}'],
    ['minutes が文字列', '{"day_types":[{"label":"a","matsunaga":[{"hour":8,"minutes":"05"}],"university":[]}]}'],
    ['hour が範囲外', '{"day_types":[{"label":"a","matsunaga":[{"hour":24,"minutes":[0]}],"university":[]}]}'],
    ['minute が小数', '{"day_types":[{"label":"a","matsunaga":[{"hour":8,"minutes":[0.5]}],"university":[]}]}'],
    [
      'day_types が 3 要素',
      JSON.stringify({ day_types: [1, 2, 3].map(() => ({ label: 'a', matsunaga: [], university: [] })) }),
    ],
  ])('%s応答は例外を投げず ok:false、再試行もしない', async (_name, text) => {
    mocks.generateContent.mockResolvedValue({ text })
    const outcome = await new OcrClient('k').read(Buffer.from('x'), 'image/jpeg')
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toMatch(/Gemini/)
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
  })

  it('既存の正解 fixture（irregular_notes なし）はそのまま通る', () => {
    const dir = path.join(HERE, '../fixtures/intermediate')
    const names = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(names.length).toBeGreaterThan(0)
    for (const f of names) {
      const text = readFileSync(path.join(dir, f), 'utf-8')
      expect(() => parseIntermediate(text)).not.toThrow()
    }
  })

  it('未知のキーは落として受け取る（照合に影響させない）', () => {
    const v = parseIntermediate('{"day_types":[{"label":"a","matsunaga":[],"university":[],"x":1}],"y":2}')
    expect(v).toEqual({ day_types: [{ label: 'a', matsunaga: [], university: [] }] })
  })
})
