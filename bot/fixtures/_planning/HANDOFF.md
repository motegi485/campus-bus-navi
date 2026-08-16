# campus-bus-navi バックエンド — 引き継ぎ（HANDOFF）

> **最終更新: 2026-08-16**
>
> このファイルは「現在の確認境界」と「次に人間が行う作業」を記録する。Bot の要件・安全境界の正本は **`BACKEND_REQUIREMENTS.md`（v1.9）**、リポジトリ全体の案内は `docs/README.md`、Bot の入口は `docs/backend-bot.md` である。
>
> GitHub Actions の有効状態、Secrets、Workflow permissions、実際のコミット・メール送信・本番反映はリポジトリ外の状態である。過去の記録だけで現在値を断定せず、稼働前に GitHub UI で再確認する。

---

## 0. 2026-08-16 の方針転換（先に読むこと）

**「Bot が PR を作り、人間がレビューしてマージする」という人間ゲートは廃止された。**
現在の設計は次のとおり（ユーザー決定・要件定義 §1.1 が正本）。

- 取得から本番反映（`main` への直接コミット）までを自動で行う。
- **変更・要手動確認・失敗があった実行だけ、結果をメールで通知する。**
- メールを見て問題がなければ、人間は何もしなくてよい。
- 問題があれば、メール末尾の「取り消したいとき」に従って巻き戻す。

2026-08-13 以前のこの文書には「初回 PR をレビューしてマージする」という手順が書かれていたが、
それは現在の設計ではない。

## 1. 引継ぎ時の読み順

1. `docs/backend-bot.md` で役割と安全境界を確認する。
2. `BACKEND_REQUIREMENTS.md` の該当する FR / NFR / AC を読む。要件の正本はこのファイルである。
   自動適用と通知の仕様は **FR-11**、人間タスクは **§16.3**、導入手順は **§17.4**。
3. `bot/src/` とテストを読む。書込制限は `files.ts`、override の優先順位は `calendar.ts`、
   計画は `plan.ts`、実行順は `index.ts`、通知本文は `report.ts` にある。
4. 適用と通知の配線は `.github/workflows/timetable-sync.yml` を読む（Bot 本体は commit も push もしない）。
5. GitHub Actions を扱う場合だけ、下記の外部状態を GitHub UI で確認してから作業する。

## 2. 確認済みのリポジトリ内状態（2026-08-16）

| 項目 | 確認内容 |
|---|---|
| Bot 実装 | `bot/` に独立した Node.js パッケージ、テスト、state、設定がある |
| ワークフロー定義 | `.github/workflows/timetable-sync.yml` がある。Node.js 22、`npm ci`、full SHA 固定の action、資格情報を残さない checkout、適用前検証、対象パス限定の差分検出と commit/push、条件付きメール送信、失敗時の成果物保存を定義する |
| 静的データ | `calendar_rules.json` と時刻表ファイルがある。`closed` / `special` は Bot の保護対象 |
| Bot state | `regular`、`vacations.summer`、`events[2026-08-23]` などの管理情報を持つ |
| テスト | ローカルで `npx vitest run` 156 件と `npx tsc --noEmit` が通ることを 2026-08-16 に確認した |

次はこの文書だけから**現在確認できない**状態です。

- workflow が GitHub 上で有効か
- `GEMINI_API_KEY` が GitHub Secrets に登録済みか
- `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_TO` が登録済みか
- Workflow permissions が `main` への push を許可しているか
- Actions の実行結果、コミット、メール到達、Cloudflare Pages 反映

**自動適用と通知は GitHub 上で 1 度も動かしていません。** 未検証の受け入れ基準は
**AC-4（変更が無い日に何も起きない）・AC-7（イベントのライフサイクル）・AC-8（通知）** です。

## 3. 本番稼働前に人間が行うこと

> 所要 15〜20 分。**順序に依存があります。** 3 の Secrets 登録より前に workflow を Enable すると、
> 適用は走るのに通知が届かない状態になるので、順番どおりに行ってください。

### 3.1 Gmail のアプリパスワードを発行する（H-9）

アプリパスワードは 2 段階認証が有効な Google アカウントでしか作れません。

1. <https://myaccount.google.com/security> を開く。
2. 「2 段階認証プロセス」がオフなら、先に有効化する。
3. <https://myaccount.google.com/apppasswords> を開く。
   「利用できません」と出る場合は 2 段階認証がまだ反映されていないので、数分待つか再ログインする。
4. アプリ名に `campus-bus-navi` と入力して「作成」。
5. 表示される 16 桁（4 文字 × 4 ブロック）を控える。**閉じると二度と表示されません。**
   登録するときは**スペースを取り除いた 16 文字**にする。

鍵と同様、この値を会話・ログ・リポジトリへ出さないこと。

### 3.2 Secrets を登録する（H-2 / H-9）

`Settings → Secrets and variables → Actions → New repository secret` で 4 件登録する。
いずれも Repository secret（Environment secret ではない）。

| Name | 値 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio で発行済みの Gemini API キー |
| `MAIL_USERNAME` | 送信元の Gmail アドレス |
| `MAIL_PASSWORD` | 3.1 の 16 文字（スペースなし） |
| `MAIL_TO` | 通知の宛先。カンマ区切りで複数可 |

