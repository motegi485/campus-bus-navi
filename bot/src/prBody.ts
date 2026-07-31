/** FR-11: PR 本文（bot/.out/pr-body.md）の生成。テンプレートは要件定義 §8 の FR-11 に従う。 */

import type { FilePlan, OverrideChange, Warning } from './types.js'

export interface PrBodyInput {
  runAt: string
  modelUsed: string
  fallbackUsed: boolean
  files: FilePlan[]
  overrideChanges: OverrideChange[]
  deletions: string[]
  warnings: Warning[]
  ocrStats: { matched: number; total: number; majority: number }
  validationFailures: string[]
}

const OP_LABEL: Record<FilePlan['op'], string> = { create: '新規', update: '更新', delete: '削除' }

function countCell(plan: FilePlan): string {
  if (!plan.counts) return '-'
  const { station, campus } = plan.counts
  if (!plan.prevCounts) return `${station}/${campus}`
  const ds = station - plan.prevCounts.station
  const dc = campus - plan.prevCounts.campus
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
  return `${station}/${campus} (${sign(ds)}/${sign(dc)})`
}

function overrideLine(change: OverrideChange): string {
  if (change.op === 'add') {
    return `- 追加: ${change.date} → ${change.id}${change.reason ? `（${change.reason}）` : ''}`
  }
  if (change.op === 'remove') {
    return `- 削除: ${change.date}${change.reason ? `（${change.reason}）` : ''}`
  }
  return `- スキップ: ${change.date} → ${change.id}${change.reason ? `（${change.reason}）` : ''}`
}

export function buildPrBody(input: PrBodyInput): string {
  const lines: string[] = []

  lines.push('## 概要')
  const fallbackNote = input.fallbackUsed ? '（⚠ フォールバックモデル使用）' : ''
  lines.push(`実行: ${input.runAt} / モデル: ${input.modelUsed}${fallbackNote}`)
  lines.push('')

  lines.push('## 変更')
  lines.push('### 時刻表ファイル')
  const writes = input.files.filter((f) => f.op !== 'delete')
  if (writes.length === 0) {
    lines.push('変更なし')
  } else {
    lines.push('| 種別 | ファイル | 操作 | 便数(松永発/大学発) | 元画像 |')
    lines.push('|---|---|---|---|---|')
    for (const plan of writes) {
      const image = plan.sourceUrl ? `[画像](${plan.sourceUrl})` : '-'
      lines.push(`| ${plan.kind} | ${plan.fileName} | ${OP_LABEL[plan.op]} | ${countCell(plan)} | ${image} |`)
    }
  }
  lines.push('')

  lines.push('### calendar_rules.overrides')
  if (input.overrideChanges.length === 0) {
    lines.push('変更なし')
  } else {
    // 件数が多くなるため種別ごとにまとめる（省略はしない）
    for (const [op, title] of [
      ['add', '追加・変更'],
      ['remove', '削除'],
      ['skip', 'スキップ'],
    ] as const) {
      const group = input.overrideChanges.filter((c) => c.op === op)
      if (group.length === 0) continue
      lines.push(`**${title}（${group.length}件）**`)
      for (const change of group.sort((a, b) => a.date.localeCompare(b.date))) lines.push(overrideLine(change))
      lines.push('')
    }
    lines.pop() // 最後のグループ直後の空行は下の共通処理と重複するので落とす
  }
  lines.push('')

  lines.push('### 削除ファイル')
  if (input.deletions.length === 0) {
    lines.push('なし')
  } else {
    for (const fileName of input.deletions) lines.push(`- ${fileName}（適用日経過）`)
  }
  lines.push('')

  lines.push('## 検証')
  const { matched, total, majority } = input.ocrStats
  lines.push(`- 2回読み照合: 一致 ${matched}/${total}（多数決採用: ${majority}件）`)
  if (input.validationFailures.length === 0) {
    lines.push('- スキーマ検証: すべて合格')
  } else {
    lines.push(`- スキーマ検証: ⚠ 失敗 ${input.validationFailures.length}件（下記）`)
  }
  lines.push('')

  lines.push('## ⚠ 要手動確認')
  const manual = [...input.validationFailures, ...input.warnings.filter((w) => w.level === 'warn').map(formatWarning)]
  if (manual.length === 0) {
    lines.push('なし')
  } else {
    for (const item of manual) lines.push(`- ${item}`)
  }
  lines.push('')

  const infos = input.warnings.filter((w) => w.level === 'info')
  if (infos.length > 0) {
    lines.push('## 参考情報')
    for (const info of infos) lines.push(`- ${formatWarning(info)}`)
    lines.push('')
  }

  lines.push('## レビュー観点')
  lines.push('- [ ] 元画像と便の突き合わせ（特に JR 列の混入がないか）')
  lines.push('- [ ] override の日付・参照先')
  lines.push('')

  return lines.join('\n')
}

export function formatWarning(warning: Warning): string {
  return warning.url ? `${warning.message}（${warning.url}）` : warning.message
}
