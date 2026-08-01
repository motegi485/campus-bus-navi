# campus-bus-navi バックエンド — 引き継ぎ（HANDOFF）

> **最終更新: 2026-08-02**
> このファイルは「今どうなっていて、次に何をするか」だけを書く。仕様の正本は
> **`BACKEND_REQUIREMENTS.md`（v1.6）** で、食い違う場合はそちらが優先。
> （2026-08-02 以前の本ファイルは着手前の引き継ぎメモだった。内容はすべて完了・陳腐化したため
> 書き換えた。旧版が必要なら git 履歴を参照。）

---

## 1. 結論から: 次にやること

**2026-08-23（オープンキャンパス）前後に、Bot を本番稼働させる。**
コードはすべて main にあり、動作検証も済んでいる。残っているのは **GitHub 側の設定 3 つと、初回実行の見届け**だけ。

所要はおよそ 30 分（うち大半は初回 PR のレビュー）。手順は §4。

---

## 2. 現在の状態（2026-08-02 時点）

| 項目 | 状態 |
|---|---|
| main | `ab00c4e`（Bot 一式・特別ダイヤ機構・お盆データを含む） |
| 本番サイト | https://campus-bus-navi.pages.dev/ — 上記が配信済み・確認済み |
| アプリバージョン | `1.1.0-beta` |
| Bot のコード | main にあり。テスト 109 件緑・型チェック通過 |
| ワークフロー | `.github/workflows/timetable-sync.yml` は main にあるが **手動で Disable 済み**（＝日次実行は起動しない） |
| `GEMINI_API_KEY`（Secrets） | **未登録** |
| Workflow permissions | **未設定**（"Allow GitHub Actions to create and approve pull requests" が無効） |
| `bot/state.json` | 2026-08-01 のローカル実走時点。`regular` / `vacations.summer` / `events["2026-08-23"]` を記録済み |

### なぜ止めてあるのか

Bot は 2026-08-01 にローカルで実走検証を終えたが、**日次自動実行はまだ様子を見たい**という運用判断で
sandbox に留めていた。その後、お盆ダイヤ（8/8〜）の対応を本番へ届ける必要が生じたため
**main へマージし、ワークフローだけを Disable する**形にした。
つまり「コードは本番、実行は保留」という状態。

### 手動で入れてあるデータ（Bot は触らない）

`public/data/calendar_rules.json` の 8/8〜8/16（9日分）は**人が手で入れた override** で、
Bot はこれを手動キーとして尊重し上書きしない（`calendar.ts` の手動不可侵ルール）。

| 日付 | 参照先 |
|---|---|
| 8/8〜8/11 | `timetable_vacation_obon`（画像から手動転記） |
| 8/12・8/16 | `timetable_special`（掲示に大学発しか書かれておらず時刻を確定できないため） |
| 8/13〜8/15 | `timetable_closed`（全便運休） |

**8/17 以降が過ぎたら、この 9 日分の override と `timetable_vacation_obon.json` は不要になる。**
消すかどうかは任意（手動キーなので放置しても Bot は困らない）。消す場合は人が手で消す。

---

## 3. 予備知識（実測で分かっていること）

初見でつまずきやすい点だけ。詳細は要件定義書。

- **GitHub Actions の `schedule` / `workflow_dispatch` はデフォルトブランチにワークフローがある場合のみ動く。** これは既に満たしている（main にある）。今止まっているのは手動 Disable のため。
- **Gemini 無料枠の RPD（1日あたり）が小さい。** 実測で `gemini-3.5-flash` は 20。リトライも枠を消費する。リセットは太平洋時間の深夜＝**JST 16:00**。枠はモデル別。
- **枠を使わずに計画だけ見たいときは `SKIP_OCR=1`。** `DRY_RUN=1` と併用すれば副作用ゼロで挙動を確認できる。
- **`GEMINI_API_KEY` はローカルでは `bot/.env.local`（git 管理外）。** 中身を読み上げ・出力しない。
- **JSON 整形はハウススタイルを維持する**（`bus_stop_coords` と schedule 各要素は1行）。素の `JSON.stringify(_, null, 2)` にすると Bot が触った全ファイルが全行差分になり、本システムの中核である PR レビューが機能しなくなる。`bot/test/files.test.ts` が byte 一致を固定しているので、壊すとテストが落ちる。
- **読めない掲示は特別ダイヤで塗り潰される。** `needs_review` のうち期間の両端が読めているものは、その期間に `timetable_special` の override が自動で張られる。PR を見落としても誤った時刻を出さないための保険。人が後から個別の override に精緻化できる（手動が最優先）。

---

## 4. 本番稼働の手順（8/23 前後）

### 事前（人間・GitHub の Web UI）

1. **Secrets 登録** — `Settings → Secrets and variables → Actions → New repository secret`
   - Name: `GEMINI_API_KEY`
   - Value: Google AI Studio で発行した鍵
   - ※ 2026-08-01 に発行した鍵をローカルで使っている。**ここで新しい鍵を発行して差し替え、旧鍵を AI Studio で削除するのが衛生的**（無料枠キーなので緊急性は無いが、ついでに済ませられる）
