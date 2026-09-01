# CLAUDE.md

このファイルは、Claude を含む AI エージェントがこのリポジトリで作業する際の入口です。詳細な仕様をここへ重複記載せず、`docs/` と Bot の正本を参照してください。

## 言語・環境

- 応答は日本語で行う。コード内のコメントも日本語でよい（識別子は英語）。
- OS は Windows 11、シェルは PowerShell。コマンドは PowerShell 互換で記述・実行し、環境変数には `$env:NAME` を使う。
- 改行コードは LF に統一する。`.gitattributes` がある場合はそれに従う。
- Node.js 20 以上を前提とする。Bot の CI は Node.js 22 を使う。

## 作業前に読む文書

1. まず [docs/README.md](docs/README.md) を読み、対象作業に対応する文書を選ぶ。
2. 次の表を最低限の導線とする。変更範囲が複数にまたがる場合は、該当する文書をすべて読む。

| 作業対象 | 先に読む文書 |
| --- | --- |
| 全体構成、状態、画面の責務 | [docs/architecture.md](docs/architecture.md) |
| 時刻表、カレンダー、お知らせ、静的 JSON | [docs/data-model-and-operations.md](docs/data-model-and-operations.md) |
| PWA、サービスワーカー、キャッシュ、Cloudflare Pages | [docs/pwa-and-deployment.md](docs/pwa-and-deployment.md) |
| 意図を持つ安全設計・UI 判断 | [docs/design-decisions.md](docs/design-decisions.md) |
| 開発環境、実装手順、変更別チェック | [docs/development-guide.md](docs/development-guide.md) |
| 検証範囲、未検証状態の扱い | [docs/verification.md](docs/verification.md) |
| 時刻表自動取り込み Bot | [docs/backend-bot.md](docs/backend-bot.md)、`bot/fixtures/_planning/BACKEND_REQUIREMENTS.md`、必要に応じて `bot/fixtures/_planning/HANDOFF.md` |
| 発車前の通知、Web Push、配信 Worker、D1 | [docs/backend-push.md](docs/backend-push.md)、`server/src/schema.sql` |

## 正本と確認の原則

- 現在の実行時挙動は、ソースコード、`public/data/`、設定ファイル、検証器を実際に確認して判断する。文書だけを根拠に断定しない。
- Bot の要件・安全境界の正本は `bot/fixtures/_planning/BACKEND_REQUIREMENTS.md`。版番号は固定で書かず、同ファイル冒頭で確認する。
- Bot の直近状況と次の人間作業は `bot/fixtures/_planning/HANDOFF.md` を確認する。ただし GitHub Actions の有効状態、Secrets、権限、実行結果、デプロイ済み状態は外部状態であり、GitHub UI 等で再確認する。
- README は利用者向けの概要・権利・免責を置く場所であり、実装仕様の正本ではない。
- コード、データ、文書に食い違いを見つけた場合は、推測で一方へ合わせない。根拠と影響を示し、修正方針を確認する。

## 文書を更新する責務

- コード、データ、設定、通信、外部連携、検証方法、運用手順を変更したら、同じ作業で該当する `docs/`、README、Bot 正本・HANDOFF の更新要否を必ず確認する。
- 仕様文書を新規作成・大幅更新するときは、必ず実装・データ・処理フローを確認し、事実、設計判断、外部状態の未確認事項を区別して記述する。
- 新しい文書を加えたら `docs/README.md` の索引を更新し、このファイルと `AGENTS.md` の導線も見直す。
- デプロイ済み、実機確認済み、GitHub 設定済みなどは、確認日と方法なしに現在の事実として書かない。

## 実装・検証コマンド

リポジトリ直下で実行する。

```powershell
npm run dev
npm run validate:data
npx tsc --noEmit
npm run build
npm run preview
```

`npm run build` は、静的データ検証、TypeScript の型検査、Vite ビルドを順に行う。時刻表・カレンダー・お知らせを変更した場合は、少なくとも `npm run validate:data` を実行する。

Bot はフロントエンドと依存を分離している。Bot を扱うときは、まず `docs/backend-bot.md` と正本を読んでから次を実行する。

```powershell
Set-Location bot
npm ci
npx vitest run
npx tsc --noEmit
$env:DRY_RUN = '1'
$env:SKIP_OCR = '1'
npx tsx src/index.ts
```

`DRY_RUN` を外すと、実データや state を変更し得る。`GEMINI_API_KEY` などの秘密情報は読み上げ・出力・コミットしない。

## 重要な作業規則

- 複数ファイルにまたがる変更、アーキテクチャ・公開 API・データ構造の変更、削除を伴うリファクタリングは、先に計画を示し、承認を得てから実装する。軽微な単一ファイル修正は直接実施してよい。
- 研究上の手法、アルゴリズム、評価方法、設計判断に関わる変更は独断で決めない。疑義と選択肢を示して確認する。
- `public/data/` の JSON はランタイムと検証器の不変条件を満たす必要がある。形式や運用の詳細は `docs/data-model-and-operations.md` を正確に参照する。
- PWA のデータ JSON をプリキャッシュしない理由、日付跨ぎ時に時刻を表示しない判断、特別ダイヤの扱い、モバイル固有の設計判断は `docs/design-decisions.md` と `docs/pwa-and-deployment.md` を読んでから変更する。
- 秘密情報、API キー、`.env`、鍵、認証情報を読み上げ・出力・コミットしない。

## Git と外部操作

操作は「自動許可」「説明付き承認」「常時禁止」の3段階で扱う。安全性を確認できない操作は自動許可に分類しない。ユーザーの依頼は、その達成に必要な範囲だけを許可する。承認済みのコマンドを、引数・対象・実行場所・外部送信先が実質的に変わった別コマンドへ流用しない。
