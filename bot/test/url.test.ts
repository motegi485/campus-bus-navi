/** 取得先の信頼境界（url.ts）。掲載ページの改ざん・誤リンクで外へ出ないことを固定する。 */

import { describe, it, expect } from 'vitest'
import { checkUrl, assertAllowedUrl } from '../src/url.js'
import { CONFIG } from '../src/config.js'

const ALLOW = CONFIG.allowedImageHostSuffixes

describe('取得先の許可判定（F-009）', () => {
  it('許可ホストの https URL は通す', () => {
    const result = checkUrl('https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/04/a.jpg', ALLOW)
    expect(result.ok).toBe(true)
  })

  it('許可ホストのサブドメインも通す', () => {
    expect(checkUrl('https://cdn.fukuyama-u.ac.jp/a.jpg', ALLOW).ok).toBe(true)
  })

  it('似ているだけの別ドメインは通さない', () => {
    // 「…fukuyama-u.ac.jp」で終わる別ホスト（例: evil-fukuyama-u.ac.jp.example.com）を拒否する
    expect(checkUrl('https://evil-fukuyama-u.ac.jp.example.com/a.jpg', ALLOW).ok).toBe(false)
    expect(checkUrl('https://notfukuyama-u.ac.jp/a.jpg', ALLOW).ok).toBe(false)
  })

  it('平文 http は通さない', () => {
    const result = checkUrl('http://www.fukuyama-u.ac.jp/a.jpg', ALLOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/https 以外/)
  })

  it('ループバック・プライベート IP 直指定は通さない', () => {
    expect(checkUrl('https://127.0.0.1:3000/private.jpg', ALLOW).ok).toBe(false)
    expect(checkUrl('https://169.254.169.254/latest/meta-data', ALLOW).ok).toBe(false)
    expect(checkUrl('https://[::1]/private.jpg', ALLOW).ok).toBe(false)
  })

  it('資格情報付き URL は通さない', () => {
    const result = checkUrl('https://user:pass@www.fukuyama-u.ac.jp/a.jpg', ALLOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/資格情報/)
  })

  it('URL として解釈できない文字列は通さない', () => {
    expect(checkUrl('javascript:alert(1)', ALLOW).ok).toBe(false)
    expect(checkUrl('not a url', ALLOW).ok).toBe(false)
  })

  it('assertAllowedUrl は許可外で例外を投げる', () => {
    expect(() => assertAllowedUrl('https://example.com/a.jpg', ALLOW)).toThrow(/許可されていないホスト/)
    expect(assertAllowedUrl('https://www.fukuyama-u.ac.jp/a.jpg', ALLOW).hostname).toBe('www.fukuyama-u.ac.jp')
  })

  it('祝日CSV は cao.go.jp のみ許可する', () => {
    expect(checkUrl(CONFIG.holidayCsvUrl, CONFIG.allowedHolidayHostSuffixes).ok).toBe(true)
    expect(checkUrl('https://www.fukuyama-u.ac.jp/a.csv', CONFIG.allowedHolidayHostSuffixes).ok).toBe(false)
  })
})
