/**
 * FR-5: 画像取得。
 * リサイズ版サフィックス（例 `-724x1024`）が付いた URL は原寸を先に試し、非200ならリンク記載 URL に戻す。
 * Content-Type が image 以外・10MB 超は needs_review（黙って進めない）。
 * 取得先は CONFIG.allowedImageHostSuffixes に限定する（リダイレクト先も fetchPage 側で検査）。
 */

import { createHash } from 'node:crypto'
import { CONFIG } from './config.js'
import { fetchWithTimeout } from './fetchPage.js'
import { checkUrl } from './url.js'

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

/**
 * 実体が JPEG / PNG かをマジックバイトで確かめる。
 * Content-Type は送信側の申告にすぎず、HTML やスクリプトが image/jpeg として
 * 返ってくることがあるため、Gemini へ渡す前にバイト列そのものを確認する。
 */
export function looksLikeImage(buffer: Buffer): boolean {
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true // JPEG
  if (
    buffer.byteLength >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return true // PNG
  return false
}

export async function fetchImage(rawUrl: string): Promise<ImageResult> {
  const candidates: string[] = []
  const original = originalSizeUrl(rawUrl)
  if (original) candidates.push(original)
  candidates.push(rawUrl)

  let lastReason = ''
  for (const [i, url] of candidates.entries()) {
    // 取得の前に宛先を検査する（掲載ページが改ざんされても許可ホスト以外へは出さない）
    const allowed = checkUrl(url, CONFIG.allowedImageHostSuffixes)
    if (!allowed.ok) {
      lastReason = `画像を取得しませんでした（${allowed.reason}）`
      continue
    }

    let res: Awaited<ReturnType<typeof fetchWithTimeout>>
    try {
      res = await fetchWithTimeout(url, {
        allowedHostSuffixes: CONFIG.allowedImageHostSuffixes,
        maxBytes: CONFIG.maxImageBytes,
      })
    } catch (e) {
      lastReason = `画像取得に失敗しました（${(e as Error).message}）`
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

    // Content-Type の申告だけを信じない（HTML が image/jpeg で返ることがある）
    if (!looksLikeImage(res.buffer)) {
      lastReason = 'JPEG / PNG のいずれでもないデータが返りました（Content-Type は画像を名乗っています）'
      continue
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
