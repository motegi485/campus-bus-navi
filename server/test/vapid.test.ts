import { describe, it, expect, beforeAll } from 'vitest'
import {
  audienceOf,
  base64UrlToBytes,
  bytesToBase64Url,
  createVapidJwt,
  importVapidPrivateKey,
  VapidSigner,
  type VapidKeys,
} from '../src/vapid.js'

/** テスト用の鍵ペアを 1 組だけ作って使い回す */
let keys: VapidKeys
let verifyKey: CryptoKey

const SUBJECT = 'mailto:campus-bus-navi@example.ac.jp'
/** 2026-08-15 12:00:00 UTC。時刻は必ず引数で渡す（テストを時計に依存させない） */
const NOW = 1786968000

beforeAll(async () => {
  // generateKey / exportKey の戻りはユニオン型。P-256 の鍵ペアと JWK なのは自明なので絞る
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey

  const publicPoint = new Uint8Array(65)
  publicPoint[0] = 0x04
  publicPoint.set(base64UrlToBytes(jwk.x!), 1)
  publicPoint.set(base64UrlToBytes(jwk.y!), 33)

  keys = {
    publicKey: bytesToBase64Url(publicPoint),
    privateKey: jwk.d!,
    subject: SUBJECT,
  }
  verifyKey = pair.publicKey
})

/** JWT の署名を公開鍵で検証する。実装が本当に ES256 として正しいかを外から確かめる */
async function verifyJwt(jwt: string): Promise<boolean> {
  const [header, payload, signature] = jwt.split('.')
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    base64UrlToBytes(signature),
    new TextEncoder().encode(`${header}.${payload}`)
  )
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)))
}

