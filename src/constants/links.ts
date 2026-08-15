/**
 * 複数の画面から参照する外部リンク。
 * 1箇所でしか使わない URL は各コンポーネントに直接書いてよい。
 */

/**
 * 大学の通学情報ページ。スクールバスの時刻表画像はここに掲載される。
 * 特別ダイヤ（既定のフォーマットで表現できないダイヤ）の日は、
 * アプリで時刻を出さずにこのページへ誘導する。
 */
export const SCHOOL_BUS_INFO_URL =
  'https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/'

/**
 * ご意見・不具合報告の受付フォーム（Google フォーム）。
 * ヘルプ画面と、時刻表を一度も取得できていないときの StatusCard から参照する。
 */
export const FEEDBACK_URL = 'https://forms.gle/CD5qh8MpFZZVubTw5'
