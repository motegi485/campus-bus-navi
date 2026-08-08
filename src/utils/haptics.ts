/**
 * 触覚フィードバック（付加価値。動かなくても機能に影響しないこと）。
 *
 * iOS Safari は Vibration API 非対応。<label>+<input switch> を使った
 * 疑似ハプティクスの hack は保守性が悪いので採用しない。
 * 呼び出し箇所を増やしても、将来 設定で OFF にできるようここ 1 箇所に集約する。
 */
export function tapFeedback(pattern: number | number[] = 10): void {
  try {
    if (typeof navigator === 'undefined') return
    navigator.vibrate?.(pattern)
  } catch {
    // 非対応・権限拒否は無視する
  }
}
