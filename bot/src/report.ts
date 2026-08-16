/**
 * FR-11: 実行レポート（bot/.out/report.md）の生成。
 *
 * 【2026-08-16 の自動適用化まで、このファイルは prBody.ts という名前で
 *   「PR 本文」を作っていた】人間が PR をレビューしてマージする設計だったため、
 * 実際の発車時刻は PR の diff で見る前提で、ここには便数しか出していなかった。
 *
 * 自動適用に切り替えたことで PR が無くなり、diff を人が見る機会そのものが消えた。
 * そこで本文の役割を「レビュー依頼」から「事後確認できる通知」へ変え、
 * 元画像リンクと並べて【発車時刻そのもの】を載せる。メール 1 通で
 * 「画像と時刻の突き合わせ」が完結することが、失われた PR レビューの代替になる。
 */

import type { ClassifiedLink, FilePlan, OverrideChange, Route, Timetable, Warning } from './types.js'

export interface ReportInput {
  runAt: string
  modelUsed: string
  fallbackUsed: boolean
  files: FilePlan[]
  overrideChanges: OverrideChange[]
  deletions: string[]
  warnings: Warning[]
  ocrStats: { matched: number; total: number; majority: number }
  validationFailures: string[]
  /** 分類済みリンク（FR-3 の「年推定」表示に使う） */
  links?: ClassifiedLink[]
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

function departures(route: Route): string[] {
  return route.schedule.map((entry) => entry.departure)
}

/** 1 ルート分の発車時刻を、旧との差分つきで書き出す */
function routeLines(label: string, next: string[], prev?: string[]): string[] {
  const lines: string[] = []

  if (!prev) {
    lines.push(`**${label}** ${next.length} 便`)
    lines.push(`- 全便: ${next.join(', ')}`)
    return lines
  }

  const prevSet = new Set(prev)
  const nextSet = new Set(next)
  const added = next.filter((t) => !prevSet.has(t))
  const removed = prev.filter((t) => !nextSet.has(t))

  lines.push(`**${label}** ${prev.length} → ${next.length} 便`)
  if (added.length === 0 && removed.length === 0) {
    lines.push('- 発車時刻の変更なし')
    return lines
  }
  if (added.length > 0) lines.push(`- 追加: ${added.join(', ')}`)
  if (removed.length > 0) lines.push(`- 削除: ${removed.join(', ')}`)
  lines.push(`- 全便: ${next.join(', ')}`)
  return lines
}

/**
 * 書き込む時刻表ごとの発車時刻。元画像リンクを隣に置き、
 * メールを見たまま画像と突き合わせられる形にする。
 */
export function departureSection(files: FilePlan[]): string[] {
  const writes = files.filter((f) => f.op !== 'delete' && f.timetable)
  if (writes.length === 0) return []

  const lines: string[] = ['## 発車時刻', '', '元画像と突き合わせて確認してください。', '']

  for (const plan of writes) {
    const timetable = plan.timetable as Timetable
    const image = plan.sourceUrl ? `　[元画像を開く](${plan.sourceUrl})` : ''
    lines.push(`### ${plan.fileName}（${OP_LABEL[plan.op]}）${image}`)
    lines.push('')

    for (const key of ['station_to_campus', 'campus_to_station'] as const) {
      const route = timetable.routes[key]
      if (!route) continue
      const prevRoute = plan.prevTimetable?.routes?.[key]
      lines.push(...routeLines(route.origin, departures(route), prevRoute ? departures(prevRoute) : undefined))
      lines.push('')
    }
  }

  return lines
}

export function buildReport(input: ReportInput): string {
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

  // 自動適用では PR の diff が存在しないため、時刻そのものをここに出す
  lines.push(...departureSection(input.files))

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

  // FR-3: 掲載に年が書かれておらず Bot が補った日付は、必ず人の目に触れるようにする
  const guessed = guessedYearLinks(input.links ?? [])
  if (guessed.length > 0) {
    lines.push('## 年を推定した日付')
    lines.push('掲載に年が書かれていないため Bot が補いました。原文と解決後の日付が合っているか確認してください。')
    lines.push('')
    lines.push('| 解決後 | 掲載原文 |')
    lines.push('|---|---|')
    for (const link of guessed) {
      lines.push(`| ${linkDates(link).join(', ') || '-'} | ${link.normalizedLine} |`)
    }
    lines.push('')
  }

  lines.push('## 確認する点')
  lines.push('- [ ] 上の「発車時刻」と元画像が一致しているか（特に JR 列の混入がないか）')
  lines.push('- [ ] override の日付・参照先')
  if (guessed.length > 0) {
    lines.push('- [ ] 年を推定した日付が掲載の意図どおりか')
  }
  if (input.warnings.some((w) => w.code === 'special_applied')) {
    lines.push('- [ ] 特別ダイヤにした期間の妥当性（通常どおり読める日は手動で個別 override に置き換えられる）')
  }
  lines.push('')
  lines.push('問題がなければ何もする必要はありません。すでに本番へ反映済みです。')
  lines.push('')

  lines.push(...rollbackSection())

  return lines.join('\n')
}

/**
 * 取り消し手順。自動適用では「気づいたときにはもう公開されている」ため、
 * 通知には必ず戻し方を添える。
 */
export function rollbackSection(): string[] {
  return [
    '## 取り消したいとき',
    '',
    '1. GitHub の該当コミット画面で **Revert** して打ち消しコミットを作る。',
    '2. 打ち消しだけでは Bot が「処理済み」と判断して再取得しないため、',
    '   `bot/state.json` の該当キー（`regular` / `vacations.<season>` / `events.<日付>`）も',
    '   削除して push する。次回実行で再度読み直される。',
    '3. その期間の時刻を表示させたくない場合は、`public/data/calendar_rules.json` の',
    '   `overrides` に手動で `timetable_special` を指定する（手動 override を Bot は書き換えない）。',
    '',
  ]
}

export function formatWarning(warning: Warning): string {
  return warning.url ? `${warning.message}（${warning.url}）` : warning.message
}

/** 年を推定して日付を解決したリンク（FR-3） */
export function guessedYearLinks(links: ClassifiedLink[]): ClassifiedLink[] {
  return links.filter((l) => l.yearGuessed === true)
}

/** リンクが指す日付（event は dates、それ以外は start〜end）を表示用に並べる */
export function linkDates(link: ClassifiedLink): string[] {
  if (link.dates && link.dates.length > 0) return link.dates
  if (link.start && link.end) return [`${link.start}〜${link.end}`]
  if (link.start) return [`${link.start}〜`]
  return []
}
