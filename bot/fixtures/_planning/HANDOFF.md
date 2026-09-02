# campus-bus-navi バックエンド — 引き継ぎ（HANDOFF）

> **最終更新: 2026-09-02**
>
> このファイルは「現在の確認境界」と「次に人間が行う作業」を記録する。Bot の要件・安全境界の正本は **`BACKEND_REQUIREMENTS.md`（版番号は同ファイル冒頭で確認する）**、リポジトリ全体の案内は `docs/README.md`、Bot の入口は `docs/backend-bot.md` である。
>
> **2026-09-01 に確認: ワークフローは GitHub 上で有効化済みで、稼働中である。** 毎日 `main` へ `bot: 時刻表データの自動更新` コミットが積まれている（2026-08-19 以降、日次で確認できる）。以前のこの文書は「本番稼働前の未実施チェックリスト」として書かれていたが、その前提はもう成り立たない。§3 の手順は完了済みの記録として読むこと。
>
> とはいえ GitHub Actions の有効状態、Secrets、Workflow permissions、**`main` の実 SHA**、メール送信の到達状況はリポジトリ外の状態である。この文書の記録だけで現在値を断定せず、疑わしいときは GitHub UI で再確認する。
>
> ⚠️ **作業用チェックアウトの `main` は live の `main` と一致しているとは限らない。** 2026-08-17 時点で、ローカルの `main` は作業ブランチより 37 コミット古かった。「main 統合済み」と書かれた記録があっても、それはその時点の推定であって現在の事実ではない。

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
| テスト | ローカルで `npx vitest run` 184 件と `npx tsc --noEmit` が通ることを 2026-08-18 に確認した |

### 2026-08-18 の変更（公開前レビューの反映）

要件定義 v1.10 の変更点を実装しました。運用に関わるのは次の 4 点です。

- **`main` 以外の ref では実行できません**（`dry_run` を除く）。ブランチで試すときは `dry_run` を有効にしてください。
- **毎月 1 日は変更が無くても稼働確認メールが届きます。** 2 か月続けて届かなければ Actions の有効状態を確認してください。
- **通常ダイヤのリンクが消えた日は必ずメールが届きます**（以前は他に差分が無いと届きませんでした）。
- **取り消し手順が変わりました。** revert だけでは翌日また同じ内容が反映されます（下の切り分け表を参照）。

**2026-09-01 の追記: 下記は本来「この文書だけから確認できない状態」として書かれていたが、
その後の運用で次が確認できている。**

- workflow は GitHub 上で有効 — **確認済み**（`main` への日次コミットが継続している）
- `GEMINI_API_KEY` / `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_TO` は登録済み — **確認済み**
- Workflow permissions は `main` への push を許可している — **確認済み**（push が成功している）
- Actions の実行結果、コミット — **確認済み**（`git log` で日次コミットを直接確認できる）
- メール到達 — **確認済み**（運用者が受信を確認）
- Cloudflare Pages への実反映 — **確認済み**（運用者が公開サイトで確認）
- **AC-7（イベントのライフサイクル）— 確認済み。** `2026-08-24` のコミットで、期限を過ぎた
  `2026-08-23` オープンキャンパスの override とファイル（`timetable_event_20260823.json`）が
  自動撤去されているのを `git show` で直接確認した。
- **AC-4（日次の不要メール）— 2026-09-02 に原因を特定し、リポジトリ内の修正とローカル検証を実施。GitHub Actions 上は未確認。**
  `2026-08-19`〜`2026-09-01` の履歴では、時刻表ファイルが変わらない日も
  `public/data/calendar_rules.json` から前日までの管理 override が 1〜2 行ずつ剪定されていた。
  旧 `Detect diff` は `public/data/` 配下の全差分を `data_changed=true` としたため、これだけで
  「時刻表を更新しました」メールを送っていた。たとえば 2026-09-01 の実差分は、8月31日の
  vacation override 1件の削除と state の `checked_at` 更新だけで、時刻表ファイルは無変更だった。
- 修正後は、Bot が `calendar_cleanup_only=true` を出し、かつ実際の `public/data` 差分が
  `calendar_rules.json` だけの場合に限って更新メールを抑止する。時刻表ファイル・他の public データ・
  今日以降の override の変更、警告、失敗、月初 heartbeat は従来どおり通知する。
  剪定や `checked_at` の commit 自体は残り得る。
- ローカル検証は 2026-09-02 に実施し、Bot テスト 193 件、Bot 型検査、静的データ検証、
  ルートの本番ビルドがすべて合格した。実ネットワーク、OCR、秘密情報は使用していない。
- **次の人間確認**: この変更を `main` へ反映した後、時刻表の実変更も警告もない日の Actions ログで
  `Detect diff` に「過去日の override 剪定だけです。更新メールの対象外」と出て、
  `Send notification` が skipped、メールが届かないことを確認する。月初1日の heartbeat は例外。
  Secrets や Workflow permissions の変更は不要。

以下は当時「未実施」として書かれた本番稼働前チェックリストの原文（§3〜3.5）。現在はすべて完了済みの手順の記録として読む。

## 3. 本番稼働前に人間が行うこと（完了済み — 2026-09-01 時点で稼働中と確認）

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

- **AC-4**: 時刻表の実変更も警告もなく、過去日の override 剪定だけの日に更新メールが届かないこと。
  `checked_at` や剪定の commit は作られてよい。月初1日の heartbeat は例外。
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
| 反映された内容が間違っている | メール末尾の「取り消したいとき」。**revert だけでは翌日また同じ内容が反映される**ので、止めるなら手動 `timetable_special` override を張るか Actions で Disable する。`bot/state.json` のキー削除は「読み直させる」操作であって停止手段ではない |
| `fetch_budget_exhausted` | 取得の締切（8 分）か件数上限（24 件）に達した。既存データは維持され翌日再試行。連日続くなら掲載リンク数と配信ホストの応答を確認 |
| `image_revalidate_failed` | 同一 URL の画像が差し替わっていないか確認できなかった。`info` のうちは一時障害、`warn`（21 日以上未確認）なら配信ホストの変更や恒久障害を疑う |
| `holiday_csv_suspicious` | 祝日 CSV が痩せすぎていて採用しなかった（既存キャッシュを維持）。内閣府 CSV の配信状況を確認 |
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