### 3.3 Workflow permissions を書き込み可にする（H-3'）

`Settings → Actions → General → Workflow permissions`

1. **「Read and write permissions」を選択**する（`main` へ push するため）。
2. **「Allow GitHub Actions to create and approve pull requests」は不要**（PR を作らなくなった）。
3. Save。

### 3.4 ワークフローを有効化して段階的に実行する

`Actions → timetable-sync`

1. 「This workflow was disabled manually」のバナーから **Enable workflow**。
2. **Run workflow → `dry_run` にチェックを入れて実行**。
   `Run sync` のログと Step Summary で、リンク分類・変更計画・警告を確認する。
   この実行ではファイルは変わらず、メールも飛ばない。
3. **Run workflow → `dry_run` のチェックを外して実行**。
   - `main` に `bot: 時刻表データの自動更新 (YYYY-MM-DD)` のコミットが増えることを確認する。
   - **メールが届くことを確認する（AC-8）。** 初回は迷惑メールに入りやすいので、
     届かなければ必ずスパムフォルダを見て「迷惑メールではない」に指定する。
4. Cloudflare Pages のデプロイ履歴と実機で反映を確認する（H-6）。
5. 以後は毎日 07:00 JST に自動実行される（GitHub の cron は遅延し得る）。

### 3.5 数日かけて観測する

- **AC-4**: 変更が無い日にコミットもメールも発生しないこと。
- **AC-7**: `bot/state.json` に登録済みの 2026-08-23 オープンキャンパスについて、
  適用日経過後（8/24 以降の実行）に override と `timetable_event_20260823.json` が
  自動削除され、その旨のメールが届くこと。
- **H-8**: AI Studio で `gemini-3.6-flash` の無料枠実値を確認し、必要なら
  `geminiMinIntervalMs` / `geminiMaxCallsPerRun` を調整する。

ワークフローを有効にする前に、運用者が Bot の書込対象、特別ダイヤのフェイルセーフ、
そして**誤りが公開されてから気づく設計になったこと**（要件定義 §15-1）を理解していることを確認してください。

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

リポジトリ側の検証器（ワークフローが適用前に通すものと同じ）は直下で実行します。

```powershell
Set-Location ..
node scripts/validate-data.mjs
```

`DRY_RUN` を外すと、`public/data/`、`bot/state.json`、`bot/holidays.json` などへ差分を出す可能性があります。`SKIP_OCR` を外すと、ローカルの `bot/.env.local` を使う外部 API 呼び出しが発生します。実行前に作業ツリーの状態、対象データ、確認手順を確認してください。**ローカル実行は commit も push もしません**（それはワークフローのステップです）。

## 5. 主な切り分け

| 症状 | 最初に確認すること |
|---|---|
| `Commit and push` が失敗 | Workflow permissions が Read and write か。ログに push 拒否とリベース再試行が出ていないか |
| `Validate data` が失敗 | `node scripts/validate-data.mjs` をローカルで再現。**この場合コミットはされていない**ので本番は無傷 |
| 鍵が未設定で失敗 | Secrets と、OCR 対象があるか |
| 429 / 503 | Gemini の利用枠・一時障害。`SKIP_OCR=1` の計画確認へ戻る |
| `link_host_not_allowed` / `image_fetch_failed` | 大学側の配信ホスト変更。allowlist と実 URL |
| メールが届かない | 迷惑メールフォルダ → `MAIL_*` 3 件の値（アプリパスワードは 16 文字・スペースなし）→ `Send notification` ステップのログ。送信失敗はジョブを赤くする |
| 変更したのにメールが来ない | 差分が `public/data/` ではなく `state.json` / `holidays.json` だけの可能性（設計どおり送らない）。`Detect diff` の出力を見る |
| 長期間メールが来ない | 変更が無ければ正常。ただし **60 日コミットが無いと GitHub が cron を自動 Disable する**ので Actions 画面を確認する |
| 便数が変わらないのに取り込まれない | 便数 ±50% ガード（FR-8）で止まっている可能性。メールの「要手動確認」を読む。正しい改正なら `bot/state.json` の該当キーを消して再実行 |
| 反映された内容が間違っている | メール末尾の「取り消したいとき」。revert だけでは翌日また取得されるので `bot/state.json` の該当キーも消す |
| `run_deadline_exceeded` | OCR が締切に達した。画像数・応答遅延・設定を要件に照らして確認 |
| コミットが全行置換 | JSON ハウススタイルまたは `files.ts` の整形保持を確認 |

## 6. 参照先

| 知りたいこと | ファイル |
|---|---|
| Bot の要件、優先順位、受け入れ基準 | `bot/fixtures/_planning/BACKEND_REQUIREMENTS.md` |
| Bot の構成と安全境界 | `docs/backend-bot.md` |
| 全体アーキテクチャ・データ・PWA | `docs/architecture.md`、`docs/data-model-and-operations.md`、`docs/pwa-and-deployment.md` |
| 検証 | `docs/verification.md` |
| 実装 | `bot/src/` と `bot/test/` |
| 適用と通知の配線 | `.github/workflows/timetable-sync.yml` |
