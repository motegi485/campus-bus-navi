/**
 * scripts/validate-data.mjs の news.json body 許可リストの検査。
 *
 * body は NewsScreen.tsx で dangerouslySetInnerHTML によって描画されるため、
 * 検証器は属性なしの <p> <b> <br> 以外の HTML を拒否する。
 * 検証器は自身の位置から public/data を決めるので、一時ディレクトリへ
 * scripts/validate-data.mjs と public/data を複製し、news.json だけを差し替えて実行する。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { repoPath } from '../src/files.js'

type NewsItem = Record<string, unknown> & { body: string }

let workDir = ''
let newsPath = ''
let originalNews: NewsItem[] = []

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'validate-data-news-'))
  mkdirSync(path.join(workDir, 'scripts'))
  mkdirSync(path.join(workDir, 'public'))
  cpSync(repoPath('scripts', 'validate-data.mjs'), path.join(workDir, 'scripts', 'validate-data.mjs'))
  cpSync(repoPath('public', 'data'), path.join(workDir, 'public', 'data'), { recursive: true })
  newsPath = path.join(workDir, 'public', 'data', 'news.json')
  originalNews = JSON.parse(readFileSync(newsPath, 'utf-8')) as NewsItem[]
})

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

/** news.json の [0].body を差し替えて検証器を実行する */
function runWithBody(body: string | null): { code: number | null; output: string } {
  const news = structuredClone(originalNews)
  if (body !== null) news[0]!.body = body
  writeFileSync(newsPath, JSON.stringify(news, null, 2) + '\n')
  const r = spawnSync(process.execPath, [path.join(workDir, 'scripts', 'validate-data.mjs')], {
    cwd: workDir,
    encoding: 'utf-8',
  })
  return { code: r.status, output: `${r.stdout}${r.stderr}` }
}

describe('validate-data.mjs: news.json body の HTML 許可リスト', () => {
  it('現行の news.json はそのまま通る', () => {
    expect(originalNews.length).toBeGreaterThan(0)
    const r = runWithBody(null)
    expect(r.output).toContain('静的データの検証に成功しました')
    expect(r.code).toBe(0)
  })

  it.each([
    ['p・b・br', '<p>本文<b>強調</b><br>次の行</p>'],
    ['自己終了の br', '<p>a<br/>b<br />c</p>'],
    ['エンティティ', '<p>&lt;script&gt; &amp; &quot;</p>'],
    ['単独の >', '<p>a > b</p>'],
    ['タグなしの文', '時刻表を更新しました。'],
  ])('許可: %s', (_label, body) => {
    const r = runWithBody(body)
    expect(r.output).toContain('静的データの検証に成功しました')
    expect(r.code).toBe(0)
  })

  it.each([
    ['script 要素', '<p>a</p><script>alert(1)</script>'],
    ['img onerror', '<p>a</p><img src=x onerror=alert(1)>'],
    ['p onclick', '<p onclick="alert(1)">a</p>'],
    ['b style', '<b style="position:fixed">a</b>'],
    ['a href=javascript:', '<a href="javascript:alert(1)">a</a>'],
    ['a href（属性なしの a も対象外）', '<a>a</a>'],
    ['iframe', '<iframe src="https://example.invalid/"></iframe>'],
    ['object', '<object data="x"></object>'],
    ['embed', '<embed src="x">'],
    ['style 要素', '<style>body{display:none}</style>'],
    ['form', '<form action="https://example.invalid/"><input name=x></form>'],
    ['svg onload', '<svg onload=alert(1)>'],
    ['閉じない img', '<p>a</p><img src=x onerror=alert(1)'],
    ['コメント', '<p>a</p><!-- x -->'],
    ['大文字の P', '<P>a</P>'],
    ['空白入りの p', '<p >a</p>'],
    ['改行入りのタグ', '<p\nonclick=alert(1)>a</p>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://example.invalid/">'],
  ])('拒否: %s', (_label, body) => {
    const r = runWithBody(body)
    expect(r.code).toBe(1)
    expect(r.output).toContain('body に許可されていない HTML があります')
  })
})
