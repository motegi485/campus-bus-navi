/**
 * Bot 全体の定数。要件定義 §7.2 が正本。
 * リポジトリルートからの相対パスは resolveRepoPath()（files.ts）で絶対化する。
 */

export type Season = 'spring' | 'summer' | 'winter'
export type DayKind = 'weekday' | 'holiday'

export const CONFIG = {
  pageUrl: 'https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/',
  userAgent: 'campus-bus-navi-bot/1.0 (+https://github.com/motegi485/campus-bus-navi)',
  fetchTimeoutMs: 30_000,

  announceBoxSelector: 'div.md-box',
  anchorKeyword: '時刻表',
  imageExtPattern: /\.(jpe?g|png)$/i,
  resizedSuffixPattern: /-\d+x\d+(?=\.(jpe?g|png)$)/i,
  maxImageBytes: 10 * 1024 * 1024,

  /**
   * OCR モデル。
   *
   * 【要件定義 v1.4（primary=gemini-3.5-flash / fallback=gemini-3.1-flash-lite）からの変更・
   *   2026-08-01 の実測にもとづきユーザー承認済み】
   *
   * primary を gemini-3.6-flash にした理由:
   *   - GA（2026-07 リリース）で 3.5-flash より新しい
   *   - 無料枠あり。有料時の入力単価は同額（$1.50/1M）で出力はむしろ安い（$7.50 vs $9.00）
   *   - 実測で通常ダイヤ画像（JR 列同居）・夏季休業画像（左右2表・共有「時」列）とも
   *     正解 fixture と完全一致。3.5-flash と同等以上だった
   *   - RPD はモデル別。3.5-flash は当日 503（高負荷）を頻発させていた
   *
   * fallback を gemini-3.5-flash にした理由:
   *   旧 fallback の gemini-3.1-flash-lite は、実測で夏季休業画像を3回読んでも
   *   結果が一致せず needs_review に落ちた（＝フォールバックとして機能しない）。
   *   フォールバックの目的は「primary が使えないときにジョブを完走させる」ことなので、
   *   別の枠を持つ同格モデルを充てる。Bot の消費量は微小なのでコスト差は問題にならない。
   */
  modelPrimary: 'gemini-3.6-flash',
  modelFallback: 'gemini-3.5-flash',
  geminiMinIntervalMs: 6000, // 無料枠 RPM 対策: 呼び出し間隔の下限
  geminiMaxRetries429: 3, // 429: 30s/60s/120s 指数バックオフ
  geminiBackoffMs: [30_000, 60_000, 120_000],

  /**
   * 一時障害（503 UNAVAILABLE / 500 INTERNAL / ネットワーク断）のリトライ。
   *
   * 【要件定義 v1.4 への追加・2026-08-01 の実地検証で必要と判明】
   * v1.4 は 429 しか扱っていないが、実際に鍵を入れて叩いたところ
   * `gemini-3.5-flash` が 503（高負荷）を継続的に返し、1回でジョブ全体が落ちた。
   * 503 は数分で解消する一時障害なので、短いバックオフでリトライし、
   * それでも駄目ならフォールバックモデルに切り替える（＝日次ジョブを落とさない）。
   */
  geminiMaxRetriesTransient: 3,
  geminiTransientBackoffMs: [5_000, 15_000, 45_000],
  /** 1リクエストの上限時間。無いと接続が張り付いたまま何分も戻らないことがある */
  geminiRequestTimeoutMs: 180_000,

  /**
   * 1実行あたりの Gemini 呼び出し上限。
   *
   * 【要件定義 v1.4 への追加・2026-08-01 の実測で判明】
   * gemini-3.5-flash の無料枠は RPD（1日あたりリクエスト数）が 20。
   * リトライも枠を消費するため、1枚の画像で 503/429 のリトライが重なると
   * 後続画像の分まで枯渇する。上限に達したら残りは needs_review に落として
   * 「読めなかった」と顕在化させる（黙って古いデータのままにしない）。
   */
  geminiMaxCallsPerRun: 18,

  holidayCsvUrl: 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv',

  dataDir: 'public/data/timetables',
  calendarRulesPath: 'public/data/calendar_rules.json',
  statePath: 'bot/state.json',
  holidaysCachePath: 'bot/holidays.json',
  prBodyPath: 'bot/.out/pr-body.md',

  seasonMap: { 春: 'spring', 夏: 'summer', 冬: 'winter' } as Record<string, Season>,

  /**
   * 長期休暇（vacation）判定パターン。
   *
   * 【要件定義 v1.4 からの変更・2026-08-01 実地検証で承認済み】
   * 元の vacationKeywords（'休暇' / '春休み' / '夏休み' / '冬休み'）ではライブ掲載の
   * 「夏季休業」に一致せず、長期休暇ダイヤが needs_review に落ちて自動取込されなかった。
   * かといって「休業」を単純に追加すると、通常ダイヤ行の
   * 「2026年4月4日（土）～　通常授業日／休業日」を休暇と誤判定してしまう。
   * そこで【季節接頭辞を必須】にしたパターンを採用する。
   *   - seasonal: 夏季休業 / 夏期休暇 / 夏休み / 春季休業 … に一致し、
   *               「通常授業日／休業日」（季節接頭辞なし）には一致しない
   *   - generic : 従来どおり単独の「休暇」「長期休業」も拾う（regular 行には出現しない語）
   */
  vacationPatterns: [
    /[春夏冬][季期]?(?:休業|休暇|休み)/, // 夏季休業 / 夏期休暇 / 夏休み …
    /長期休業/,
    /休暇/,
  ] as RegExp[],

  protectedFiles: [
    // §7.4。書込/削除はホワイトリスト方式（files.ts）が正であり、これは追加の明示ガード。
    'timetable_closed.json', // 全便運休ダイヤ（手動運用）。Bot は読み書き・削除しない
  ] as string[],

  newFileNames: {
    weekday: '授業日ダイヤ',
    holiday: '休業日ダイヤ',
    vacation: (s: Season, d: DayKind) =>
      `${{ spring: '春季', summer: '夏季', winter: '冬季' }[s]}休暇ダイヤ（${d === 'weekday' ? '平日' : '休日'}）`,
    event: (label: string) => `${label}ダイヤ`,
  },

  busStops: {
    station_to_campus: {
      origin: '松永発',
      destination: '大学行き',
      bus_stop_name: '松永 バス乗り場',
      bus_stop_coords: { lat: 34.45118558593484, lng: 133.25675322125554 },
    },
    campus_to_station: {
      origin: '大学発',
      destination: '松永行き',
      bus_stop_name: '大学 バス乗り場',
      bus_stop_coords: { lat: 34.459281686471684, lng: 133.23183492499786 },
    },
  },
} as const

/** 発車時刻として許容する範囲（FR-8） */
export const EARLIEST_DEPARTURE = '05:00'
export const LATEST_DEPARTURE = '23:59'

/** ダイヤ種別ラベル → 出力先の振り分けキーワード（FR-7 の 3） */
export const LABEL_KEYWORDS = {
  weekday: ['授業', '平日'],
  holiday: ['休業', '休日', '土日', '祝'],
} as const
