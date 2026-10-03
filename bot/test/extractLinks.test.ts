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
import { isRealDate } from '../src/time.js'
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
    // today は掲示の全日付（4/4・6/14・6/20）より前にする。過去日フィルタで偶然 0 件になるのではなく、
    // 日付行がすべてリンクに使われていることを確かめるため
    const { warnings } = extractLinks(html, undefined, '2026-04-01')
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

  // v1.16 の複数行まとめ・possible_missed_dates を足しても、旧形式（見出しがリンク行の中・→ 補足行）では警告が増えない
  it('警告を出さない（possible_missed_dates を誤発火させない）', () => {
    // スナップショット取得日に固定（8/8・8/17・8/23 は今日以降として判定対象になる）
    const { warnings } = extractLinks(html, undefined, TODAY)
    expect(warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 追加: 旧スナップショットは複数行まとめの影響を受けない（v1.16 の回帰防止）
// ---------------------------------------------------------------------------

describe('追加: 旧スナップショットでは前の行とまとめない', () => {
  // まとめが起きると ownLineText が入り、lineText が前の行を含むようになる。
  // 旧 2 形式では lineText がリンクを含む <p> だけ（従来どおり）であることを守る
  for (const name of ['page_snapshot.html', 'page_snapshot_20260801.html']) {
    it(`${name}: どのリンクも ownLineText / ungroupedKind を持たない`, () => {
      const { links } = extractLinks(readFixture(name))
      expect(links.every((l) => l.ownLineText === undefined)).toBe(true)
      const c = classifyLinks(links, TODAY)
      expect(c.every((x) => x.ungroupedKind === undefined)).toBe(true)
    })
  }

  it('page_snapshot_20260801.html: lineText はリンクを含む行だけ（前のリンク行を巻き込まない）', () => {
    const { links } = extractLinks(readFixture('page_snapshot_20260801.html'))
    expect(links.map((l) => normalizeLineText(l.lineText))).toEqual([
      '● 2026年 4月 4日（土）～ 通常授業日／休業日 時刻表はコチラ',
      '● 2026年 8月 8日（土）～ 8月16日（日） 時刻表はコチラ',
      '● 2026年 8月 17日（月）～ 9月23日（水） 夏季休業 時刻表はコチラ',
      '● 2026年 8月 23日（日） オープンキャンパス 時刻表はコチラ',
    ])
  })
})

// ---------------------------------------------------------------------------
// 追加: 2026-10-03 のライブ凍結スナップショット（見出し／日付行／リンク行が別の <p>）
// ---------------------------------------------------------------------------

describe('追加: extractLinks(page_snapshot_20261003.html) — 複数行に分かれた掲示', () => {
  const html = readFixture('page_snapshot_20261003.html')
  /** このスナップショットを取得した日 */
  const TODAY_1003 = '2026-10-03'

  // 2026-10-03 の不具合（10/03・10/10・10/11・10/17 の欠落、10/16 のラベル欠落）を再発させない
  it('6 リンクを抽出し、種別・日付・ラベル・年推定・まとめ前の種別が期待どおり', () => {
    const { links } = extractLinks(html)
    const c = classifyLinks(links, TODAY_1003)
    expect(c.map((x) => x.url)).toEqual([
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/09/20260924.jpg',
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/09/公開講座-1-724x1024.jpg',
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/10/2026-1011.1012-1024x709.jpg',
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/10/2026-1016-724x1024.jpg',
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/10/2026-1017.1018-724x1024.jpg',
      'https://www.fukuyama-u.ac.jp/wp-content/uploads/2026/10/2026-1019-724x1024.jpg',
    ])
    expect(c.map((x) => x.kind)).toEqual(['regular', 'event', 'event', 'event', 'event', 'event'])
    // 見出し・日付行の連結で種別が変わっていない（grouping_changed_kind を出さない前提）
    expect(c.map((x) => x.ungroupedKind)).toEqual(['regular', 'event', 'event', 'event', 'event', 'event'])

    expect(c[0]!.start).toBe('2026-09-24')

    expect(c[1]!.dates).toEqual(['2026-10-03', '2026-10-10', '2026-10-31'])
    expect(c[1]!.label).toBe('公開講座')

    expect(c[2]!.dates).toEqual(['2026-10-11', '2026-10-12'])

    expect(c[3]!.dates).toEqual(['2026-10-16'])
    expect(c[3]!.label).toBe('令和8年度後期学長杯争奪競技大会 第52回福山大学三蔵祭 準備日')

    expect(c[4]!.dates).toEqual(['2026-10-17', '2026-10-18'])
    expect(c[4]!.label).toBe('第52回福山大学三蔵祭')

    expect(c[5]!.dates).toEqual(['2026-10-19'])
    expect(c[5]!.label).toBe('第52回福山大学三蔵祭 片付け日')

    // 年は見出し直後の日付行に書いてあるので、まとめれば推定にならない
    expect(c.map((x) => x.yearGuessed)).toEqual([false, false, false, false, false, false])
  })

  it('全リンクが前の行とまとめられ、ownLineText にリンク行だけのテキストが残る', () => {
    const { links } = extractLinks(html)
    expect(links.every((l) => l.ownLineText !== undefined)).toBe(true)
    expect(normalizeLineText(links[1]!.ownLineText!)).toBe('10月31日（土） 時刻表はコチラ')
  })

  it('警告を出さない（日付行はすべてどれかのリンクに使われている）', () => {
    const { warnings } = extractLinks(html, undefined, TODAY_1003)
    expect(warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 追加: 複数行まとめの境界（最小 HTML）
// ---------------------------------------------------------------------------

/** md-box 1 つだけの最小ページ */
const box = (inner: string) => `<html><body><div class="md-box">${inner}</div></body></html>`
const IMG = (name: string) => `https://www.fukuyama-u.ac.jp/${name}.jpg`
const anchor = (name: string, text = '時刻表はコチラ') => `<a href="${IMG(name)}">${text}</a>`
const TODAY_OCT = '2026-10-03'

describe('追加: 複数行まとめ — まとめるケース', () => {
  it('見出し・日付行・リンク行を 1 件にまとめる（基本形）', () => {
    const html = box(`<p>● 公開講座</p><p>2026年10月3日（土）</p><p>10月10日（土） ${anchor('a')}</p>`)
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(links).toHaveLength(1)
    expect(normalizeLineText(links[0]!.lineText)).toBe('● 公開講座 2026年10月3日（土） 10月10日（土） 時刻表はコチラ')
    expect(normalizeLineText(links[0]!.ownLineText!)).toBe('10月10日（土） 時刻表はコチラ')
    const c = classifyLinks(links, TODAY_OCT)
    expect(c[0]!.dates).toEqual(['2026-10-03', '2026-10-10'])
    expect(c[0]!.label).toBe('公開講座')
    expect(c[0]!.yearGuessed).toBe(false)
    // まとめに使った行は possible_missed_dates の対象外
    expect(warnings).toEqual([])
  })

  it('<p> 間の空白だけのテキストノードとコメントは飛ばして遡る', () => {
    const html = box(
      `<p>● 公開講座</p>\n  \n<!-- 編集メモ -->\n<p>2026年10月3日（土）</p>\n\t<p>10月10日（土） ${anchor('a')}</p>`,
    )
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(links[0]!.ownLineText).toBeDefined()
    expect(classifyLinks(links, TODAY_OCT)[0]!.dates).toEqual(['2026-10-03', '2026-10-10'])
    expect(warnings).toEqual([])
  })

  it('空白でない裸のテキストノードは 1 行として扱う（日付行として取り込める）', () => {
    const html = box(`<p>● 公開講座</p>2026年10月3日（土）<p>10月10日（土） ${anchor('a')}</p>`)
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(links[0]!.ownLineText).toBeDefined()
    const c = classifyLinks(links, TODAY_OCT)
    expect(c[0]!.dates).toEqual(['2026-10-03', '2026-10-10'])
    expect(c[0]!.label).toBe('公開講座')
    // 取り込んだテキストノードは「使われた行」になり、警告されない
    expect(warnings).toEqual([])
  })

  it('空白でない裸のテキストノードは 1 行として扱う（見出し行として取り込める）', () => {
    const html = box(`● 公開講座<p>2026年10月3日（土）</p><p>10月10日（土） ${anchor('a')}</p>`)
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    const c = classifyLinks(links, TODAY_OCT)
    expect(c[0]!.dates).toEqual(['2026-10-03', '2026-10-10'])
    expect(c[0]!.label).toBe('公開講座')
    expect(warnings).toEqual([])
  })

  it('日付も見出し記号も無い裸のテキストノードは 1 行として扱い、そこで止まる', () => {
    const html = box(`<p>● 公開講座</p>ご注意ください<p>2026年10月3日（土） ${anchor('a')}</p>`)
    const { links } = extractLinks(html)
    expect(links[0]!.ownLineText).toBeUndefined()
    expect(normalizeLineText(links[0]!.lineText)).toBe('2026年10月3日（土） 時刻表はコチラ')
  })

  it('日付行が 5 行までならまとめる（上限ちょうど）', () => {
    const dateLines = [3, 4, 5, 6, 7].map((d) => `<p>2026年10月${d}日</p>`).join('')
    const html = box(`<p>● 公開講座</p>${dateLines}<p>10月10日（土） ${anchor('a')}</p>`)
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(links[0]!.ownLineText).toBeDefined()
    expect(classifyLinks(links, TODAY_OCT)[0]!.dates).toEqual([
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-10',
    ])
    expect(warnings).toEqual([])
  })

  // 見出しの語を巻き込んで種別が変わったことを detectChanges（grouping_changed_kind）が検知できるよう、
  // リンク行だけで分類した種別を ungroupedKind に残す
  it('まとめで種別が変わる場合、ungroupedKind にリンク行だけの種別が残る', () => {
    const html = box(`<p>● 冬季休業を除く</p><p>2026年10月3日（土）～ ${anchor('a')}</p>`)
    const c = classifyLinks(extractLinks(html).links, TODAY_OCT)
    expect(c[0]!.kind).toBe('vacation')
    expect(c[0]!.ungroupedKind).toBe('regular')
  })

  it('まとめていないリンクには ungroupedKind を付けない', () => {
    const html = box(`<p>● 2026年10月3日（土） 公開講座 ${anchor('a')}</p>`)
    const c = classifyLinks(extractLinks(html).links, TODAY_OCT)
    expect(c[0]!.ungroupedKind).toBeUndefined()
  })
})

describe('追加: 複数行まとめ — まとめない境界（リンク行だけを使う従来動作）', () => {
  /** まとめが起きていないこと＝ ownLineText が無く、lineText がリンク行だけ */
  function expectUngrouped(html: string, ownText: string, today = TODAY_OCT) {
    const { links, warnings } = extractLinks(html, undefined, today)
    const target = links.find((l) => normalizeLineText(l.lineText).includes(ownText))
    expect(target, `「${ownText}」を含むリンクが無い`).toBeDefined()
    expect(target!.ownLineText).toBeUndefined()
    expect(normalizeLineText(target!.lineText)).toBe(ownText)
    return { links, warnings, classified: classifyLinks(links, today) }
  }

  it('空行（<p>&nbsp;</p>）で止まる', () => {
    const { warnings } = expectUngrouped(
      box(`<p>● 公開講座</p><p>&nbsp;</p><p>2026年10月3日（土） ${anchor('a')}</p>`),
      '2026年10月3日（土） 時刻表はコチラ',
    )
    expect(warnings).toEqual([])
  })

  it('画像でない <a> を含む行で止まる', () => {
    const { warnings } = expectUngrouped(
      box(
        `<p>● 公開講座</p><p>2026年10月3日（土） <a href="https://www.fukuyama-u.ac.jp/info.pdf">案内</a></p>` +
          `<p>10月10日（土） ${anchor('a')}</p>`,
      ),
      '10月10日（土） 時刻表はコチラ',
    )
    // アンカーを含む行は possible_missed_dates の対象外（リンク側の警告で扱う）
    expect(warnings.map((w) => w.code)).not.toContain('possible_missed_dates')
  })

  it('『時刻表』文言の無い画像 <a> を含む行で止まる', () => {
    const { warnings } = expectUngrouped(
      box(`<p>● 公開講座</p><p>2026年10月3日（土） ${anchor('b', 'こちら')}</p><p>10月10日（土） ${anchor('a')}</p>`),
      '10月10日（土） 時刻表はコチラ',
    )
    // 文言なし画像リンクの行は従来どおり possible_missed_link で知らせる
    expect(warnings.map((w) => w.code)).toEqual(['possible_missed_link'])
  })

  it('→ で始まる補足行で止まる', () => {
    const { warnings } = expectUngrouped(
      box(`<p>● お盆</p><p>→ 8月12日 最終便の時刻変更</p><p>2026年8月8日（土） ${anchor('a')}</p>`),
      '2026年8月8日（土） 時刻表はコチラ',
      // 8/12 が今日以降になる日付で判定し、「補足行だから警告しない」ことを確かめる
      TODAY,
    )
    expect(warnings).toEqual([])
  })

  it('日付も見出し記号も無い行で止まる', () => {
    const { warnings } = expectUngrouped(
      box(`<p>● 公開講座</p><p>2026年10月3日（土）</p><p>ご注意ください</p><p>10月10日（土） ${anchor('a')}</p>`),
      '10月10日（土） 時刻表はコチラ',
    )
    // 止まった結果使われなかった日付行は警告で知らせる
    expect(warnings.map((w) => w.code)).toEqual(['possible_missed_dates'])
  })

  it('日付行が 6 行以上ならまとめない（上限超え）', () => {
    const dateLines = [3, 4, 5, 6, 7, 8].map((d) => `<p>2026年10月${d}日</p>`).join('')
    const { warnings } = expectUngrouped(
      box(`<p>● 公開講座</p>${dateLines}<p>10月10日（土） ${anchor('a')}</p>`),
      '10月10日（土） 時刻表はコチラ',
    )
    expect(warnings.filter((w) => w.code === 'possible_missed_dates')).toHaveLength(6)
  })

  it('見出しに着く前に兄弟の先頭へ達したらまとめない', () => {
    const { warnings } = expectUngrouped(
      box(`<p>2026年10月3日（土）</p><p>10月10日（土） ${anchor('a')}</p>`),
      '10月10日（土） 時刻表はコチラ',
    )
    expect(warnings.map((w) => w.code)).toEqual(['possible_missed_dates'])
  })

  it('md-box 直下のアンカーは遡らない（md-box の外の行を取り込まない）', () => {
    // md-box の前の兄弟に見出し・日付行があっても、告知ボックスの外なのでまとめない
    const html =
      `<html><body><div class="md-box_glow"><p>● 公開講座</p><p>2026年10月3日（土）</p>` +
      `<div class="md-box">10月10日（土） ${anchor('a')}</div></div></body></html>`
    expectUngrouped(html, '10月10日（土） 時刻表はコチラ')
  })

  // 修正 1(e) の回帰: md-box 直下のアンカーでは lineText ＝ md-box 全体のテキストで、隣の裸テキスト
  // 「10月10日（土）」は適用日として使われている。md-box 自身が usedNodes に入っていればボックス内を
  // 未使用判定しないので、possible_missed_dates を誤発火しない（md-box の外の行は判定範囲外）
  it('md-box 直下のアンカーでは、リンクと同じ行の日付を possible_missed_dates にしない', () => {
    const html =
      `<html><body><div class="md-box_glow"><p>● 公開講座</p><p>2026年10月3日（土）</p>` +
      `<div class="md-box">10月10日（土） ${anchor('a')}</div></div></body></html>`
    const { warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(warnings).toEqual([])
  })

  it('同じ <p> に対象アンカーが 2 つ（<br> 区切り）なら <br> 分割だけで、前の行へは遡らない', () => {
    const html = box(
      `<p>● 公開講座</p><p>2026年10月3日（土）</p>` +
        `<p>10月10日（土） ${anchor('a')}<br>10月31日（土） ${anchor('b')}</p>`,
    )
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(links).toHaveLength(2)
    expect(links.every((l) => l.ownLineText === undefined)).toBe(true)
    expect(links.map((l) => normalizeLineText(l.lineText))).toEqual([
      '10月10日（土） 時刻表はコチラ',
      '10月31日（土） 時刻表はコチラ',
    ])
    // 警告は遡らなかった別の <p> の 10/3 行だけ。リンクのある <br> 区間（10/10・10/31）は警告しない
    expect(warnings.map((w) => w.code)).toEqual(['possible_missed_dates'])
    expect(warnings[0]!.message).toContain('「2026年10月3日（土）」')
  })

  it('見出し記号がリンク行の中にある従来形式は遡らない', () => {
    const { warnings } = expectUngrouped(
      box(`<p>2026年10月3日（土）</p><p>● 2026年10月10日（土） 公開講座 ${anchor('a')}</p>`),
      '● 2026年10月10日（土） 公開講座 時刻表はコチラ',
    )
    expect(warnings.map((w) => w.code)).toEqual(['possible_missed_dates'])
  })

  it('連続するリンク行どうしはまとめない（前のリンク行で止まる）', () => {
    const { links } = extractLinks(
      box(`<p>● 公開講座</p><p>2026年10月3日（土） ${anchor('a')}</p><p>2026年10月10日（土） ${anchor('b')}</p>`),
    )
    expect(links).toHaveLength(2)
    // 1 件目は見出しとまとめる。2 件目は直前がリンク行なのでまとめない
    expect(links[0]!.ownLineText).toBeDefined()
    expect(links[1]!.ownLineText).toBeUndefined()
  })
})

describe('追加: possible_missed_dates', () => {
  it('どのリンクのまとめにも使われない日付行を warn で知らせる（行のテキストを含む）', () => {
    const { warnings } = extractLinks(
      box(`<p>2026年10月3日（土） 公開講座</p><p>&nbsp;</p><p>● 2026年10月10日（土） 公開講座 ${anchor('a')}</p>`),
      undefined,
      TODAY_OCT,
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.code).toBe('possible_missed_dates')
    expect(warnings[0]!.level).toBe('warn')
    expect(warnings[0]!.message).toContain('「2026年10月3日（土） 公開講座」')
  })

  it('→ で始まる補足行は日付を含んでも警告しない', () => {
    const { warnings } = extractLinks(
      box(`<p>● 2026年8月8日（土）～8月16日（日） ${anchor('a')}</p><p>→ 8月12日（水） 最終便の時刻変更</p>`),
      undefined,
      // 8/12 が今日以降になる日付で判定し、過去日だからではなく補足行だから警告しないことを確かめる
      TODAY,
    )
    expect(warnings).toEqual([])
  })

  it('まとめに使われた日付行は警告しない', () => {
    const { warnings } = extractLinks(
      box(`<p>● 公開講座</p><p>2026年10月3日（土）</p><p>10月10日（土） ${anchor('a')}</p>`),
      undefined,
      TODAY_OCT,
    )
    expect(warnings).toEqual([])
  })

  it('日付の無い行（見出しだけ・空行）は警告しない', () => {
    const { warnings } = extractLinks(
      box(`<p>無料スクールバス運行アナウンス</p><p>&nbsp;</p><p>● 2026年10月10日（土） 公開講座 ${anchor('a')}</p>`),
      undefined,
      TODAY_OCT,
    )
    expect(warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 追加: レビュー指摘の回帰（extractLinks 修正 1(a)〜(d)）
// ---------------------------------------------------------------------------

/** possible_missed_dates の警告メッセージだけを取り出す */
const missedDates = (html: string, today: string) =>
  extractLinks(html, undefined, today)
    .warnings.filter((w) => w.code === 'possible_missed_dates')
    .map((w) => w.message)

describe('追加: 修正 1(a) — 日付入りの見出し記号の行はまとめない', () => {
  // 「● 10月20日（火）は運休します」は別の告知。次の見出し無しリンク行に取り込むと、
  // 運休日にイベントダイヤを張る事故になる
  it('日付入り ● 行の直後の見出し無しリンク行はまとめず、● 行は possible_missed_dates になる', () => {
    const html = box(`<p>● 10月20日（火）は運休します</p><p>2026年10月24日（土） ${anchor('a')}</p>`)
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(links).toHaveLength(1)
    expect(links[0]!.ownLineText).toBeUndefined()
    expect(normalizeLineText(links[0]!.lineText)).toBe('2026年10月24日（土） 時刻表はコチラ')
    // 運休日 10/20 を適用日に取り込まない
    expect(classifyLinks(links, TODAY_OCT)[0]!.dates).toEqual(['2026-10-24'])
    expect(warnings.map((w) => w.code)).toEqual(['possible_missed_dates'])
    expect(warnings[0]!.message).toContain('「● 10月20日（火）は運休します」')
  })

  it('日付入り ● 行とリンク行の間に日付行があってもまとめず、両方の行を警告する', () => {
    const html = box(
      `<p>● 2026年10月20日（火）は運休します</p><p>10月24日（土）</p><p>10月25日（日） ${anchor('a')}</p>`,
    )
    const { links } = extractLinks(html, undefined, TODAY_OCT)
    expect(links[0]!.ownLineText).toBeUndefined()
    expect(classifyLinks(links, TODAY_OCT)[0]!.dates).toEqual(['2026-10-25'])
    const messages = missedDates(html, TODAY_OCT)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('「● 2026年10月20日（火）は運休します」')
    expect(messages[1]).toContain('「10月24日（土）」')
  })
})

describe('追加: 修正 1(b) — ※ 注記行', () => {
  // ※ 行は注記で、日付を含んでも適用日ではない。まとめを止め、未使用の警告にもしない
  it('※ 行でまとめが止まり、※ 行自体は警告しない（手前の日付行だけ警告）', () => {
    const html = box(
      `<p>● 公開講座</p><p>2026年10月3日（土）</p><p>※ 10月10日は午前のみ運行</p><p>10月31日（土） ${anchor('a')}</p>`,
    )
    const { links } = extractLinks(html, undefined, TODAY_OCT)
    expect(links[0]!.ownLineText).toBeUndefined()
    expect(normalizeLineText(links[0]!.lineText)).toBe('10月31日（土） 時刻表はコチラ')
    const messages = missedDates(html, TODAY_OCT)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('「2026年10月3日（土）」')
    expect(messages.some((m) => m.includes('※'))).toBe(false)
  })

  it('リンク行の後ろの ※ 行は、今日以降の日付を含んでも警告しない', () => {
    const html = box(`<p>● 2026年10月10日（土） 公開講座 ${anchor('a')}</p><p>※ 10月17日（土）は運休</p>`)
    expect(extractLinks(html, undefined, TODAY_OCT).warnings).toEqual([])
  })
})

describe('追加: 修正 1(c) — possible_missed_dates は今日以降の日付を含む行だけ', () => {
  // 過ぎた告知が掲示に残っても、毎日 warn（⚠ 要確認メール）にならないようにする
  const pastNotice = box(`<p>● 8月13日～8月15日 運休</p><p>&nbsp;</p><p>● 2026年10月10日（土） 公開講座 ${anchor('a')}</p>`)

  it('過去日だけの行は警告しない（年なしの 8/13 は 180 日以内なので 2026 年＝過去）', () => {
    expect(missedDates(pastNotice, TODAY_OCT)).toEqual([])
  })

  it('同じ行でも、今日以降の日付を含む日に判定すれば警告する', () => {
    const messages = missedDates(pastNotice, TODAY)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('「● 8月13日～8月15日 運休」')
  })

  it('過去と今日以降の日付を両方含む行は警告する', () => {
    const html = box(`<p>2026年9月20日（日）～10月20日（火） 工事</p><p>&nbsp;</p><p>● 2026年10月10日（土） 公開講座 ${anchor('a')}</p>`)
    expect(missedDates(html, TODAY_OCT)).toHaveLength(1)
  })

  it('今日ちょうどの日付は「今日以降」に含めて警告する', () => {
    const html = box(`<p>2026年10月3日（土） 臨時運休</p><p>&nbsp;</p><p>● 2026年10月10日（土） 公開講座 ${anchor('a')}</p>`)
    expect(missedDates(html, TODAY_OCT)).toHaveLength(1)
    // 翌日に判定すれば過去日なので警告しない
    expect(missedDates(html, '2026-10-04')).toEqual([])
  })
})

describe('追加: 修正 1(d) — <br> 区切りで対象アンカーが複数あるブロック', () => {
  // 各リンクは自分の <br> 区間しか使わないので、リンクの無い区間の日付は取りこぼしの疑いがある
  it('リンクの無い日付区間を警告し、リンク区間は警告しない', () => {
    const html = box(
      `<p>2026年10月3日（土） 公開講座<br>10月10日（土） ${anchor('a')}<br>10月31日（土） ${anchor('b')}</p>`,
    )
    const { links, warnings } = extractLinks(html, undefined, TODAY_OCT)
    expect(links).toHaveLength(2)
    expect(warnings.map((w) => w.code)).toEqual(['possible_missed_dates'])
    expect(warnings[0]!.message).toContain('「2026年10月3日（土） 公開講座」')
    expect(warnings.some((w) => w.message.includes('10月10日') || w.message.includes('10月31日'))).toBe(false)
  })

  it('リンクの無い区間でも、過去日だけなら警告しない', () => {
    const html = box(
      `<p>2026年9月1日（火） 前期終了<br>10月10日（土） ${anchor('a')}<br>10月31日（土） ${anchor('b')}</p>`,
    )
    expect(extractLinks(html, undefined, TODAY_OCT).warnings).toEqual([])
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
      <p>2026年9月1日（火）　特別ダイヤ　<a href="https://www.fukuyama-u.ac.jp/2026.jpg">こちら</a></p>
      <p>2026年4月4日（土）～　通常授業日／休業日　<a href="https://www.fukuyama-u.ac.jp/r8.jpg">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links, warnings } = extractLinks(html, undefined, TODAY)
    expect(links).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.code).toBe('possible_missed_link')
  })

  // Codex レビュー S2-BOT-04: 拡張子の判定を URL 全体末尾で行っていたため、
  // CMS がキャッシュバスターやアンカーを足しただけで無警告の取りこぼしになっていた
  it('クエリ付きの画像 URL（.jpg?v=2）も画像リンクとして拾う', () => {
    const html = `<html><body><div class="md-box">
      <p>2026年4月4日（土）～　通常授業日／休業日　<a href="https://www.fukuyama-u.ac.jp/r8.jpg?v=2">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links, warnings } = extractLinks(html, undefined, TODAY)
    expect(links).toHaveLength(1)
    expect(links[0]!.url).toBe('https://www.fukuyama-u.ac.jp/r8.jpg?v=2')
    expect(warnings).toHaveLength(0)
  })

  it('フラグメント付きの画像 URL（.png#x）も画像リンクとして拾う', () => {
    const html = `<html><body><div class="md-box">
      <p>2026年6月20日（土）　オープンキャンパス　<a href="https://www.fukuyama-u.ac.jp/b.png#x">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links } = extractLinks(html)
    expect(links).toHaveLength(1)
    expect(links[0]!.url).toBe('https://www.fukuyama-u.ac.jp/b.png#x')
  })

  it('クエリ付きで『時刻表』文言が無い画像リンクは、取りこぼし警告の対象になる', () => {
    const html = `<html><body><div class="md-box">
      <p>2026年9月1日（火）　特別ダイヤ　<a href="https://www.fukuyama-u.ac.jp/2026.jpg?v=3">こちら</a></p>
      <p>2026年4月4日（土）～　通常授業日／休業日　<a href="https://www.fukuyama-u.ac.jp/r8.jpg">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links, warnings } = extractLinks(html, undefined, TODAY)
    expect(links).toHaveLength(1)
    expect(warnings.map((w) => w.code)).toContain('possible_missed_link')
  })

  it('画像でない拡張子はクエリが付いていても拾わない', () => {
    const html = `<html><body><div class="md-box">
      <p>2026年4月4日（土）～　通常授業日／休業日　<a href="https://www.fukuyama-u.ac.jp/r8.pdf?v=2">時刻表はコチラ</a></p>
      <p>2026年6月20日（土）　オープンキャンパス　<a href="https://www.fukuyama-u.ac.jp/b.jpg">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links } = extractLinks(html)
    expect(links.map((l) => l.url)).toEqual(['https://www.fukuyama-u.ac.jp/b.jpg'])
  })

  it('同一ブロック内に複数リンクがある場合は <br> で行を分割する', () => {
    const html = `<html><body><div class="md-box"><p>
      2026年6月14日（日）　簿記検定　<a href="https://www.fukuyama-u.ac.jp/a.jpg">時刻表はコチラ</a><br>
      2026年6月20日（土）　オープンキャンパス　<a href="https://www.fukuyama-u.ac.jp/b.jpg">時刻表はコチラ</a>
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

  // 1 文字の曜日括弧だけを除いていた頃は、10/12 のラベルが「（月 祝）」という残骸になっていた（2026-10-03）
  it('複数文字の曜日括弧（月・祝）も除去する', () => {
    expect(
      extractEventLabel('● 薬学教育者ワークショップ 2026年 10月11日（日） 10月12日（月・祝） 時刻表はコチラ', '時刻表はコチラ'),
    ).toBe('薬学教育者ワークショップ')
    // 半角括弧・中黒の代わりの空白も同様
    expect(extractEventLabel('2026年10月12日(月 祝) 学園祭', '')).toBe('学園祭')
    expect(extractEventLabel('2026年10月17日（土・日） 学園祭', '')).toBe('学園祭')
  })

  it('曜日以外の括弧書き（第1回 など）はラベルに残す', () => {
    expect(extractEventLabel('2026年10月3日（土） 公開講座（第1回）', '')).toBe('公開講座（第1回）')
  })
})

// ---------------------------------------------------------------------------
// テスト4: 日付の実在検証と取得先の許可（Codex レビュー F-018 / F-009）
// ---------------------------------------------------------------------------

describe('テスト4: 日付の実在検証（F-018）', () => {
  it('isRealDate は非実在日を弾く（dayjs の正規化を通さない）', () => {
    expect(isRealDate('2026-02-28')).toBe(true)
    expect(isRealDate('2024-02-29')).toBe(true) // 閏年
    expect(isRealDate('2026-02-29')).toBe(false)
    expect(isRealDate('2026-02-30')).toBe(false)
    expect(isRealDate('2026-13-01')).toBe(false)
    expect(isRealDate('2026-99-99')).toBe(false)
    expect(isRealDate('2026-8-1')).toBe(false) // ゼロ埋めなし
  })

  it('非実在日を含む掲示は needs_review になり、期間も持たない', () => {
    const c = classifyLink(link('2026年2月30日（月）　オープンキャンパス'), TODAY)
    expect(c.kind).toBe('needs_review')
    expect(c.reason).toMatch(/実在しない日付/)
    // 誤読の可能性が高いので特別ダイヤの塗り潰しもしない
    expect(c.start).toBeUndefined()
    expect(c.end).toBeUndefined()
  })

  it('期間が逆転している掲示は needs_review になり、期間も持たない', () => {
    const c = classifyLink(link('2026年8月16日～2026年8月8日 夏季休業'), TODAY)
    expect(c.kind).toBe('needs_review')
    expect(c.reason).toMatch(/開始日が終了日より後/)
    expect(c.start).toBeUndefined()
    expect(c.end).toBeUndefined()
  })

  it('正しい期間はこれまでどおり vacation として取り込む', () => {
    const c = classifyLink(link('2026年8月17日～9月23日 夏季休業'), TODAY)
    expect(c.kind).toBe('vacation')
    expect(c.start).toBe('2026-08-17')
    expect(c.end).toBe('2026-09-23')
  })
})

describe('テスト4: 取得先ホストの制限（F-009）', () => {
  it('許可外ホストの絶対 URL は候補にせず警告を出す', () => {
    const html = `<html><body><div class="md-box">
      <p>2026年6月14日（日）　簿記検定　<a href="https://evil.example.com/a.jpg">時刻表はコチラ</a></p>
      <p>2026年6月20日（土）　オープンキャンパス　<a href="https://www.fukuyama-u.ac.jp/b.jpg">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links, warnings } = extractLinks(html, undefined, TODAY)
    expect(links.map((l) => l.url)).toEqual(['https://www.fukuyama-u.ac.jp/b.jpg'])
    expect(warnings.map((w) => w.code)).toContain('link_host_not_allowed')
  })

  it('平文 http のリンクも取り込まない', () => {
    const html = `<html><body><div class="md-box">
      <p>2026年6月14日（日）　簿記検定　<a href="http://www.fukuyama-u.ac.jp/a.jpg">時刻表はコチラ</a></p>
      <p>2026年6月20日（土）　オープンキャンパス　<a href="https://www.fukuyama-u.ac.jp/b.jpg">時刻表はコチラ</a></p>
    </div></body></html>`
    const { links, warnings } = extractLinks(html, undefined, TODAY)
    expect(links).toHaveLength(1)
    expect(warnings.some((w) => w.code === 'link_host_not_allowed')).toBe(true)
  })
})
