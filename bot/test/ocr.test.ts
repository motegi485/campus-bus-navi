/**
 * 実行時間の締切（F-021）と画像実体の検査（F-017）。
 * どちらもネットワークへ出る前に判定されることを固定する。
 */

import { describe, it, expect, vi } from 'vitest'
import { OcrClient } from '../src/ocr.js'
import { looksLikeImage } from '../src/fetchImage.js'

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
