/**
 * fetchWithTimeout のサイズ上限とリダイレクト検査（F-009 / F-017）。
 * グローバル fetch をスタブするだけで、実ネットワークへは一切出ない。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { fetchWithTimeout, ResponseTooLargeError } from '../src/fetchPage.js'
import { CONFIG } from '../src/config.js'

const HOST = 'https://www.fukuyama-u.ac.jp'
const OPTIONS = { allowedHostSuffixes: CONFIG.allowedImageHostSuffixes, maxBytes: 1024 }

/** 指定バイト数を chunkSize ずつ流すストリーム応答 */
function streamResponse(totalBytes: number, headers: Record<string, string> = {}): Response {
  const chunk = new Uint8Array(256)
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      const size = Math.min(chunk.byteLength, totalBytes - sent)
      sent += size
      controller.enqueue(chunk.subarray(0, size))
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'image/jpeg', ...headers } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('取得サイズの上限（F-017）', () => {
  it('Content-Length が上限を超えていたら受信を打ち切る', async () => {
    let delivered = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        delivered += 256
        controller.enqueue(new Uint8Array(256))
      },
      cancel() { cancelled = true },
    })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(body, { status: 200, headers: { 'content-length': '99999', 'content-type': 'image/jpeg' } }),
    ))

    await expect(fetchWithTimeout(`${HOST}/big.jpg`, OPTIONS)).rejects.toBeInstanceOf(ResponseTooLargeError)
    // 宣言サイズだけで判断して即座に打ち切るので、上限（1024）を超える量は受け取らない
    expect(cancelled).toBe(true)
    expect(delivered).toBeLessThanOrEqual(OPTIONS.maxBytes)
  })

  it('Content-Length が無くても累積が上限に達した時点で打ち切る', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(10_000)))
    await expect(fetchWithTimeout(`${HOST}/chunked.jpg`, OPTIONS)).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('上限内なら本文を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(512)))
    const res = await fetchWithTimeout(`${HOST}/small.jpg`, OPTIONS)
    expect(res.ok).toBe(true)
    expect(res.buffer.byteLength).toBe(512)
  })
})

describe('リダイレクトの追従と検査（F-009）', () => {
  it('許可ホスト内のリダイレクトは追従する', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: `${HOST}/final.jpg` } })
      }
      return streamResponse(128)
    }))

    const res = await fetchWithTimeout(`${HOST}/start.jpg`, OPTIONS)
    expect(res.ok).toBe(true)
    expect(calls).toEqual([`${HOST}/start.jpg`, `${HOST}/final.jpg`])
  })

  it('許可外ホストへのリダイレクトは追従せず例外にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example.com/a.jpg' } }),
    ))
    await expect(fetchWithTimeout(`${HOST}/start.jpg`, OPTIONS)).rejects.toThrow(/許可されていないホスト/)
  })

  it('初回 URL が許可外なら fetch を呼ばない', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    await expect(fetchWithTimeout('https://evil.example.com/a.jpg', OPTIONS)).rejects.toThrow(
      /許可されていないホスト/,
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('リダイレクトが続きすぎたら打ち切る', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1
      return new Response(null, { status: 302, headers: { location: `${HOST}/hop${n}.jpg` } })
    }))
    await expect(fetchWithTimeout(`${HOST}/start.jpg`, OPTIONS)).rejects.toThrow(/リダイレクトが/)
  })
})
