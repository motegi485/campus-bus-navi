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
    BOOLEAN: 'BOOLEAN',
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
  modelFallback: string | undefined
}
const originalMinIntervalMs = CONFIG.geminiMinIntervalMs
const originalMaxRetriesTransient = CONFIG.geminiMaxRetriesTransient
const originalTransientBackoffMs = CONFIG.geminiTransientBackoffMs
const originalModelFallback = CONFIG.modelFallback

/** 切替機構を検証するためだけに一時設定するフォールバックモデル名（実在モデルではない） */
const TEST_FALLBACK = 'gemini-3.8-fallback-test'
const PRIMARY = 'gemini-3.7-flash'

function calledModels(): string[] {
  return mocks.generateContent.mock.calls.map(([request]) => (request as { model: string }).model)
}

function setUpFastConfig(): void {
  mocks.generateContent.mockReset()
  // フォールバック判定だけを即時に検証し、本番の RPM 対策の待機は持ち込まない。
  mutableConfig.geminiMinIntervalMs = 0
  mutableConfig.geminiMaxRetriesTransient = 0
  mutableConfig.geminiTransientBackoffMs = [0, 0, 0]
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

function restoreConfig(): void {
  mutableConfig.geminiMinIntervalMs = originalMinIntervalMs
  mutableConfig.geminiMaxRetriesTransient = originalMaxRetriesTransient
  mutableConfig.geminiTransientBackoffMs = originalTransientBackoffMs
  mutableConfig.modelFallback = originalModelFallback
  vi.restoreAllMocks()
}

/**
 * 【2026-10-03 ユーザー決定】既定は gemini-3.7-flash 単独でフォールバックなし。
 * ただし modelFallback を設定すれば以前の切替分岐がそのまま働く（config.ts のコメント）。
 * この describe は「fallback を設定した構成でも切替機構が壊れていない」ことを守る。
 */
describe('OCR モデルフォールバック（modelFallback を設定した構成）', () => {
  beforeEach(() => {
    setUpFastConfig()
    mutableConfig.modelFallback = TEST_FALLBACK
  })

  afterEach(restoreConfig)

  it('primary は CONFIG.modelPrimary（gemini-3.7-flash）である', () => {
    expect(CONFIG.modelPrimary).toBe(PRIMARY)
  })

  it('primary がモデル不存在なら fallback へ一度だけ切り替える', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('404 NOT_FOUND'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe(TEST_FALLBACK)
    expect(calledModels()).toEqual([PRIMARY, TEST_FALLBACK, TEST_FALLBACK])
  })

  it('primary の RPD 枯渇なら待機せず fallback へ切り替える', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED RequestsPerDayPerProject'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe(TEST_FALLBACK)
    expect(calledModels()).toEqual([PRIMARY, TEST_FALLBACK, TEST_FALLBACK])
  })

  it('primary がリクエストタイムアウトなら再試行せず fallback へ切り替え、その実行では使い続ける', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('AbortError This operation was aborted'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe(TEST_FALLBACK)
    expect(calledModels()).toEqual([PRIMARY, TEST_FALLBACK, TEST_FALLBACK])
    expect(client.calls).toBe(3)
  })

  it('primary の 503 は既定回数を再試行してから fallback へ切り替える', async () => {
    mutableConfig.geminiMaxRetriesTransient = 3
    for (let attempt = 0; attempt < 4; attempt += 1) {
      mocks.generateContent.mockRejectedValueOnce(new Error('503 UNAVAILABLE'))
    }
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe(TEST_FALLBACK)
    expect(calledModels()).toEqual([PRIMARY, PRIMARY, PRIMARY, PRIMARY, TEST_FALLBACK, TEST_FALLBACK])
  })

  it('fallback へ切り替えた後のタイムアウトは一時障害として再試行し、回復すれば成功する', async () => {
    // fallback 設定済み構成では、切替後のタイムアウトは従来どおり一時障害（v1.13）。即失敗にはしない
    mutableConfig.geminiMaxRetriesTransient = 1
    mocks.generateContent.mockRejectedValueOnce(new Error('AbortError This operation was aborted'))
    mocks.generateContent.mockRejectedValueOnce(new Error('AbortError This operation was aborted'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.modelUsed).toBe(TEST_FALLBACK)
    // primary タイムアウト → 切替 → fallback タイムアウト → 再試行で成功 → 2 回目の読み
    expect(calledModels()).toEqual([PRIMARY, TEST_FALLBACK, TEST_FALLBACK, TEST_FALLBACK])
    expect(client.deadlineExceeded).toBe(false)
  })

  it('fallback へ切り替えた後もタイムアウトが続けば、再試行枠を使い切ってから失敗する', async () => {
    mutableConfig.geminiMaxRetriesTransient = 1
    mocks.generateContent.mockRejectedValue(new Error('AbortError This operation was aborted'))

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('Gemini の呼び出しに失敗しました')
    expect(outcome.reason).toContain('AbortError')
    expect(outcome.fallbackUsed).toBe(true)
    // primary 1 回 + fallback（初回 + 再試行 1 回）。fallback から先へは切り替えない
    expect(calledModels()).toEqual([PRIMARY, TEST_FALLBACK, TEST_FALLBACK])
    expect(client.deadlineExceeded).toBe(false)
  })
})

/**
 * 既定構成（modelFallback 未設定）。gemini-3.8-flash の 503 連発で再試行が実行上限を
 * 食い潰した 2026-10-03 の事象を受け、3.7 単独で動き、別モデルへ黙って切り替えないこと、
 * 要求タイムアウトで 180 秒 × 再試行を重ねず即失敗にすることを守る（FR-6【v1.16】）。
 */
describe('OCR モデル（既定構成: フォールバックなし）', () => {
  beforeEach(setUpFastConfig)

  afterEach(restoreConfig)

  it('既定では primary が gemini-3.7-flash で、modelFallback は未設定', () => {
    expect(CONFIG.modelPrimary).toBe(PRIMARY)
    expect(CONFIG.modelFallback).toBeUndefined()
  })

  it('既定では gemini-3.7-flash だけを使って読み取る', async () => {
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(true)
    expect(outcome.fallbackUsed).toBe(false)
    expect(outcome.modelUsed).toBe(PRIMARY)
    expect(calledModels()).toEqual([PRIMARY, PRIMARY])
  })

  it('モデル不存在（404）でも切り替えずに失敗する', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('404 NOT_FOUND'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('Gemini の呼び出しに失敗しました')
    expect(outcome.reason).toContain('404')
    expect(outcome.fallbackUsed).toBe(false)
    expect(client.usedFallback).toBe(false)
    expect(outcome.modelUsed).toBe(PRIMARY)
    expect(calledModels()).toEqual([PRIMARY])
  })

  it('リクエストタイムアウトは再試行せず即失敗にする（generateContent は 1 回）', async () => {
    // 一時障害の再試行枠が残っていても、タイムアウトは再試行しない
    mutableConfig.geminiMaxRetriesTransient = 3
    mocks.generateContent.mockRejectedValueOnce(new Error('AbortError This operation was aborted'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('Gemini の呼び出しに失敗しました')
    expect(outcome.reason).toContain('AbortError')
    expect(outcome.attempts).toBe(0)
    expect(outcome.fallbackUsed).toBe(false)
    expect(outcome.modelUsed).toBe(PRIMARY)
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
    expect(client.calls).toBe(1)
    // 締切まで十分な残りがある状態のタイムアウトは、締切到達としては記録しない
    expect(client.deadlineExceeded).toBe(false)
  })

  it('締切に合わせて短くした要求がタイムアウトしたら、締切到達（deadlineExceeded）として失敗する', async () => {
    // Date だけを偽装して時刻を決定的に進める（setTimeout 等は実時間のまま）
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const base = Date.UTC(2026, 9, 3, 0, 0, 0)
      vi.setSystemTime(base)
      mutableConfig.geminiMinIntervalMs = 1000
      mutableConfig.geminiMaxRetriesTransient = 3
      // 要求中に時間が経ち、残り 500ms（<= 呼び出し間隔の下限 1000ms）になってからタイムアウトした想定
      mocks.generateContent.mockImplementationOnce(async () => {
        vi.setSystemTime(base + 4500)
        throw new Error('AbortError This operation was aborted')
      })
      mocks.generateContent.mockResolvedValue(RESPONSE)

      const client = new OcrClient('test-key', undefined, base + 5000)
      const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

      expect(outcome.ok).toBe(false)
      expect(outcome.reason).toMatch(/実行時間の上限/)
      expect(client.deadlineExceeded).toBe(true)
      expect(mocks.generateContent).toHaveBeenCalledTimes(1)
      expect(outcome.modelUsed).toBe(PRIMARY)
    } finally {
      vi.useRealTimers()
    }
  })

  it('TimeoutError も同じく再試行せず即失敗にする', async () => {
    mutableConfig.geminiMaxRetriesTransient = 3
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    mocks.generateContent.mockRejectedValueOnce(timeout)
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(false)
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
    expect(outcome.modelUsed).toBe(PRIMARY)
  })

  it('503 は既定回数を再試行してから、切り替えずに失敗する', async () => {
    // 503 の再試行回数・数え方は現状維持（計画 5）
    mutableConfig.geminiMaxRetriesTransient = 3
    mocks.generateContent.mockRejectedValue(new Error('503 UNAVAILABLE'))

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('Gemini の呼び出しに失敗しました')
    expect(outcome.reason).toContain('503')
    expect(outcome.fallbackUsed).toBe(false)
    expect(client.usedFallback).toBe(false)
    expect(outcome.modelUsed).toBe(PRIMARY)
    // 初回 + 再試行 3 回 = 4 回。すべて primary
    expect(calledModels()).toEqual([PRIMARY, PRIMARY, PRIMARY, PRIMARY])
    expect(client.calls).toBe(4)
  })

  it('RPD 枯渇でも切り替えずに失敗する（待っても当日は回復しないので待機もしない）', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED RequestsPerDayPerProject'))
    mocks.generateContent.mockResolvedValue(RESPONSE)

    const client = new OcrClient('test-key')
    const outcome = await client.read(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')

    expect(outcome.ok).toBe(false)
    expect(outcome.fallbackUsed).toBe(false)
    expect(outcome.modelUsed).toBe(PRIMARY)
    expect(calledModels()).toEqual([PRIMARY])
  })
})
