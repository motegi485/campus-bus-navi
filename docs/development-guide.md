# 開発ガイド

## 前提

- Node.js 20 以上を使用します。リポジトリには Node.js バージョン固定ファイルはありません。
- フロントエンドと `bot/` は別々の npm パッケージです。それぞれのディレクトリで依存関係を管理します。
- TypeScript は `strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch` を有効にしています。
- ルートにはテスト・lint の npm スクリプトはありません。静的データ検証、型チェック、ビルドが品質ゲートです。

## 最初に読む文書

作業対象に応じて、着手前に [docs/README.md](README.md) の読書案内を確認してください。特に、データ変更では [data-model-and-operations.md](data-model-and-operations.md)、PWA 変更では [pwa-and-deployment.md](pwa-and-deployment.md)、安全設計を変える変更では [design-decisions.md](design-decisions.md) が必読です。

Bot を変更する場合は、[backend-bot.md](backend-bot.md) を入口にしてから、`bot/fixtures/_planning/BACKEND_REQUIREMENTS.md` を必ず読みます。

## フロントエンドのセットアップとコマンド

PowerShell ではリポジトリのルートで次を使います。

```powershell
npm install
npm run dev
```

| コマンド | 用途 |
|---|---|
| `npm run dev` | Vite 開発サーバーを起動する。通常は `http://localhost:5173` |
| `npm run validate:data` | `public/data/` の静的 JSON を検証する |
| `npx tsc --noEmit` | TypeScript の型検査だけを実行する |
| `npm run build` | データ検証、型検査、Vite ビルドを順に実行し `dist/` を作る |
| `npm run preview` | 本番ビルドをローカルで確認する。Service Worker を含む確認に使う |

時刻表・カレンダー・お知らせを変えたら、最低でも `npm run validate:data` を実行します。TypeScript を変えたら `npx tsc --noEmit`、配信・PWA・設定を変えたら `npm run build` と `npm run preview` まで実行します。

## 主なディレクトリ

```text
src/
  App.tsx                 画面全体の状態とレイアウト
  components/             UI コンポーネント
  hooks/                  時刻、取得、設定、オーバーレイなど
  utils/                  カレンダー、時刻計算、地図 URL、端末判定
  types/timetable.d.ts    JSON と UI の共有型
public/
  data/                   時刻表・カレンダー・お知らせ
  _headers, _redirects    Cloudflare Pages の配信設定
scripts/validate-data.mjs 静的データの品質ゲート
bot/                      時刻表自動取り込み Bot の独立パッケージ
docs/                     開発・運用・設計文書
```

## Bot のローカル確認

Bot は副作用を避けるため、まずドライランと OCR スキップで確認します。

```powershell
Set-Location bot
npm ci
npx vitest run
npx tsc --noEmit
$env:DRY_RUN = "1"
$env:SKIP_OCR = "1"
npx tsx src/index.ts
```

`DRY_RUN` を外すと、`public/data/`、`bot/state.json`、`bot/holidays.json` などを書き換える可能性があります。`SKIP_OCR` を外すと、ローカルの `bot/.env.local` にある `GEMINI_API_KEY` を使い、外部 API 呼び出しが発生します。秘密情報を表示・記録・コミットしてはいけません。

Bot の本番稼働や GitHub Actions 操作は、[backend-bot.md](backend-bot.md) と `HANDOFF.md` の人間向け手順に従ってください。

## 通知配信のローカル確認

配信サーバもフロントエンドと依存を分離しています。詳細は [backend-push.md](backend-push.md) を参照してください。

```powershell
Set-Location server
npm ci
npm run typecheck
npm test
npx wrangler deploy --dry-run --outdir .wrangler/dry
```

実機へ 1 通だけ送って確かめる場合は次を使います。鍵は `server/.dev.vars`（`.gitignore` 済み）から自動で読まれます。

```powershell
npm run keygen                      # 初回のみ。公開鍵だけ画面に出る
npm run send-test                   # 購読情報を貼り付けると 1 通送る
```

`wrangler` のコマンドは必ず `server/` で実行してください。リポジトリ直下の `wrangler.toml` は Pages の設定であり、直下で `wrangler deploy` を実行してはいけません。

**通知の購読 API は Pages Functions なので、`npm run preview` では動きません。** ローカルで API まで通すには `npx wrangler pages dev`、または Cloudflare のプレビューデプロイを使います。

## 変更別チェックリスト

| 変更 | 必要な確認 |
|---|---|
| 時刻表、カレンダー、お知らせ | データ仕様確認、`npm run validate:data`、表示対象日を確認 |
| 次発計算、日付、タイムゾーン | JST・分境界・日付跨ぎ・同じ分の便を確認 |
| PWA、キャッシュ、デプロイ | `npm run build`、`npm run preview`、更新・オフライン経路を確認 |
| 地図、端末判定 | iOS / iPadOS / Android の URL とタイル表示を確認 |
| オーバーレイ、設定、操作感 | キーボードフォーカス、Escape、背面操作不可、縮小モーションを確認 |
| Bot | 要件正本、Bot テスト・型検査、書込ホワイトリスト、ドライランを確認 |
| 通知、Web Push、配信 Worker、D1 | `server` の型検査・テスト、`--dry-run`、送信しない条件（運休日・特別ダイヤ・実在しない便）、鍵がコミットされていないことを確認。**配信 Worker は `git push` では反映されない**ので、`npx wrangler deploy` の要否も判断する（D1 のスキーマ変更は migration の適用と同じ作業でまとめる） |
| 文書 | 影響する `docs/`、README、AGENTS.md、CLAUDE.md の更新要否を確認 |

## 文書の保守

コード、データ、設定、運用手順を変えたら、同じ変更で説明を更新してください。実装と文書に違いを見つけた場合、現在のコード・データ・検証器を読み直し、意図を確認できない仕様変更は独断で行わないでください。

公開済み、実機確認済み、GitHub 設定済みといった外部状態は、確認日・環境・確認方法がなければ断定しません。詳細は [verification.md](verification.md) を参照してください。

