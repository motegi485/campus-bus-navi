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
    modelUsed: 'gemini-3.7-flash',
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
    // runAt（2026-08-18）より後の日付のファイルの削除なので、理由は「掲示から外れた」（v1.16）
    expect(body).toContain('- timetable\\_event\\_20260823.json（掲示から外れた）')
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

/**
 * 削除ファイルの理由（v1.16）。未来日のファイルの削除は利用者に影響するので、
 * 「適用日経過」と「掲示から外れた（中止・延期・日付の撤去）」を取り違えて書かないことを守る。
 */
describe('削除ファイルの理由（v1.16）', () => {
  function deletionLines(body: string): string[] {
    return body.split('\n').filter((l) => l.startsWith('- timetable\\_event'))
  }

  it('runAt より前の日付のファイルは「適用日経過」', () => {
    const body = report({ deletions: ['timetable_event_20260817.json'] })
    expect(deletionLines(body)).toEqual(['- timetable\\_event\\_20260817.json（適用日経過）'])
  })

  it('runAt 以降（当日を含む）の日付のファイルは「掲示から外れた」', () => {
    const body = report({ deletions: ['timetable_event_20260818.json', 'timetable_event_20260901.json'] })
    expect(deletionLines(body)).toEqual([
      '- timetable\\_event\\_20260818.json（掲示から外れた）',
      '- timetable\\_event\\_20260901.json（掲示から外れた）',
    ])
  })

  it('過去と未来が混在しても行ごとに理由を分ける', () => {
    const body = report({ deletions: ['timetable_event_20260801.json', 'timetable_event_20261003.json'] })
    expect(deletionLines(body)).toEqual([
      '- timetable\\_event\\_20260801.json（適用日経過）',
      '- timetable\\_event\\_20261003.json（掲示から外れた）',
    ])
  })
})

/**
 * FR-9【v1.16】取り込めなかったイベントの日を特別ダイヤにしたことを通知に出す。
 * 節は calendar で実際に special を put した日（specialDates）があるときだけ出し、
 * 掲載ページ由来の行テキスト・理由はセルとして逃がす。
 */
describe('特別ダイヤにした日（取り込み失敗）の節（FR-9 v1.16）', () => {
  const HEADING = '### 特別ダイヤにした日（取り込み失敗）'
  const CHECK = '- [ ] 特別ダイヤにした日（取り込み失敗）の元画像'

  it('failedEvents が無い・specialDates が空なら節も確認項目も出さない', () => {
    for (const failedEvents of [
      undefined,
      [],
      // 手動キー・suppressed で special を put しなかった日は誤報しない
      [{ url: 'https://www.fukuyama-u.ac.jp/a.jpg', line: '10月16日', reason: 'x', retry: true, specialDates: [] }],
    ]) {
      const body = report({ failedEvents })
      expect(body).not.toContain(HEADING)
      expect(body).not.toContain(CHECK)
    }
  })

  it('specialDates がある失敗だけを表に出し、確認する点に行を足す', () => {
    const body = report({
      failedEvents: [
        {
          url: 'https://www.fukuyama-u.ac.jp/1016.jpg',
          line: '● 学外行事 10月16日（金）',
          reason: 'Gemini の呼び出しに失敗しました: 503 UNAVAILABLE',
          retry: true,
          specialDates: ['2026-10-16'],
        },
        {
          url: 'https://www.fukuyama-u.ac.jp/x.jpg',
          line: '出さない行',
          reason: 'x',
          retry: true,
          specialDates: [],
        },
      ],
    })
    expect(body).toContain(HEADING)
    expect(body).toContain('| 日付 | 掲示 | 理由 | 次回 |')
    expect(body).toContain('| 2026-10-16 | ● 学外行事 10月16日（金） | Gemini の呼び出しに失敗しました: 503 UNAVAILABLE | 翌日以降に再読取り |')
    expect(body).not.toContain('出さない行')
    expect(body).toContain(CHECK)
    // 確認する点の節の中にあること
    expect(body.indexOf(CHECK)).toBeGreaterThan(body.indexOf('## 確認する点'))
  })

  it('retry が false（画像の内容による拒否）は「画像が変わるまで読み直さない」と書き、複数日をまとめる', () => {
    const body = report({
      failedEvents: [
        {
          url: 'https://www.fukuyama-u.ac.jp/2026-1011.1012.jpg',
          line: '薬学ワークショップ 10月11日（日）・12日（月・祝）',
          reason: '日付ごとに別の表がある',
          retry: false,
          specialDates: ['2026-10-11', '2026-10-12'],
        },
      ],
    })
    const row = body.split('\n').find((l) => l.startsWith('| 2026-10-11'))!
    expect(row).toContain('| 2026-10-11, 2026-10-12 |')
    expect(row).toContain('| 画像が変わるまで読み直さない |')
    expect(row).not.toContain('翌日以降に再読取り')
  })

  it('掲示の行テキスト・理由の `|`・改行・HTML・`_` を逃がして表を割らない', () => {
    const body = report({
      failedEvents: [
        {
          url: 'https://www.fukuyama-u.ac.jp/a.jpg',
          line: '● 行事 | 10月16日\n<img src=x onerror=alert(1)>',
          reason: 'timetable_event_20261016 [x](https://evil.example/)',
          retry: true,
          specialDates: ['2026-10-16'],
        },
      ],
    })
    const row = body.split('\n').find((l) => l.startsWith('| 2026-10-16'))!
    expect(row).toContain('● 行事 \\| 10月16日 &lt;img src=x onerror=alert(1)&gt;')
    expect(row).toContain('timetable\\_event\\_20261016 \\[x\\](https://evil.example/)')
    // 見出し（| 日付 | 掲示 | 理由 | 次回 |）と同じ 4 列のままであること
    expect(row.split(/(?<!\\)\|/).length).toBe(6)
    expect(body).not.toContain('<img')
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
