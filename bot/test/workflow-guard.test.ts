/**
 * .github/workflows/timetable-sync.yml の安全対策が消えていないことを静的に検査する。
 *
 * ワークフローは GitHub Actions 上でしか実走できないため、ここでは YAML の文面を読む。
 * - コミット対象の許可リスト（ALLOWED_PATHS_RE）が files.ts の書込みホワイトリストと一致すること
 * - token の復元（trap）、hook の無効化、install スクリプトの無効化、改名検出の無効化が残っていること
 * - run ブロックへ ${{ github.ref }} を直接展開していないこと（スクリプト注入の防止）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { repoPath, isWritableTimetableFile } from '../src/files.js'
import { CONFIG } from '../src/config.js'

const WORKFLOW_PATH = repoPath('.github', 'workflows', 'timetable-sync.yml')
const yml = readFileSync(WORKFLOW_PATH, 'utf-8').replace(/\r\n/g, '\n')

/** yml から ALLOWED_PATHS_RE='...' を抜き出して RegExp にする（ERE の構文はこの範囲で JS と互換） */
function loadAllowedPathsRe(): RegExp {
  const m = yml.match(/^\s*ALLOWED_PATHS_RE='([^']+)'\s*$/m)
  if (!m) throw new Error('ALLOWED_PATHS_RE がワークフローに見つかりません')
  return new RegExp(m[1]!)
}

/** `run: |` ブロックの本文行だけを集める（インデントで終端を判定する） */
function runBlockLines(): string[] {
  const lines = yml.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/)
    if (!m) continue
    const keyIndent = m[1]!.length
    const rest = m[2]!
    if (!/^[|>]/.test(rest)) {
      out.push(rest) // 1 行の run
      continue
    }
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!
      if (line.trim() === '') continue
      const indent = line.length - line.trimStart().length
      if (indent <= keyIndent) break
      out.push(line)
    }
  }
  return out
}

describe('timetable-sync.yml: コミット対象の許可リスト', () => {
  const re = loadAllowedPathsRe()

  it.each([
    'public/data/calendar_rules.json',
    'public/data/timetables/timetable_weekday.json',
    'public/data/timetables/timetable_holiday.json',
    'public/data/timetables/timetable_vacation_spring_weekday.json',
    'public/data/timetables/timetable_vacation_spring_holiday.json',
    'public/data/timetables/timetable_vacation_summer_weekday.json',
    'public/data/timetables/timetable_vacation_summer_holiday.json',
    'public/data/timetables/timetable_vacation_winter_weekday.json',
    'public/data/timetables/timetable_vacation_winter_holiday.json',
    'public/data/timetables/timetable_event_20261031.json',
    'bot/state.json',
    'bot/holidays.json',
  ])('Bot の書込み対象 %s は受理する', (p) => {
    expect(re.test(p)).toBe(true)
  })

  it.each([
    'public/data/news.json',
    'public/data/_examples/timetable_sample.json',
    'public/data/timetables/timetable_closed.json',
    'public/data/timetables/timetable_special.json',
    'public/data/timetables/timetable_vacation_obon.json',
    'public/data/timetables/timetable_event_2026103.json',
    'public/data/timetables/timetable_event_202610311.json',
    'public/data/timetables/timetable_weekday.json.bak',
    'public/data/timetables/sub/timetable_weekday.json',
    'public/data/calendar_rules.json.orig',
    '"public/data/timetables/timetable_event_2026\\343\\201\\202.json"',
    'xpublic/data/calendar_rules.json',
    'scripts/validate-data.mjs',
    '.github/workflows/timetable-sync.yml',
    'bot/src/index.ts',
    'bot/package.json',
    'public/sw.js',
    'public/_headers',
  ])('書込み対象外 %s は拒否する', (p) => {
    expect(re.test(p)).toBe(false)
  })

  it('timetables/ 配下の判定が files.ts の isWritableTimetableFile と一致する（二重管理の同期）', () => {
    const names = [
      'timetable_weekday.json',
      'timetable_holiday.json',
      ...(['spring', 'summer', 'winter', 'obon', 'autumn'] as const).flatMap((s) => [
        `timetable_vacation_${s}_weekday.json`,
        `timetable_vacation_${s}_holiday.json`,
      ]),
      'timetable_vacation_obon.json',
      'timetable_event_20261031.json',
      'timetable_event_19991231.json',
      'timetable_event_2026103.json',
      'timetable_event_202610311.json',
      'timetable_event_YYYYMMDD.json',
      'timetable_closed.json',
      'timetable_special.json',
      'timetable_sample.json',
      'timetable_weekday.json.bak',
      'timetable_Weekday.json',
      'news.json',
      'calendar_rules.json',
      ...CONFIG.protectedFiles,
    ]
    for (const name of names) {
      expect(re.test(`public/data/timetables/${name}`), name).toBe(isWritableTimetableFile(name))
    }
  })

  it('timetables/ 以外の許可パスが config.ts の書込み先と一致する', () => {
    for (const p of [CONFIG.calendarRulesPath, CONFIG.statePath, CONFIG.holidaysCachePath]) {
      expect(re.test(p), p).toBe(true)
    }
    expect(re.test(`${CONFIG.dataDir}/timetable_weekday.json`)).toBe(true)
    // レポートは gitignore 下で、コミット対象ではない
    expect(re.test(CONFIG.reportPath)).toBe(false)
  })

  it('許可リストはステージ後と rebase 後の両方で check_paths により検査される', () => {
    expect(yml).toMatch(/git diff --cached --name-only --no-renames \| check_paths/)
    expect(yml).toMatch(/changed=\$\(git diff --name-only --no-renames "\$base" HEAD\)/)
    expect(yml).toMatch(/printf '%s\\n' "\$changed" \| check_paths/)
    // 旧来の public/data 全体を通す正規表現が残っていない
    expect(yml).not.toContain("grep -qvE '^(public/data/|")
  })
})

