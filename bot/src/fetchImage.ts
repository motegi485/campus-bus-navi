/**
 * FR-5: 画像取得。
 * リサイズ版サフィックス（例 `-724x1024`）が付いた URL は原寸を先に試し、非200ならリンク記載 URL に戻す。
 * Content-Type が image 以外・10MB 超は needs_review（黙って進めない）。
 */

import { createHash } from 'node:crypto'
import { CONFIG } from './config.js'
import { fetchWithTimeout } from './fetchPage.js'

export type ImageResult =
  | { ok: true; buffer: Buffer; sha256: string; url: string; mimeType: string; triedOriginal: boolean }
  | { ok: false; reason: string; url: string }

function guessMimeType(url: string, contentType: string): string {
  const ct = contentType.split(';')[0]!.trim().toLowerCase()
  if (ct.startsWith('image/')) return ct === 'image/jpg' ? 'image/jpeg' : ct
  return /\.png$/i.test(url) ? 'image/png' : 'image/jpeg'
}

/** リサイズ版 URL から原寸 URL を作る。サフィックスが無ければ null */
export function originalSizeUrl(url: string): string | null {
  if (!CONFIG.resizedSuffixPattern.test(url)) return null
  return url.replace(CONFIG.resizedSuffixPattern, '')
}

export async function fetchImage(rawUrl: string): Promise<ImageResult> {
  const candidates: string[] = []
  const original = originalSizeUrl(rawUrl)
  if (original) candidates.push(original)
  candidates.push(rawUrl)

  let lastReason = ''
  for (const [i, url] of candidates.entries()) {
    let res: Awaited<ReturnType<typeof fetchWithTimeout>>
    try {
      res = await fetchWithTimeout(url)
    } catch (e) {
      lastReason = `画像取得に失敗しました（ネットワークエラー: ${(e as Error).message}）`
      continue
    }
    if (!res.ok) {
      lastReason = `画像取得に失敗しました（HTTP ${res.status}）`
      continue
    }

    const ct = res.contentType.split(';')[0]!.trim().toLowerCase()
    if (!ct.startsWith('image/')) {
      // 原寸試行で HTML（404ページ等）が返るケースがあるので、フォールバックを続行する
      lastReason = `Content-Type が画像ではありません（${res.contentType || '不明'}）`
      continue
    }

    if (res.buffer.byteLength > CONFIG.maxImageBytes) {
      return {
        ok: false,
        url,
        reason: `画像サイズが上限（${Math.round(CONFIG.maxImageBytes / 1024 / 1024)}MB）を超えています: ${res.buffer.byteLength} bytes`,
      }
    }

    return {
      ok: true,
      buffer: res.buffer,
      sha256: createHash('sha256').update(res.buffer).digest('hex'),
      url,
      mimeType: guessMimeType(url, res.contentType),
      triedOriginal: Boolean(original) && i === 0,
    }
  }

  return { ok: false, url: rawUrl, reason: lastReason || '画像を取得できませんでした' }
}
