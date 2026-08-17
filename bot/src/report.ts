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

// ---------------------------------------------------------------------------
// Markdown のエスケープ
//
// レポートには外部由来の文字列（掲載ページの行テキスト、画像 URL、警告文）が入る。
// 素のまま埋めると、`|` がテーブルの列を割り、改行が行を割り、`](` がリンクの
// 表示先を差し替えられる。危険なスクリプトが動くわけではないが、**確認する人が
// 見る表とリンクを改変できる**ので、用途ごとに逃がす。
// ---------------------------------------------------------------------------

/** 1 行に収める（改行はセル・箇条書きの構造を壊す） */
function oneLine(value: string): string {
  return String(value).replace(/\r?\n/g, ' ')
}

/** テーブルのセルへ入れる文字列 */
function cell(value: string): string {
  return oneLine(value).replace(/\|/g, '\\|')
}

/** リンクの表示テキストへ入れる文字列 */
function linkText(value: string): string {
  return oneLine(value).replace(/([[\]])/g, '\\$1')
}

/**
 * リンク先 URL。空白と括弧・山括弧を percent encode して、
 * `](` の閉じ位置を外部から動かせないようにする。
 *
 * ⚠️ `encodeURIComponent` は `!'()*-._~` を変換しない（RFC 3986 の unreserved mark）。
 *    括弧はここで明示的に置き換える必要がある。
 */
const URL_ESCAPES: Record<string, string> = { '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' }

function linkUrl(value: string): string {
  return oneLine(value).replace(/[\s<>()]/g, (c) => URL_ESCAPES[c] ?? encodeURIComponent(c))
}

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
  const reason = change.reason ? `（${oneLine(change.reason)}）` : ''
  if (change.op === 'add') {
    return `- 追加: ${change.date} → ${change.id}${reason}`
  }
  if (change.op === 'remove') {
    return `- 削除: ${change.date}${reason}`
  }
  return `- スキップ: ${change.date} → ${change.id}${reason}`
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
    const image = plan.sourceUrl ? `　[元画像を開く](${linkUrl(plan.sourceUrl)})` : ''
    lines.push(`### ${linkText(plan.fileName)}（${OP_LABEL[plan.op]}）${image}`)
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
      const image = plan.sourceUrl ? `[画像](${linkUrl(plan.sourceUrl)})` : '-'
      lines.push(
        `| ${cell(plan.kind)} | ${cell(plan.fileName)} | ${OP_LABEL[plan.op]} | ${countCell(plan)} | ${image} |`,
      )
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
      lines.push(`| ${cell(linkDates(link).join(', ') || '-')} | ${cell(link.normalizedLine)} |`)
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
 *
 * 【2026-08-18 修正】以前の文面は「revert だけでは再取得されないので state キーも消せ」
 * としていたが、実装はその逆である。Bot は data と state を**同じコミット**で更新するので、
 * revert すると state も一緒に戻り、Bot から見て「未処理」に戻る。つまり翌日の実行で
 * 同じ画像を読み直して同じ誤りを再公開する。state キーの削除は「再取得を促す」操作であって
 * 停止手段ではない。**再公開を止める手順と、読み直させる手順を混ぜてはいけない。**
 */
export function rollbackSection(): string[] {
  return [
    '## 取り消したいとき',
    '',
    '1. GitHub の該当コミット画面で **Revert** して打ち消しコミットを作る。',
    '   `public/data/` と `bot/state.json` が一緒に戻る。',
    '2. **そのままだと翌日の実行で同じ画像を読み直し、同じ内容が再び反映される。**',
    '   revert で state も戻り、Bot から見て「未処理」に戻るため。再公開を止めるには次のどちらかを行う。',
    '   - `public/data/calendar_rules.json` の `overrides` に手動で `timetable_special` を',
    '     指定する（手動 override を Bot は書き換えない）。時刻を出さず大学ホームページへ誘導する。',
    '   - 急ぐ場合は GitHub の Actions 画面で `timetable-sync` を Disable する。',
    '3. `bot/state.json` の該当キー（`regular` / `vacations.<season>` / `events.<日付>`）を',
    '   削除するのは、**わざと読み直させたいとき**だけ。停止手段ではない。',
    '',
  ]
}

/**
 * 警告 1 件を箇条書き 1 行にする。
 *
 * message は掲載ページ由来の文字列を含みうるので改行を畳む（改行は箇条書きを割る）。
 * URL はリンクにせず素の文字列で出す（リンク表示先の改変余地を作らない）。
 */
export function formatWarning(warning: Warning): string {
  const message = oneLine(warning.message)
  return warning.url ? `${message}（${oneLine(warning.url)}）` : message
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
