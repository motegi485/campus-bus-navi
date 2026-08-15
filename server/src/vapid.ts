/**
 * VAPID（RFC 8292）の署名。
 *
 * Node の `web-push` ライブラリは Cloudflare Workers で動かない（Node 固有の crypto に
 * 依存している）ため、WebCrypto だけで自前実装する。同じコードが Workers と Node 24 の
 * 両方でそのまま動くので、単体テストは vitest から直接呼べる。
 *
 * 送信するのは**ペイロードなし push**（本文なし）。Workers 無料枠の CPU 上限は
 * 1 実行あたり 10ms で、購読者ごとの本文暗号化（ECDH + HKDF + AES-GCM）を回すと
 * 50 人分で超える見込みのため。ペイロードなしなら署名は「push サービスのオリジン
 * （aud）ごとに 1 回」で済み、使い回せる。表示内容は受信側の SW が組み立てる。
 */

/** JWT の有効期間。RFC 8292 は 24 時間以内を要求する。余裕を見て 12 時間にする */
const JWT_TTL_SECONDS = 12 * 60 * 60

/** 署名キャッシュを捨てる余裕。期限ぎりぎりの JWT を送らない */
const JWT_REFRESH_MARGIN_SECONDS = 30 * 60

/** push サービスに保持させる時間。端末が圏外でも次に繋がったときに届く */
export const DEFAULT_TTL_SECONDS = 10 * 60

export interface VapidKeys {
  /** 65 バイトの非圧縮公開点（0x04 || X || Y）の base64url */
  publicKey: string
  /** 32 バイトの秘密スカラー d の base64url */
  privateKey: string
  /** 連絡先。`mailto:` か `https:` の URL でなければならない */
  subject: string
}

// ── base64url ────────────────────────────────────────────────────────────────

// 返り値を Uint8Array<ArrayBuffer> と明示する。既定の Uint8Array は TS 5.7 以降
// Uint8Array<ArrayBufferLike> に広がり、WebCrypto の BufferSource に渡せなくなるため。
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

// ── 鍵 ───────────────────────────────────────────────────────────────────────

/**
 * 保存形式（公開点 + 秘密スカラー）から署名用の CryptoKey を作る。
 *
 * WebCrypto の JWK インポートは x / y も要求するが、公開鍵は非圧縮点なので
 * 先頭の 0x04 を除いた前半 32 バイトが x、後半 32 バイトが y になる。
 */
export async function importVapidPrivateKey(keys: Pick<VapidKeys, 'publicKey' | 'privateKey'>): Promise<CryptoKey> {
  const publicPoint = base64UrlToBytes(keys.publicKey)
  if (publicPoint.length !== 65 || publicPoint[0] !== 0x04) {
    throw new Error('VAPID 公開鍵は 65 バイトの非圧縮点（先頭 0x04）でなければなりません')
  }
  const privateScalar = base64UrlToBytes(keys.privateKey)
  if (privateScalar.length !== 32) {
    throw new Error('VAPID 秘密鍵は 32 バイトでなければなりません')
  }

  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicPoint.subarray(1, 33)),
      y: bytesToBase64Url(publicPoint.subarray(33, 65)),
      d: bytesToBase64Url(privateScalar),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

/**
 * push エンドポイントから aud（オーディエンス）を取り出す。
 * RFC 8292 はオリジン（スキーム + ホスト）だけを求める。パスを含めると弾く実装がある。
 */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin
}

// ── 署名 ─────────────────────────────────────────────────────────────────────

/**
 * ES256 の JWT を 1 本作る。
 *
 * WebCrypto の ECDSA 署名は IEEE P1363 形式（r || s の 64 バイト生値）を返す。
 * JWS が要求するのもこの形式なので、DER への変換は要らない（Node の crypto を
 * 使うと DER が返るため、そちらでは変換が必要になる）。
 */
export async function createVapidJwt(params: {
  audience: string
  subject: string
  key: CryptoKey
  /** 現在時刻（epoch 秒）。テストから固定値を渡せるようにしている */
  nowSeconds: number
}): Promise<string> {
  const header = utf8ToBase64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = utf8ToBase64Url(
    JSON.stringify({
      aud: params.audience,
      exp: params.nowSeconds + JWT_TTL_SECONDS,
      sub: params.subject,
    })
  )
  const signingInput = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    params.key,
    new TextEncoder().encode(signingInput)
  )
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
}

interface CachedJwt {
  token: string
  /** この時刻（epoch 秒）を過ぎたら作り直す */
  refreshAfter: number
}

/**
 * aud ごとに JWT をキャッシュする署名器。
 *
 * 1 回の送信バッチに含まれる購読は、push サービスが数種類（FCM / APNs / Mozilla）に
 * 限られる。オーディエンス単位で使い回せば、署名は実質 1 バッチ 3 回以下になり、
 * CPU 10ms の制約に収まる。
 */
export class VapidSigner {
  private key: CryptoKey | null = null
  private readonly cache = new Map<string, CachedJwt>()

  constructor(private readonly keys: VapidKeys) {
    if (!/^(mailto:|https:)/.test(keys.subject)) {
      throw new Error('VAPID の subject は mailto: か https: の URL でなければなりません')
    }
  }

  /** `Authorization` ヘッダ用の JWT を返す（同じ aud なら使い回す） */
  async tokenFor(audience: string, nowSeconds: number): Promise<string> {
    const cached = this.cache.get(audience)
    if (cached && nowSeconds < cached.refreshAfter) return cached.token

    if (!this.key) this.key = await importVapidPrivateKey(this.keys)
    const token = await createVapidJwt({
      audience,
      subject: this.keys.subject,
      key: this.key,
      nowSeconds,
    })
    this.cache.set(audience, {
      token,
      refreshAfter: nowSeconds + JWT_TTL_SECONDS - JWT_REFRESH_MARGIN_SECONDS,
    })
    return token
  }

  /**
   * ペイロードなし push のリクエストヘッダを組み立てる。
   *
   * 本文がないので `Content-Encoding` は付けない。`TTL` は必須。
   * `Urgency: high` は「発車が近い」という性質に合わせたもので、端末が省電力状態でも
   * 配送を試みさせる（push サービスへの助言であって保証ではない）。
   */
  async headersFor(endpoint: string, nowSeconds: number, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<HeadersInit> {
    const token = await this.tokenFor(audienceOf(endpoint), nowSeconds)
    return {
      Authorization: `vapid t=${token}, k=${this.keys.publicKey}`,
      TTL: String(ttlSeconds),
      Urgency: 'high',
      'Content-Length': '0',
    }
  }
}
