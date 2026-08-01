import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractLinks,
  classifyLinks,
  classifyLink,
  normalizeLineText,
  findRawDates,
  resolveDates,
  extractEventLabel,
} from '../src/extractLinks.js'
import type { LinkInfo } from '../src/types.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const readFixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf-8')

/** テストの決定性のため today を固定する */
const TODAY = '2026-08-01'

function link(lineText: string, anchorText = '時刻表はコチラ'): LinkInfo {
  return { url: 'https://example.com/x.jpg', rawHref: 'https://example.com/x.jpg', anchorText, lineText }
}

// ---------------------------------------------------------------------------
// テスト1: 凍結スナップショット（regular + event×2）
// ---------------------------------------------------------------------------

describe('テスト1: extractLinks(page_snapshot.html)', () => {
  const html = readFixture('page_snapshot.html')

  it('時刻表リンクを3件だけ抽出する（乗り場写真・キャンパスマップ・学生課ボタンを拾わない）', () => {
    const { links } = extractLinks(html)
    expect(links).toHaveLength(3)
    expect(links.map((l) => l.url)).toEqual([
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/04/R8スクールバス時刻表.jpg',
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/05/0614　簿記-724x1024.jpg',
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/05/0620　オープンキャンパス-724x1024.jpg',
    ])
    // 除外されるべきもの
    const joined = links.map((l) => l.url).join('\n')
    expect(joined).not.toContain('busstop_matsunagastation')
    expect(joined).not.toContain('キャンパスマップ')
  })

  it('href は % エンコードのまま保持し、フェッチ用 rawHref とデコード済み url を両方持つ', () => {
    const { links } = extractLinks(html)
    expect(links[1]!.rawHref).toContain('%E7%B0%BF%E8%A8%98')
    expect(links[1]!.url).toContain('簿記')
  })

  it('regular / event×2 に分類され、日付とラベルが取れる', () => {
    const { links } = extractLinks(html)
    const classified = classifyLinks(links, TODAY)

    expect(classified.map((c) => c.kind)).toEqual(['regular', 'event', 'event'])
    expect(classified[0]!.start).toBe('2026-04-04')
    expect(classified[1]!.dates).toEqual(['2026-06-14'])
    expect(classified[1]!.label).toBe('日商簿記検定試験日')
    expect(classified[2]!.dates).toEqual(['2026-06-20'])
    expect(classified[2]!.label).toBe('オープンキャンパス')
    expect(classified.every((c) => c.yearGuessed !== true)).toBe(true)
  })

  it('サイレント欠落警告を誤発火させない（乗り場写真・キャンパスマップの行に日付が無い）', () => {
    const { warnings } = extractLinks(html)
    expect(warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 追加: 2026-08-01 のライブ凍結スナップショット（regular + お盆 + 夏季休業 + event）
// ---------------------------------------------------------------------------

describe('追加: extractLinks(page_snapshot_20260801.html) — 実ライブの4リンク', () => {
  const html = readFixture('page_snapshot_20260801.html')

  it('4件抽出し、regular / needs_review / vacation / event に分類される', () => {
    const { links } = extractLinks(html)
    expect(links).toHaveLength(4)
    const c = classifyLinks(links, TODAY)
    expect(c.map((x) => x.kind)).toEqual(['regular', 'needs_review', 'vacation', 'event'])
  })

  it('通常ダイヤ行「通常授業日／休業日」を休暇と誤判定しない', () => {
    const c = classifyLinks(extractLinks(html).links, TODAY)
    expect(c[0]!.kind).toBe('regular')
    expect(c[0]!.start).toBe('2026-04-04')
  })

  it('お盆特別ダイヤ（日付2つ＋波ダッシュ・休暇語彙なし）は needs_review になる', () => {
    const c = classifyLinks(extractLinks(html).links, TODAY)
    expect(c[1]!.kind).toBe('needs_review')
    expect(c[1]!.reason).toContain('長期休暇の語彙に一致しません')
    // 時刻は取り込まないが、期間は残す（特別ダイヤの適用先になる）
    expect(c[1]!.start).toBe('2026-08-08')
    expect(c[1]!.end).toBe('2026-08-16')
  })

  it('「夏季休業」を vacation(summer) として期間つきで取り込む', () => {
    const c = classifyLinks(extractLinks(html).links, TODAY)
    expect(c[2]!.kind).toBe('vacation')
    expect(c[2]!.season).toBe('summer')
    expect(c[2]!.start).toBe('2026-08-17')
    expect(c[2]!.end).toBe('2026-09-23')
    // 2つ目の日付の年補完は規則で一意なので「年推定」フラグは立てない
    expect(c[2]!.yearGuessed).toBe(false)
  })

  it('オープンキャンパスを単日イベントとして取り込む', () => {
    const c = classifyLinks(extractLinks(html).links, TODAY)
    expect(c[3]!.kind).toBe('event')
    expect(c[3]!.dates).toEqual(['2026-08-23'])
    expect(c[3]!.label).toBe('オープンキャンパス')
  })
})

// ---------------------------------------------------------------------------
// テスト2: トリップワイヤー
// ---------------------------------------------------------------------------

describe('テスト2: トリップワイヤー', () => {
  it('アンカー0件の HTML は例外を投げる', () => {
    expect(() => extractLinks('<html><body><div class="md-box"><p>お知らせ</p></div></body></html>')).toThrow(
      /時刻表リンクが1件も抽出できませんでした/,
    )
  })

  it('md-box の外にしかリンクが無い場合も例外を投げる', () => {
    const html = `<html><body><div class="other"><p>2026年4月4日 <a href="a.jpg">時刻表はコチラ</a></p></div></body></html>`
    expect(() => extractLinks(html)).toThrow()
  })

  it('画像リンクだが『時刻表』文言が無く行に日付がある場合は警告を出す（処理は継続）', () => {
    const html = `<html><body><div class="md-box">
      <p>2026年9月1日（火）　特別ダイヤ　<a href="https://x/2026.jpg">こちら</a></p>
      <p>2026年4月4日（土）～　通常授業日／休業日　<a href="https://x/r8.jpg">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links, warnings } = extractLinks(html)
    expect(links).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.code).toBe('possible_missed_link')
  })

  it('同一ブロック内に複数リンクがある場合は <br> で行を分割する', () => {
    const html = `<html><body><div class="md-box"><p>
      2026年6月14日（日）　簿記検定　<a href="https://x/a.jpg">時刻表はコチラ</a><br>
      2026年6月20日（土）　オープンキャンパス　<a href="https://x/b.jpg">時刻表はコチラ</a>
    </p></div></body></html>`
    const c = classifyLinks(extractLinks(html).links, TODAY)
    expect(c).toHaveLength(2)
    expect(c[0]!.label).toBe('簿記検定')
    expect(c[1]!.label).toBe('オープンキャンパス')
  })
})

// ---------------------------------------------------------------------------
// テスト3: 日付パース
// ---------------------------------------------------------------------------

describe('テスト3: 正規化と日付パース', () => {
  it('全角数字・全角空白・NBSP を正規化し連続空白を圧縮する', () => {
    expect(normalizeLineText('２０２６年　８月  １日')).toBe('2026年 8月 1日')
  })

  it('桁揃えの空白入り表記をパースできる（2026-07 ライブ形式）', () => {
    expect(findRawDates(normalizeLineText('2026年 8月  17日（月）'))).toEqual([{ year: 2026, month: 8, day: 17 }])
  })

  it('波ダッシュは U+FF5E / U+301C / ASCII のいずれも受理する', () => {
    for (const t of ['～', '〜', '~']) {
      expect(classifyLink(link(`2026年4月4日（土）${t} 通常授業日／休業日`), TODAY).kind).toBe('regular')
    }
  })

  it('年なしの日付は現在年を補い、180日以上過去なら +1 年する', () => {
    // today=2026-08-01。9月1日 → 2026-09-01（未来なのでそのまま）
    expect(resolveDates([{ month: 9, day: 1 }], TODAY)).toEqual({ dates: ['2026-09-01'], yearGuessed: true })
    // 1月1日 → 2026-01-01 は today-180日(2026-02-02) より過去 → 2027-01-01
    expect(resolveDates([{ month: 1, day: 1 }], TODAY)).toEqual({ dates: ['2027-01-01'], yearGuessed: true })
    // 3月1日 → 2026-03-01 は閾値より後なのでそのまま
    expect(resolveDates([{ month: 3, day: 1 }], TODAY)).toEqual({ dates: ['2026-03-01'], yearGuessed: true })
  })

  it('期間の2つ目の日付は開始日と同年、跨ぐ場合は +1 年する', () => {
    expect(resolveDates([{ year: 2026, month: 8, day: 1 }, { month: 9, day: 20 }], TODAY).dates).toEqual([
      '2026-08-01',
      '2026-09-20',
    ])
    expect(resolveDates([{ year: 2026, month: 12, day: 24 }, { month: 1, day: 6 }], TODAY).dates).toEqual([
      '2026-12-24',
      '2027-01-06',
    ])
  })

  it('vacation の語彙バリエーションを吸収する', () => {
    const cases: [string, string][] = [
      ['2026年8月17日～9月23日 夏季休業', 'summer'],
      ['2026年8月17日～9月23日 夏期休暇', 'summer'],
      ['2026年8月17日～9月23日 夏休み', 'summer'],
      ['2026年2月1日～3月31日 春季休業', 'spring'],
      ['2026年12月24日～1月6日 冬季休業', 'winter'],
    ]
    for (const [text, season] of cases) {
      const c = classifyLink(link(text), TODAY)
      expect(c.kind, text).toBe('vacation')
      expect(c.season, text).toBe(season)
    }
  })

  it('vacation で終了日が無い場合も start だけ取れる', () => {
    const c = classifyLink(link('2026年8月17日～ 夏季休業'), TODAY)
    expect(c.kind).toBe('vacation')
    expect(c.start).toBe('2026-08-17')
    expect(c.end).toBeUndefined()
  })

  it('季節が特定できない休暇告知は needs_review になる', () => {
    const c = classifyLink(link('2026年8月17日～9月23日 長期休業'), TODAY)
    expect(c.kind).toBe('needs_review')
    expect(c.reason).toContain('季節')
    expect(c.start).toBe('2026-08-17')
    expect(c.end).toBe('2026-09-23')
  })

  it('複数日イベントは全日付を拾う', () => {
    const c = classifyLink(link('2026年8月22日（土）　2026年8月23日（日）　オープンキャンパス'), TODAY)
    expect(c.kind).toBe('event')
    expect(c.dates).toEqual(['2026-08-22', '2026-08-23'])
    expect(c.label).toBe('オープンキャンパス')
  })

  it('日付が無い行は needs_review になり、期間も持たない', () => {
    const c = classifyLink(link('スクールバス時刻表について'), TODAY)
    expect(c.kind).toBe('needs_review')
    // 適用先を決められないので特別ダイヤも張らない
    expect(c.start).toBeUndefined()
    expect(c.end).toBeUndefined()
  })

  it('イベントラベルから日付・曜日・記号・リンク文言を除去する', () => {
    expect(extractEventLabel('● 2026年 6月14日（日） 日商簿記検定試験日 時刻表はコチラ', '時刻表はコチラ')).toBe(
      '日商簿記検定試験日',
    )
  })
})
