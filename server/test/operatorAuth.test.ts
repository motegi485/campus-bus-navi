/**
 * 運用者向け API（/api/status）の合言葉の検査（server/src/operatorAuth.ts）。
 *
 * 守っている反例（2026-11-01 の監査由来）:
 *   - 無認証の /api/status を匿名で叩き続けると、D1 の読み取り枠を消費させられた
 *   - 合言葉の設定漏れや短すぎる値で「誰でも通る」状態にしない（フェイルクローズ）
 */

import { describe, expect, it } from 'vitest'
import { checkOperatorToken, MIN_OPERATOR_TOKEN_LENGTH } from '../src/operatorAuth.js'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789+/=='

describe('checkOperatorToken', () => {
  it('Bearer で正しい合言葉なら ok', async () => {
    expect(await checkOperatorToken(`Bearer ${TOKEN}`, TOKEN)).toBe('ok')
  })

  it('最小長は 32 文字', () => {
    expect(MIN_OPERATOR_TOKEN_LENGTH).toBe(32)
  })

  it.each([
    ['未設定', undefined],
    ['空文字', ''],
    ['31 文字', 'x'.repeat(31)],
    ['文字列以外', { length: 40 }],
    ['null', null],
  ])('合言葉が %s なら、ヘッダーが一致していても unconfigured', async (_name, token) => {
    expect(await checkOperatorToken(`Bearer ${String(token)}`, token)).toBe('unconfigured')
  })

  it('32 文字ちょうどは設定済みとして扱う', async () => {
    const token = 'y'.repeat(32)
    expect(await checkOperatorToken(`Bearer ${token}`, token)).toBe('ok')
    expect(await checkOperatorToken('Bearer ' + 'z'.repeat(32), token)).toBe('denied')
  })

  it.each([
    ['ヘッダーなし', null],
    ['空', ''],
    ['Basic 形式', `Basic ${TOKEN}`],
    ['scheme のみ', 'Bearer'],
    ['scheme の後が空白だけ', 'Bearer '],
    ['トークンのみ', TOKEN],
    ['1 文字違い', `Bearer ${TOKEN.slice(0, -1)}X`],
    ['前方一致（短い）', `Bearer ${TOKEN.slice(0, 32)}`],
    ['後ろに余分な文字', `Bearer ${TOKEN}A`],
    ['後ろに空白', `Bearer ${TOKEN} `],
    ['前に空白', ` Bearer ${TOKEN}`],
    ['間の空白が 2 つ', `Bearer  ${TOKEN}`],
    ['改行を含む', `Bearer ${TOKEN}\n`],
    ['513 文字以上', `Bearer ${'a'.repeat(513)}`],
  ])('%s は denied', async (_name, header) => {
    expect(await checkOperatorToken(header, TOKEN)).toBe('denied')
  })
})
