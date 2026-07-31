/** FR-1: 対象ページ取得。非200・ネットワーク失敗はジョブ失敗（この時点で変更は一切していないので安全）。 */

import { CONFIG } from './config.js'

export interface FetchResult {
  ok: boolean
  status: number
  buffer: Buffer
  contentType: string
  url: string
}

/** UA 付き・タイムアウト付きの fetch。3xx は fetch が既定で追従する。 */
export async function fetchWithTimeout(url: string, timeoutMs = CONFIG.fetchTimeoutMs): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': CONFIG.userAgent },
      redirect: 'follow',
      signal: controller.signal,
    })
    const buffer = Buffer.from(await res.arrayBuffer())
    return {
      ok: res.ok,
      status: res.status,
      buffer,
      contentType: res.headers.get('content-type') ?? '',
      url: res.url || url,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchPage(url: string = CONFIG.pageUrl): Promise<string> {
  let res: FetchResult
  try {
    res = await fetchWithTimeout(url)
  } catch (e) {
    throw new Error(`ページ取得に失敗しました（ネットワークエラー）: ${url} / ${(e as Error).message}`)
  }
  if (!res.ok) {
    throw new Error(`ページ取得に失敗しました（HTTP ${res.status}）: ${url}`)
  }
  return res.buffer.toString('utf-8')
}
