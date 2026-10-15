/** 公開 API の共通境界。本文を無制限に展開せず、ブラウザからの別オリジン書込みを拒む。 */
export const MAX_JSON_BODY_BYTES = 8 * 1024

/** 購読・予約・エラーの応答を共有キャッシュや端末の HTTP キャッシュへ残さない。 */
export function privateJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

type JsonObjectResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response }

export async function readMutationJson(request: Request): Promise<JsonObjectResult> {
  const reject = (error: string, status: number): JsonObjectResult => ({
    ok: false,
    response: privateJson({ error }, status),
  })

  // Origin を送らない直接の API 呼出しは維持する。ブラウザが送る null Origin も拒否する。
  const origin = request.headers.get('Origin')
  if (origin !== null && origin !== new URL(request.url).origin) {
    return reject('別のサイトからの書込みは受け付けません', 403)
  }
  const mediaType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
  if (mediaType !== 'application/json') return reject('Content-Type は application/json を指定してください', 415)

  // Content-Length だけには依存しない。ヘッダが無い・実際より小さい場合も読取り中に止める。
  const declaredLength = request.headers.get('Content-Length')
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_JSON_BODY_BYTES) {
    return reject('リクエスト本文が大きすぎます', 413)
  }
  if (!request.body) return reject('JSON を解釈できませんでした', 400)

  const reader = request.body.getReader()
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    let length = 0
    let text = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_JSON_BODY_BYTES) {
        void reader.cancel().catch(() => undefined)
        return reject('リクエスト本文が大きすぎます', 413)
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return reject('リクエストの形式が不正です', 400)
    }
    return { ok: true, value: value as Record<string, unknown> }
  } catch {
    return reject('JSON を解釈できませんでした', 400)
  } finally {
    reader.releaseLock()
  }
}