describe('timetable-sync.yml: push ステップの堅牢化', () => {
  it('token 入りの remote URL を EXIT / INT / TERM で必ず戻す', () => {
    expect(yml).toMatch(/restore_remote\(\) \{/)
    expect(yml).toMatch(/^\s*trap restore_remote EXIT\s*$/m)
    expect(yml).toMatch(/^\s*trap 'exit 130' INT TERM\s*$/m)
    // trap は token を差す行より前に置く
    const trapAt = yml.indexOf('trap restore_remote EXIT')
    const tokenAt = yml.indexOf('x-access-token:${GH_TOKEN}')
    expect(trapAt).toBeGreaterThan(-1)
    expect(tokenAt).toBeGreaterThan(trapAt)
  })

  it('push ステップ全体で git hook を無効にする（GIT_CONFIG_* 経由の core.hooksPath）', () => {
    expect(yml).toMatch(/^\s*export GIT_CONFIG_COUNT=1\s*$/m)
    expect(yml).toMatch(/^\s*export GIT_CONFIG_KEY_0=core\.hooksPath\s*$/m)
    expect(yml).toMatch(/^\s*export GIT_CONFIG_VALUE_0=\/dev\/null\s*$/m)
    // 最初の git 呼び出し（git config user.name）より前に置く
    const hooksAt = yml.indexOf('GIT_CONFIG_KEY_0=core.hooksPath')
    const firstGitAt = yml.indexOf('git config user.name')
    expect(hooksAt).toBeGreaterThan(-1)
    expect(firstGitAt).toBeGreaterThan(hooksAt)
  })

  it('依存のインストールで lifecycle スクリプトを実行しない', () => {
    expect(yml).toMatch(/run: npm ci --ignore-scripts\s*$/m)
    expect(yml).not.toMatch(/run: npm ci\s*$/m)
  })

  it('run ブロックに ${{ github.ref }} を直接展開しない（env 経由にする）', () => {
    const lines = runBlockLines()
    expect(lines.length).toBeGreaterThan(10)
    for (const line of lines) {
      expect(line, line).not.toMatch(/\$\{\{\s*github\.ref\s*\}\}/)
      expect(line, line).not.toMatch(/\$\{\{\s*github\.head_ref\s*\}\}/)
    }
    // Guard ref は env: REF で受け取る
    expect(yml).toMatch(/REF: \$\{\{ github\.ref \}\}/)
  })
})

describe('timetable-sync.yml: 実行成果物の保存', () => {
  /** `- name: Upload run artifacts` から次のステップまでを抜き出す */
  function uploadStep(): string {
    const start = yml.indexOf('- name: Upload run artifacts')
    expect(start).toBeGreaterThan(-1)
    const next = yml.indexOf('\n      - name:', start + 1)
    return yml.slice(start, next === -1 ? undefined : next)
  }

  it('隠しディレクトリ bot/.out を成果物に含める（既定では除外され 1 件も残らなかった）', () => {
    const step = uploadStep()
    expect(step).toMatch(/^\s*path: bot\/\.out\/\*\*\s*$/m)
    expect(step).toMatch(/^\s*include-hidden-files: true\s*$/m)
  })

  it('対象パスは bot/.out に限る（.git などほかの隠しファイルを上げない）', () => {
    const paths = [...uploadStep().matchAll(/^\s*path: (.+)$/gm)].map((m) => m[1]!.trim())
    expect(paths).toEqual(['bot/.out/**'])
  })
})
