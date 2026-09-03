/**
 * Bot 全体の定数。要件定義 §7.2 が正本。
 * リポジトリルートからの相対パスは repoPath()（files.ts）で絶対化する。
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
  /** 掲載ページ本体（HTML）のサイズ上限 */
  maxPageBytes: 5 * 1024 * 1024,
  /** 祝日 CSV のサイズ上限 */
  maxCsvBytes: 5 * 1024 * 1024,
  /** リダイレクトの追従上限。各ホップで許可ホストを再検証する */
  maxRedirects: 5,

  /**
   * 「URL が同じ画像」を再検証する間隔（日）。
   *
   * 【2026-08-18 追加】以前は URL が前回と同じなら画像を取得すらせず `unchanged` に
   * していたため、大学の CMS が同じ URL の内容を差し替えると、URL か state が別途
   * 変わるまで古い時刻表を出し続けた（見逃し期間に上限が無かった）。
   *
   * ETag / Last-Modified が state にあれば毎回の条件付き GET で確かめる
   * （変わっていなければ 304 が返るだけで、画像本体の転送は発生しない）。
   * 検証子を返さないサーバ向けの保険としてこの間隔を置き、最後に確認した日から
   * これだけ経っていれば画像を取り直して SHA-256 を比べる。
   */
  imageRevalidateIntervalDays: 7,
  /**
   * 再検証が続けて失敗しているときに警告へ格上げするまでの日数。
   * 一時的な失敗で毎日メールを鳴らさず、恒久的な失敗は見逃さないための境目。
   */
  imageRecheckStaleDays: 21,

  /**
   * 取得を許可するホスト（完全一致 or そのサブドメイン）。
   *
   * 掲載ページの href をそのまま取得しにいく作りなので、ページの改ざん・誤リンク・
   * リダイレクト先の乗っ取りがあると CI から任意のホストへ接続できてしまう。
   * 【大学が画像の配信先を別ホスト（CDN 等）に変えたら、ここへ追加すること。】
   * 追加を忘れると image_fetch_failed の警告になり、古いダイヤのまま止まる（安全側）。
   */
  allowedPageHostSuffixes: ['fukuyama-u.ac.jp'] as string[],
  allowedImageHostSuffixes: ['fukuyama-u.ac.jp'] as string[],
  allowedHolidayHostSuffixes: ['cao.go.jp'] as string[],

  /**
   * OCR モデル。
   *
   * 【2026-09-03 ユーザー承認】
   * primary は最新の GA モデル gemini-3.8-flash、fallback は同じ OCR リクエスト
   * （画像入力・構造化 JSON・low thinking）に対応する gemini-3.7-flash とする。
   *
   * fallback の目的は、primary 固有のモデル利用不可・RPD 枯渇・一時障害時に
   * ジョブを安全に完走させること。1 リクエストが時間切れ（AbortError / TimeoutError）なら
   * primary を再試行せず直ちに fallback へ切り替える。通常の RPM 429 と 503 等の
   * 一時障害は既存どおりバックオフ再試行を優先する。Google API 全体の障害に対する
   * 保証ではない。
   * 無料枠の実値はプロジェクト・モデルごとに AI Studio で確認し、呼び出し上限は
   * 確認できるまで既存の保守的な値を維持する。
   */
  modelPrimary: 'gemini-3.8-flash',
  modelFallback: 'gemini-3.7-flash',
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

  /**
   * 1 日あたりの Gemini 呼び出し上限。
   *
   * 【2026-08-18 追加】上限が 1 実行単位でしか無かったため、手動実行を 2 回行えば
   * 36 回試行でき、無料枠の RPD（1 日あたりリクエスト数）を超えられた。
   * state.json に日次カウンタを持ち、同じ日の実行をまたいで守る。
   * 日付が変われば 0 に戻る（RPD は太平洋時間の深夜＝日本時間 16:00 リセットなので、
   * JST の日付境界とは一致しないが、上限を跨いで積み上がらないことが目的）。
   */
  geminiMaxCallsPerDay: 18,

  holidayCsvUrl: 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv',

  dataDir: 'public/data/timetables',
  calendarRulesPath: 'public/data/calendar_rules.json',
  statePath: 'bot/state.json',
  holidaysCachePath: 'bot/holidays.json',
  /** 実行レポート（通知メールの本文になる）。gitignore 下 */
  reportPath: 'bot/.out/report.md',

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

  /**
   * 「特別ダイヤ」の待機ファイル ID。
   *
   * 【要件定義 v1.5 への追加・2026-08-02 承認済み】
   * needs_review（読めない・解釈が割れる掲示）と判定した期間は、この ID で塗り潰す。
   * フロントは id に 'special' を含むことを見て、発車時刻を出さず大学ホームページへ誘導する。
   * 通知メールを見落としても誤った時刻を表示しないためのフェイルセーフであり、
   * 自動適用（人間の事前レビューなし）を許容できる最大の根拠でもある。
   * Bot はこのファイルを【書かない】（files.ts のホワイトリスト外。参照するだけ）。
   */
  specialTimetableId: 'timetable_special',
  /** 特別ダイヤを張る期間の上限日数。日付の誤読で長大な期間を塗り潰すのを防ぐ */
  specialMaxRangeDays: 92,

  /**
   * 掲載ページから消えた未来イベントを撤去するまでの連続確認回数。
   *
   * イベントが中止・延期されると掲載行ごと消えるが、1回消えただけで撤去すると
   * ページ側の一時的な編集ミスで有効なイベントを落としてしまう。日次実行なので
   * 3 回 ＝ 3 日連続で消えていることを確認してから override とファイルを撤去する。
   * ページ全体からリンクを1件も抽出できなかった実行は「消えた」と数えない。
   */
  eventMissingRunsBeforeRemoval: 3,

  /**
   * 1実行の締切（ミリ秒）。ワークフローの timeout-minutes: 20 から、レポート生成・
   * コミット・メール送信などの後処理ぶんの余裕を引いた値。OCR のリトライはこの締切を
   * 越えないところで打ち切り、ジョブが強制終了される前に needs_review へ収束させる
   * （強制終了されるとレポートも Step Summary も残らず、通知も飛ばないため、
   * 失敗が最も観測しにくい形になる）。
   */
  runDeadlineMs: 15 * 60 * 1000,

  /**
   * 取得フェーズ（画像の取得・再検証）の締切。プロセス開始からの経過で測る。
   *
   * 【2026-08-18 追加】runDeadlineMs は OCR クライアントにしか渡っておらず、
   * 画像の逐次取得には全体予算が無かった。1 リンクあたり原寸・リサイズ版の 2 候補 ×
   * リクエスト 30 秒で最大 1 分かかるため、遅い新規リンクが十数件並ぶだけで
   * 取得だけでジョブの timeout-minutes: 20 に迫り、レポートもメールも残らずに
   * 強制終了する（失敗が最も観測しにくい形）。
   *
   * 締切に達した分は取り込まず警告に落として、翌日の実行で再試行する。
   * OCR 用に runDeadlineMs との差を残してある。
   */
  fetchDeadlineMs: 8 * 60 * 1000,

  /**
   * 1 実行で画像を取得しにいくリンク数の上限。
   * 掲載が壊れて大量のリンクが並んだときに、取得だけで実行を使い切らないための歯止め。
   * 超えた分は取り込まず警告に落とす（黙って切らない）。
   */
  maxImageFetchesPerRun: 24,

  /** 祝日キャッシュの許容経過日数。これを超えたら取得経路の異常を疑う */
  holidayCacheMaxAgeDays: 90,
  /** 祝日データに求める将来カバレッジ日数。今日からこの日数先まで収録が無ければ警告 */
  holidayCoverageMinDays: 120,

  /**
   * 祝日 CSV の健全性しきい値。
   *
   * 【2026-08-18 追加】CSV は「1 データ行以上」なら受理していたため、途中で切れた
   * HTTP 200 応答（プロキシ・CDN の部分応答など）をそのまま正規のキャッシュとして
   * 採用し、既存の祝日 override を消してしまう経路があった。祝日に平日ダイヤを
   * 案内するのは誤案内そのものなので、明らかに痩せた応答は採用しない。
   */
  /** 既存キャッシュが無いときに受理する最小件数（初回 bootstrap 用） */
  holidayMinRowsWithoutCache: 100,
  /** 既存キャッシュに対して許容する最小比率。これを下回る応答は採用しない */
  holidayMinRatioVsCache: 0.7,

  protectedFiles: [
    // §7.4。書込/削除はホワイトリスト方式（files.ts）が正であり、これは追加の明示ガード。
    'timetable_closed.json', // 全便運休ダイヤ（手動運用）。Bot は読み書き・削除しない
    'timetable_special.json', // 特別ダイヤ（手動運用）。Bot は override から参照するだけで書かない
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
