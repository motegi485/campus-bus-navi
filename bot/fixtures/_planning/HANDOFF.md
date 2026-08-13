# campus-bus-navi バックエンド — 引き継ぎ（HANDOFF）

> **最終更新: 2026-08-13**
>
> このファイルは「現在の確認境界」と「次に人間が行う作業」を記録する。Bot の要件・安全境界の正本は **`BACKEND_REQUIREMENTS.md`（v1.8）**、リポジトリ全体の案内は `docs/README.md`、Bot の入口は `docs/backend-bot.md` である。
>
> GitHub Actions の有効状態、Secrets、Workflow permissions、実 PR・本番反映はリポジトリ外の状態である。過去の記録だけで現在値を断定せず、稼働前に GitHub UI で再確認する。

---

## 1. 引継ぎ時の読み順

1. `docs/backend-bot.md` で役割と安全境界を確認する。
2. `BACKEND_REQUIREMENTS.md` の該当する FR / NFR / AC を読む。要件の正本はこのファイルである。
3. `bot/src/` とテストを読む。書込制限は `files.ts`、override の優先順位は `calendar.ts`、計画は `plan.ts`、実行順は `index.ts` にある。
4. GitHub Actions を扱う場合だけ、下記の外部状態を GitHub UI で確認してから作業する。

## 2. 確認済みのリポジトリ内状態（2026-08-13）

| 項目 | 確認内容 |
|---|---|
| Bot 実装 | `bot/` に独立した Node.js パッケージ、テスト、state、設定がある |
| ワークフロー定義 | `.github/workflows/timetable-sync.yml` がある。Node.js 22、`npm ci`、full SHA 固定の action、資格情報を残さない checkout、失敗時の成果物保存を定義する |
| 静的データ | `calendar_rules.json` と時刻表ファイルがある。`closed` / `special` は Bot の保護対象 |
| Bot state | `regular`、`vacations.summer`、`events[2026-08-23]` などの管理情報を持つ |

次はこの文書だけから**現在確認できない**状態です。

- workflow が GitHub 上で有効か
- `GEMINI_API_KEY` が GitHub Secrets に登録済みか
- Workflow permissions が PR 作成を許可しているか
- Actions の実行結果、PR 作成、マージ、Cloudflare Pages 反映

2026-08-08 までの文書には、ローカルでテスト 153 件と AC-1〜AC-3 相当を確認したという記録があります。これは過去の実績であり、現在の再実行結果ではありません。未検証の受け入れ基準は **AC-4（既存 PR の更新）** と **AC-7（イベントの実運用ライフサイクル）** です。

## 3. 本番稼働前に人間が行うこと

1. GitHub の `Actions → timetable-sync` で、ワークフローが意図どおり有効または無効かを確認する。
2. `Settings → Secrets and variables → Actions` で `GEMINI_API_KEY` を登録または有効性確認する。鍵の値は会話、ログ、リポジトリへ出さない。
3. `Settings → Actions → General → Workflow permissions` で Read and write permissions と、GitHub Actions による PR 作成許可を確認する。
4. 必要なら workflow を Enable する。
5. まず `workflow_dispatch` を `dry_run: true` で実行し、リンク分類、計画、警告を確認する。
6. `dry_run: false` で初回 PR を作る。PR 本文の要手動確認、元画像、時刻表、override を人間が確認する。
7. マージ後、Cloudflare Pages の反映と配信データを確認する。
8. イベントの追加・適用日通過後の削除を観測し、AC-4 と AC-7 の実環境確認を記録する。

ワークフローを有効にする前に、運用者が Bot の書込対象と特別ダイヤのフェイルセーフを理解していることを確認してください。

## 4. 安全なローカル再現

まず書込も OCR も行わない確認経路を使います。

```powershell
Set-Location bot
npm ci
npx vitest run
npx tsc --noEmit
$env:DRY_RUN = "1"
$env:SKIP_OCR = "1"
npx tsx src/index.ts
```

`DRY_RUN` を外すと、`public/data/`、`bot/state.json`、`bot/holidays.json` などへ差分を出す可能性があります。`SKIP_OCR` を外すと、ローカルの `bot/.env.local` を使う外部 API 呼び出しが発生します。実行前に作業ツリーの状態、対象データ、レビュー手順を確認してください。

## 5. 主な切り分け

| 症状 | 最初に確認すること |
|---|---|
| `create-pull-request` が失敗 | GitHub の Workflow permissions と PR 作成許可 |
| 鍵が未設定で失敗 | Secrets と、OCR 対象があるか |
| 429 / 503 | Gemini の利用枠・一時障害。`SKIP_OCR=1` の計画確認へ戻る |
| `link_host_not_allowed` / `image_fetch_failed` | 大学側の配信ホスト変更。allowlist と実 URL |
| ジョブが赤く PR がない | 差分ゼロだが警告または検証失敗の意図的失敗。`timetable-sync-out` と Step Summary |
| PR が全行置換 | JSON ハウススタイルまたは `files.ts` の整形保持を確認 |
| `run_deadline_exceeded` | OCR が締切に達した。画像数・応答遅延・設定を要件に照らして確認 |

## 6. 参照先

| 知りたいこと | ファイル |
|---|---|
| Bot の要件、優先順位、受け入れ基準 | `bot/fixtures/_planning/BACKEND_REQUIREMENTS.md` |
| Bot の構成と安全境界 | `docs/backend-bot.md` |
| 全体アーキテクチャ・データ・PWA | `docs/architecture.md`、`docs/data-model-and-operations.md`、`docs/pwa-and-deployment.md` |
| 検証 | `docs/verification.md` |
| 実装 | `bot/src/` と `bot/test/` |
