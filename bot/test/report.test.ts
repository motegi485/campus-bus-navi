/**
 * 実行レポートの出力安全性（Codex レビュー S3-BOT-08）と、取り消し手順の一貫性（S2-BOT-06）。
 *
 * レポートは通知メールの本文になる。掲載ページ由来の文字列（行テキスト・画像 URL・警告文）を
 * 素のまま埋めると、`|` がテーブルの列を割り、改行が行を割り、`](` がリンクの表示先を
 * 差し替えられる。危険なスクリプトが動くわけではないが、**確認する人が見る表とリンクを
 * 外部から改変できる**ため、用途ごとにエスケープする。
 */

import { describe, it, expect } from 'vitest'
import { buildReport, formatWarning, rollbackSection } from '../src/report.js'
import type { ClassifiedLink, FilePlan, Timetable } from '../src/types.js'

const RUN_AT = '2026-08-18T07:00:00+09:00'

function timetable(id: string): Timetable {
  const route = (origin: string, destination: string) => ({
    origin,
    destination,
    bus_stop_name: `${origin} バス乗り場`,
    bus_stop_coords: { lat: 34.4, lng: 133.2 },
    schedule: [{ departure: '08:00', note: '' }],
  })
  return {
    id,
    name: id,
    routes: {
      station_to_campus: route('松永発', '大学行き'),
      campus_to_station: route('大学発', '松永行き'),
    },
  }
}

function report(overrides: Partial<Parameters<typeof buildReport>[0]> = {}): string {
  return buildReport({
    runAt: RUN_AT,
    modelUsed: 'gemini-3.8-flash',
    fallbackUsed: false,
    files: [],
    overrideChanges: [],
    deletions: [],
    warnings: [],
    ocrStats: { matched: 0, total: 0, majority: 0 },
    validationFailures: [],
    ...overrides,
  })
}

function reportWithoutOcr(): string {
  return buildReport({
    runAt: RUN_AT,
    fallbackUsed: false,
    files: [],
    overrideChanges: [],
    deletions: [],
    warnings: [],
    ocrStats: { matched: 0, total: 0, majority: 0 },
    validationFailures: [],
  })
}

describe('レポートのエスケープ（S3-BOT-08）', () => {
  it('OCR を一度も呼ばなかったときはモデル行を出さない', () => {
    const body = reportWithoutOcr()

    expect(body).toContain(`実行: ${RUN_AT}`)
    expect(body).not.toContain('モデル:')
    expect(body).not.toContain('フォールバックモデル使用')
  })

  it('画像 URL の括弧を percent encode して、リンクの閉じ位置を外から動かせないようにする', () => {
    const plan: FilePlan = {
      op: 'create',
      fileName: 'timetable_weekday.json',
      kind: 'regular',
      sourceUrl: 'https://www.fukuyama-u.ac.jp/a.jpg?x=(evil)',
      timetable: timetable('timetable_weekday'),
      counts: { station: 1, campus: 1 },
    }
    const body = report({ files: [plan] })
    expect(body).toContain('https://www.fukuyama-u.ac.jp/a.jpg?x=%28evil%29')
    // 素の `)` が残るとリンクがそこで閉じ、後続の文字が本文へ漏れる
    expect(body).not.toContain('a.jpg?x=(evil)')
  })

  it('テーブルのセルに入る値の `|` を逃がして列を割られないようにする', () => {
    const plan: FilePlan = {
      op: 'create',
      // 実運用のファイル名に | は入らないが、値の出所が変わっても表が壊れないことを固定する
      fileName: 'timetable_|_weekday.json',
      kind: 'regular',
      timetable: timetable('timetable_weekday'),
      counts: { station: 1, campus: 1 },
    }
    const body = report({ files: [plan] })
    const row = body.split('\n').find((l) => l.includes('weekday.json'))!
    expect(row).toContain('\\|')
    // 見出し（| 種別 | ファイル | 操作 | 便数 | 元画像 |）と同じ 5 列のままであること
    expect(row.split(/(?<!\\)\|/).length).toBe(7)
  })

  it('年推定テーブルの掲載原文に含まれる `|` と改行を逃がす', () => {
    const link: ClassifiedLink = {
      url: 'https://www.fukuyama-u.ac.jp/a.jpg',
      rawHref: 'https://www.fukuyama-u.ac.jp/a.jpg',
      anchorText: '時刻表はコチラ',
      lineText: '9月1日 | 改行\nあり',
      normalizedLine: '9月1日 | 改行\nあり',
      kind: 'event',
      dates: ['2026-09-01'],
      yearGuessed: true,
    }
    const body = report({ links: [link] })
    const row = body.split('\n').find((l) => l.includes('9月1日'))!
    expect(row).toContain('\\|')
    expect(row).toContain('改行 あり')
  })

  it('警告文の改行を畳んで箇条書きを割らない', () => {
    expect(formatWarning({ level: 'warn', code: 'x', message: '1行目\n2行目' })).toBe('1行目 2行目')
    expect(formatWarning({ level: 'warn', code: 'x', message: 'a', url: 'https://e.example/\nb' })).toBe(
      'a（https://e.example/ b）'
    )
  })
})

