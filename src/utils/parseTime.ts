/**
 * "HH:mm" 形式の文字列を 0時0分基準の通算分に変換する。
 * 不正な値（フォーマット違反、範囲外、NaN）の場合は null を返す。
 *
 * 例: "08:30" → 510, "24:00" → null, "8:0" → null
 */
export function parseHHmmToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}