2. **PR 作成権限** — `Settings → Actions → General → Workflow permissions`
   - 「Read and write permissions」を選択
   - 「Allow GitHub Actions to create and approve pull requests」にチェック
   - **未設定だと `create-pull-request` が必ず失敗する**（初回でここに引っかかるのが定番）
3. **ワークフローを再有効化** — `Actions → timetable-sync → 右上「…」→ Enable workflow`

### 初回実行（人間）

4. **まずドライラン** — `Actions → timetable-sync → Run workflow → dry_run: true → Run`
   - PR は作られない。ログに変更計画（JSON）が出る
   - 見るところ: リンクが 4 件前後正しく分類されているか／`decisions` に想定外の `ocr` が無いか／`warnings` に見慣れないものが無いか
5. **本番実行** — `Run workflow → dry_run: false → Run`
   - `bot/timetable-sync` ブランチに PR が立つ
6. **PR をレビューしてマージ**
   - PR 本文の「⚠ 要手動確認」を必ず読む
   - 時刻表の差分は**元画像と突き合わせて確認する**（PR 本文に画像リンクがある）
   - JR 松永駅の時刻が混入していないか（通常ダイヤ画像は JR 列が同居している）
7. **デプロイ確認** — マージ後 1〜2 分で Cloudflare Pages が反映する
   ```powershell
   $j = (Invoke-WebRequest "https://campus-bus-navi.pages.dev/data/calendar_rules.json" -UseBasicParsing).Content | ConvertFrom-Json
   $j.overrides.PSObject.Properties.Name | Where-Object { $_ -like '2026-*' }
   ```

### 見届け（8/24 以降）

8. **イベントのライフサイクル確認（AC-7・唯一の未検証項目）**
   - 8/23 が過去日になると、翌日の実行で `timetable_event_20260823.json` の**削除**と
     `overrides["2026-08-23"]` の**除去**が計画されるはず
   - 8/24 以降の PR にこれが現れれば、Bot の一巡（追加 → 適用 → 自動クリーンアップ）が実証される
9. **数日〜1週間、日次実行を観察** — 掲示に変化が無ければ PR は立たない（差分ゼロなら PR は作られない）のが正常

---

## 5. 動かなかったときの切り分け

| 症状 | 原因の第一候補 |
|---|---|
| `create-pull-request` で失敗 | 手順 2 の PR 作成権限が未設定 |
| ジョブが「GEMINI_API_KEY が設定されていません」で落ちる | 手順 1 の Secrets 未登録（かつ新規/変更画像があった） |
| 429 が連続して読み取れない | 無料枠 RPD 枯渇。JST 16:00 のリセットを待つ。`SKIP_OCR=1` なら枠を使わず計画だけ見られる |
| 503 が続く | Gemini 側の高負荷。一時障害リトライ（5/15/45秒）→ フォールバックモデル切替が入る。それでも駄目なら翌日 |
| 毎日 PR が立ち続ける | 掲示が変わっていないのに state が書き換わっている疑い。`bot/state.json` の差分を見る |
| PR の差分が全行置換になっている | JSON 整形のハウススタイルが壊れている（§3 参照）。`bot/test/files.test.ts` が落ちているはず |

### ローカルでの再現

```powershell
cd bot
npm install
npx vitest run                        # テスト 109 件
npx tsc --noEmit                      # 型チェック
$env:DRY_RUN="1"; $env:SKIP_OCR="1"   # 無料枠を使わず計画だけ出力
npx tsx src/index.ts
```

実 OCR を伴う確認は `bot/.env.local` に `GEMINI_API_KEY` を置いてから `SKIP_OCR` を外す。
`DRY_RUN` を外すと **`public/data/` を実際に書き換える**ので、その前に必ず `git status` で作業ツリーが
きれいなことを確認する（巻き戻せるように）。

---

## 6. 参照先

| 知りたいこと | ファイル |
|---|---|
| 仕様の正本（FR・AC・state スキーマ・優先順位） | `bot/fixtures/_planning/BACKEND_REQUIREMENTS.md`（v1.6） |
| 残タスクの一覧 | 同 §17.2 |
| リポジトリ全体の設計判断 | ルートの `CLAUDE.md`（Codex 用は `AGENTS.md`。内容は同一） |
| 運用者向けの手順（ダイヤ改正・お知らせ追加） | ルートの `README.md` §3 |
| 実装コード | `bot/src/`（オーケストレータは `index.ts`、純粋な計画部分は `plan.ts`） |

---

## 7. 用語の対応（コードを読むとき）

| 用語 | 意味 |
|---|---|
| `regular` | 通年の通常ダイヤ（授業日／休業日の2ファイルを生成） |
| `vacation` | 長期休暇ダイヤ（期間 override つき。平日／休日の2ファイル） |
| `event` | 単日イベントダイヤ（`timetable_event_YYYYMMDD`） |
| `needs_review` | 分類できなかった掲示。時刻は取り込まない。期間が読めれば特別ダイヤで塗り潰す |
| 管理 override | Bot が張り、`state.managed_overrides` に記録したキー。Bot が自分で消せる |
| 手動 override | 上記以外。**Bot は絶対に触らない** |
| 抑止（suppressed） | 管理 override を人が消した／変えた日付。以後 Bot は再生成しない |