/**
 * Codex レビュー SEC-20260912-02。レポートは convert_markdown: true で HTML メールになり、
 * Showdown は raw HTML を素通しする。掲載ページ由来の文字列に HTML タグや Markdown の
 * リンク記法が入っても、本文の構造・リンク先・画像を変えられないことを固定する。
 */
describe('外部文字列の HTML / Markdown エスケープ（SEC-20260912-02）', () => {
  const HTML = '<img src="https://evil.example/x.png" onerror="alert(1)">'
  const LINK = '[大学ページ](https://evil.example/phish)'

  it('警告文に含まれる HTML タグとリンク記法を逃がす', () => {
    const body = report({
      warnings: [
        { level: 'warn', code: 'x', message: `分類不能: 「${HTML} ${LINK}」`, url: 'https://www.fukuyama-u.ac.jp/<a>.jpg' },
        { level: 'info', code: 'y', message: `参考 ${HTML}` },
      ],
    })
    expect(body).toContain('&lt;img src="https://evil.example/x.png" onerror="alert(1)"&gt;')
    expect(body).toContain('\\[大学ページ\\](https://evil.example/phish)')
    expect(body).toContain('https://www.fukuyama-u.ac.jp/&lt;a&gt;.jpg')
    expect(body).not.toContain('<img')
    expect(body).not.toContain('[大学ページ](')
  })

  it('検証エラー（OCR のラベル・画像 URL を含む）も逃がす', () => {
    const body = report({ validationFailures: [`ダイヤ種別ラベル「<script>x</script>」を振り分けられません（元画像: https://a.example/?a=1&b=2）`] })
    expect(body).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(body).toContain('?a=1&amp;b=2')
    expect(body).not.toContain('<script>')
  })

  /**
   * 2026-09-12 に受信した実際の通知メールで、警告文の `timetable_weekday / timetable_holiday` が
   * 「timetableweekday / timetableholiday」と `_` を失って届いていた。Showdown は単語の途中の
   * `_` も強調記法として扱うため、`_weekday / timetable_` が斜体になっていた。
   */
  it('時刻表 ID・ファイル名の `_` を逃がして、HTML 化で斜体にならないようにする', () => {
    const plan: FilePlan = {
      op: 'update',
      fileName: 'timetable_vacation_summer_weekday.json',
      kind: 'vacation',
      timetable: timetable('timetable_vacation_summer_weekday'),
      counts: { station: 1, campus: 1 },
    }
    const body = report({
      files: [plan],
      overrideChanges: [{ date: '2026-08-17', op: 'add', id: 'timetable_vacation_summer_weekday' }],
      deletions: ['timetable_event_20260823.json'],
      warnings: [
        {
          level: 'warn',
          code: 'regular_link_missing',
          message: '既存の timetable_weekday / timetable_holiday は変更しません',
        },
      ],
    })
    expect(body).toContain('timetable\\_weekday / timetable\\_holiday')
    expect(body).toContain('| vacation | timetable\\_vacation\\_summer\\_weekday.json | 更新 |')
    expect(body).toContain('### timetable\\_vacation\\_summer\\_weekday.json（更新）')
    expect(body).toContain('- 追加: 2026-08-17 → timetable\\_vacation\\_summer\\_weekday')
    expect(body).toContain('- timetable\\_event\\_20260823.json（適用日経過）')
    // 逃がしていない ID・ファイル名が残っていないこと
    expect(body).not.toContain('timetable_weekday')
    expect(body).not.toContain('timetable_vacation')
    expect(body).not.toContain('timetable_event')
  })

  it('年推定テーブルの掲載原文と override の理由も逃がす', () => {
    const link: ClassifiedLink = {
      url: 'https://www.fukuyama-u.ac.jp/a.jpg',
      rawHref: 'https://www.fukuyama-u.ac.jp/a.jpg',
      anchorText: '時刻表はコチラ',
      lineText: `9月1日 ${HTML}`,
      normalizedLine: `9月1日 ${HTML}`,
      kind: 'event',
      dates: ['2026-09-01'],
      yearGuessed: true,
    }
    const body = report({
      links: [link],
      overrideChanges: [{ date: '2026-09-01', op: 'skip', id: 'timetable_event_20260901', reason: `手動キーと衝突（既存値: ${HTML}）` }],
    })
    expect(body).not.toContain('<img')
    expect(body.match(/&lt;img/g)).toHaveLength(2)
  })
})

describe('取り消し手順の一貫性（S2-BOT-06）', () => {
  const text = rollbackSection().join('\n')

  it('revert だけでは翌日また反映されることを明示する', () => {
    expect(text).toContain('翌日の実行で同じ画像を読み直し')
  })

  it('再公開を止める手段（手動 override / ワークフロー停止）を示す', () => {
    expect(text).toContain('timetable_special')
    expect(text).toContain('Disable')
  })

  it('state キーの削除を「停止手段」として書かない', () => {
    expect(text).toContain('停止手段ではない')
    // 旧文面の危険な誘導が残っていないこと
    expect(text).not.toContain('消さないと再取得されない')
  })
})
