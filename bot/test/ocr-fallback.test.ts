import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }

    constructor(_options: unknown) {}
  },
  Type: {
    ARRAY: 'ARRAY',
    OBJECT: 'OBJECT',
    INTEGER: 'INTEGER',
    STRING: 'STRING',
  },
  ThinkingLevel: { LOW: 'LOW' },
  MediaResolution: { MEDIA_RESOLUTION_HIGH: 'MEDIA_RESOLUTION_HIGH' },
}))

import { OcrClient } from '../src/ocr.js'
import { CONFIG } from '../src/config.js'

const RESPONSE = {
  text: JSON.stringify({
    day_types: [
      {
        label: '授業日',
        matsunaga: [{ hour: 8, minutes: [0] }],
        university: [{ hour: 8, minutes: [10] }],
      },
    ],
  }),
}

const mutableConfig = CONFIG as unknown as {
  geminiMinIntervalMs: number
  geminiMaxRetriesTransient: number
  geminiTransientBackoffMs: readonly number[]
}
const originalMinIntervalMs = CONFIG.geminiMinIntervalMs
const originalMaxRetriesTransient = CONFIG.geminiMaxRetriesTransient
const originalTransientBackoffMs = CONFIG.geminiTransientBackoffMs

function calledModels(): string[] {
  return mocks.generateContent.mock.calls.map(([request]) => (request as { model: string }).model)
}

describe('OCR モデルフォールバック', () => {
  beforeEach(() => {
    mocks.generateContent.mockReset()
    // フォールバック判定だけを即時に検証し、本番の RPM 対策の待機は持ち込まない。
    mutableConfig.geminiMinIntervalMs = 0
    mutableConfig.geminiMaxRetriesTransient = 0
    mutableConfig.geminiTransientBackoffMs = [0, 0, 0]
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    mutableConfig.geminiMinIntervalMs = originalMinIntervalMs
    mutableConfig.geminiMaxRetriesTransient = originalMaxRetriesTransient
    mutableConfig.geminiTransientBackoffMs = originalTransientBackoffMs
    vi.restoreAllMocks()
  })

  it('primary がモデル不存在なら gemini-3.7-flash へ一度だけ切り替える', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('404 NOT_FOUND'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe('gemini-3.7-flash')
    expect(calledModels()).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.7-flash'])
  })

  it('primary の RPD 枯渇なら待機せず gemini-3.7-flash へ切り替える', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED RequestsPerDayPerProject'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe('gemini-3.7-flash')
    expect(calledModels()).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.7-flash'])
  })

  it('primary がリクエストタイムアウトなら再試行せず gemini-3.7-flash へ切り替え、その実行では使い続ける', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('AbortError This operation was aborted'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe('gemini-3.7-flash')
    expect(calledModels()).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.7-flash'])
    expect(client.calls).toBe(3)
  })

  it('primary の 503 は既定回数を再試行してから gemini-3.7-flash へ切り替える', async () => {
    mutableConfig.geminiMaxRetriesTransient = 3
    for (let attempt = 0; attempt < 4; attempt += 1) {
      mocks.generateContent.mockRejectedValueOnce(new Error('503 UNAVAILABLE'))
    }
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe('gemini-3.7-flash')
    expect(calledModels()).toEqual([
      'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.7-flash',
    ])
  })
})
