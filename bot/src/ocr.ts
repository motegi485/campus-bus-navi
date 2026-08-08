/**
 * FR-6: Gemini による画像→中間構造化（§8.5）。
 * - SDK は `@google/genai`（`@google/generative-ai` はレガシーで使用禁止）
 * - Gemini 3 系の公式推奨に従い temperature / topP / topK は指定しない（既定 1.0 のまま）
 * - 決定性は「2回読み照合」（§8.5.4）で担保する
 */

import { GoogleGenAI, Type, ThinkingLevel, MediaResolution, type Schema } from '@google/genai'
import { CONFIG } from './config.js'
import type { Intermediate, IntermediateDayType, IntermediateRow } from './types.js'

/**
 * OCR プロンプト（§8.5.3）。
 *
 * 【要件定義 v1.4 からの変更・2026-08-01 実地検証で承認済み】
 * v1.4 の規則4 は「通常/休暇ダイヤ画像＝時｜松永発｜時｜大学発」「イベント画像＝松永発｜時｜大学発」と
 * 画像種別でレイアウトを決め打ちしていたが、実際の夏季休業画像（0817-.jpg）は
 * 「松永発｜時｜大学発」の共有『時』列で、しかも平日／土・日・祝の2表が左右に並ぶ。
 * そこで規則4 をレイアウト非依存に書き換え、複数種別の配置（上下／左右）も明示した。
 * また 0808 画像には表セル内に「8月12日（水）最終」等の注記矢印があるため、
 * 注記を発車時刻として読まない規則（6）を追加した。
 */
export const OCR_PROMPT = `あなたは福山大学スクールバス時刻表画像の読み取り器です。
画像から「スクールバスの発車時刻」だけを抽出し、指定スキーマのJSONのみを返してください。

厳守事項:
1. 抽出対象は「スクールバス時刻表」の2方向のみ:
   - "松永発"（→ matsunaga）
   - "大学発"（→ university）
2. 「JR」「松永駅」「上り」「下り」「福山方面」「尾道方面」と書かれた列・表は鉄道の時刻表です。
   これらは絶対に含めないでください。バスとJRの時刻は形式が似ているため、列の見出しを必ず確認し、
   取り違えを厳禁とします。
3. 1つの画像に複数のダイヤ種別（例:「授業日」「休業日」「平日」「土・日・祝」）が含まれることが
   あります。その場合は種別ごとに day_types の別要素として抽出してください。
   種別が1つしかない画像は day_types を1要素にしてください。
   複数の種別は「上下に並ぶ」場合と「左右に並ぶ」場合の両方があります。どちらの場合も、
   枠で囲まれた見出しラベルとその下（または右）の表の対応を必ず確認してください。
4. 「時」列の位置はレイアウトによって異なります。決め打ちせず、必ず列見出しを見て判断してください:
   - 「時｜松永発｜時｜大学発」のように、各方向が専用の「時」列を左隣に持つ場合
   - 「松永発｜時｜大学発」のように、中央の「時」列を両方向で共有する場合
   各方向の「分」は、その方向に対応する「時」列と必ず組にして読んでください。
5. 各時間帯セルには2桁の「分」が0個以上書かれています。書かれている分をすべて minutes に
   列挙してください。存在しない時刻を捏造しない。存在する時刻を省略しない。
   発車のない時間帯（空のセル）は minutes を空配列 [] にしてください。空の行を読み飛ばして
   後続の行を繰り上げないでください（各行は必ず「時」列の値と組で読む）。
6. 表の中や周囲にある注記（矢印・吹き出し・「◯月◯日 最終」「◯月◯日 始発」「運行休止」等の
   但し書き）は発車時刻ではありません。minutes に含めないでください。
7. label は画像内のそのダイヤ種別の表記（例:「授業日」「休業日」「平日」「土・日・祝」）を
   そのまま使ってください。種別の表記が無い画像では、タイトルにある行事名・種別名
   （例:「オープンキャンパス」「簿記検定」「夏季休業」）を使ってください。
   日付や期間（例:「2026年8月23日(日)」「8月17日～9月23日」）は label ではありません。
   日付しか見当たらない場合は空文字にしてください。
8. 出力はJSONのみ。説明文・マークダウン・コードフェンスを含めないでください。`

