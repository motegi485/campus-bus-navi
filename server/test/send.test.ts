import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { base64UrlToBytes, bytesToBase64Url, VapidSigner, type VapidKeys } from '../src/vapid.js'
import { sendPush } from '../src/send.js'

let signer: VapidSigner
const NOW = 1786968000
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123'

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey

  const publicPoint = new Uint8Array(65)
  publicPoint[0] = 0x04
  publicPoint.set(base64UrlToBytes(jwk.x!), 1)
  publicPoint.set(base64UrlToBytes(jwk.y!), 33)

  const keys: VapidKeys = {
    publicKey: bytesToBase64Url(publicPoint),
    privateKey: jwk.d!,
    subject: 'mailto:campus-bus-navi@example.ac.jp',
  }
  signer = new VapidSigner(keys)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** fetch を差し替えて、送信されたリクエストを覗けるようにする */
function stubFetch(reply: Response | (() => never)) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (typeof reply === 'function') reply()
    return Promise.resolve(reply)
  })
  return calls
}

describe('sendPush', () => {
  it('201 は成功として扱う（push サービスは 200 とは限らない）', async () => {
    stubFetch(new Response(null, { status: 201 }))
    expect(await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })).toEqual({ status: 'sent', code: 201 })
  })

  it('POST で、本文を付けずに送る', async () => {
    const calls = stubFetch(new Response(null, { status: 201 }))
    await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(ENDPOINT)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.body).toBeUndefined()

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^vapid t=/)
    expect(headers.TTL).toBe('600')
    // 本文がないので Content-Encoding を付けてはいけない
    expect(headers['Content-Encoding']).toBeUndefined()
  })

  it('410 Gone は失効として扱う（購読を削除する合図）', async () => {
    stubFetch(new Response(null, { status: 410 }))
    expect(await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })).toEqual({ status: 'expired', code: 410 })
  })

  it('404 Not Found も失効として扱う', async () => {
    stubFetch(new Response(null, { status: 404 }))
    expect(await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })).toEqual({ status: 'expired', code: 404 })
  })

  it('429 は絞られただけなので購読を消さない', async () => {
    stubFetch(new Response(null, { status: 429 }))
    expect(await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })).toEqual({ status: 'rate-limited' })
  })

  it('400 は失敗として本文の先頭を残す', async () => {
    stubFetch(new Response('InvalidTTL: value must be a number', { status: 400 }))
    const result = await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })
    expect(result).toEqual({ status: 'failed', code: 400, detail: 'InvalidTTL: value must be a number' })
  })

  it('401 は「設定の誤り」として一時的な失敗と分ける（鍵の不一致）', async () => {
    stubFetch(new Response('the vapid key in the authorization header does not match', { status: 401 }))
    const result = await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })
    expect(result).toEqual({
      status: 'rejected',
      code: 401,
      detail: 'the vapid key in the authorization header does not match',
    })
  })

  it('403 も「設定の誤り」として扱う', async () => {
    stubFetch(new Response('forbidden', { status: 403 }))
    const result = await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })
    expect(result).toEqual({ status: 'rejected', code: 403, detail: 'forbidden' })
  })

  it('鍵を読めないときは失敗として返さず投げる（静かに止まらせない）', async () => {
    // VAPID_PRIVATE_KEY が未登録・形式違いの状況。ここで failed に化けると、
    // 呼び出し側は実行を成功として終え、Cron の実行結果も成功のまま通知だけが止まる
    const broken = new VapidSigner({
      publicKey: 'not-a-valid-public-point',
      privateKey: 'not-a-valid-scalar',
      subject: 'mailto:campus-bus-navi@example.ac.jp',
    })
    const calls = stubFetch(new Response(null, { status: 201 }))

    await expect(sendPush({ endpoint: ENDPOINT, signer: broken, nowSeconds: NOW })).rejects.toThrow()
    // 署名できていないので、送信そのものを試みてはいけない
    expect(calls).toHaveLength(0)
  })

  it('長すぎるエラー本文は切り詰める', async () => {
    stubFetch(new Response('x'.repeat(5000), { status: 500 }))
    const result = await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })
    expect(result.status).toBe('failed')
    if (result.status === 'failed') expect(result.detail.length).toBe(200)
  })

  it('ネットワーク層の失敗でも例外を投げず、購読を消さない', async () => {
    stubFetch(() => {
      throw new TypeError('network error')
    })
    const result = await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW })
    expect(result).toEqual({ status: 'failed', code: 0, detail: 'network error' })
  })

  it('TTL を指定できる', async () => {
    const calls = stubFetch(new Response(null, { status: 201 }))
    await sendPush({ endpoint: ENDPOINT, signer, nowSeconds: NOW, ttlSeconds: 90 })
    expect((calls[0].init.headers as Record<string, string>).TTL).toBe('90')
  })

  it('APNs のエンドポイントには APNs 向けの aud で署名する', async () => {
    const calls = stubFetch(new Response(null, { status: 201 }))
    await sendPush({ endpoint: 'https://web.push.apple.com/QABC/deadbeef', signer, nowSeconds: NOW })

    const auth = (calls[0].init.headers as Record<string, string>).Authorization
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(auth.split('.')[1])))
    expect(payload.aud).toBe('https://web.push.apple.com')
  })
})