describe('base64url', () => {
  it('往復して元に戻る', () => {
    const bytes = new Uint8Array([0, 1, 62, 63, 127, 128, 254, 255])
    expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(Array.from(bytes))
  })

  it('URL 安全な文字だけを使い、パディングを付けない', () => {
    // 0xfb 0xff は標準 base64 では "+/" を含む並びになる
    const encoded = bytesToBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('長さが 4 の倍数でない入力も復号できる（パディング無しの JWT 断片）', () => {
    expect(Array.from(base64UrlToBytes('AQ'))).toEqual([1])
    expect(Array.from(base64UrlToBytes('AQI'))).toEqual([1, 2])
  })
})

describe('audienceOf', () => {
  it('パスを落としてオリジンだけを返す', () => {
    expect(audienceOf('https://fcm.googleapis.com/fcm/send/abc123:XYZ')).toBe('https://fcm.googleapis.com')
    expect(audienceOf('https://web.push.apple.com/QABC.../deadbeef')).toBe('https://web.push.apple.com')
    expect(audienceOf('https://updates.push.services.mozilla.com/wpush/v2/g')).toBe(
      'https://updates.push.services.mozilla.com'
    )
  })

  it('ポート付きでもオリジンとして扱える', () => {
    expect(audienceOf('https://push.example.com:8443/send/x')).toBe('https://push.example.com:8443')
  })
})

describe('importVapidPrivateKey', () => {
  it('正しい鍵を読み込める', async () => {
    await expect(importVapidPrivateKey(keys)).resolves.toBeDefined()
  })

  it('公開鍵が 65 バイトの非圧縮点でなければ拒む', async () => {
    const compressed = bytesToBase64Url(new Uint8Array(33))
    await expect(importVapidPrivateKey({ publicKey: compressed, privateKey: keys.privateKey })).rejects.toThrow(
      /65 バイト/
    )
  })

  it('秘密鍵が 32 バイトでなければ拒む', async () => {
    const short = bytesToBase64Url(new Uint8Array(16))
    await expect(importVapidPrivateKey({ publicKey: keys.publicKey, privateKey: short })).rejects.toThrow(/32 バイト/)
  })
})

describe('createVapidJwt', () => {
  it('公開鍵で検証できる署名を作る', async () => {
    const key = await importVapidPrivateKey(keys)
    const jwt = await createVapidJwt({
      audience: 'https://fcm.googleapis.com',
      subject: SUBJECT,
      key,
      nowSeconds: NOW,
    })
    expect(await verifyJwt(jwt)).toBe(true)
  })

  it('ヘッダが ES256 の JWT である', async () => {
    const key = await importVapidPrivateKey(keys)
    const jwt = await createVapidJwt({ audience: 'https://x.example', subject: SUBJECT, key, nowSeconds: NOW })
    expect(decodeSegment(jwt.split('.')[0])).toEqual({ typ: 'JWT', alg: 'ES256' })
  })

  it('aud / sub / exp を載せ、exp は 24 時間以内に収まる', async () => {
    const key = await importVapidPrivateKey(keys)
    const jwt = await createVapidJwt({
      audience: 'https://web.push.apple.com',
      subject: SUBJECT,
      key,
      nowSeconds: NOW,
    })
    const payload = decodeSegment(jwt.split('.')[1]) as { aud: string; sub: string; exp: number }

    expect(payload.aud).toBe('https://web.push.apple.com')
    expect(payload.sub).toBe(SUBJECT)
    // RFC 8292 は 24 時間以内を要求する。境界ちょうども超過も許さない
    expect(payload.exp).toBeGreaterThan(NOW)
    expect(payload.exp - NOW).toBeLessThan(24 * 60 * 60)
  })

  it('署名は IEEE P1363 形式（r||s の 64 バイト）で、DER ではない', async () => {
    const key = await importVapidPrivateKey(keys)
    const jwt = await createVapidJwt({ audience: 'https://x.example', subject: SUBJECT, key, nowSeconds: NOW })
    // DER なら先頭が 0x30（SEQUENCE）で長さも 64 にならない
    const signature = base64UrlToBytes(jwt.split('.')[2])
    expect(signature.length).toBe(64)
  })
})

describe('VapidSigner', () => {
  it('subject が mailto: / https: でなければ作れない', () => {
    expect(() => new VapidSigner({ ...keys, subject: 'campus-bus-navi@example.ac.jp' })).toThrow(/subject/)
    expect(() => new VapidSigner({ ...keys, subject: 'https://campus-bus-navi.pages.dev/' })).not.toThrow()
  })

  it('同じ aud なら署名を使い回す', async () => {
    const signer = new VapidSigner(keys)
    const a = await signer.tokenFor('https://fcm.googleapis.com', NOW)
    const b = await signer.tokenFor('https://fcm.googleapis.com', NOW + 60)
    expect(b).toBe(a)
  })

  it('aud が違えば別の署名になる', async () => {
    const signer = new VapidSigner(keys)
    const fcm = await signer.tokenFor('https://fcm.googleapis.com', NOW)
    const apns = await signer.tokenFor('https://web.push.apple.com', NOW)
    expect(apns).not.toBe(fcm)
    expect(decodeSegment(apns.split('.')[1]).aud).toBe('https://web.push.apple.com')
  })

  it('期限が近づいたら作り直す', async () => {
    const signer = new VapidSigner(keys)
    const first = await signer.tokenFor('https://fcm.googleapis.com', NOW)
    // TTL 12h - 余裕 30min = 11.5h。それを過ぎたら新しい JWT になる
    const later = await signer.tokenFor('https://fcm.googleapis.com', NOW + 11.5 * 60 * 60 + 1)
    expect(later).not.toBe(first)
    expect(await verifyJwt(later)).toBe(true)
  })

  it('ペイロードなし push のヘッダを組み立てる', async () => {
    const signer = new VapidSigner(keys)
    const headers = (await signer.headersFor(
      'https://fcm.googleapis.com/fcm/send/abc123',
      NOW
    )) as Record<string, string>

    expect(headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/)
    expect(headers.Authorization).toContain(`k=${keys.publicKey}`)
    expect(headers.TTL).toBe('600')
    expect(headers['Content-Length']).toBe('0')
    // 本文がないので Content-Encoding は付けない（付けると push サービスが 400 を返す）
    expect(headers['Content-Encoding']).toBeUndefined()
  })

  it('TTL を指定できる', async () => {
    const signer = new VapidSigner(keys)
    const headers = (await signer.headersFor('https://fcm.googleapis.com/fcm/send/x', NOW, 120)) as Record<
      string,
      string
    >
    expect(headers.TTL).toBe('120')
  })
})
