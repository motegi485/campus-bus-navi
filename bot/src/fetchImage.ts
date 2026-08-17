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
  | {
      ok: true
      buffer: Buffer
      sha256: string
      url: string
      mimeType: string
      triedOriginal: boolean
      /** 次回の条件付き GET に使う応答ヘッダ（無ければ空文字） */
      etag: string
      lastModified: string
    }
  | { ok: false; reason: string; url: string }

/** 条件付き GET で「変わっていない」（304）と返された場合。本文は無い */
interface NotModified {
  ok: true
  notModified: true
  url: string
  etag: string
  lastModified: string
}

/** 前回の取得で得た検証子。条件付き GET のヘッダになる */
export interface Validators {
  etag?: string
  lastModified?: string
}

/** 同一 URL の画像がまだ同じ内容かを確かめた結果 */
export type RevalidateResult =
  /** 変わっていない（304 か、取得して SHA-256 が一致した） */
  | { status: 'unchanged'; etag: string; lastModified: string }
  /** 中身が変わっていた。OCR し直す */
  | { status: 'changed'; image: Extract<ImageResult, { ok: true }> }
  /** 確かめられなかった。前回の判断を維持する（黙って変更なしとは言わない） */
  | { status: 'unknown'; reason: string }

function guessMimeType(url: string, contentType: string): string {
  const ct = contentType.split(';')[0]!.trim().toLowerCase()
  if (ct.startsWith('image/')) return ct === 'image/jpg' ? 'image/jpeg' : ct
  return /\.png$/i.test(url) ? 'image/png' : 'image/jpeg'
}

/**
 * リサイズ版 URL から原寸 URL を作る。サフィックスが無ければ null。
 *
 * 判定は URL の**パス部分**に対して行う。URL 全体へ当てると `-724x1024.jpg?v=2` の
 * ようにクエリが付いた時点で一致しなくなり、原寸への切り替えが黙って効かなくなる
 * （extractLinks の拡張子判定と同じ理由）。
 */
export function originalSizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!CONFIG.resizedSuffixPattern.test(parsed.pathname)) return null
    parsed.pathname = parsed.pathname.replace(CONFIG.resizedSuffixPattern, '')
    return parsed.toString()
  } catch {
    // 絶対 URL として解釈できないときは従来どおり文字列として扱う
    if (!CONFIG.resizedSuffixPattern.test(url)) return null
    return url.replace(CONFIG.resizedSuffixPattern, '')
  }
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

/**
 * 候補（原寸 → リンク記載 URL）を順に試す取得本体。
 *
 * `conditional` を渡すと、**最初の候補にだけ**条件付き GET のヘッダを付ける。
 * 検証子は前回成功した URL に対して発行された値なので、フォールバックした別 URL へ
 * 送ると意味が無い（サーバによっては誤って 304 を返しかねない）。
 */
async function fetchImageInternal(
  rawUrl: string,
  conditional?: Validators,
): Promise<ImageResult | NotModified> {
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

    const headers: Record<string, string> = {}
    if (i === 0 && conditional) {
      if (conditional.etag) headers['if-none-match'] = conditional.etag
      if (conditional.lastModified) headers['if-modified-since'] = conditional.lastModified
    }

    let res: Awaited<ReturnType<typeof fetchWithTimeout>>
    try {
      res = await fetchWithTimeout(url, {
        allowedHostSuffixes: CONFIG.allowedImageHostSuffixes,
        maxBytes: CONFIG.maxImageBytes,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      })
    } catch (e) {
      lastReason = `画像取得に失敗しました（${(e as Error).message}）`
      continue
    }

    // 条件付き GET で「変わっていない」。本文は流れない
    if (res.status === 304) {
      return { ok: true, notModified: true, url, etag: res.etag, lastModified: res.lastModified }
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
      etag: res.etag,
      lastModified: res.lastModified,
    }
  }

  return { ok: false, url: rawUrl, reason: lastReason || '画像を取得できませんでした' }
}

export async function fetchImage(rawUrl: string): Promise<ImageResult> {
  const outcome = await fetchImageInternal(rawUrl)
  // 条件付きヘッダを付けていないので 304 は返らない。型の上でだけ潰す
  if (outcome.ok && 'notModified' in outcome) {
    return { ok: false, url: rawUrl, reason: '条件付き要求をしていないのに 304 が返りました' }
  }
  return outcome
}

/**
 * 「URL は前回と同じ」画像が、まだ同じ内容かを確かめる（FR-4 の見逃し対策）。
 *
 * 検証子があれば条件付き GET を投げる。サーバが 304 を返せば画像本体は流れないので、
 * 毎日確かめても大学サイトへの負荷はヘッダ 1 往復で済む。
 * 検証子が無い・無視される場合は本体が返るので、SHA-256 で突き合わせる。
 *
 * 確かめられなかった場合は `unknown` を返す。呼び出し側はここで「変更なし」と
 * 断定せず、最後に確認できた日からの経過で警告の重さを決める。
 */
export async function revalidateImage(
  rawUrl: string,
  known: { sha256: string; etag?: string; lastModified?: string },
): Promise<RevalidateResult> {
  /**
   * ⚠️ **取得は必ず `fetchImageInternal` を通す。** state の `sha256` は、原寸フォールバック
   * （FR-5）を経て実際に取得できた URL のバイト列から作られている。リンク記載 URL
   * （リサイズ版）を直接取り直して比べると、同じ画像でも別バイト列になり、
   * **毎回「差し替わった」と誤判定して無駄な OCR が走る。**
   * 候補の解決順を取得本体と共有することでこの食い違いを防ぐ。
   */
  const outcome = await fetchImageInternal(rawUrl, {
    ...(known.etag ? { etag: known.etag } : {}),
    ...(known.lastModified ? { lastModified: known.lastModified } : {}),
  })

  if (!outcome.ok) return { status: 'unknown', reason: outcome.reason }

  if ('notModified' in outcome) {
    // 検証子は更新されうる（サーバが新しい値を返すことがある）ので拾い直す
    return {
      status: 'unchanged',
      etag: outcome.etag || (known.etag ?? ''),
      lastModified: outcome.lastModified || (known.lastModified ?? ''),
    }
  }

  if (outcome.sha256 === known.sha256) {
    return { status: 'unchanged', etag: outcome.etag, lastModified: outcome.lastModified }
  }

  return { status: 'changed', image: outcome }
}