// 注: SDK の Schema では minItems / maxItems は int64 を表す【文字列】。数値を渡すと API エラーになる。
const ROWS_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    required: ['hour', 'minutes'],
    properties: {
      hour: { type: Type.INTEGER, minimum: 0, maximum: 23 },
      minutes: { type: Type.ARRAY, items: { type: Type.INTEGER, minimum: 0, maximum: 59 } },
    },
  },
}

export const INTERMEDIATE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ['day_types'],
  properties: {
    day_types: {
      type: Type.ARRAY,
      minItems: '1',
      maxItems: '2',
      items: {
        type: Type.OBJECT,
        required: ['label', 'matsunaga', 'university'],
        properties: {
          label: { type: Type.STRING },
          matsunaga: ROWS_SCHEMA,
          university: ROWS_SCHEMA,
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// 正規化と比較（§8.5.4）
// ---------------------------------------------------------------------------

function normalizeRows(rows: IntermediateRow[]): IntermediateRow[] {
  return [...rows]
    .map((r) => ({ hour: r.hour, minutes: [...new Set(r.minutes)].sort((a, b) => a - b) }))
    .sort((a, b) => a.hour - b.hour)
}

export function normalizeIntermediate(value: Intermediate): Intermediate {
  const day_types: IntermediateDayType[] = [...value.day_types]
    .map((d) => ({
      label: (d.label ?? '').trim(),
      matsunaga: normalizeRows(d.matsunaga ?? []),
      university: normalizeRows(d.university ?? []),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return { day_types }
}

function sameIntermediate(a: Intermediate, b: Intermediate): boolean {
  return JSON.stringify(normalizeIntermediate(a)) === JSON.stringify(normalizeIntermediate(b))
}

// ---------------------------------------------------------------------------
// 呼び出し
// ---------------------------------------------------------------------------

export interface OcrOutcome {
  ok: boolean
  intermediate?: Intermediate
  /** 何回読んだか */
  attempts: number
  /** 多数決で採用したか */
  majority: boolean
  /** フォールバックモデルを使ったか */
  fallbackUsed: boolean
  modelUsed: string
  reason?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function errorText(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } }
  return [err?.name, err?.message, err?.cause?.code, err?.cause?.message].filter(Boolean).join(' ')
}

function isRateLimit(e: unknown): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED|rate limit/i.test(errorText(e))
}

/**
 * 1日あたりのリクエスト上限（RPD）を使い切った 429。
 * RPM の 429 と違い**待っても当日は回復しない**ので、バックオフせずに
 * フォールバックモデル（別の枠を持つ）へ切り替えるか、即座に失敗させる。
 */
function isDailyQuotaExhausted(e: unknown): boolean {
  return /PerDay|per day|RequestsPerDayPerProject/i.test(errorText(e))
}

/** モデル自体が使えない（無料枠から外れた・権限が無い等）→ フォールバックモデルへ */
function isModelUnavailable(e: unknown): boolean {
  return /\b(404|403)\b|NOT_FOUND|PERMISSION_DENIED|is not found|not supported/i.test(errorText(e))
}

/** 一時障害（数分で解消し得るもの）→ 短いバックオフでリトライ */
function isTransient(e: unknown): boolean {
  const text = errorText(e)
  if (/\b(500|502|503|504)\b|UNAVAILABLE|INTERNAL|high demand|overloaded/i.test(text)) return true
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|TimeoutError|AbortError|terminated/i.test(
    text,
  )
}

/** 無料枠 RPD を1実行で使い切った（呼び出し上限に達した）ことを示す */
export class CallBudgetExhaustedError extends Error {
  constructor(limit: number) {
    super(`1実行あたりの Gemini 呼び出し上限（${limit}回）に達しました。`)
    this.name = 'CallBudgetExhaustedError'
  }
}

/**
 * 実行全体の締切に達したことを示す。
 *
 * 1リクエスト 180 秒 × 呼び出し上限 18 回だけでもワークフローの timeout-minutes: 20 を
 * 大きく超えうる。ジョブが強制終了されると PR 本文も Step Summary も残らず、
 * 「何が起きたか分からないまま古いダイヤが残る」という最も観測しにくい失敗になる。
 * 締切前に打ち切って needs_review へ収束させ、必ず記録を残す。
 */
export class RunDeadlineExceededError extends Error {
  constructor() {
    super('実行時間の上限に達したため OCR を打ち切りました。')
    this.name = 'RunDeadlineExceededError'
  }
}

export class OcrClient {
  private ai: GoogleGenAI
  private lastCallAt = 0
  private model: string
  private fallbackUsed = false
  private callCount = 0
  private deadlineAt: number
  private deadlineHit = false

  /**
   * modelOverride は検証用（tools/ocr-check.ts の OCR_MODEL）。本番は CONFIG の既定を使う。
   * deadlineAt は実行全体の締切（epoch ミリ秒）。既定は生成時から CONFIG.runDeadlineMs。
   */
  constructor(apiKey: string, modelOverride?: string, deadlineAt?: number) {
    this.ai = new GoogleGenAI({ apiKey })
    this.model = modelOverride || CONFIG.modelPrimary
    this.deadlineAt = deadlineAt ?? Date.now() + CONFIG.runDeadlineMs
  }

  /** 締切に達して OCR を打ち切ったか（PR・Step Summary への警告に使う） */
  get deadlineExceeded(): boolean {
    return this.deadlineHit
  }

  /** 締切までの残り時間（ミリ秒。過ぎていたら 0） */
  private get remainingMs(): number {
    return Math.max(0, this.deadlineAt - Date.now())
  }

  /** 待機してからもう1回リクエストする余裕が締切内に残っているか */
  private canRetryAfter(waitMs: number): boolean {
    return this.remainingMs > waitMs + CONFIG.geminiMinIntervalMs
  }

  get modelUsed(): string {
    return this.model
  }

  get usedFallback(): boolean {
    return this.fallbackUsed
  }

  /** これまでに実行した Gemini 呼び出し回数（リトライを含む） */
  get calls(): number {
    return this.callCount
  }

  get budgetExhausted(): boolean {
    return this.callCount >= CONFIG.geminiMaxCallsPerRun
  }

  /** 無料枠 RPM 対策: 呼び出し間隔の下限を守る */
  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + CONFIG.geminiMinIntervalMs - Date.now()
    if (wait > 0) await sleep(wait)
    this.lastCallAt = Date.now()
  }

  private async callOnce(buffer: Buffer, mimeType: string, model: string): Promise<Intermediate> {
    if (this.budgetExhausted) throw new CallBudgetExhaustedError(CONFIG.geminiMaxCallsPerRun)
    // 呼び出し間隔（throttle）と1リクエストの下限時間ぶんも残っていなければ始めない
    if (this.remainingMs <= CONFIG.geminiMinIntervalMs) {
      this.deadlineHit = true
      throw new RunDeadlineExceededError()
    }
    this.callCount += 1
    await this.throttle()
    // 1リクエストの上限は「既定値」と「締切までの残り」の短い方
    const requestTimeoutMs = Math.max(1000, Math.min(CONFIG.geminiRequestTimeoutMs, this.remainingMs))
    const res = await this.ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType, data: buffer.toString('base64') } }, { text: OCR_PROMPT }],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: INTERMEDIATE_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        abortSignal: AbortSignal.timeout(requestTimeoutMs),
        // temperature / topP / topK は指定しない（Gemini 3 公式推奨: 既定 1.0 のまま）
      },
    })
    const text = res.text
    if (!text) throw new Error('Gemini の応答にテキストが含まれていません')
    return JSON.parse(text) as Intermediate
  }

  /** 429 / 一時障害のバックオフ ＋ モデル利用不可・過負荷継続時のフォールバックを含む1回読み */
  private async readOnce(buffer: Buffer, mimeType: string): Promise<Intermediate> {
    let rateLimitRetries = 0
    let transientRetries = 0

    for (;;) {
      try {
        return await this.callOnce(buffer, mimeType, this.model)
      } catch (e) {
        // 呼び出し上限・実行時間の締切はリトライしない
        if (e instanceof CallBudgetExhaustedError) throw e
        if (e instanceof RunDeadlineExceededError) throw e

        const dailyExhausted = isDailyQuotaExhausted(e)
        if (dailyExhausted) {
          console.warn(`[ocr] モデル ${this.model} の当日分の無料枠（RPD）を使い切りました。`)
        }

        if (isRateLimit(e) && !dailyExhausted && rateLimitRetries < CONFIG.geminiMaxRetries429) {
          const wait = CONFIG.geminiBackoffMs[Math.min(rateLimitRetries, CONFIG.geminiBackoffMs.length - 1)]!
          if (!this.canRetryAfter(wait)) {
            this.deadlineHit = true
            throw new RunDeadlineExceededError()
          }
          rateLimitRetries += 1
          console.warn(`[ocr] 429 を受信しました。${wait / 1000}秒待って再試行します（${rateLimitRetries}回目）`)
          await sleep(wait)
          continue
        }

        if (isTransient(e) && transientRetries < CONFIG.geminiMaxRetriesTransient) {
          const wait =
            CONFIG.geminiTransientBackoffMs[
              Math.min(transientRetries, CONFIG.geminiTransientBackoffMs.length - 1)
            ]!
          if (!this.canRetryAfter(wait)) {
            this.deadlineHit = true
            throw new RunDeadlineExceededError()
          }
          transientRetries += 1
          console.warn(
            `[ocr] 一時障害を検出しました（${errorText(e).slice(0, 120)}）。${wait / 1000}秒待って再試行します（${transientRetries}回目）`,
          )
          await sleep(wait)
          continue
        }

        // モデルが使えない / 一時障害が解消しない / 当日枠を使い切った
        // → フォールバックモデル（別の枠を持つ）へ1度だけ切り替える
        const canFallback = !this.fallbackUsed && this.model === CONFIG.modelPrimary
        if (canFallback && (isModelUnavailable(e) || isTransient(e) || dailyExhausted)) {
          console.warn(
            `[ocr] モデル ${this.model} を使用できません（${errorText(e).slice(0, 120)}）。${CONFIG.modelFallback} で再試行します。`,
          )
          this.model = CONFIG.modelFallback
          this.fallbackUsed = true
          transientRetries = 0
          continue
        }

        throw e
      }
    }
  }

  /**
   * §8.5.4 2回読み照合。
   * 一致 → 採用。不一致 → 3回目を実行し、3つのうち2つが一致すればそれを採用。
   * 全不一致 → needs_review（1画像あたり最大3回）。
   */
  async read(buffer: Buffer, mimeType: string): Promise<OcrOutcome> {
    const results: Intermediate[] = []
    try {
      results.push(await this.readOnce(buffer, mimeType))
      results.push(await this.readOnce(buffer, mimeType))
    } catch (e) {
      return {
        ok: false,
        attempts: results.length,
        majority: false,
        fallbackUsed: this.fallbackUsed,
        modelUsed: this.model,
        reason: `Gemini の呼び出しに失敗しました: ${(e as Error).message}`,
      }
    }

    if (sameIntermediate(results[0]!, results[1]!)) {
      return {
        ok: true,
        intermediate: normalizeIntermediate(results[0]!),
        attempts: 2,
        majority: false,
        fallbackUsed: this.fallbackUsed,
        modelUsed: this.model,
      }
    }

    try {
      results.push(await this.readOnce(buffer, mimeType))
    } catch (e) {
      return {
        ok: false,
        attempts: 2,
        majority: false,
        fallbackUsed: this.fallbackUsed,
        modelUsed: this.model,
        reason: `2回読みが不一致で、3回目の呼び出しに失敗しました: ${(e as Error).message}`,
      }
    }

    for (const [i, j] of [
      [0, 2],
      [1, 2],
    ] as const) {
      if (sameIntermediate(results[i]!, results[j]!)) {
        return {
          ok: true,
          intermediate: normalizeIntermediate(results[i]!),
          attempts: 3,
          majority: true,
          fallbackUsed: this.fallbackUsed,
          modelUsed: this.model,
        }
      }
    }

    return {
      ok: false,
      attempts: 3,
      majority: false,
      fallbackUsed: this.fallbackUsed,
      modelUsed: this.model,
      reason: '3回読んでも結果が一致しませんでした（読み取りが不安定です）。',
    }
  }
}
