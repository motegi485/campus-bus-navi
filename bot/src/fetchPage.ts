/** FR-1: 対象ページ取得。非200・ネットワーク失敗はジョブ失敗（この時点で変更は一切していないので安全）。 */

import { CONFIG } from './config.js'
import { assertAllowedUrl } from './url.js'

export interface FetchResult {
  ok: boolean
  status: number
  buffer: Buffer
  contentType: string
  url: string
  /** 応答の ETag（無ければ空文字）。次回の条件付き GET に使う */
  etag: string
  /** 応答の Last-Modified（無ければ空文字）。次回の条件付き GET に使う */
  lastModified: string
}

export interface FetchOptions {
  /** 許可ホスト。初回 URL と各リダイレクト先の両方を検査する */
  allowedHostSuffixes: readonly string[]
  /** 本文の上限バイト数。超えた時点で受信を打ち切る */
  maxBytes: number
  timeoutMs?: number
  /** 追加リクエストヘッダ（条件付き GET の If-None-Match / If-Modified-Since 用） */
  headers?: Record<string, string>
}

/** 上限を超えた本文を受け取ったときのエラー（呼び出し側が理由をそのまま警告にする） */
export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number, url: string) {
    super(`応答が上限（${Math.round(maxBytes / 1024 / 1024)}MB）を超えています: ${url}`)
    this.name = 'ResponseTooLargeError'
  }
}

/**
 * 上限つきで本文を読む。
 *
 * `arrayBuffer()` で全体をメモリに載せてから長さを見るのでは、上限を超える応答の
 * 転送量とピークメモリを抑えられない。Content-Length があれば受信前に弾き、
 * 無い場合（chunked）はストリームを読みながら累積が上限に達した時点で中断する。
 */
async function readBodyWithLimit(res: Response, maxBytes: number, url: string): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    // 本文は読まずに捨てる
    await res.body?.cancel().catch(() => { /* noop */ })
    throw new ResponseTooLargeError(maxBytes, url)
  }

  if (!res.body) return Buffer.alloc(0)

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => { /* noop */ })
      throw new ResponseTooLargeError(maxBytes, url)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * UA 付き・タイムアウト付き・ホスト検査付きの fetch。
 *
 * リダイレクトは fetch 任せ（`redirect: 'follow'`）にせず自前で追う。任せると
 * 許可ホストから任意ホストへの 302 でそのまま外へ出てしまい、初回 URL の検査が
 * 意味をなさなくなるため、各ホップで許可ホストを検査し直す。
 */
export async function fetchWithTimeout(url: string, options: FetchOptions): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? CONFIG.fetchTimeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let current = assertAllowedUrl(url, options.allowedHostSuffixes).toString()

    for (let hop = 0; hop <= CONFIG.maxRedirects; hop++) {
      const res = await fetch(current, {
        headers: { 'user-agent': CONFIG.userAgent, ...(options.headers ?? {}) },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel().catch(() => { /* noop */ })
        if (!location) {
          return {
            ok: false, status: res.status, buffer: Buffer.alloc(0), contentType: '',
            url: current, etag: '', lastModified: '',
          }
        }
        // 相対 Location も絶対化したうえで、行き先を必ず検査する
        current = assertAllowedUrl(new URL(location, current).toString(), options.allowedHostSuffixes).toString()
        continue
      }

      let buffer: Buffer
      if (res.status === 304) {
        // 304 は本文を持たない（条件付き GET の「変わっていない」応答）
        await res.body?.cancel().catch(() => { /* noop */ })
        buffer = Buffer.alloc(0)
      } else {
        buffer = await readBodyWithLimit(res, options.maxBytes, current)
      }
      return {
        ok: res.ok,
        status: res.status,
        buffer,
        contentType: res.headers.get('content-type') ?? '',
        url: res.url || current,
        etag: res.headers.get('etag') ?? '',
        lastModified: res.headers.get('last-modified') ?? '',
      }
    }

    throw new Error(`リダイレクトが ${CONFIG.maxRedirects} 回を超えました: ${url}`)
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchPage(url: string = CONFIG.pageUrl): Promise<string> {
  let res: FetchResult
  try {
    res = await fetchWithTimeout(url, {
      allowedHostSuffixes: CONFIG.allowedPageHostSuffixes,
      maxBytes: CONFIG.maxPageBytes,
    })
  } catch (e) {
    throw new Error(`ページ取得に失敗しました（ネットワークエラー）: ${url} / ${(e as Error).message}`)
  }
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました（HTTP ${res.status}）: ${url}`)
  }
  return res.buffer.toString('utf-8')
}
