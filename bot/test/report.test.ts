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
    modelUsed: 'gemini-3.6-flash',
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

describe('レポートのエスケープ（S3-BOT-08）', () => {
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
    const row = body.split('\n').find((l) => l.includes('timetable_'))!
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
