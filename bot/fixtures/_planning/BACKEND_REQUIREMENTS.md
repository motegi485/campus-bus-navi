# campus-bus-navi バックエンド（時刻表自動取り込みBot）要件定義書

| 項目 | 内容 |
|---|---|
| 文書バージョン | 1.10（公開前レビュー指摘の反映・見逃しと予算の上限化） |
| v1.10 変更点 | 2026-08-18、Codex による公開前システムレビュー（`_codexReview/CODEX_REVIEW_2026-08-17.md`）で妥当と判定した指摘を実装に反映。**FR-2**: 画像拡張子の判定を URL 全体末尾から **URL の `pathname`** へ（`.jpg?v=2` / `.png#x` の無警告の取りこぼしを解消）／6(b) の `regular_link_missing` を **`info` から `warn` へ格上げ**（他に差分が無い日でも必ずメールに載る。「書かなかった判断も通知」との整合）。**FR-4**: 「URL 同一 → スキップ」を **「URL 同一 → 条件付き再検証つきスキップ」** へ変更。`ETag` / `Last-Modified` があれば毎回の条件付き GET、無ければ最後に内容確認できた日から `imageRevalidateIntervalDays`（7 日）以上経過したときに再取得して SHA-256 比較。確認できなかった実行は「変化なし」と断定せず記録し、`imageRecheckStaleDays`（21 日）を超えたら warn へ格上げ。これで「同一 URL のまま画像が差し替わる」見逃し期間の上限が無限から有限になる。**FR-5**: 原寸 URL の判定も `pathname` に対して行う。**FR-10**: 祝日 CSV に健全性検査（実在日・日付重複なし・昇順整列）と、既存キャッシュ比の急減ガード（`holidayMinRatioVsCache` = 0.7、キャッシュが無いときは `holidayMinRowsWithoutCache` = 100 件）を追加。途中で切れた HTTP 200 応答を正規のキャッシュとして採用しない。**FR-11**: 取り消し手順の自己矛盾を解消（後述）。レポートの Markdown を用途別にエスケープ（テーブルセルの `|`、リンクテキストの `[]`、リンク URL の括弧・空白）。**§7.2**: `fetchDeadlineMs`（8 分）・`maxImageFetchesPerRun`（24）・`geminiMaxCallsPerDay`（18）・`imageRevalidateIntervalDays`・`imageRecheckStaleDays`・祝日しきい値を追加。取得フェーズにも締切と件数上限を課し、超えた分は黙って切らず warn に落として翌日再試行する。**§9**: state の各エントリに `etag` / `last_modified` / `checked_at`（いずれも任意）、ルートに `ocr_usage`（日次の Gemini 呼び出し回数）を追加。**§10**: `main` 以外の ref での実行を先頭ステップで fail-closed に拒否（`HEAD:main` を push するため、別 ref だとその ref の既存コミットまで運んでしまう）／rebase 後は組み合わせ後のツリーでデータ検証と変更範囲検査をやり直してから push ／毎月 1 日は変更が無くても稼働確認メールを送る（`heartbeat`）。**§14**: 誤反映の巻き戻し手順を「再公開を止める手順」と「読み直させる手順」に分離 |
| v1.9 変更点 | 2026-08-16、**「Bot が PR を作り人間がレビューしてマージする」という人間ゲートを廃止し、取得から本番反映までを自動化した**（ユーザー決定）。反映の遅れと「PR を放置すると古いダイヤが出続ける」状態を解消するのが目的。**§1.1 / §1.3 / §1.4-3**: 反映は `main` への直接コミットになり、人間の役割は「事後にメールを見る」へ移る。**FR-11**: 「PR 作成」を「自動適用と通知」へ全面改稿。`bot/src/report.ts` は `report.ts` に改名し、出力は `bot/.out/report.md`。PR の diff が無くなるため、**レポートに発車時刻そのもの（旧→新の追加・削除）を載せる**。**FR-8**: 便数 ±50% 超の変化を SHOULD 警告から **MUST エラー（そのファイルを書かない）** へ格上げ（PR レビューという第 3 層の代替）。**§10**: `create-pull-request` を廃し、適用前の `node scripts/validate-data.mjs`・対象パス限定の差分検出・`main` への push・条件付きメール送信に置き換え。`permissions` は `contents: write` のみ。**index.ts**: 「警告あり かつ 差分ゼロで `exitCode = 1`」を廃止（通知メールが入り前提が消えたため）。**§12.3**: AC-4 を「既存 PR の更新」から「差分ゼロの日に何も起きない」へ差し替え、通知の AC-8 を追加。**§16.3**: H-3 の PR 作成許可は不要になり、H-5 は「PR レビュー」から「メール確認」へ。メール用 Secrets（`MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_TO`）を H-9 として追加 |
| v1.8 変更点 | 2026-08-13、実行可能な `.github/workflows/timetable-sync.yml` と §10 の記載を照合し、action の full commit SHA、`checkout` の `persist-credentials: false`、失敗時の `bot/.out/**` 成果物保存を実装と一致させた。PR タイトルは日付付きではなく固定文字列であることを明記。実行済みテスト・GitHub Actions の有効状態・Secrets・権限を「文書上の過去記録」と「GitHub UI で再確認が必要な外部状態」に分離し、AC-4 と AC-7 が未検証であることを明確化。詳細な全体設計は `docs/` から参照する。 |
| v1.7 変更点 | 2026-08-08、Codex による公開前システムレビュー（`_codexReview/CODEX_REVIEW_2026-08-08.md`）で妥当と判定した指摘を実装に反映。**FR-3**: 日付は `time.ts` の `isRealDate()` で実在検証し、非実在日・逆転期間（start > end）の掲示は**期間を残さず** `needs_review`（特別ダイヤの塗り潰しもしない）／年を推定した日付（`yearGuessed`）を レポートの専用節と Step Summary に出す。**FR-4**: 掲載から消えた未来イベントを `state.events[].missing_count` で数え、`CONFIG.eventMissingRunsBeforeRemoval`（3 回連続）で state・override・event ファイルを撤去する（`plan.ts` の `reconcileEvents`）。ページから時刻表リンクを 1 件も抽出できなかった実行は数えない／同一 URL で event の日付が増減したときに、追加日の `timetable_event_YYYYMMDD` を既存 derived から複製し、外れた日のファイルを撤去する（`syncEventFiles`）。**FR-5 / NFR-8**: 取得先を `url.ts` の allowlist（https のみ・資格情報付き不可・IP リテラル不可・許可ホストのみ）で制限し、リダイレクトは自前で追って各ホップで再検証。応答サイズは Content-Length 事前判定とストリーム上限で頭打ちにし、画像はマジックバイトで実体を確認（§7.2 に `allowed*HostSuffixes`・`maxPageBytes`・`maxCsvBytes`・`maxRedirects` 追加）。**FR-10**: 祝日キャッシュに鮮度（`holidayCacheMaxAgeDays`）と将来カバレッジ（`holidayCoverageMinDays`）の警告を追加。**FR-11/§10**: `level: 'warn'` があるのにリポジトリ差分が 0 の実行は `process.exitCode = 1` で失敗させ、`bot/.out/**` を `if: always()` で成果物に残す（PR も通知も残らないサイレント失敗の解消）／1 実行の締切 `runDeadlineMs`（15 分）を追加し、OCR のリトライがワークフローの `timeout-minutes: 20` を越えないようにする／workflow の action を full commit SHA で固定し、checkout を `persist-credentials: false` にした。**§9**: `state.events[].missing_count` を追加 |
| v1.6 変更点 | 2026-08-02、既定のフォーマットで表現できないダイヤ（お盆期間のように運休日と通常日が混在し、「大学発のみ最終便が変わる」等の但し書きを含むもの）への対処として **特別ダイヤ `timetable_special`** を新設：**§3.4** に `special` と無印 `vacation` を追加（判定順序 `closed → special → event → vacation → holiday → weekday`）／**FR-3** の needs_review に「期間の両端が読めていれば `start`/`end` を残す」を追加／**FR-9 の優先順位を 手動 > special > event > 長期休暇 > 祝日 > default_rules に変更**し、needs_review の期間を `timetable_special` で塗り潰す手順 3a を追加（PR を見落としても誤った時刻を表示しないフェイルセーフ）／FR-9 の改ざん検査で「値が**変更**された」場合も `suppressed_overrides` に記録するよう変更（同じ衝突警告が毎実行 PR に出続けるのを防ぐ）／**§9 に `specials`** 追加／§7.2 に `specialTimetableId`・`specialMaxRangeDays` 追加 |
| v1.5 変更点 | 2026-08-01 に Phase 0〜1 を実装し、実 API で通し検証した結果を反映：**§5/§7.2 モデル変更**（primary `gemini-3.6-flash` / fallback `gemini-3.5-flash`）／**§7.2 vacation 判定を季節接頭辞つき正規表現へ**（「夏季休業」に対応）／**§8.5.3 OCR プロンプトをレイアウト非依存に全面改稿**＋注記除外・label 規則追加／**§8.5.5 に 503 等の一時障害リトライ・RPD 枯渇の扱い・1実行あたり呼び出し上限**を追加（無料枠 RPD=20 の実測値）／**§3.5 JSON 整形をハウススタイル維持に**／**§9 に `suppressed_overrides`** 追加／FR-10 を「CSV の SHA-256 が変わったときだけ書き換え」に（冪等性）／FR-7 に「label が日付だけのときのフォールバック」追加／§7.1 に `time.ts`・`plan.ts`・`env.ts`・`tools/ocr-check.ts` 追加／§7.3 に `SKIP_OCR`・`.env.local`／§12 の fixtures 供給元と AC を実態へ更新／§4.3 の画像レイアウト記述を実測で訂正 |
| v1.1 変更点 | §3.1 SW プレキャッシュ挙動の正確化／§3.3 旧スナップショット混在の明記／§7.1 lockfile コミット必須／§7.4 テンプレ実名の確定／FR-9 手動キー欠損の情報警告追加／§15-6 追加 |
| v1.2 変更点 | §16（実装・導入の役割分担：Claude Code / 人間の分界と画像由来 fixtures の供給元）・§17（導入シーケンス）を追加 |
| v1.3 変更点 | ライブからイベント画像が削除された事実を反映：§12.1（page_snapshot は歴史的スナップショット・images/ 追加）・§12.3（実環境AC を「通常ダイヤのみ」に再構成、イベント経路はユニットテストへ、AC-7 追加） |
| v1.4 変更点 | 2026-07-07 の実地検証を反映：§3.1 プレキャッシュ記述の訂正（データJSONは globIgnores で除外済・NetworkFirst 3秒）／§3.4 に closed 追加／§4 命名非依存原則・画像レイアウト2種・除外根拠訂正・robots.txt／FR-2〜FR-5・FR-7・FR-9 の規則追加（空白許容日付パース・未来 start の regular 保留・過去 event スキップ・「日付ちょうど1つ」規則・event name 生成元確定・警告2種）／§7 保護ファイルの実態反映（テンプレは _examples/ へ移動済み・timetable_closed.json 明記）／§9 state スキーマ統一／§12 AC 再構成（AC-7 は 2026-07-18 で実走可）／§15-6・C-8 削除／§16-17 役割分担更新（fixtures 配置は C-10 化、_reviewRSD 削除前に複製必須） |
| 作成日 | 2026-06-13 |
| 位置づけ | **Bot の要件・安全境界の正本（SSoT）**。他の資料（`HANDOFF.md`、`docs/backend-bot.md`、ルートの `CLAUDE.md` / `AGENTS.md`、`README.md`）と矛盾する場合は本書が優先する。実行可能なワークフローの行単位の設定は `.github/workflows/timetable-sync.yml` を確認する。※ v1.4 まで併記していた `BACKEND_DESIGN.md`（v2ドラフト）は本書へ統合済みで、リポジトリには存在しない |
| 実装者 | Claude Code（本書を実装指示書として渡す） |
| 確認境界（v1.9） | v1.9 のコード変更は 2026-08-16 にローカルでテスト 156 件・`tsc --noEmit` の合格を確認した。**GitHub Actions 上での実走は未検証**（自動適用・メール送信とも 1 度も動かしていない）。workflow の有効状態、Secrets、Workflow permissions、Cloudflare Pages の反映は外部状態であり、稼働前に GitHub UI で再確認する。**未検証の受け入れ基準は AC-4 / AC-7 / AC-8。** |
| 確認境界（v1.10） | v1.10 のコード変更は 2026-08-18 にローカルで確認した。Bot のテスト 184 件・`tsc --noEmit`・`node scripts/validate-data.mjs`・ルートの `npm run build`・`server` のテストと typecheck がすべて合格。**GitHub Actions 上での実走は引き続き未検証。** |
| 実装状況（2026-08-18） | **ワークフローは Disable 中である想定。** v1.9 / v1.10 の改修はこのチェックアウト上で完了し、テストは緑。⚠️ **「main に統合済み」かどうかは、このリポジトリの中からは確認できない。** 作業用チェックアウトの追跡 ref は live の `main` と一致しているとは限らない（実際、2026-08-17 時点のローカル `main` は作業ブランチより 37 コミット古かった）。**公開・稼働の前に、GitHub UI か API で `main` の実 SHA とワークフローの内容・有効状態を確認すること。** **未了は人間側の外部設定（§16.3 の H-2 / H-3' / H-9）と初回実走**（§17.4・手順は `HANDOFF.md`）。 |
| 主要な訂正（v2ドラフトから） | ① SDKは `@google/genai`（旧 `@google/generative-ai` は使用禁止） ② Gemini 3系は **temperature を指定しない**（公式推奨。temp 0 指定は誤り） ③ `thinking_level` / `media_resolution` を使用 ④ create-pull-request は **v8** ⑤ 出力先は `public/data/timetables/` |

---

## 1. 目的とスコープ

### 1.1 目的
福山大学公式サイトに不定期掲載されるスクールバス時刻表画像を**日次で自動巡回**し、新規・変更を検知したら **Gemini API で画像→JSON 化**し、フロントエンド（campus-bus-navi PWA）が読む `public/data/` 配下のデータファイルを更新して、**`main` へ直接コミットし本番へ反映する**。**変更があった実行だけ、結果をメールで通知する。**

**【v1.9 で方針転換・2026-08-16 ユーザー決定】** v1.8 まではここが「Pull Request を自動作成し、main への直接 push は行わず、人（Nano）が PR をレビューしてマージする」だった。人間ゲートは誤読を止める最終防波堤として機能する一方、PR が放置されるとその間ずっと古いダイヤが利用者に出続けるという、目的に反する失敗の仕方をする。「自動システム」として成立させるため、**適用は自動・人間の確認は事後（メール）** に変えた。

人間ゲートを外す代わりに、次の層で誤りを抑える。

1. OCR の **2 回読み照合**（不一致なら 3 回目・多数決、それでも割れたら取り込まない）
2. 読めない掲示は**時刻を作らず** `timetable_special` で塗り潰す（フロントは時刻を出さず大学 HP へ誘導）
3. 書き込み前の zod 検証（FR-8）と、**便数 ±50% 超の変化での取り込み中止**（v1.9 で MUST へ格上げ）
4. コミット前の `node scripts/validate-data.mjs`（リポジトリ側の検証器を適用前に通す）
5. 通知メールに**発車時刻そのもの**と元画像リンクを載せ、事後の突き合わせを 1 通で完結させる（FR-11）

### 1.2 スコープ（v1 で全部実装する）
- 通常ダイヤ（授業日／休業日）の取り込み
- 長期休暇ダイヤ（春季・夏季・冬季 × 平日／休日）の取り込みと期間 override 生成
- イベントダイヤ（単日）の取り込みと override 生成
- 祝日の自動 override 生成（内閣府CSV由来）
- 期限切れデータのクリーンアップ
- 変更・警告・失敗をメールで通知（v1.9）
- ドライラン（変更計画のログ出力のみ）

### 1.3 スコープ外
- JR 松永駅の時刻表（画像内に同居するが**読み取らない**。将来拡張候補）
- フロントエンドコードの変更（`src/`、`vite.config.ts`、`index.html` 等には**一切触れない**）
- `news.json` の自動更新
- `main` 以外のブランチへの反映、リリース・タグ操作
- 利用者向けの通知（更新バナー・Web Push）。データのみの更新では出さない（§3.1）

### 1.4 大原則（違反禁止）
1. **無料運用**: GitHub Actions（公開リポジトリ）＋ Gemini API 無料枠のみ。
2. **キー非露出**: `GEMINI_API_KEY` とメール送信の資格情報は GitHub Secrets にのみ保管。クライアント・リポジトリ内ファイル・ログへ書かない。
3. **事後確認の担保（v1.9 で改訂）**: 反映は自動だが、**削除を含む全変更を必ず通知メールに載せる**。書かなかった・消さなかった判断（要手動確認）も同じメールに出す。「黙って反映する」「黙って止まる」のどちらも禁止。旧 v1.8 の「反映は必ず PR 経由」はこの項に置き換わった。
4. **手動データ不可侵**: Bot は自分が作ったデータ（state.json に記録された管理分）だけを変更・削除する。人が書いた override・ファイルには触れない。
5. **フロント契約の遵守**: §3 の既存契約（パス・スキーマ・命名・ID規約）を変更しない。

---

## 2. 用語

| 用語 | 意味 |
|---|---|
| regular | 通常ダイヤ。1画像に「授業日」「休業日」の2種別。適用は継続（開始日のみ、`～` 付き） |
| vacation | 長期休暇ダイヤ。1画像に「授業日（平日）」「休業日」相当の2種別。適用は期間（開始〜終了） |
| event | イベントダイヤ。1画像に1種別。適用は単日（複数日掲載の場合あり） |
| 中間構造 | OCR が返す「時×分」のグリッド表現（§8.5）。アプリ JSON への整形はコード側で行う |
| 管理 override | Bot が `calendar_rules.overrides` に書き込み、`state.managed_overrides` に記録したキー |
| 手動 override | 上記以外の overrides キー。**Bot は読み取り専用** |
| 保護ファイル | テンプレ用に置いてあるファイル（§7.4）。Bot は読み書き・削除を行わない |

---

## 3. 既存システムとの契約（フロントエンド側・固定インターフェース）

Bot はフロントを変更しない。以下はリポジトリの現状から確認済みの**前提契約**である。

### 3.1 データ配置とフェッチ
- 時刻表 JSON: `public/data/timetables/{id}.json`（フロントは `/data/timetables/{id}.json` をフェッチ）
- カレンダー: `public/data/calendar_rules.json`
- `_headers` により `/data/*.json` は `no-cache` 配信。SW は NetworkFirst（タイムアウト **3秒**、失敗時は `timetable-data` キャッシュの前回取得分にフォールバック。maxEntries 20 / 7日）。
- **データのみの変更では `package.json` の `version` を上げない**（ユーザー決定。precache のリビジョンはファイル内容ハッシュ由来であり、伝播に version は関与しない）。
- **【確認済みの付随挙動・2026-07-07 HEAD】** `vite.config.ts` の `globPatterns` は `json` を含むが、`globIgnores: ['data/**/*.json']` により **`/data/**` の JSON は SW プレキャッシュから除外されている**。したがって**データのみのマージでは precache manifest は変化せず、UpdateBanner（更新通知）は表示されない**。既存クライアントは次回起動時の NetworkFirst（通常起動・手動更新 `?t=` 付き・お知らせ取得のすべてがこの経路を通る）で新鮮なデータを取得し、取得済み分がオフライン用フォールバックになる。この挙動は `globIgnores` の除外設定に依存しており、フロント側でこれを外すと壊れる（`docs/pwa-and-deployment.md` にも明記あり）。Bot 側の対応は不要（マージ後に観測される正常挙動としてここに明記する）。

### 3.2 timetable JSON スキーマ（`src/types/timetable.d.ts` と一致させる）
```jsonc
{
  "id": "string",            // ファイル名（拡張子なし）と完全一致必須（DayBadge が依存）
  "name": "string",          // 表示名
  "routes": {
    "station_to_campus": {
      "origin": "松永発",
      "destination": "大学行き",
      "bus_stop_name": "松永 バス乗り場",
      "bus_stop_coords": { "lat": 34.45118558593484, "lng": 133.25675322125554 },
      "schedule": [ { "departure": "HH:mm", "note": "" | "最終" } ]
    },
    "campus_to_station": {
      "origin": "大学発",
      "destination": "松永行き",
      "bus_stop_name": "大学 バス乗り場",
      "bus_stop_coords": { "lat": 34.459281686471684, "lng": 133.23183492499786 },
      "schedule": [ ... ]
    }
  }
}
```

### 3.3 calendar_rules スキーマと解決規則
```jsonc
{
  "default_rules": { "0": "timetable_holiday", "1": "timetable_weekday", ... "6": "timetable_holiday" },
  "overrides": { "YYYY-MM-DD": "timetable_xxx" }
}
```
- `resolveCalendar()`: overrides（特定日）> default_rules（曜日 0=日〜6=土）。
- **リポジトリ HEAD の `public/data/calendar_rules.json` を常に正とする**。今回の照合で、プロジェクトナレッジ（repomix）には**新旧2世代のスナップショットが混在**していることを確認した。旧世代の overrides は旧命名 `timetable_spring_vac_hld_2026` / `timetable_spring_vac_wd_2026` を参照しており、これは現行の `vacation` 命名規約（§3.4）に違反する過去データである。実装・テストではナレッジ検索結果をそのまま信用せず、**必ずチェックアウトした HEAD のファイルを読む**こと。

### 3.4 ID 命名規約（DayBadge `resolveDiagramType()` が文字列包含で判定）
| 種別 | ID | 判定 |
|---|---|---|
| 授業日 | `timetable_weekday` | （他に該当なし）→ weekday |
| 休業日 | `timetable_holiday` | `holiday` を含む |
| 長期休暇（平日/休日の別なし） | `timetable_vacation_{季節等}` | `vacation` を含み `weekday`/`holiday` を含まない【v1.6】 |
| 長期休暇・平日 | `timetable_vacation_{season}_weekday` | `vacation` を含む（`holiday` 判定より先） |
| 長期休暇・休日 | `timetable_vacation_{season}_holiday` | `vacation` かつ `holiday` |
| イベント | `timetable_event_{YYYYMMDD}` | `event` を含む |
| 全便運休日 | timetable_closed | closed を含む（判定は最優先） |
| 特別ダイヤ | timetable_special | special を含む（closed の次）【v1.6】 |

- **`timetable_closed`（全便運休ダイヤ）と `timetable_special`（特別ダイヤ）は Bot の生成・更新・削除の対象外**。どちらも `schedule` を空配列にした手動運用の待機ファイルで、overrides から参照させて使う。**ただし `timetable_special` だけは Bot が override を張る対象になる**（FR-9 の 3a。ファイル自体は書かない）。判定順序は closed → special → event → vacation → holiday → weekday（`DayBadge.tsx` の実装と一致することを 2026-08-02 に確認済み）。
- 【v1.6】**特別ダイヤの意味**: 既定の timetable スキーマ（路線ごとの発車時刻の配列）で表現できないダイヤ。アプリは発車時刻を一切表示せず、大学の通学情報ページへのリンクを案内する。掲示に書かれていない側（多くは松永発）を推測で埋めると「行きはあるが帰りが無い」時刻を表示しかねないため、**推測するより出さない**という判断（2026-08-02 ユーザー決定）。無印 `vacation` は、お盆ダイヤのように平日・休日で表が分かれない単一表のための種別。
- `{season}` ∈ `spring` / `summer` / `winter`。**年を含めない**（季節ごとに上書き）。
- `{YYYYMMDD}` は**適用日**。1日1ダイヤなので一意（ユーザー決定）。
- **ID 文字列に `vac` 等の短縮形を使わない**（`vacation` 完全一致包含が必須）。

### 3.5 既存ファイルの更新ポリシー（ユーザー決定 C）
- **既存ファイルは `routes.*.schedule` 配列のみ置換**。`id`・`name`・`origin`・`destination`・`bus_stop_name`・`bus_stop_coords` その他のフィールドとキー順は保持する（`JSON.parse` → schedule のみ代入 → 再シリアライズ。JS のキー挿入順保持に依る）。
- 新規作成時のみ §8.6.4 の既定 `name` を設定する。
- **【v1.5 訂正】シリアライズは素の `JSON.stringify(obj, null, 2)` ではなく、既存ファイルのハウススタイルを再現する専用シリアライザ（`bot/src/files.ts`）を使う。**
  既存の `public/data/timetables/*.json` は `"bus_stop_coords": { "lat": …, "lng": … }` と
  `{ "departure": "08:00", "note": "" }` を**1行に収める**書式で書かれており、素の `JSON.stringify` を使うと
  Bot が触った全ファイルが全行書き換えになる。差分が「実際に変わった発車時刻の行だけ」になる形を正とする。
  **【v1.9 注記】** この規約は元々「人間の PR レビュー（H-5）を成立させるため」に置かれた。PR が無くなった
  現在も、コミット履歴から「いつ何時が変わったか」を追えること、`git revert` で狙った変更だけを
  戻せること（§14 の巻き戻し手順）が同じ理由で要るため、規約は据え置く。
  `bot/test/files.test.ts` が、既存の `timetable_weekday/holiday/closed.json`・`calendar_rules.json`・
  `_examples/` のテンプレートを parse → 再整形して **byte 一致**することを固定している。
  `calendar_rules.json` と `state.json` は素の2スペース整形、`holidays.json` は holidays 配列の各要素をインラインにする。

---

## 4. 情報源（大学サイト）の仕様

### 4.1 対象ページ
`https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/`（WordPress）。
- robots.txt（2026-07-07 確認）: `Disallow: /wp-admin/` のみで対象ページ・`/wp-content/uploads/` へのクロール制限なし、`Crawl-delay` 指定なし。NFR-8 の礼節（日次1回・変更分のみ DL）は引き続き遵守する。

### 4.2 時刻表リンクの構造（確認済み実例）
アナウンス用 `<div class="md-box">` 内に、行ごとに次の形で並ぶ:
```html
<p>　　2026年4月4日（土）～　通常授業日／休業日　<a href="...R8%E3%82%B9...jpg">時刻表はコチラ</a></p>
<p>　　2026年6月14日（日）　日商簿記検定試験日　<a href="...0614%E3%80%80%E7%B0%BF%E8%A8%98-724x1024.jpg">時刻表はコチラ</a></p>
```
- リンク数は **0〜N で変動**（通常1 + イベント0〜複数 + 長期休暇期は vacation リンク）。
- `<a href>` は **% エンコード**、ページ内 `<img src>` は生の日本語 — Bot はリンクのみ使用し、href は `decodeURIComponent` で正規化。
- イベント画像リンクは、リサイズ版（例 `0614　簿記-724x1024.jpg`＝ファイル名に全角空白を含む）の場合と、原寸直リンク（2026-07 ライブ実例: `0705.jpg`・`0718.jpg`）の場合の両方がある。**画像ファイル名の形式は時期により大きく変わるため、分類・判定にファイル名を一切使ってはならない（分類は lineText のみに依存する）**。リサイズサフィックスが存在する場合のみ FR-5 の原寸試行を行う。
- 同 `md-box_glow` 内の**2つ目の md-box** には乗り場写真・キャンパスマップ等の非時刻表画像が混在する。スナップショット実測では、通常・イベントの時刻表画像3枚は素の `<img>` だが、**乗り場写真（`busstop_matsunagastation.jpg`）とキャンパスマップ（`スクールバス用平面キャンパスマップ2025-scaled.jpg`）は `<a href="...jpg"><img></a>` の画像リンクになっている**。これらが抽出から除外される根拠は「アンカーテキストに『時刻表』を含まない」という FR-2 条件 (b) であり、「`<img>` を走査しないから」ではない点に注意（`a[href]` の走査には引っかかる）。
- 日付表記の揺れ: 凍結スナップショット（2026-05 時点）は「2026年4月4日（土）～」と空白なし・波ダッシュは U+FF5E（実測）。一方 2026-07 のライブでは「2026年 7月  5日（日）」のような**桁揃えの空白入り表記**が観測されている。FR-3 の日付正規表現は空白許容が必須。
- ライブ掲載は変動する（参考: 2026-07-07 時点は regular＋2026-07-05 ビジネス能力検定＋2026-07-18 オープンキャンパスの3リンク。6月のイベント2件は削除済み）。

### 4.3 画像の仕様（確認済み実例）
- regular 画像（`R8スクールバス時刻表.jpg`）: 上段「授業日」・下段「休業日」。各段にスクールバス（**時｜松永発｜時｜大学発** — 松永発と大学発が**それぞれ専用の「時」列を左隣に持つ**4列グループ）と **JR 松永駅時刻表（上り福山方面／下り尾道方面）が同居**。
- event 画像: 「松永発｜**時**｜大学発」の1テーブルのみ（1種別）。regular と異なり**中央の「時」列を両方向で共有**する。
- **【v1.5 訂正】vacation 画像のレイアウトは regular と同じとは限らない。** 2026-08-01 に実物（`0817-.jpg`・夏季休業 2026-08-17〜09-23）を確認したところ、
  **「松永発｜時｜大学発」の共有「時」列**（＝event と同じ形）で、しかも**「平日」と「土・日・祝」の2表が左右に並ぶ**横長レイアウトだった。JR 列は無い。
  v1.4 までの「vacation＝時｜松永発｜時｜大学発」という記述は誤り。
- したがって **表レイアウトは画像種別から決め打ちできない**。プロンプトは「列見出しを見て『時』列の位置を判断する」「複数種別は上下にも左右にも並ぶ」という**レイアウト非依存**の指示にすること（§8.5.3 規則3・4）。固定列マッピングを前提にした実装・プロンプトは誤抽出のもと。
- 表の中や周囲に注記が入ることがある（実例: `0808.jpg` のセル内に「8月12日（水）最終」「8月16日（日）始発」の矢印吹き出し）。これらは発車時刻ではないのでプロンプトで明示的に除外する（§8.5.3 規則6）。
- いずれも電子生成画像（Excel系）。セル内に2桁の「分」が横位置バラバラに 0 個以上並ぶ。
- **重大リスク**: JR 列の時刻もバスと同形式（`HH:mm` 相当）のため、取り違えはスキーマ検証で検出不能。OCR プロンプト（§8.5.3）と 2 回読み照合で防ぎ、通り抜けたぶんは便数 ±50% ガード（FR-8）と通知メールの発車時刻一覧（FR-11）で事後に見つける。**v1.8 まではここに「PR レビュー」を数えていた**（§15-1 も参照）。
- 画像には「最終」という文言は存在しない。最終便の `note: "最終"` は **Bot が付与する推論情報**である（FR-7 の 2）。
- 発車のない時間帯は空欄行として存在する（7時・11時・16時など）。空行を読み飛ばして後続行を繰り上げると全時間帯がずれるため、「時」列の値をアンカーとして行単位で読む（§8.5.3 規則4）。

---

## 5. 技術スタック（2026-06 時点で確認済み）

| 区分 | 採用 | 備考 |
|---|---|---|
| 実行基盤 | GitHub Actions `ubuntu-latest` | 公開リポジトリは無料。cron は遅延し得る／60日コミットなしで schedule 自動無効化 |
| ランタイム | **Node.js 22 (LTS)** | Node 20 は 2026-04 EOL のため不可 |
| 言語 | TypeScript 5（`strict: true`） | 実行は `tsx`（ビルドステップ不要） |
| Gemini SDK | **`@google/genai` ^2**（npm） | 統一SDK。**`@google/generative-ai` はレガシーで使用禁止**（公式明記）。`generateContent` API を使用（Interactions API はベータのため不使用） |
| OCR モデル | **【v1.5 変更】** 既定 **`gemini-3.6-flash`**（2026-07 GA）／フォールバック **`gemini-3.5-flash`** | config で差し替え可能。§8.5.5。旧: primary `gemini-3.5-flash` / fallback `gemini-3.1-flash-lite`。変更理由は下記 |
| 生成設定 | `responseMimeType: 'application/json'` + `responseSchema`、`thinkingConfig: { thinkingLevel: 'low' }`、画像 Part に `media_resolution_high` | **temperature / top_p / top_k は設定しない**（Gemini 3 公式推奨: 既定 1.0 のまま。低温指定はループ・劣化要因）。決定性は「2回読み照合」(§8.5.4) で担保 |
| HTML パース | `cheerio` ^1 | |
| 検証 | `zod` ^4 | |
| 文字コード | `iconv-lite` | 祝日CSV（Shift_JIS）デコード用 |
| 日時 | `dayjs`（`utc`/`timezone`、`Asia/Tokyo` 固定） | フロントと同一流儀 |
| HTTP | Node 組み込み `fetch` | UA: `campus-bus-navi-bot/1.0 (+https://github.com/motegi485/campus-bus-navi)` |
| ハッシュ | `node:crypto` SHA-256 | |
| テスト | `vitest` | フィクスチャ駆動（§12） |
| 本番反映 | ワークフロー内の `git commit` + `git push origin HEAD:main` | v1.9 で `peter-evans/create-pull-request` を廃止。追加 action を使わない |
| メール通知 | **`dawidd6/action-send-mail` を full commit SHA で固定** | checkout と setup-node も full commit SHA 固定。実際の SHA は `.github/workflows/timetable-sync.yml` を確認する |
| 祝日データ | 内閣府 CSV `https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv` | CC-BY。Shift_JIS・CRLF。1行目ヘッダ `国民の祝日・休日月日,国民の祝日・休日名称`、データ行 `YYYY/M/D,名称`（月日ゼロ埋めなし）。振替休日込み。1955年〜翌年分（2026-08-01 取得時点で 1067 件・2027-11-23 まで）。**URL は過去に一時変更歴ありのため config 化＋キャッシュフォールバック必須** |

#### 5.1 OCR モデル選定の根拠（v1.5・2026-08-01 実測）

| 観点 | `gemini-3.6-flash`（新 primary） | `gemini-3.5-flash`（新 fallback） | `gemini-3.1-flash-lite`（旧 fallback） |
|---|---|---|---|
| 状態 | GA（2026-07） | GA（2026-05-19） | GA |
| 無料枠 | あり | あり | あり |
| 有料単価（入力/出力・per 1M） | $1.50 / **$7.50** | $1.50 / $9.00 | $0.30 / $2.50 |
| 通常ダイヤ画像（JR 列同居） | **正解 fixture と完全一致** | **正解 fixture と完全一致** | 未検証 |
| 夏季休暇画像（左右2表・共有時列） | **正解 fixture と完全一致** | 当日 503 頻発で検証不能 | **3回読んでも不一致 → needs_review** |

- primary を `gemini-3.6-flash` にした理由: より新しい GA モデルで、無料枠があり、有料時も出力単価はむしろ安い。実測で最難関の2画像とも完全一致した。
- fallback を `gemini-3.5-flash` にした理由: 旧 fallback の `gemini-3.1-flash-lite` は実測で読みが安定せずフォールバックとして機能しなかった。**フォールバックの目的は「primary が使えないときにジョブを完走させる」ことなので、同格モデルを充てる**。RPD はモデル別に管理されるため、別モデルへの切り替えは枠の面でも有効。Bot の消費量は微小なのでコスト差は問題にならない。

---

## 6. 全体ワークフロー

```
GitHub Actions cron（毎日 07:00 JST = UTC 22:00）/ workflow_dispatch
  └─ bot/src/index.ts（オーケストレータ）
     1. fetchPage      : 対象ページ取得（非200/ネットワーク失敗 → ジョブ失敗）
     2. extractLinks   : md-box 内アンカー抽出 → LinkInfo[]（0件 → トリップワイヤーでジョブ失敗）
     3. classify       : 各リンクを regular / vacation / event に分類、日付・期間・ラベル解析
     4. fetchHolidays  : 内閣府CSV取得 → bot/holidays.json 更新（失敗時は既存キャッシュ続用）
     5. detectChanges  : state.json と URL/SHA-256 を突合 → OCR 対象を決定
     6. fetchImage     : 対象画像 DL（原寸試行 → リサイズ版フォールバック）
     7. ocr            : Gemini で中間構造化（2回照合、最大3回）
     8. assemble       : 中間構造 → timetable JSON（HH:mm 化・整列・最終便付与・メタ保持）
     9. validate       : Zod + 整合検証。NG はファイル不出力＋通知で警告
    10. writeFiles     : timetables/ へ書き込み（§3.5 ポリシー、保護ファイル除外）
    11. updateCalendar : 望ましい管理 override 集合を計算 → overrides 差し替え（手動不可侵）
    12. cleanup        : 過去日付の管理 override・event ファイル削除（計画を通知に明記）
    13. writeState     : bot/state.json 更新（同じコミットに同梱）
    14. report         : bot/.out/report.md 生成（git 管理外）＋ GITHUB_OUTPUT へ has_warn
  └─ Validate data    : node scripts/validate-data.mjs（適用前の最終ゲート。失敗ならコミットしない）
  └─ Detect diff      : git status で public/data・bot/state.json・bot/holidays.json の差分だけを見る
  └─ Commit and push  : 差分があれば main へ直接コミット（対象パスのみ add）
  └─ Send notification: 変更あり / 要手動確認あり / 失敗 のいずれかのときだけメール送信
Cloudflare Pages（GitHub App 連携）が main push を検知して再デプロイ
```

**状態確定の仕組み（v1.9 で単純化）**: Bot は常に main をチェックアウトして state.json を読み、
成功した実行はその場で main を前進させる。v1.8 までは「PR が未マージのうちは main の state が旧いまま」
という中間状態があり、同一ブランチの上書き更新で冪等性を保っていたが、その状態自体が無くなった。
**適用されなかった変更は state にも残らない**（コミットが起きなければ state も進まない）ため、
翌日の実行が同じ差分を再計算して再試行する。

**注意（既知の仕様）**: `GITHUB_TOKEN` による push は他の Actions ワークフローを**トリガーしない**。
本プロジェクトの CI は存在せず、デプロイは Cloudflare Pages の GitHub App 連携（Actions ではない）なので影響なし。
将来 main への push をトリガーとする Actions を追加する場合は PAT 等の検討が必要（現時点では不要）。

---

## 7. リポジトリ追加構成

### 7.1 ディレクトリ
```
campus-bus-navi/
├── .github/workflows/timetable-sync.yml
├── bot/
│   ├── src/
│   │   ├── index.ts            # オーケストレータ（手順 §6）
│   │   ├── config.ts           # §7.2 の定数
│   │   ├── types.ts            # LinkInfo / Intermediate / State 等の型
│   │   ├── time.ts             # 【v1.5 追加】JST 固定の日時ユーティリティ（NFR-6 を1箇所に閉じ込める）
│   │   ├── env.ts              # 【v1.5 追加】ローカル開発用 .env.local 読み込み（CI では no-op）
│   │   ├── fetchPage.ts
│   │   ├── extractLinks.ts     # 抽出＋分類＋日付解析（§8.2〜8.3）
│   │   ├── detectChanges.ts
│   │   ├── fetchImage.ts
│   │   ├── ocr.ts              # Gemini 呼び出し（§8.5）
│   │   ├── assemble.ts         # §8.6
│   │   ├── validate.ts         # §8.7
│   │   ├── plan.ts             # 【v1.5 追加】OCR 後の純粋部分（組立→検証→state→カレンダー）
│   │   ├── calendar.ts         # §8.8（overrides 計算・クリーンアップ）
│   │   ├── holidays.ts         # §8.9
│   │   ├── files.ts            # 読み書き・保護ファイルガード・JSON 整形規約
│   │   └── report.ts
│   ├── tools/
│   │   └── ocr-check.ts        # 【v1.5 追加】OCR 単体チェック（本番フロー外の開発ツール）
│   ├── test/                   # vitest（§12）
│   ├── fixtures/               # §12.1 正解データ
│   ├── state.json              # §9（初期値 { "version": 1 }）
│   ├── holidays.json           # 祝日キャッシュ（初期値は実装時に1度取得して同梱）
│   ├── .out/                   # 実行時生成物（report.md / mail-body.md）。.gitignore 対象
│   ├── .env.local              # 【v1.5 追加】ローカル実行用の GEMINI_API_KEY。.gitignore 対象・絶対にコミットしない
│   ├── .gitignore              # .out/ , node_modules/ , .env.local
│   ├── package.json            # フロントと独立（依存を混ぜない）
│   ├── package-lock.json       # 必ずコミット（workflow の npm ci と cache-dependency-path が依存）
│   └── tsconfig.json
└── （既存）public/data/...      # 出力先。フロントのファイルは変更しない
```

### 7.2 config.ts（必須定数）
```ts
export const CONFIG = {
  pageUrl: 'https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/',
  announceBoxSelector: 'div.md-box',
  anchorKeyword: '時刻表',
  imageExtPattern: /\.(jpe?g|png)$/i,
  resizedSuffixPattern: /-\d+x\d+(?=\.(jpe?g|png)$)/i,

  modelPrimary: 'gemini-3.6-flash',    // v1.5 変更（§5.1）
  modelFallback: 'gemini-3.5-flash',   // v1.5 変更（§5.1）
  geminiMinIntervalMs: 6000,          // 無料枠RPM対策: 呼び出し間隔の下限
  geminiMaxRetries429: 3,             // 429: 30s/60s/120s 指数バックオフ

  // 【v1.5 追加】一時障害（503 UNAVAILABLE / 500 / ネットワーク断）のリトライと上限（§8.5.5）
  geminiMaxRetriesTransient: 3,
  geminiTransientBackoffMs: [5_000, 15_000, 45_000],
  geminiRequestTimeoutMs: 180_000,    // 1リクエストの上限時間（張り付き防止）
  geminiMaxCallsPerRun: 18,           // 1実行あたりの呼び出し上限（無料枠 RPD=20 の実測にもとづく）

  // 【v1.10 追加】1日あたりの呼び出し上限。state.ocr_usage に持ち越し、手動実行を
  // 繰り返しても無料枠の RPD を超えないようにする（上限が1実行単位だけだと 2 回実行で 36 回試行できた）
  geminiMaxCallsPerDay: 18,

  // 【v1.10 追加】同一 URL の画像を再検証する間隔と、失敗が続いたときに warn へ格上げする日数（FR-4）
  imageRevalidateIntervalDays: 7,
  imageRecheckStaleDays: 21,

  // 【v1.10 追加】取得フェーズ（画像の取得・再検証）の予算（FR-4）。
  // runDeadlineMs は OCR にしか渡っておらず、逐次取得には全体予算が無かった
  fetchDeadlineMs: 8 * 60 * 1000,
  maxImageFetchesPerRun: 24,

  holidayCsvUrl: 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv',

  // 【v1.10 追加】祝日 CSV の健全性しきい値（FR-10 の 1b）
  holidayMinRowsWithoutCache: 100,     // 既存キャッシュが無いときに受理する最小件数
  holidayMinRatioVsCache: 0.7,         // 既存キャッシュに対して許容する最小比率

  dataDir: 'public/data/timetables',
  calendarRulesPath: 'public/data/calendar_rules.json',
  statePath: 'bot/state.json',
  holidaysCachePath: 'bot/holidays.json',
  reportPath: 'bot/.out/report.md',

  seasonMap: { '春': 'spring', '夏': 'summer', '冬': 'winter' } as const,

  /**
   * 【v1.5 変更】旧 `vacationKeywords: ['休暇','春休み','夏休み','冬休み']` を廃止し、
   * 季節接頭辞を必須にした正規表現に置き換える。
   *
   * 理由: ライブ掲載の実表記は「夏季休業」で旧キーワードに一致せず、長期休暇ダイヤが
   * needs_review に落ちて永久に自動取込されなかった。かといって「休業」を単純追加すると
   * 通常ダイヤ行「2026年4月4日（土）～ 通常授業日／休業日」を休暇と誤判定してしまう。
   * 季節接頭辞（春/夏/冬）を必須にすることで、「夏季休業・夏期休暇・夏休み」に一致し、
   * 「通常授業日／休業日」には一致しない。
   */
  vacationPatterns: [
    /[春夏冬][季期]?(?:休業|休暇|休み)/,   // 夏季休業 / 夏期休暇 / 夏休み …
    /長期休業/,
    /休暇/,                                // 単独の「休暇」（regular 行には出現しない）
  ],

  /**
   * 【v1.6】特別ダイヤの待機ファイル ID（§3.4）。
   * needs_review と判定した期間はこの ID で塗り潰す。Bot はファイル自体を【書かない】—
   * ホワイトリスト外なので、override から参照するだけ。
   */
  specialTimetableId: 'timetable_special',
  specialMaxRangeDays: 92,             // 特別ダイヤを張る期間の上限。日付の誤読で長大な期間を塗り潰さない

  protectedFiles: [                    // §7.4。書込/削除はホワイトリスト方式が正であり、これは追加の明示ガード
    'timetable_closed.json',           // 全便運休ダイヤ（手動運用）。Bot は読み書き・削除しない
    'timetable_special.json',          // 【v1.6】特別ダイヤ（手動運用）。Bot は override から参照するのみ
  ],

  newFileNames: {                      // 新規作成時のみ使用（§3.5）
    weekday: '授業日ダイヤ',
    holiday: '休業日ダイヤ',
    vacation: (s: 'spring'|'summer'|'winter', d: 'weekday'|'holiday') =>
      `${{spring:'春季',summer:'夏季',winter:'冬季'}[s]}休暇ダイヤ（${d==='weekday'?'平日':'休日'}）`,
    event: (label: string) => `${label}ダイヤ`,
  },

  busStops: {
    station_to_campus: { origin:'松永発', destination:'大学行き', bus_stop_name:'松永 バス乗り場',
      bus_stop_coords:{ lat:34.45118558593484, lng:133.25675322125554 } },
    campus_to_station: { origin:'大学発', destination:'松永行き', bus_stop_name:'大学 バス乗り場',
      bus_stop_coords:{ lat:34.459281686471684, lng:133.23183492499786 } },
  },
} as const;
```

### 7.3 環境変数
| 変数 | 必須 | 用途 |
|---|---|---|
| `GEMINI_API_KEY` | ✔ | Gemini API。GitHub Secrets から注入。**ローカルでは `bot/.env.local` に置く**（git 管理外。`env.ts` が読み込む） |
| `DRY_RUN` | – | `1` でファイル書込・state 更新・レポート生成をスキップし、変更計画を JSON でログ出力。ワークフロー側もコミットと通知をスキップする |
| `SKIP_OCR` | – | **【v1.5 追加】** `1` で OCR をスキップ（鍵があっても呼ばない）。無料枠 RPD が 20 しかないため、抽出・分類・カレンダーだけ確認したいローカル検証で枠を消費しないようにする |
| `OCR_MODEL` | – | **【v1.5 追加】** `tools/ocr-check.ts` 専用のモデル上書き。本番フロー（`src/index.ts`）は参照しない |
| `TZ` | – | ワークフローで `Asia/Tokyo` を設定（日付演算の事故防止。コード側でも dayjs.tz を明示） |
| `GITHUB_OUTPUT` | – | Actions が自動設定。`index.ts` が `has_warn` / `report_written` を書き、後続の通知ステップが読む（v1.9） |

**【v1.9 追加】メール通知用の Secrets**。`bot/` のコードは一切参照せず、ワークフローの
`Send notification` ステップだけが使う。Bot 本体からメール資格情報へは到達しない。

| Secret | 必須 | 用途 |
|---|---|---|
| `MAIL_USERNAME` | ✔ | 送信元 Gmail アドレス（SMTP 認証のユーザー名兼 From） |
| `MAIL_PASSWORD` | ✔ | Gmail の**アプリパスワード**（16 文字・スペースなし）。通常のログインパスワードでは送れない |
| `MAIL_TO` | ✔ | 通知の宛先。カンマ区切りで複数指定できる |

### 7.4 保護ファイル（FR-PROT）
- **実体（2026-08-08 HEAD で確認済み）**: `public/data/timetables/` にあるのは次の 8 ファイル。
  - 常設・Bot 書込対象: `timetable_weekday.json`・`timetable_holiday.json`
  - Bot 生成: `timetable_vacation_summer_weekday.json`・`timetable_vacation_summer_holiday.json`・`timetable_event_20260823.json`
  - 手動運用・Bot 書込対象外: `timetable_closed.json`（全便運休日）・`timetable_special.json`（特別ダイヤ）・`timetable_vacation_obon.json`（期間ダイヤ）
  - テンプレート（`timetable_vacation_SEASON_weekday.json`・`timetable_vacation_SEASON_holiday.json`・`timetable_event_YYYYMMDD.json` 等）は **`public/data/_examples/` へ移動済み**で、Bot の入出力ディレクトリ（`CONFIG.dataDir`）の外にある。`timetable_event_temp.json` はリポジトリに存在しない。
  - ※ v1.4 まで「本番3ファイルのみ」と記していたが、これは Bot 導入前・長期休暇取込前の状態である。
- **防御はホワイトリスト方式を正とする**: `files.ts` は、書込を `^timetable_(weekday|holiday)\.json$`・`^timetable_vacation_(spring|summer|winter)_(weekday|holiday)\.json$`・`^timetable_event_\d{8}\.json$` に合致するファイル名のみに、削除を `^timetable_event_\d{8}\.json$` のみに許可し、それ以外への書込・削除要求は例外を投げる。`timetable_closed.json`・`_examples/` 配下・その他の未知ファイルは構造的に対象外となる。
- `CONFIG.protectedFiles`（**`timetable_closed.json` と `timetable_special.json` の 2 件**。§7.2 の定義が正）は上記に加えた明示ガードであり、リストのファイルが存在しなくてもエラーにしない。`timetable_special.json` は FR-9 の 3a で override から**参照する**だけで、ファイルは書かない。Bot は `public/data/_examples/` に一切アクセスしない。
- なお `timetable_vacation_obon.json` のような手動運用の期間ダイヤは、ホワイトリストのどのパターンにも合致しないため構造的に書込・削除の対象外である（`protectedFiles` に列挙する必要はない）。

---

## 8. 機能要件

### FR-1: ページ取得（fetchPage）
- `CONFIG.pageUrl` を GET（UA 付与、タイムアウト 30s、3xx 追従）。
- 非 200・ネットワーク失敗 → **ジョブ失敗（exit 1）**。この時点で一切の変更を行っていないため安全。

### FR-2: リンク抽出（extractLinks）
1. `cheerio` でロードし、`div.md-box a[href]` を全走査。
2. 条件: (a) href を絶対化した URL の **`pathname`**（デコード済み）が `imageExtPattern` に一致、かつ (b) アンカーテキストに `時刻表` を含む。**2条件 AND**（2シグナル）。【v1.10】URL 全体の末尾に当てると `timetable.jpg?v=2` や `timetable.png#x` が画像として扱われず、CMS がキャッシュバスターやアンカーを付けただけでその系列を**無警告で取りこぼす**（6(a) の `possible_missed_link` にも入らない）。URL として解釈できない href は従来どおり文字列へパターンを当てる。
3. 各ヒットについて、**アンカーの最近接ブロック要素（`<p>` 等）のテキスト全体**（リンク含む行）を `lineText` として取得。同一ブロック内に対象アンカーが複数ある場合は `<br>` でテキストを分割し、当該アンカーを含むセグメントを `lineText` とする（スナップショット実測では 1 `<p>` に 1 リンクだが、将来のマークアップ変化への防御）。
4. URL 正規化: デコード、相対→絶対化。同一正規化 URL は重複排除。
5. **トリップワイヤー**: ページ取得成功かつヒット 0 件 → エラーログ（「ページ構造変更の可能性。セレクタ確認要」）を出して **exit 1**。削除・state 変更は行わない。「前回より減った」では発火させない（イベントは正当に消えるため）。
6. **サイレント欠落対策（警告・処理は続行）**: (a) href が `imageExtPattern` に一致するが条件 (b)（『時刻表』文言）に不一致で、かつ `lineText` に FR-3 の日付パターンを含むアンカーがあれば、needs_review 警告として 通知/ログに URL を記載する（リンク文言の変更による取りこぼしの検知。乗り場写真・キャンパスマップは日付を含まないため誤発火しない）。(b) `state.regular` が存在するのに今回 regular リンクが 1 件も抽出できなかった場合、**`level: 'warn'`** で 通知/ログに記載する（既存の weekday/holiday の削除・変更は行わない）。【v1.10】以前は `info` で、他に差分が無い日はメールの送信条件に入らなかった。通常ダイヤは平日・休日の 2 系列を支える土台で、リンクを見失うと URL か state が変わるまで古い表を出し続けるため、「書かなかった判断も通知する」という約束から漏れてはいけない。掲示の一時的な揺れでも鳴るが、古い表が数週間居座るより誤報の方が安い。

### FR-3: 分類・日付解析（classify）
`lineText` を前処理（全角数字→半角、全角空白 U+3000→半角空白、**連続する空白は 1 つに圧縮**、波ダッシュは `U+FF5E ～` と `U+301C 〜` の両方を許容〔スナップショット実測は U+FF5E〕）してから:

| 優先 | 判定 | 種別 | 取得値 |
|---|---|---|---|
| 1 | `vacationPatterns`（§7.2・v1.5 で正規表現化）のいずれかに一致 | **vacation** | season（`seasonMap` の漢字 1 文字を検索。`春季/夏季/冬期/冬季/春休み…` を吸収）、期間 `start`〜`end`（`(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日` を行内から最大2つ抽出（**年月日の間の空白を許容** — 2026-07 ライブの「2026年 7月  5日」形式に対応。年なし形は `(\d{1,2})月\s*(\d{1,2})日`）。`～` 区切り） |
| 2 | 日付が1つ以上あり `～` を**含まない** | **event** | 行内の**全日付**（複数日掲載に対応。各日付ごとに 1 ファイル＋1 override を生成、OCR は 1 回で結果を共用）、label（行から日付・曜日括弧・記号・「時刻表はコチラ」を除去した残り。例 `日商簿記検定試験日`→ trim） |
| 3 | 日付が**ちょうど1つ**＋`～` あり | **regular** | 開始日（情報としてログ・PR に記載。処理上は常設扱い）。※日付が2つ以上あるのに `vacationPatterns` に不一致の行は regular に落とさず **needs_review**（通常ダイヤを期間ダイヤで上書きする事故の防止）。**実例（2026-08-01 ライブ）**: お盆特別ダイヤ「2026年 8月 8日（土）～ 8月16日（日）」は休暇語彙が無いのでここに落ちる。この画像は 8/13〜15 運休・8/12 最終便・8/16 始発といったスキーマで表現できない但し書きを含むため、**人間対応に回すのが正しい挙動**であり修正しない |
| 4 | 上記いずれにも該当しない | **needs_review** | OCR せず 通知で警告（「分類不能の時刻表リンクあり」＋URL）。【v1.6】**期間の両端が読めている場合は `start`/`end` を残す**（FR-9 の 3a が特別ダイヤの適用先に使う）。該当するのは「日付2つ＋`～`だが休暇語彙なし」（お盆型）と「休暇語彙はあるが季節不明」の2ケース。日付が取れないケースでは `start`/`end` とも undefined のままにし、特別ダイヤも張らない |

補助規則:
- 2つ目の日付に年が無い場合（例 `8月1日～9月20日`）: 開始日と同年。それでも `end < start` なら end に +1 年。
- 年が完全に無い日付: 現在 JST 年を補い、結果が `today - 180日` より過去なら +1 年。**推定した場合は 通知メールに「年推定」フラグ**。
- vacation で end が取れない場合: ファイル生成と OCR は行うが **override 生成をスキップ**し、通知メールに「期間不明・手動で override 追加要」警告。
- event の label（lineText 由来）は通知表示・ログ用。**timetable の `name` 生成には OCR の day_type ラベルを使う**（FR-7 の 5 参照）。

### FR-4: 変更検知（detectChanges）
- 論理キー: regular は固定キー `regular`、vacation は `vacation:{season}`、event は `event:{YYYY-MM-DD}`（複数日イベントは画像単位で `event:{最初の日付}` をキーにし、`dates[]` を保持）。
- 判定: state に同キーが**無い** → 新規。**URL が異なる** → 画像 DL → **SHA-256 が state と同じなら「URL のみ変更」として state の URL を更新するだけ（OCR しない）**、異なれば変更として OCR。**URL 同一 → 条件付き再検証つきスキップ**（下記）。
- **【v1.10】URL 同一の再検証（同一 URL での画像差し替えの検知）**
  「URL が同じ ＝ 中身も同じ」は成り立たない。大学の CMS が同じ URL の内容を差し替えると、URL か state が別途変わるまで古い時刻表を出し続ける（v1.9 まで見逃し期間に上限が無かった）。次の規則で上限を有限にする。
  1. state に `etag` または `last_modified` があれば、**毎実行**、条件付き GET（`If-None-Match` / `If-Modified-Since`）を投げる。`304` なら変化なし。画像本体は流れないので大学サイトへの負荷はヘッダ 1 往復で済む。
  2. 検証子が無ければ、`checked_at` から `CONFIG.imageRevalidateIntervalDays`（7 日）以上経過したときだけ画像を取り直して SHA-256 を比較する。`checked_at` が無い（v1.9 以前の state）場合は必ず 1 度確かめる。
  3. `200` が返り SHA-256 が state と異なれば **OCR し直す**（`info` の `image_replaced_same_url` を記録）。
  4. 確かめられなかった実行（ネットワーク失敗・非 200・画像でない応答・許可外ホスト）は、**「変化なし」と断定しない**。既存データは触らず `checked_at` も進めず、`image_revalidate_failed` を記録する。最後に確認できてから `CONFIG.imageRecheckStaleDays`（21 日）を超えていれば `warn`、それ以内なら `info`（一時障害で毎日メールを鳴らさない）。
  5. 確認できた実行では、応答の `ETag` / `Last-Modified` と `checked_at`（当日）を state へ書き戻す。
  Gemini 呼び出しは 3 のときだけ発生する（通常の日次実行は 0 回のまま）。
- **【v1.10】取得の予算**: 取得フェーズ全体に `CONFIG.fetchDeadlineMs`（8 分・プロセス開始基準）と `CONFIG.maxImageFetchesPerRun`（24 件）を課す。どちらかに達したら新しい取得を始めず、既存データはそのまま維持する（新規リンクは `skip`）。**見送った分は必ず `warn`（`fetch_budget_exhausted`）に落とす。黙って切らない。** 締切が無いと、遅い応答が並ぶだけで取得だけに実行時間を使い切り、ワークフローの `timeout-minutes: 20` に達してレポートもメールも残らない（失敗が最も観測しにくい形になる）。
- **【v1.5 重要】`state.*.url` に記録するのは「リンクの正規化 URL」（デコード済み・リサイズサフィックスつきのまま）であって、実際に取得した URL ではない。**
  取得 URL を保存すると次の2点で構造的に一致せず、**毎日全画像を再ダウンロードし続ける**（FR-4 の「URL 同一 → スキップ」と NFR-8「画像 DL は変更分のみ」が効かなくなる）:
  1. リンク側は `decodeURIComponent` 済みだが、フェッチには % エンコードのままの href を使う
  2. FR-5 の原寸試行により、実際に取得する URL はサフィックスを除去したもの（`0817--1024x724.jpg` → `0817-.jpg`）になる
  §9 の state スキーマ例もデコード済みのリンク URL を示している。レポートの「元画像」リンクには実際に取得した URL を使ってよい（実行時の値を使う）。
- vacation/event の `dates`・期間がテキスト側だけ変わった場合（画像同一）も override 再計算には反映する（OCR 不要）。
- **regular の適用開始日が未来（start > today JST）の場合は取り込まない**（画像 DL・OCR・state 書込のいずれも行わない）。ログおよび（他に変更があれば）通知メールに「将来開始の通常ダイヤを検知（YYYY-MM-DD〜）。開始日以降に自動取込」と情報記載し、毎日再評価して today ≥ start となった実行で通常フローに乗せる（現行ダイヤの前倒し上書き防止）。
- **regular リンクが複数併存する場合**（前期・後期の移行期等）: start ≤ today のうち start が最新の 1 件を採用し、他はログに記録する。start が解析できない regular リンクは needs_review。
- **event は dates[] の全日付が today より過去ならスキップ**（画像 DL・OCR・state 書込を行わない。ログのみ）。一部の日付のみ過去の複数日イベントは、**today 以降の日付についてのみ**ファイル・override を生成し、過去日はログに記録する。
- **state.events のプルーニング**: writeState 時、dates の全日付が today より過去のエントリは state から削除する（上記スキップ規則により再取込は発生しないため安全。ファイル削除は FR-9、override の消滅は FR-9 の「today 以降のみ」規則が担う）。

### FR-5: 画像取得（fetchImage）
- `resizedSuffixPattern` に一致する URL は、サフィックス除去した**原寸 URL を先に試行**。非 200 ならリンク記載 URL にフォールバック。【v1.10】判定は URL の `pathname` に対して行う（FR-2 と同じ理由。URL 全体に当てるとクエリが付いた時点で原寸への切り替えが黙って効かなくなる）。
- レスポンスは `Buffer` で保持し SHA-256 を計算。Content-Type が image 以外なら needs_review。
- 取得画像が **10MB を超える場合は needs_review**（Gemini inlineData の実用上限と異常データの検知を兼ねる）。

### FR-6: OCR（ocr）

#### 8.5.1 SDK 呼び出し（`@google/genai`）
```ts
import { GoogleGenAI, Type } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const res = await ai.models.generateContent({
  model: CONFIG.modelPrimary,            // 'gemini-3.5-flash'
  contents: [{
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'image/jpeg', data: imageBuffer.toString('base64') } },
      { text: OCR_PROMPT },
    ],
  }],
  config: {
    responseMimeType: 'application/json',
    responseSchema: INTERMEDIATE_SCHEMA,             // §8.5.2（Type enum で表現）
    thinkingConfig: { thinkingLevel: 'low' },        // 単純グリッド読みのため low
    mediaResolution: 'MEDIA_RESOLUTION_HIGH',        // 細かい数字の読み取り精度のため（SDK の MediaResolution enum に従う。Part 単位指定でも可）
    // temperature / topP / topK は指定しない（Gemini 3 公式推奨: 既定 1.0）
  },
});
const json = JSON.parse(res.text);
```

#### 8.5.2 中間構造スキーマ（responseSchema / Zod 共通の論理形）
```jsonc
{
  "type": "object",
  "required": ["day_types"],
  "properties": {
    "day_types": {                       // regular/vacation 画像=2要素、event 画像=1要素
      "type": "array", "minItems": 1, "maxItems": 2,
      "items": {
        "type": "object",
        "required": ["label", "matsunaga", "university"],
        "properties": {
          "label": { "type": "string" }, // 画像表記のまま（例: 授業日 / 休業日）
          "matsunaga":  { "$ref": "#/rows" },   // 松永発
          "university": { "$ref": "#/rows" }    // 大学発
        }
      }
    }
  },
  "rows": {                              // 概念定義（実装では items を展開）
    "type": "array",
    "items": {
      "type": "object",
      "required": ["hour", "minutes"],
      "properties": {
        "hour":    { "type": "integer", "minimum": 0, "maximum": 23 },
        "minutes": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 59 } }
      }
    }
  }
}
```
実装では `@google/genai` の `Type.OBJECT / Type.ARRAY / Type.STRING / Type.INTEGER` で同形を構築する。

#### 8.5.3 OCR プロンプト（全文・このまま使用）

**【v1.5 全面改稿】** v1.4 の規則4 は「通常/休暇＝時｜松永発｜時｜大学発」「イベント＝松永発｜時｜大学発」と
画像種別でレイアウトを決め打ちしていたが、§4.3 のとおり実物の休暇画像は共有「時」列＋左右2表であり誤りだった。
規則3・4 をレイアウト非依存に書き換え、注記除外（規則6）と label 規則（規則7）を追加した。
実装の正本は `bot/src/ocr.ts` の `OCR_PROMPT`。

```
あなたは福山大学スクールバス時刻表画像の読み取り器です。
画像から「スクールバスの発車時刻」だけを抽出し、指定スキーマのJSONのみを返してください。

厳守事項:
1. 抽出対象は「スクールバス時刻表」の2方向のみ:
   - "松永発"（→ matsunaga）
   - "大学発"（→ university）
2. 「JR」「松永駅」「上り」「下り」「福山方面」「尾道方面」と書かれた列・表は鉄道の時刻表です。
   これらは絶対に含めないでください。バスとJRの時刻は形式が似ているため、列の見出しを必ず確認し、
   取り違えを厳禁とします。
3. 1つの画像に複数のダイヤ種別（例:「授業日」「休業日」「平日」「土・日・祝」）が含まれることが
   あります。その場合は種別ごとに day_types の別要素として抽出してください。
   種別が1つしかない画像は day_types を1要素にしてください。
   複数の種別は「上下に並ぶ」場合と「左右に並ぶ」場合の両方があります。どちらの場合も、
   枠で囲まれた見出しラベルとその下（または右）の表の対応を必ず確認してください。
4. 「時」列の位置はレイアウトによって異なります。決め打ちせず、必ず列見出しを見て判断してください:
   - 「時｜松永発｜時｜大学発」のように、各方向が専用の「時」列を左隣に持つ場合
   - 「松永発｜時｜大学発」のように、中央の「時」列を両方向で共有する場合
   各方向の「分」は、その方向に対応する「時」列と必ず組にして読んでください。
5. 各時間帯セルには2桁の「分」が0個以上書かれています。書かれている分をすべて minutes に
   列挙してください。存在しない時刻を捏造しない。存在する時刻を省略しない。
   発車のない時間帯（空のセル）は minutes を空配列 [] にしてください。空の行を読み飛ばして
   後続の行を繰り上げないでください（各行は必ず「時」列の値と組で読む）。
6. 表の中や周囲にある注記（矢印・吹き出し・「◯月◯日 最終」「◯月◯日 始発」「運行休止」等の
   但し書き）は発車時刻ではありません。minutes に含めないでください。
7. label は画像内のそのダイヤ種別の表記（例:「授業日」「休業日」「平日」「土・日・祝」）を
   そのまま使ってください。種別の表記が無い画像では、タイトルにある行事名・種別名
   （例:「オープンキャンパス」「簿記検定」「夏季休業」）を使ってください。
   日付や期間（例:「2026年8月23日(日)」「8月17日～9月23日」）は label ではありません。
   日付しか見当たらない場合は空文字にしてください。
8. 出力はJSONのみ。説明文・マークダウン・コードフェンスを含めないでください。
```

**実測結果（2026-08-01 / `gemini-3.6-flash` / 2回読み一致）**: 通常ダイヤ画像（JR 列同居・2種別上下配置・専用「時」列）と
夏季休暇画像（JR 列なし・2種別左右配置・共有「時」列）の両方で、正解 fixture と**完全一致**した。

> **注（SDK 仕様）**: `responseSchema` の `minItems` / `maxItems` は int64 を表す**文字列**（`'1'` / `'2'`）。
> 数値を渡すと API エラーになる。`@google/genai` の `Schema` 型で注釈しておくとコンパイル時に検出できる。

#### 8.5.4 2回読み照合（決定性の担保）
1. 同一画像で `generateContent` を 2 回実行（呼び出し間隔 ≥ `geminiMinIntervalMs`）。
2. 正規化（day_types を label 昇順、各 rows を hour 昇順、minutes を昇順・重複除去）して deep-equal 比較。
3. 一致 → 採用。不一致 → 3 回目を実行し、**3 つのうち 2 つが一致すればそれを採用**（通知メールに「3回読み・多数決採用」注記）。全不一致 → その画像は **needs_review**（ファイル不出力、通知メールに元画像 URL と不一致箇所を記載）。
4. 1 画像あたり Gemini 呼び出しは最大 3 回。

#### 8.5.5 モデル・レート制御

**【v1.5 全面改訂】** v1.4 は 429 のみを扱っていたが、実 API で叩いたところ 429 以外の失敗モードが実在した。

| 失敗モード | 検出 | 対応 |
|---|---|---|
| **429（RPM 超過）** | `429` / `RESOURCE_EXHAUSTED` かつ RPD 表記なし | 30s → 60s → 120s の指数バックオフで最大 3 リトライ |
| **429（RPD 枯渇）** | エラー本文に `PerDay` / `RequestsPerDayPerProject` | **バックオフしない**（待っても当日は回復しない）。即座に `modelFallback`（別の RPD 枠）へ切り替え、それも駄目なら失敗 |
| **503 / 500（過負荷・内部エラー）** | `503` / `UNAVAILABLE` / `high demand` / `INTERNAL` 等 | 5s → 15s → 45s の短いバックオフで最大 3 リトライ。解消しなければ `modelFallback` へ |
| **ネットワーク断・タイムアウト** | `fetch failed` / `ECONNRESET` / `ETIMEDOUT` / `AbortError` 等 | 上と同じ扱い。加えて 1 リクエストに `abortSignal`（既定 180 秒）を付け、接続が張り付いたまま戻らない事態を防ぐ |
| **モデル不存在/権限エラー** | `404` / `403` / `NOT_FOUND` / `PERMISSION_DENIED` | `modelFallback` で再試行 |

- フォールback使用時は レポートに「⚠ フォールバックモデル使用」を明記する。フォールバックでも失敗ならジョブ失敗（**黙って成功扱いにしない**）。
- **1実行あたりの呼び出し上限 `geminiMaxCallsPerRun`（既定 18）**: リトライも無料枠を消費するため、1枚の画像で 503/429 が重なると後続画像の分まで枯渇する。上限に達したら残りの画像は OCR せず needs_review として 通知/ログに顕在化させる（既存データは触らない）。翌日の実行で自然に再試行される。
- **無料枠の実測値（2026-08-01・H-8 の答え）**: `gemini-3.5-flash` の Free Tier は
  **RPD（1日あたりリクエスト数）= 20**（エラー本文の `quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier` / `quotaValue: 20` より）。
  **RPD は太平洋時間の深夜（＝日本時間 16:00）にリセット**され、**モデルごとに独立**して管理される。
- 想定呼び出し回数: 更新なし日 **0 回**／更新日 = 変更画像数 × 2〜3 回（典型 2〜9 回）。RPD=20 に対して通常運用は収まるが**開発中の検証には窮屈**なので、枠を消費せず計画だけ見たいときは `SKIP_OCR=1` を使う。
- 無料枠の数値は変動するため、**実値は AI Studio のレート制限画面で確認**して運用する。

### FR-7: 組み立て（assemble）
入力: 中間構造 + 種別 + メタ。出力: §3.2 形式の timetable オブジェクト（種別ごとに 1〜2 個）。
1. 各方向: 全 `(hour, minutes[])` を `HH:mm`（ゼロ埋め）へ展開 → 昇順整列 → 重複除去。
2. `note`: 末尾（その方向の最終便）のみ `"最終"`、他は `""`。**「最終」は画像に存在しない Bot 付与の推論情報**（§4.3）。
3. day_type → 出力ファイルのマッピング:
   - regular: label に `授業` または `平日` を含む → `timetable_weekday`、`休業`・`休日`・`土日`・`祝` のいずれかを含む → `timetable_holiday`。両方に振れない/重複 → needs_review。
   - vacation: 同上の label 判定で `timetable_vacation_{season}_weekday` / `_holiday`。
   - event: day_types は 1 要素のはず（2 要素なら needs_review）。`dates[]` の各日付につき `timetable_event_{YYYYMMDD}` を同内容で生成。
4. メタ: 既存ファイルがあれば **schedule のみ差し替え**（§3.5）。新規なら `CONFIG.busStops` と `newFileNames` で全体を構築し、`id` = ファイル名（拡張子なし）。
5. **event の `name`**: `${day_types[0].label}ダイヤ`（**OCR の day_type ラベル基準**。fixtures の期待値「簿記検定ダイヤ」「オープンキャンパスダイヤ」と一致する）。既存ファイル更新時は §3.5 のとおり `name` は保持。
   - **【v1.5 追加】OCR ラベルが空・空白のみ、または「日付・期間・記号だけ」の場合は lineText 由来の label（FR-3）にフォールバックする。**
     実測（2026-08-01・`0823.jpg`）では、種別ラベル枠を持たない画像に対して OCR が `"2026年8月23日(日)"` を label として返した。
     そのまま使うと `name` が「2026年8月23日(日)ダイヤ」になってしまう。プロンプト規則7 で日付をラベルにしないよう指示したうえで、
     コード側でも日付・曜日括弧・記号を除去して空になるラベルを無効とみなす二段構えにする（`assemble.ts` の `isMeaninglessLabel()`）。

### FR-8: 検証（validate / zod）
ファイル出力前に各 timetable オブジェクトへ適用。**1 つでも失敗したらそのファイルは書かず**、対応する override も生成せず、通知メールの「要手動確認」として理由・元画像 URL を記載する。
- `departure` が `^([01]\d|2[0-3]):[0-5]\d$`。
- 各方向: 厳密昇順（重複不可）、件数 ≥ 1、全時刻が 05:00〜23:59。
- `note`: 末尾要素のみ `最終`、それ以外は空文字。
- `id` === ファイル名（拡張子なし）。`routes` のキーが `station_to_campus` / `campus_to_station` の 2 つ丁度。
- 2回読み照合が成立していること（§8.5.4）。
- **【v1.9 で MUST へ格上げ】既存ファイル更新時、便数変化が ±50% 超ならそのファイルを書かない。**
  v1.8 までは「SHOULD・警告のみ（書き込みは止めない）」だった。人間の PR レビューが最終ゲートとして
  存在し、そこで元画像と突き合わせられる前提だったためである。自動適用ではそのゲートが無いので、
  NFR-3「判定不能・検証失敗は書かない・消さない・顕在化させる」に合わせる。
  実データの便数は 1 ルートあたり 10〜32 便で、最小の 10 便でも 5 便以下 / 16 便以上でしか発火しない。
  正しい改正でここに落ちた場合の復旧は「`bot/state.json` の該当キーを削除して再実行」または手動投入で、
  この手順は通知メールにも書かれる（`validate.ts` のエラーメッセージ）。
  新規作成（`prevCounts` なし）は比較対象が無いため対象外。

### FR-9: カレンダー更新（calendar）— 中核アルゴリズム

**優先順位（確定）【v1.6 で special を追加】: 手動 > 特別ダイヤ > イベント > 長期休暇 > 祝日(baseline) > default_rules**

特別ダイヤをイベントより上に置くのは安全側の判断。「読めなかった掲示」が指す期間に、別に読めた掲示のダイヤを重ねると、実際にはその掲示で上書きされている運行を表示してしまいうるため。

```
入力: live overrides O, state.managed_overrides M(前回), 
      今回の有効データ {events, vacations(期間), holidays(CSV)}, today(JST)

1) 改ざん検査: 各 (k,v) ∈ M について
   - O[k] が存在し v と異なる → k を「手動化」: M から除外し、O[k] は現状維持。通知で警告（revert しない）。
     【v1.6】削除時と同様に state.suppressed_overrides に記録し、以後この日付は計算対象にしない
     （記録しないと毎実行 D に現れては「手動と衝突」を報告し続け、通知に同じ警告が出続ける）
   - O[k] が存在しない（人が削除）→ M から除外し、【v1.5】state.suppressed_overrides に記録して
     **以後この日付には override を生成しない**。通知で警告
2) 手動キー集合 H = { k ∈ O | k ∉ M }   // Bot は H に一切触れない
3) 望ましい管理集合 D を優先順に構築（today 以降 かつ suppressed_overrides に無い日付のみ）:
   a.【v1.6】special: state.specials の各期間 [start, end] 内の日 d → D[d] = timetable_special
   b. event: 各イベント日 d（d ∉ D）→ D[d] = timetable_event_{d}
   c. vacation: 各期間内の日 d（d ∉ D）→ 月〜金かつ祝日でない → _weekday / 土日または祝日 → _holiday
   d. holiday baseline: CSV の祝日 d（today ≤ d ≤ CSV最終日, 月〜金, d ∉ D）→ timetable_holiday
4) 衝突解決: d ∈ D かつ d ∈ H → D から削除（手動が勝つ）。値が異なる場合のみ 通知で警告
5) 整合: D の各値 id に対応する {id}.json が（今回の書き込み後に）存在しない → その d を D から外し 通知で警告
6) 新 overrides = H ∪ D を日付昇順で並べ、calendar_rules.json を再構築
   （default_rules は無変更。ただし参照先ファイル欠如を検知したら 通知で警告）
7) state.managed_overrides ← D（カテゴリ別 special/event/vacation/holiday に分けて記録）
```
- 【v1.6】**state.specials の作り方**（`plan.ts` の `applySpecials`）: FR-3 で `needs_review` に落ちたリンクのうち、
  **期間の両端（`start`/`end`）が読めているもの**だけを記録する。日付が読めないものは適用先を決められないので
  従来どおり警告のみ。期間が `CONFIG.specialMaxRangeDays`（92日）を超えるものは日付の誤読を疑って適用せず警告する。
  記録するのは期間そのもの（適用日リストではない）。日が進むたびに state が書き換わって「state だけが変わったコミット」が
  期間中ずっと立つのを避けるため。過去日の切り捨ては 3) の「today 以降のみ」規則が担う。
  掲示がページから消えれば state.specials からも消え、override も自然に外れる。
- 【v1.6】特別ダイヤの適用は `warn` レベルの警告として通知メールの「⚠ 要手動確認」に出す。人は掲示を見て、
  通常どおり読める日だけ個別の時刻表ファイルを作って手動 override に置き換えられる（手動が最優先なので上書きされない）。
- **D の構築は「本実行の結果を反映した後の state」から行う**（state.regular / state.vacations / state.events の全既知エントリ＋holidays キャッシュ。今回 OCR した分だけを入力にすると、変更のなかった日の管理 override が消える誤実装になる）。state.events の過去日プルーニングは FR-4 参照。
- クリーンアップは 3) の「today 以降のみ」から自然に導かれる: **過去日付の旧管理キーは新 overrides に含まれず消える**。
- **event ファイル削除**: 旧 `M.event` にあり、日付 < today、ファイル名が `^timetable_event_\d{8}\.json$`、かつ保護リスト外 → 削除（レポートの「削除ファイル」欄に列挙）。**state に記録のない event ファイル（人が手置きしたもの）は削除しない**。
- vacation ファイルは削除しない（翌季に同名上書き）。`timetable_weekday/holiday` も削除しない。
- （SHOULD・情報警告）**手動キー**の参照先 `{id}.json` が `timetables/` に存在しない場合、レポートに情報として列挙する（**修正・削除は行わない**。旧命名の遺残 override や手入力ミスの検知が目的）。

### FR-10: 祝日取得（holidays）
1. `holidayCsvUrl` を GET → `iconv-lite` で Shift_JIS → UTF-8、CRLF/最終行欠落を許容してパース。1 行目ヘッダをスキップ、`YYYY/M/D,名称` を `{ date:'YYYY-MM-DD', name }` に正規化。
1a. **【v1.10】健全性検査。** パース時に次を検査し、外れたら例外にする（呼び出し側が警告に落として既存キャッシュで続行するので、壊れた応答が正規のキャッシュへ昇格しない）。
   - **実在日であること**（`isRealDate`）。正規表現は `2026/13/45` のような値も通すため、そのままだと override の日付が壊れる
   - **同じ日付が重複しないこと**
   - 昇順に整列して返す（順序に依存する下流を作らない）
1b. **【v1.10】規模の妥当性。** 既存キャッシュがあれば、新しい件数が `既存件数 × CONFIG.holidayMinRatioVsCache`（0.7）を下回る応答は**採用しない**（`warn` の `holiday_csv_suspicious` を出し、既存キャッシュで続行）。既存キャッシュが無い初回は `CONFIG.holidayMinRowsWithoutCache`（100 件）を下回る応答を採用しない。
   v1.9 までは「1 データ行以上」で受理していたため、途中で切れた HTTP 200 応答（プロキシ・CDN の部分応答など）を正規のキャッシュとして採用し、既存の祝日 override を消す経路があった。遠未来の 1 行だけなら `holidayCoverageMinDays` の警告も回避できてしまう。**祝日に平日ダイヤを案内するのは誤案内そのもの**なので、明らかに痩せた応答は採らない。
2. 成功 → `bot/holidays.json` を `{ fetched_at, source_sha256, holidays:[...] }` で上書き（コミットに同梱）。
   **【v1.5 追加】ただし取得した CSV の SHA-256 が既存キャッシュと同じなら書き換えない。**
   毎回 `fetched_at` を更新すると、データ無変更の日でも差分が出て**毎日コミットが積まれ NFR-1（冪等性）と AC-3/AC-4 に反する**。
   また CSV は 1955 年からの全件（2026-08-01 時点で 1067 件）をそのまま保持する。実行日によって内容が変わる絞り込みをすると同じ理由で冪等性が壊れる。
3. 失敗（非200/パース不能）→ **既存キャッシュを使用**して処理続行、通知メールに「祝日CSV取得失敗・キャッシュ使用」警告。キャッシュも無い初回失敗時のみ祝日 baseline をスキップして警告。

### FR-11: 自動適用と通知
> **【v1.9 で全面改稿】** 旧 FR-11 は「PR 作成」で、`peter-evans/create-pull-request` に
> 単一ローリングブランチ `bot/timetable-sync` を更新させ、人がレビューしてマージする設計だった。
> v1.9 でこの人間ゲートを廃止した（理由は §1.1）。実行可能な設定は
> `.github/workflows/timetable-sync.yml` を正とする。

#### 11.1 適用
- Bot 本体は **commit も push もしない**。作業ツリーにファイルを書き、`bot/.out/report.md` を生成し、
  `GITHUB_OUTPUT` に `has_warn` / `report_written` を出すところまでが責務。
- ワークフローが次の順で適用する。
  1. `node scripts/validate-data.mjs`（リポジトリ側の検証器。**失敗したらコミットしない**）
  2. `git status --porcelain -- public/data bot/state.json bot/holidays.json` で差分検出
  3. 差分があれば `git add` を**上記 3 パスに限定**して commit し、`git push origin HEAD:main`
- コミットメッセージは `bot: 時刻表データの自動更新 (YYYY-MM-DD)` 固定。
- push が拒否された場合は `git pull --rebase origin main` して 1 回だけ再試行し、それでも駄目ならジョブ失敗。
- `checkout` は `persist-credentials: false` のままとし、**push するステップの中だけ** remote に token を差す
  （Bot 実行ステップから repository write token へ到達させない設計を維持する）。

#### 11.2 通知
差分・警告・失敗のいずれかがある実行だけメールを送る。**変化が何も無い日は送らない**（ユーザー決定）。

| 状況 | 送信 | 件名 |
|---|---|---|
| ジョブ失敗（取得失敗・トリップワイヤー・鍵なし・検証失敗・push 失敗） | ✔ | `❌ [campus-bus-navi] 自動取得に失敗しました (MM-DD)` |
| `public/data/**` に差分あり ＋ 要手動確認あり | ✔ | `⚠ [campus-bus-navi] 時刻表を更新しました／要確認あり (MM-DD)` |
| `public/data/**` に差分あり（要手動確認なし） | ✔ | `[campus-bus-navi] 時刻表を更新しました (MM-DD)` |
| 差分なし ＋ 要手動確認あり | ✔ | `⚠ [campus-bus-navi] 要確認 (MM-DD)` |
| `state.json` / `holidays.json` だけの差分、要手動確認なし | – | （コミットと push はする） |
| 完全に変化なし | – | |
| `dry_run: true` の手動実行 | – | ログのみ |

- ユーザーが手で実行をキャンセルした場合は送らない（`!cancelled()`）。ジョブごと強制終了された場合は
  このステップも走らないので、GitHub 標準の失敗通知が受け持つ。
- 本文は `bot/.out/report.md` の先頭に実行日時・実行ログ URL・反映コミット URL を足したもの。
  レポートが生成される前に落ちた実行では、実行ログへの導線だけを出すフォールバック本文を使う
  （**無言で失敗させない**）。

#### 11.3 report.md テンプレート（生成内容）
```md
## 概要
実行: {ISO日時 JST} / モデル: {使用モデル}{フォールバック注記}

## 変更
### 時刻表ファイル
| 種別 | ファイル | 操作 | 便数(松永発/大学発) | 元画像 |
|---|---|---|---|---|
| regular | timetable_weekday.json | 更新 | 32/30 (+0/-1) | [画像]({URL}) |
...
### calendar_rules.overrides
- 追加: 2026-06-14 → timetable_event_20260614（イベント: 日商簿記検定試験日）
- 追加: 2026-07-20 → ※手動キーと衝突のためスキップ（既存値: timetable_holiday）
- 削除: 2026-05-04（過去日付の管理キー）
### 削除ファイル
- timetable_event_20260315.json（適用日経過）

## 発車時刻                      ← 【v1.9 追加】
元画像と突き合わせて確認してください。

### timetable_weekday.json（更新）　[元画像を開く]({URL})

**松永発** 32 → 33 便
- 追加: 08:20
- 全便: 07:30, 07:50, ...

**大学発** 30 → 30 便
- 発車時刻の変更なし

## 検証
- 2回読み照合: 一致 {n}/{m}（多数決採用: {件数}）
- スキーマ検証: すべて合格 / ⚠ 失敗 {件数}（下記）

## ⚠ 要手動確認
- {あれば列挙。なければ「なし」}

## 確認する点
- [ ] 上の「発車時刻」と元画像が一致しているか（特に JR 列の混入がないか）
- [ ] override の日付・参照先

問題がなければ何もする必要はありません。すでに本番へ反映済みです。

## 取り消したいとき                ← 【v1.10 で全面差し替え】
1. GitHub の該当コミット画面で Revert する（public/data と bot/state.json が一緒に戻る）。
2. **そのままだと翌日の実行で同じ画像を読み直し、同じ内容が再び反映される。**
   再公開を止めるには次のどちらかを行う。
   - calendar_rules.json の overrides に手動で timetable_special を張る
   - 急ぐ場合は Actions で timetable-sync を Disable する
3. bot/state.json の該当キー削除は「わざと読み直させたいとき」だけ。停止手段ではない。
```

> **【v1.10 修正】** v1.9 の文面は「revert だけでは Bot が処理済みと判断して再取得しないため、
> state キーも削除して push する」としていたが、**実装はその逆**である。Bot は data と state を
> 同じコミットで更新するので、revert すると state も戻り、Bot から見て「未処理」に戻る。
> つまり翌日の実行で同じ画像を読み直して同じ誤りを再公開する（§14 の「誤反映の巻き戻し」が正しい）。
> state キーの削除は**再取得を促す**操作であって停止手段ではない。**再公開を止める手順と
> 読み直させる手順を混ぜてはいけない。** 誤った文面は、唯一の復旧導線で運用者を逆方向へ誘導する。
> 同じ内容を `bot/src/report.ts` の `rollbackSection()`、§14、`docs/backend-bot.md`、
> `HANDOFF.md` で揃える。

**「発車時刻」節を置く理由**: v1.8 まで実際の時刻は PR の diff で見る前提で、本文には便数しか
出していなかった。PR が無くなると時刻が人の目に触れる経路が消えるため、旧→新の追加・削除と
全便一覧を本文に載せる。**メール 1 通で「画像と時刻の突き合わせ」が完結すること**が、
失われた PR レビューの実質的な代替になる（§1.1 の第 5 層）。

### FR-12: ドライラン
`DRY_RUN=1` のとき: 手順 1〜9・11(計算) まで実行し、**ファイル書込・state 更新・レポート生成を行わず**、変更計画（書く予定のファイル一覧・overrides 差分・削除予定・警告）を JSON でログ出力。ワークフロー側も検証・差分検出・コミット・通知をすべてスキップする。workflow_dispatch の boolean 入力 `dry_run` と連動。

---

## 9. 状態ファイル `bot/state.json`（スキーマ）

```jsonc
{
  "version": 1,
  "regular": {
    "url": "https://.../R8スクールバス時刻表.jpg",
    "sha256": "…",
    "start": "2026-04-04",
    "derived": ["timetable_weekday", "timetable_holiday"],
    "processed_at": "2026-06-13T07:00:00+09:00",
    // 【v1.10 追加・任意】同一 URL の再検証に使う（FR-4）。3 つとも省略可
    "etag": "\"abc123\"",
    "last_modified": "Wed, 04 Apr 2026 01:23:45 GMT",
    "checked_at": "2026-08-18"
  },
  "vacations": {
    "summer": { "url": "…", "sha256": "…", "period": { "start": "2026-08-01", "end": "2026-09-20" },
                "derived": ["timetable_vacation_summer_weekday", "timetable_vacation_summer_holiday"],
                "processed_at": "…" }
  },
  "events": {
    "2026-06-14": { "url": "…", "sha256": "…", "label": "日商簿記検定試験日",
                    "dates": ["2026-06-14"],
                    "derived": ["timetable_event_20260614"], "processed_at": "…" }
  },
  "specials": {
    "2026-08-08": { "url": "…", "line": "● 2026年 8月 8日（土）～ 8月16日（日） 時刻表はコチラ",
                    "period": { "start": "2026-08-08", "end": "2026-08-16" },
                    "reason": "期間指定（日付2つ＋波ダッシュ）ですが長期休暇の語彙に一致しません…",
                    "processed_at": "…" }
  },
  "managed_overrides": {
    "special":  { "2026-08-12": "timetable_special", "2026-08-16": "timetable_special" },
    "event":    { "2026-06-14": "timetable_event_20260614", "2026-06-20": "timetable_event_20260620" },
    "vacation": { "2026-08-03": "timetable_vacation_summer_weekday", "...": "..." },
    "holiday":  { "2026-09-21": "timetable_holiday", "...": "..." }
  },
  "suppressed_overrides": { "2026-10-12": "timetable_holiday" },
  "holidays_source": { "fetched_at": "…", "sha256": "…" },
  "ocr_usage": { "date": "2026-08-18", "calls": 6 }
}
```
- **【v1.10 追加】`etag` / `last_modified` / `checked_at`**（`regular` / `vacations.*` / `events.*` の各エントリ・すべて任意）:
  FR-4 の「URL 同一 → 条件付き再検証つきスキップ」が読む。`checked_at` は**内容が変わっていないことを確認できた日**であり、
  確認に失敗した実行では進めない（進めると「確認できていない」と「確認して変化なし」の区別が消える）。
  v1.9 以前の state はこれらを持たないが、そのまま読める（持たないエントリは 1 度必ず再検証される）。
- **【v1.10 追加】`ocr_usage`**（`{ date, calls }`）: 同じ日に使った Gemini 呼び出し回数。
  上限が 1 実行単位しか無いと、手動実行を繰り返すだけで無料枠の RPD を超えられる。`date` が今日でなければ 0 から数え直す。
- **【v1.6 追加】`specials`**（期間開始日 → 読み取れなかった掲示の記録）: FR-3 で `needs_review` に落ちたリンクのうち
  **期間の両端が読めているもの**だけを記録する。FR-9 の 3a がこれを見て `timetable_special` の override を張り、
  アプリはその日、発車時刻を出さずに大学ホームページへ誘導する。**適用日リストではなく期間そのもの**を持つのは、
  日が進むたびに state が書き換わって「state だけが変わったコミット」が期間中ずっと立つのを避けるため。
  掲示がページから消えればこの記録も消え、override も自然に外れる。
- **【v1.5 追加】`suppressed_overrides`**（日付 → 削除された時点の時刻表 ID）:
  FR-9 の「人が削除した管理キーは再追加しない」は、記録を残さないと**1実行分しか効かない**。
  削除されたキーはその実行で M から外れるため、次回の実行では「未知の日付」として祝日 baseline 等が
  再生成され、人の削除が翌日には復活してしまう。ここに残すことで削除判断を恒久的に尊重する。
  過去日になったエントリは自動的に捨てる。
  **【v1.6 で変更】「値を別のダイヤに変更」した場合もここに記録する。**
  変更されたキーはその実行で手動キー（H）になるため値そのものは維持されるが、記録しないと Bot は毎実行
  その日付を D に再計算しては「手動と衝突」を報告し続け、同じ警告が毎回の通知に出続けてしまう。
  FR-9 の 1) がこの動作の正であり、v1.5 までの「変更時は記録不要」という記述は本項で撤回する
  （実装は `calendar.ts` の改ざん検査が削除・変更の両方を `suppressed` に入れる）。
- 初期値はリポジトリに `{ "version": 1 }` でコミット（＝初回実行で全件が「新規」扱いになり、現行ページの全時刻表を取り込むコミットが出る）。
- **初回導入の注意**: 既存 overrides（祝日・土曜授業日等の手動分）はすべて「手動」扱いとなり Bot は触れない。祝日 baseline が手動キーと同日になった場合は衝突スキップ（値が同じなら警告も不要）。

---

## 10. GitHub Actions ワークフロー（実行定義はリポジトリ上の YAML）

> **実行可能な設定の最終確認先は `.github/workflows/timetable-sync.yml`**。
> **【v1.9 で方針変更】** ここに YAML 全文を複製していたが、実ファイルと二重管理になり
> 片方だけ古くなる事故が起きやすい。本節は**要件として固定したい事項**だけを書き、
> 行単位の設定は実ファイルを見ることとする。

#### ジョブ全体（要件として固定する事項）

| 項目 | 値 | 理由 |
|---|---|---|
| トリガー | `schedule: '0 22 * * *'`（07:00 JST）＋ `workflow_dispatch`（boolean 入力 `dry_run`） | NFR-8: 日次 1 回を超えて頻度を上げない |
| concurrency | `group: timetable-sync` / `cancel-in-progress: false` | 多重起動で state が壊れるのを防ぐ（前の実行を待つ） |
| permissions | **`contents: write` のみ** | main へ push するため。**v1.9 で `pull-requests: write` を削除**（PR を作らなくなった）。⚠️ GitHub の permissions は **job 単位**でしか付けられないので、この権限は job 内の全ステップ・全 action に効く。push 専用 job へ分離すれば境界を狭められるが、Bot が書いた作業ツリーを artifact 経由で受け渡す必要があり、複雑さに見合わないと判断して**残存リスクとして受容**する（v1.10。§15 参照） |
| timeout-minutes | 20 | `CONFIG.runDeadlineMs`（15 分）と対。OCR は締切前に打ち切る。**【v1.10】取得フェーズにも別途 `fetchDeadlineMs`（8 分）を課す**（FR-4） |
| env | `TZ: Asia/Tokyo` | 日付演算の事故防止 |
| action の固定 | **すべて full commit SHA** | 可変タグは移動・侵害され得る。GitHub の Secure use reference が full-length SHA のみを immutable としている |
| checkout | `persist-credentials: false` | Bot 実行ステップから repository write token へ到達させない |
| **【v1.10】実行できる ref** | **`main` のみ**（`dry_run` を除く） | このワークフローは `HEAD:main` を push する。手動実行では ref を自由に選べるため、`main` 以外で走らせると **Bot が作った差分だけでなく、その ref に既にあるコミットまで `main` へ運んでしまう**。先頭ステップで fail-closed に拒否し、push ステップにも同じ条件を持たせる（多重防御）。ブランチで試すときは `dry_run` を使う |

#### ステップ構成

| # | ステップ | 条件 | 要点 |
|---|---|---|---|
| 0 | **【v1.10】`Guard ref`** | `dry_run != true` かつ `github.ref != 'refs/heads/main'` | エラーを出して即失敗させる。理由は上表 |
| 1 | checkout / setup-node（22）/ `npm ci`（`working-directory: bot`） | 常時 | npm キャッシュのキーは `bot/package-lock.json` |
| 2 | `Run sync`（`id: sync`）= `npx tsx src/index.ts` | 常時 | env に `GEMINI_API_KEY` と `DRY_RUN`。`GITHUB_OUTPUT` へ `has_warn` を返す |
| 3 | `Validate data`（`id: validate`）= `node scripts/validate-data.mjs` | `dry_run != true` | **適用前の最終ゲート**。落ちたらコミットしない。Node 標準モジュールのみなのでルートの `npm ci` は不要 |
| 4 | `Detect diff`（`id: diff`） | `dry_run != true` | `git status --porcelain` を `public/data` / `bot/state.json` / `bot/holidays.json` に限定。`changed` と `data_changed` を返す |
| 5 | `Commit and push`（`id: push`） | `dry_run != true` かつ `changed == 'true'` かつ `github.ref == 'refs/heads/main'` | `git add` は同 3 パスのみ（`git add -A` 禁止）。token はこのステップ内でのみ remote に差す。push 拒否時は rebase して 1 回だけ再試行。**【v1.10】rebase したら、組み合わせ後のツリーで `validate-data.mjs` と変更範囲の検査をやり直してから push する**（個別に検証済みでも「Bot の差分 + main の新しい変更」は未検証。落ちたら push せずジョブを失敗させ、翌日に再試行する）。rebase で自分のコミットが空になった場合は push せず正常終了 |
| 6 | `Upload run artifacts` | `always()` | `bot/.out/**` を 30 日保存。差分ゼロの実行では他に何も残らないため |
| 7 | `Compose notification`（`id: mail`） | `!cancelled()` かつ `dry_run != true` | FR-11.2 の表に従って送信要否・件名・本文を決める。**【v1.10】毎月 1 日は変更も警告も無くても稼働確認メールを送る**（heartbeat。§10.1 の 4 と対） |
| 8 | `Send notification` | `!cancelled()` かつ `send == 'yes'` | `dawidd6/action-send-mail`（full SHA 固定）。Gmail は `smtp.gmail.com:465` / `secure: true` |

### 10.1 リポジトリ初期設定チェックリスト（稼働前に必ず実施）
1. **Secrets**: `Settings → Secrets and variables → Actions` に 4 件登録する。
   - `GEMINI_API_KEY`（Google AI Studio で発行）
   - `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_TO`（v1.9。Gmail はアプリパスワードが要る）
2. **書き込み許可**: `Settings → Actions → General → Workflow permissions` で
   「Read and write permissions」を選択する（main へ push するため）。
   - **【v1.9】「Allow GitHub Actions to create and approve pull requests」は不要になった**（PR を作らない）。
   - なお、リポジトリ既定が読み取り専用のときにワークフローの `permissions:` 宣言が昇格として
     効くかは公式文書で確認できなかった（未確認）。確実な「Read and write permissions」を設定する。
3. AI Studio のプロジェクト画面で `gemini-3.6-flash` の無料枠レート（RPM/RPD）を確認し、必要なら `geminiMinIntervalMs` を調整。
4. 運用注意: スケジュールワークフローは**リポジトリに 60 日コミットがないと自動無効化**される。
   Bot は変更があった日しかコミットしないため、**掲載が長期間動かない時期は Bot だけでは無効化を防げない**
   （フロント開発のコミットがあれば防げる）。無効化時は GitHub から通知が届くので、
   Actions タブで Enable し直す。§14 の「長期間メールが来ない」と対で読むこと。
   **【v1.10】毎月 1 日は変更が無くても稼働確認メール（heartbeat）を送る。** 変更が無い日は何も残らないため、
   スケジュールが止まっていることを無期限に見逃す経路があった。月 1 通なら通知量を増やさずに気づける。
   **月初のメールが 2 か月続けて届かなければ、Actions の有効状態を確認すること。**

---

## 11. 非機能要件

| ID | 要件 |
|---|---|
| NFR-1 | **冪等性**: 同一入力（ページ・画像・state）での再実行は差分を生まない。**空コミットも余計な通知も発生させない**（v1.9: 旧「同一ブランチを上書きし PR の重複を作らない」から書き換え） |
| NFR-2 | **JSON 整形規約**: UTF-8（BOM なし）・LF・2 スペースインデント・末尾改行 1 つ。overrides キーは日付昇順。既存ファイル更新時はキー順を保持（§3.5） |
| NFR-3 | **安全側default**: 判定不能・検証失敗・取得失敗は「書かない・消さない・通知/ログで顕在化」。黙って成功扱いにしない |
| NFR-4 | **ログ**: 各ステップの判断（リンク分類結果、変更検知の理由、OCR 照合結果、override 差分）を console に構造化出力。`GITHUB_STEP_SUMMARY` にも要約を書く（SHOULD） |
| NFR-5 | **依存分離**: `bot/package.json` はフロントの `package.json`・lockfile と独立。フロントのビルドへ影響を与えない |
| NFR-6 | **タイムゾーン**: すべての「今日」「日付」判定は JST（dayjs.tz('Asia/Tokyo')）。`new Date()` の素の比較を禁止 |
| NFR-7 | **プライバシー/利用規約**: Gemini へ送るのは公開時刻表画像のみ。無料枠の「入力がモデル改善に利用され得る」性質は本用途で許容済み |
| NFR-8 | **アクセス礼節**: 対象ページへのアクセスは 1 実行あたり 1 回、画像 DL は変更分のみ。日次 1 回の cron 以上に頻度を上げない |

---

## 12. テスト・受け入れ基準

### 12.1 フィクスチャ（`bot/fixtures/`）
> **重要**: fixtures は意図的に「凍結したスナップショット」である。大学サイトのライブ状態（イベント画像はイベント終了後に削除される）とは独立。イベント処理の検証はライブではなくこの凍結データで行う。
>
> **【v1.5 更新 / v1.7 で表記統一】供給元と配置は完了済み。** v1.4 が供給元としていた `_reviewRSD/` は**リポジトリに存在しない**。
> 原本は `bot/fixtures/_planning/` にあり、C-10 はそこからの複製として 2026-08-01 に実施済み（原本は `_planning/` に残してある）。
> 以降で `_reviewRSD/` に言及している箇所（§16.1 の (B)、§16.2 の C-10）は **v1.4 当時の歴史記述**であり、
> 現在の供給元はいずれも `bot/fixtures/_planning/` と読み替えること。

| ファイル | 内容 |
|---|---|
| `page_snapshot.html` | **イベントを含む歴史的スナップショット**（regular + 簿記2026-06-14 + オープンキャンパス2026-06-20 の3リンクを含む、本書 §4.2 の構造）。**あえてこの版を使う**（ライブ再取得ではイベントが消えており分類テストが不能になるため）。原本 `bot/fixtures/_planning/page_snapshot.html` をそのまま複製したもの |
| `images/` | 元の時刻表画像3枚（`R8…jpg` / `0614…jpg` / `0620…jpg`）。**provenance（監査・再検証用）として保存推奨**。ライブから消えても fixtures の出所が辿れる。テストは決定性のため JSON fixtures のみを使い、画像は provenance（監査・再検証用）として保存する（Claude Code は画像を閲覧**できる**ため、必要になれば fixtures と画像の照合検証も可能） |
| `intermediate/regular.json`・`event_20260614.json`・`event_20260620.json` | 3 画像ぶんの中間構造（提供済み）。OCR 正解 |
| `expected/timetable_weekday.json`・`timetable_holiday.json`・`timetable_event_20260614.json`・`timetable_event_20260620.json` | 正解 JSON（提供済み）。**weekday/holiday は現在もライブにある通常ダイヤ画像由来で、本番データと一致確認済み** → 実走AC（AC-2）の通常ダイヤ照合にも使える。event 2本は歴史的データ（ライブには無い） |
| `holidays_sample.csv` | 内閣府 CSV の先頭ヘッダ＋当年分（2026年・18件）を含む Shift_JIS サンプル（C-5 で生成済み） |
| `calendar_rules_live.json` | HEAD の calendar_rules スナップショット（手動キー保護テスト用、C-6 で生成済み） |
| **`page_snapshot_20260801.html`**（v1.5 追加） | 2026-08-01 のライブページ凍結版。**regular / needs_review（お盆）/ vacation（夏季休業）/ event（OC）の4リンク**を含み、v1.5 の分類規則（季節接頭辞つき vacation 判定・期間ダイヤの needs_review 落とし）を回帰テストする |
| **`images/0808-724x1024.jpg`・`0817--1024x724.jpg`・`0823-724x1024.jpg`**（v1.5 追加） | 2026-08-01 ライブの3画像。provenance 兼 OCR 実測の対象 |
| **`intermediate/vacation_summer.json`**（v1.5 追加） | 夏季休暇画像の中間構造。**手動転記して作成し、`gemini-3.6-flash` の実 OCR が完全一致することで二重に検証済み**。v1.4 まで vacation 経路の fixture が1つも無く、左右2表・共有「時」列レイアウトが無検証だった |
| **`expected/timetable_vacation_summer_weekday.json`・`_holiday.json`**（v1.5 追加） | 上記から assemble した正解 JSON。実走で生成されたファイルと byte 一致することを確認済み |

### 12.2 ユニットテスト（vitest）
1. `extractLinks(page_snapshot.html)` → 3 件、(regular: 2026-04-04 開始, event: 2026-06-14 簿記, event: 2026-06-20 オープンキャンパス) に分類される。キャンパスマップ等を拾わない。
2. アンカー 0 件の HTML → トリップワイヤー（例外）。
3. 日付パース: 全角数字・`〜`(U+301C)・年なし日付（+1 年補正）・vacation 期間（end 年省略）。
4. `assemble(intermediate)` → `expected/*` と schedule 配列が完全一致（最終便 note 含む）。
5. `validate`: 降順データ・`24:00`・note 位置違反・id 不一致をそれぞれ検出。
6. `calendar`: (a) 手動キー不可侵（live スナップショットの `2026-05-02: weekday` 等が保持される）、(b) 優先順位（同日に event と vacation と祝日 → event が勝つ）、(c) 改ざん検知（managed キーの値を変えた state を与える → 手動化＋警告）、(d) 過去日付クリーンアップ、(e) 祝日 baseline が手動キーと衝突 → スキップ。
7. `files`: 保護ファイル名への書込・削除要求が拒否される。既存ファイル更新で `name`・キー順が保持される。
8. `holidays`: Shift_JIS サンプルのデコード・パース、取得失敗→キャッシュフォールバック。

**【v1.5 追加】**

9. `files`: 既存の `timetable_weekday/holiday/closed.json`・`calendar_rules.json`・`_examples/` のテンプレートを
   parse → 再整形して **byte 一致**する（§3.5 のハウススタイル維持。崩れるとコミットが全行差分になる）。
10. `extractLinks`: `page_snapshot_20260801.html`（ライブ凍結）で **regular / needs_review / vacation(summer) / event** の4分類、
    「通常授業日／休業日」を休暇と誤判定しない、「夏季休業」を期間つきで拾う、お盆行が needs_review に落ちる。
11. `assemble`: 夏季休暇画像の中間構造から `timetable_vacation_summer_weekday/_holiday` を生成し expected と一致（左右2表・共有「時」列の経路）。
    OCR ラベルが「日付だけ」のとき掲載行ラベルへフォールバックする。
12. `calendar`: `suppressed_overrides` により人の削除が翌実行以降も維持される／過去日エントリは自動的に捨てる／
    抑止された日付に人が改めて override を書いたらその値が使われる。
13. **統合テスト**（`test/integration.test.ts`・ネットワーク無し）: ライブ凍結スナップショット＋ fixtures の中間構造で
    抽出→分類→組立→検証→カレンダー→実行レポートまで通し、生成ファイル一覧・override の値・state・レポートを固定する。
    2回目の実行で差分ゼロになること（AC-3 相当）も含む。

**【v1.9 追加】**

18. `validate`: 便数が ±50% 超変化したら `ok: false`（書かない）になる。範囲内なら合格。
    新規作成（`prevCounts` なし）は対象外。
19. **統合テスト**: 実行レポートに「発車時刻」節が出て、新規ファイルは全便、更新ファイルは旧→新の
    追加・削除が載る。削除計画は発車時刻の節に出さない。「取り消したいとき」が常に付く。

**【v1.6 追加】**

14. `extractLinks`: needs_review でも期間の両端が読めていれば `start`/`end` が入る（お盆型・季節不明の休暇告知）。
    日付が無い行では両方 undefined のまま。
15. `calendar`: 特別ダイヤが祝日 baseline・event・長期休暇より優先される／手動 override には負ける／
    期間内でも過去日には張らない／`timetable_special.json` が無ければ張らずに警告する。
16. `calendar`: 管理キーを人が**変更**した場合も `suppressed_overrides` に記録され、翌実行以降
    「手動と衝突」の警告が出続けない。
17. **統合テスト**: お盆リンク（needs_review）で 8/8〜8/16 の 9 日が `timetable_special` になり、
    山の日（8/11）は祝日 baseline より特別ダイヤが優先される。時刻表ファイルは 1 つも生成しない。

### 12.3 受け入れ基準（実環境）
> 前提: ライブ掲載は変動するため、AC はライブ状態に依存しない形で定義する（「実行時点のライブ掲載リンク集合」を基準に読む）。ロジックの網羅検証は §12.2 のユニットテスト（凍結 fixtures）が担い、実走 AC は配線の確認を主目的とする。
>
> **【v1.5 追加 / v1.9 更新】検証経路について**: GitHub Actions の `schedule` / `workflow_dispatch` は**デフォルトブランチにワークフローファイルがある場合のみ**動作する。
> 作業ブランチ（`sandbox`）に置いている間は Actions 実走が起動できないため、**AC-1〜AC-3・AC-5・AC-6 はローカル実行で検証する**。
> ローカルでも `DRY_RUN=1`（計画のみ）と実走（実際に `public/data/` を書き換え `bot/.out/report.md` を生成）の両方が可能で、
> 生成差分は `git diff` で確認できる。**Actions 配線に依存する AC-4・AC-7・AC-8 は実走で確認する**。

| AC | 条件 | 合格基準 | 状況（2026-08-01） |
|---|---|---|---|
| AC-1 | state 初期値でドライラン | 計画ログに: 通常ダイヤ（weekday/holiday）の取り込み、未来 event の取り込み計画、過去日 event のスキップ記録、祝日 baseline override の追加計画、既存の手動 override は保持。ファイル変更ゼロ | ✅ **ローカルで確認済み** |
| AC-2 | 同条件で実走 | `timetable_weekday.json`・`timetable_holiday.json` が更新（**生成 schedule が fixtures/expected と一致**）、未来 event の `timetable_event_{YYYYMMDD}.json` 生成と `overrides` 追加、過去日 event のファイルは生成されない。`calendar_rules.json` に override 追加（手動キーは保持）、`state.json` 更新。レポートはテンプレ通り | ✅ **ローカルで確認済み**。weekday/holiday は**本番データと content 差分ゼロ**（＝画像から起こし直しても同一）、vacation 2件・event 1件を新規生成、手動 override 10件は無傷、`npm run validate:data` 合格 |
| AC-3 | AC-2 の直後に再実行 | 差分ゼロ（＝コミットが作られない）で冪等 | ✅ **ローカルで確認済み**（OCR 呼び出し 0回・ファイル書込 0件・override 差分 0件・`calendar_rules.json` と `state.json` が byte 一致） |
| AC-4 | **【v1.9 で定義変更】**変更が無い日に Actions が走る | コミットが作られず、**メールも届かない**。ジョブは緑で終わる | ⏸ **未検証**（Actions 実走が必要）。旧 AC-4「マージせず再実行したとき既存 PR が更新されるのみ」は PR 廃止により消滅 |
| AC-5 | `GEMINI_API_KEY` 未設定で実行 | OCR 対象が無ければ成功、有ればジョブ失敗（明確なエラー）。いずれも不正なファイルを書かない | ✅ 実装・確認済み（ドライラン時のみ情報警告を出してスキップ） |
| AC-6 | イベント取り込み・クリーンアップ（ロジック検証） | ユニットテスト 6（優先順位・クリーンアップ）と 4（event の assemble）で検証する | ✅ **テスト緑**（過去日の管理キー消滅＋event ファイル削除計画、state に無い event ファイルは削除しない、を含む） |
| AC-7 | **イベント実走** | 適用日より前の実行で `timetable_event_{YYYYMMDD}.json` 生成＋`overrides` 追加がコミットされ通知に出る。適用日経過後の実行で当該 override とファイルの削除がコミットされ通知に出る。`timetable_closed.json`・`_examples/` 配下は常に無傷 | ⏸ **未検証**。次の実走対象は **2026-08-23 オープンキャンパス**（削除の観測は 8/24 以降） |
| AC-8 | **【v1.9 追加】通知** | 時刻表が変わった実行でメールが届き、本文に発車時刻・元画像リンク・反映コミット URL・取り消し手順が含まれる。要手動確認があれば件名に ⚠ が付く。ジョブ失敗時は ❌ のメールが届く。変更も警告も無い日は届かない | ⏸ **未検証**（Actions 実走が必要） |

---

## 13. 実装フェーズ（Claude Code への指示単位）

| Phase | 内容 | 完了条件 | 状況 |
|---|---|---|---|
| 0 | `bot/` 雛形（package/tsconfig/config/types）、fetchPage/extractLinks/classify、holidays、state 読み書き、**ドライラン経路**、ユニットテスト 1–3,8 | AC-1 相当のドライランがローカルで通る | ✅ 完了（2026-08-01） |
| 1 | fetchImage/ocr/assemble/validate/files/calendar/レポート生成、ワークフロー YAML、テスト 4–7 | AC-2〜AC-5 | ✅ 完了（2026-08-01） |
| 2 | クリーンアップ動作の実地確認、STEP_SUMMARY、便数±50%警告、運用調整 | AC-6 | ✅ 実装済み・テスト緑。実走確認は AC-7 と同じく未了 |
| 3 | **【v1.9】自動適用と通知**: `prBody.ts` → `report.ts` への改称と発車時刻節の追加、便数 ±50% の MUST 化、ワークフローの適用・通知ステップ、文書更新 | AC-4 / AC-7 / AC-8 | ✅ リポジトリ側は完了（2026-08-16・テスト 156 件緑）。**実走確認は未了** |

※ローカル開発（Windows 11 / PowerShell）:
```powershell
cd bot
npm install
npx vitest run                       # ユニット/統合テスト
$env:DRY_RUN="1"; $env:SKIP_OCR="1"  # 無料枠を消費せず計画だけ見る
npx tsx src/index.ts
Remove-Item Env:\DRY_RUN, Env:\SKIP_OCR
npx tsx src/index.ts                 # 実走（public/data/ を書き換える）
npm run ocr:check -- fixtures/images/R8スクールバス時刻表.jpg fixtures/intermediate/regular.json
```
`GEMINI_API_KEY` は `bot/.env.local` に置く（git 管理外）。コード・コメントは日本語。

---

## 14. 運用（Runbook 抜粋）

- **通知メールの「要手動確認」がある**: 元画像リンクを開いて該当ファイルを手修正し、`main` へ直接コミットする
  （state は Bot が書いた値のままで良い。sha256 が記録済みなので再 OCR は走らない）。
- **【v1.10】通知メールを見て内容がおかしい**: メール末尾の「取り消したいとき」に従う。
  ① 該当コミットを revert（data と state が一緒に戻る）② **そのままでは翌日また同じ内容が反映される**ので、
  止めるなら手動で `timetable_special` の override を張るか、Actions でワークフローを Disable する
  ③ `bot/state.json` の該当キー削除は「わざと読み直させたいとき」だけ（停止手段ではない）。
- **モデル変更**: `config.ts` の `modelPrimary` を書き換えるだけ。切り替え前に
  `npm run ocr:check -- <画像> <正解fixture>`（`OCR_MODEL` で一時的にモデルを上書き可）で読み取り精度を確かめること。
- **【v1.5】無料枠を使い切った / 使いたくないとき**: `SKIP_OCR=1` を付けると OCR を通さずに
  抽出・分類・カレンダー計算だけ実行できる。RPD は太平洋時間の深夜（日本時間 16:00）にリセットされる。
- **【v1.5 / v1.10】通知メールに「呼び出し上限に達したためスキップ」が出た**: その画像は翌日の実行で自動的に再試行される。
  上限は **1 実行 18 回**と **1 日 18 回**の 2 つで、日次のほうは `bot/state.json` の `ocr_usage` に持ち越す。
  急ぐ場合でも**同じ日に再実行しても日次上限は増えない**。`geminiMaxCallsPerRun` / `geminiMaxCallsPerDay` を
  一時的に上げるか、翌日まで待つ（RPD は太平洋時間の深夜＝日本時間 16:00 リセット）。
- **【v1.10】通知メールに「取得の上限・締切に達した」が出た（`fetch_budget_exhausted`）**: 掲載リンクが異常に増えたか、
  配信ホストの応答が遅い。既存データは維持され、翌日の実行で再試行される。連日続くなら掲載ページと配信ホストを確認する。
- **【v1.10】通知メールに「同一 URL の画像が差し替わっていないか確認できませんでした」が出た（`image_revalidate_failed`）**:
  `info` のうちは一時障害の可能性が高い。`warn` に上がった（21 日以上確認できていない）場合は、配信ホストの変更や
  恒久的な取得障害を疑い、実 URL とホスト allowlist を確認する。
- **強制再 OCR**: `state.json` から該当キーを削除して push（次回実行で新規扱い）。※適用日がすべて過去の event は FR-4 のスキップ規則により削除しても再取込されない（過去分のダイヤを再生成したい場合は手動対応）。
- **誤反映の巻き戻し**: 該当コミットを revert（state も一緒に戻るので整合が保たれる）。**ただし state が戻る＝
  Bot にとっては「未処理」に戻るため、翌日の実行で同じ内容が再取得される。**恒久的に止めたい場合は
  手動 override を張る（Bot は手動キーに触れない）。急ぐ場合は Actions でワークフローを Disable する。
  **`bot/state.json` のキー削除は「読み直させる」操作であって停止手段ではない**（FR-11 の注記を参照）。
- **大学ページの構造変更（トリップワイヤー発火）**: ❌ の通知メール（および Actions の失敗通知）→
  `announceBoxSelector` / 抽出条件を実ページに合わせて修正。
- **【v1.9】メールが届かない**: ① Gmail 側で迷惑メール判定されていないか ② `MAIL_*` の 3 Secrets が正しいか
  （アプリパスワードは 16 文字・スペースなし）③ Actions の `Send notification` ステップのログ。
  送信に失敗するとジョブが赤くなるので、GitHub 標準の失敗通知が届く。
- **【v1.9】長期間メールが来ない**: 変更が無ければ届かないのが正常だが、**リポジトリに 60 日間コミットが
  無いと GitHub が scheduled workflow を自動 Disable する**（§10.1 の 4）。Actions 画面で有効状態を確認する。
- **無料枠変更で 429/権限エラーが続く**: フォールバックモデル運用 or AI Studio で枠確認。Bot の消費は微小なので、多くの場合は `geminiMinIntervalMs` 引き上げで足りる。

---

## 15. 既知の制約・残存リスク（合意済み）

1. **バス/JR 取り違え**は機械検証不能 → プロンプト＋2回照合＋**便数 ±50% ガード**＋**通知メールの発車時刻一覧**で抑止（残存リスクとして受容）。
   **【v1.9 で性質が変わった】** v1.8 まではここに PR レビューがあり、**誤りは公開前に止まった**。
   自動適用では**誤りは一度公開されてから気づく**ことになる。列の取り違えは便数が近いことも多く
   ±50% ガードをすり抜け得るため、**通知メールの「発車時刻」節を実際に読むこと**が最終防衛線である。
   気づいた場合の復旧は §14 の巻き戻し手順による。これは 2026-08-16 に「反映の遅れ」と
   「誤りの公開」を天秤にかけたうえでユーザーが受容した残存リスクである。
2. **分類キーワード依存**（通常/休暇/イベントの判定は `lineText` の語彙に依存）→ 不能時は needs_review に落ちる設計で安全側。
3. **Gemini 3.5 Flash の無料枠数値は非公表・変動** → フォールバック＋429 顕在化で対応。実値は導入時に確認。
4. **cron 遅延・60 日無効化・祝日 CSV の URL 変更歴** → 各所に注意として明記済み（§5, §10.1, FR-10）。
5. 本書の確認済みスナップショット（ページ構造・ライブ calendar_rules・テンプレファイル名）が実装時点で変わっている可能性 → 実装着手時に §7.4 と §3.3 の「実体確認」を必ず行う。
7. **【v1.5 追加】無料枠の RPD が小さい**（`gemini-3.5-flash` で実測 20/日）。通常運用（更新なし日 0 回・更新日 6〜9 回）には足りるが、
   ライブに大量の新規リンクが同時掲載された日や 503/429 が重なった日は `geminiMaxCallsPerRun` に達し、一部が needs_review になり得る。
   その場合は翌日の実行で自然に再試行されるため恒久的な取りこぼしにはならないが、**通知メールの「要手動確認」を必ず読むこと**。
8. **【v1.5 追加】期間ダイヤのうち「休暇語彙を持たないもの」は自動取込されない**（お盆特別ダイヤ等）。これは安全側の設計であり不具合ではないが、
   該当期間のダイヤは人が手動で用意する必要がある（`timetable_closed.json` の override 追加を含む）。⚠ の通知メールに URL が出るのでそれを起点に対応する。
9. **【v1.9 追加 / v1.10 で緩和】無変更が続くと稼働しているか分からない**。変更が無い日は通知を送らない設計のため、
   「静か＝正常」と「静か＝Bot が止まっている」を通知だけでは区別できなかった。**v1.10 で毎月 1 日の
   稼働確認メール（heartbeat）を追加**し、月単位では区別できるようにした。日単位の検知は依然できない
   （それには無変更でも毎日通知するか、外部の dead-man 監視が要る）。§10.1 の 4 と併せて読むこと。
10. **【v1.10 追加】job 全体への `contents: write`**。GitHub の permissions は job 単位でしか付けられないため、
   push 以外のステップ（`npm ci` や Bot 本体、後続 action）にも書き込み権限が及ぶ。push 専用 job への分離は
   作業ツリーの受け渡しが必要で複雑さに見合わないと判断し、**受容した**。緩和は、外部 action の full SHA 固定、
   fork / PR から起動しないこと、checkout が資格情報を残さないこと、runner が実行ごとに破棄されること。
11. **【v1.10 追加】同一 URL の再検証は「検証子が無ければ最長 7 日」**。ETag / Last-Modified を返さない配信元では、
   同一 URL での差し替えを最大 7 日見逃す。日次で毎回取り直せば 1 日になるが、大学サイトへの転送量が増える。
   NFR-8（アクセス礼節）との折り合いとして 7 日を選んだ。短くする場合は転送量の増加を許容できるか確認すること。
6. **状態依存記述の陳腐化リスク**: 本書の「確認済み」記述（ページ構造・ライブ掲載・リポジトリ実体）は執筆時点のスナップショットである。v1.3 の「ライブにイベントなし」「テンプレが timetables/ に実在」「CLAUDE.md に旧命名残存」はいずれも v1.4 時点で事実と不一致となり訂正済み。**実装着手時に §7.4 の実体と §4 のライブ状態を必ず再確認する**こと（旧命名 `timetable_spring_vac_*` はリポジトリから解消済みで対応不要）。

---

## 16. 実装・導入の役割分担

> **【v1.7 注記 / v1.9 更新】本節は 2026-07〜08 の導入時点の記録である。** C-1〜C-10 はすべて完了済み。
> 残っているのは §17.4 の人間タスク（H-2 / H-3' / H-9 と初回実走）だけ。本節に出てくる `_reviewRSD/` は
> 当時の作業ディレクトリ名で、**リポジトリには存在しない**（原本は `bot/fixtures/_planning/`）。
> 現在の運用手順を知りたい場合は本節ではなく `HANDOFF.md` を読むこと。

### 16.1 結論
本書を Claude Code に渡せば**コードと設定はほぼ全量を自動実装できる**が、**完全自動では完了しない**。理由は次の2系統が Claude Code の外にあるため。
- **(A) リポジトリ外の認証・権限・観測タスク**（API キー発行、Gmail アプリパスワード発行、GitHub Secrets、リポジトリ設定、通知メールの確認、デプロイ観測、無料枠確認）。
- **(B) 供給物の配置順序**。時刻表画像・正解 fixtures は当時リポジトリ内 `_reviewRSD/`（現在は存在しない。原本は `bot/fixtures/_planning/`）に置かれており、Claude Code は画像の閲覧も含めて扱えた（v1.3 の「Claude Code は画像を読めない」は誤りだったため訂正）。fixtures 配置は Claude Code の機械的コピー作業（C-10）で完結するが、**供給元ディレクトリの削除前に実施することが必須**という順序制約があった。**この制約は C-10 完了（2026-08-01）により解消済み。**

### 16.2 Claude Code が行う（リポジトリ内で完結）
| # | 作業 | 補足 |
|---|---|---|
| C-1 | `bot/` 一式の実装（§7.1 の全ファイル）：fetch/extract/classify/detect/ocr/assemble/validate/calendar/holidays/files/report/index | 本書 §8 が仕様の正本 |
| C-2 | `bot/package.json`・`tsconfig.json`・`.gitignore` 作成と `npm install`→`package-lock.json` 生成（§7.1, §5） | 依存はフロントと分離 |
| C-3 | `.github/workflows/timetable-sync.yml` 配置（§10 の要件どおり） | v1.9 で自動適用・通知の構成へ改修 |
| C-4 | ユニットテスト実装（§12.2 の 1〜8）と `vitest` 設定 | 正解データは C-7/C-10 供給分を使用 |
| C-5 | `bot/holidays.json` 初期キャッシュ生成＋`fixtures/holidays_sample.csv`（Shift_JIS）作成 | Claude Code は実行環境にネット接続があるため内閣府CSVを取得・エンコードできる。取得不可なら H-7 に降格 |
| C-6 | `fixtures/calendar_rules_live.json` を **HEAD の実体からコピー**して作成（§12.1） | |
| C-7 | `mediaResolution` 等 SDK の正確な enum/型を**インストール済み `@google/genai` の型定義で確定**（§8.5.1 の留保解消） | |
| C-8 | （v1.4 で解消済みのため作業なし）旧命名残存は確認の結果すでに存在しない | — |
| C-9 | ローカル/CI でのドライラン実行と全テストのグリーン化（§13 Phase 0〜2 の各完了条件） | 実 OCR を伴う検証は H-1 の鍵が前提 |
| C-10 | 供給元（当時 `_reviewRSD/`、現在の原本は `bot/fixtures/_planning/`）から `bot/fixtures/` への fixtures 複製（§12.1 の対応表どおり） | 旧 H-4 を移管。**2026-08-01 完了** |

### 16.3 人間（Nano）が行う（Claude Code 不可）
| # | 作業 | 手段 | これがないと | 状況（2026-08-16） |
|---|---|---|---|---|
| H-1 | Google AI Studio で **`GEMINI_API_KEY` を発行**（ローカル検証では `bot/.env.local` に置く） | AI Studio（Google ログイン要） | OCR 不能 | ✅ 完了（2026-08-01） |
| H-2 | GitHub に **`GEMINI_API_KEY` を登録** | `Settings → Secrets and variables → Actions`（または `gh secret set`） | Actions 実行時に OCR 不能 | ⏸ 未了 |
| H-3' | **Workflow permissions を「Read and write permissions」に**する | `Settings → Actions → General` | **main への push が失敗する** | ⏸ 未了 |
| ~~H-3~~ | ~~「Allow GitHub Actions to create and approve pull requests」を有効化~~ | — | — | **【v1.9】不要になった**（PR を作らない） |
| H-4 | （C-10 に移管・完了） | — | — | ✅ |
| H-5 | **【v1.9 で変更】通知メールを読む**（元画像と発車時刻を突き合わせる。問題なければ何もしない） | メール本文の「発車時刻」節と元画像リンク | 誤ったダイヤが公開されたまま残る | 運用時 |
| H-6 | **Cloudflare Pages デプロイ反映を確認** | Pages のデプロイ履歴／実機 | — | 運用時（初回のみ必須。以降は随時） |
| H-7 | （C-5 が不可だった場合のみ）祝日 CSV 取得・初期キャッシュの手当て | 手動 DL → 配置 | 祝日 baseline 不可 | ✅ 不要（C-5 完了） |
| H-8 | AI Studio で**無料枠 RPM/RPD を確認**し必要なら `geminiMinIntervalMs` 調整 | AI Studio のレート制限画面 | 429 のリスク評価 | ✅ 一部判明: `gemini-3.5-flash` は **RPD=20**（§8.5.5）。新 primary `gemini-3.6-flash` の実値は要確認 |
| H-9 | **【v1.9 追加】Gmail のアプリパスワードを発行し、`MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_TO` を Secrets に登録** | Google アカウント（2 段階認証が前提）→ `Settings → Secrets and variables → Actions` | **通知が一切届かない**＝自動適用の内容を誰も確認できない | ⏸ 未了 |

> H-2 / H-3' / H-9 は `gh` CLI が admin 権限で認証済みなら Claude Code に代行させることも技術的には可能。ただし秘密情報の取り扱いとリポジトリ権限変更は**人間が明示実施するのが安全**なので、本書では人間タスクとする。

#### 16.3.1 画像由来 fixtures（C-10 の中身・供給元）
| ファイル（`bot/fixtures/` 配下） | 供給元 | 状態 |
|---|---|---|
| `expected/timetable_weekday.json` | `bot/fixtures/_planning/timetable_weekday.json`（画像との一致検証済み） | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |
| `expected/timetable_holiday.json` | `bot/fixtures/_planning/timetable_holiday.json` | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |
| `expected/timetable_event_20260614.json` | `bot/fixtures/_planning/timetable_event_20260614.json` | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |
| `expected/timetable_event_20260620.json` | `bot/fixtures/_planning/timetable_event_20260620.json` | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |
| `intermediate/regular.json` | `bot/fixtures/_planning/intermediate_regular.json` | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |
| `intermediate/event_20260614.json` | `bot/fixtures/_planning/intermediate_event_20260614.json` | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |
| `intermediate/event_20260620.json` | `bot/fixtures/_planning/intermediate_event_20260620.json` | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |
| `page_snapshot.html` | **原本 `bot/fixtures/_planning/page_snapshot.html` を複製**（ライブ再取得は不可：イベント構成が変わると §12.2 テスト1の前提が崩れるため、この凍結スナップショットを使う） | 複製済み（2026-08-01・C-10）。原本は `_planning/` に残置 |

### 16.4 役割の境界（誤解防止）
- Claude Code は **OCR の精度を保証しない**。fixtures による検証は assemble/validate/calendar の**ロジック**を保証するもので、実画像に対する読み取り精度は実行時の 2 回照合＋便数ガード＋**事後のメール確認（H-5）** で担保する。
- **【v1.9 で変更】反映は Bot が自動で行う**。v1.8 までの「Claude Code は PR を作るところまで。マージは常に人間」は、
  適用が自動になったことで成立しない。人間の役割は**事後にメールを読み、必要なら巻き戻す**ことへ移った（§14）。
- Claude Code は **calendar_rules の手動キーを生成も削除もしない**実装を作るが、既存の手動 override の正しさ自体は人間の責任領域。

---

## 17. 導入シーケンス（推奨手順）

### 17.1 実施済み（2026-08-01）

```
[Claude Code] C-10 fixtures を `bot/fixtures/_planning/` から `bot/fixtures/` へ複製（原本は残す）
[Claude Code] Phase 0: 雛形・抽出・分類・祝日・state・ドライラン経路 + テスト1-3,8
        → ローカルで DRY_RUN=1 のドライランが通り、テスト緑（AC-1 相当）
[Claude Code] Phase 1: OCR・組立・検証・calendar・レポート生成 + ワークフロー YAML + テスト4-7
[人間]        H-1 Gemini APIキー発行 → bot/.env.local に配置
[Claude Code] 実 API での検証:
        - ocr-check で通常ダイヤ画像・夏季休暇画像とも正解 fixture と完全一致を確認
        - ローカル実走（AC-2 相当）→ git diff で内容確認 → npm run validate:data 合格
        - 再実行で差分ゼロ（AC-3 相当）を確認
[Claude Code] Phase 2: STEP_SUMMARY・便数±50%警告・本書 v1.5 更新
```

### 17.2 実施済み（2026-08-02）

```
[Claude Code] 特別ダイヤ（timetable_special）の新設 — フロント・データ・Bot・本書 v1.6
[人間]        お盆ダイヤ（8/8〜）を手動で投入（8/8-11 obon / 8/12・16 special / 8/13-15 closed）
[人間]        sandbox → main へマージ
[人間]        Actions → timetable-sync を手動 Disable
[検証]        本番サイトで overrides 24件・時刻表4ファイル・JS バンドルの
              SHA-256 一致を確認（2026-08-02）
```

**当初は「H-2/H-3（当時）を済ませてから main へマージ」という順序だったが、お盆ダイヤ（8/8 開始）を
本番へ届ける必要が生じたため、マージを先行させ、代わりにワークフローを Disable する形に変えた。**
結果として「コードは本番、日次実行は保留」という状態になっている。

### 17.3 実施済み（2026-08-16）

```
[ユーザー決定] PR 承認フローを廃止し、取得から本番反映までを自動化する。
               変更があったときだけメールで通知する（送信元は Gmail、適用は main へ直接コミット、
               無変更日は通知しない）。
[Claude Code] Phase 3: bot/src/report.ts（発車時刻節・取り消し手順）、便数 ±50% の MUST 化、
               index.ts の GITHUB_OUTPUT 出力と終了コード方針の変更、
               ワークフローの適用・通知ステップ、本書 v1.9 と docs/・HANDOFF の更新
        → ローカルで vitest 156 件・tsc --noEmit 合格（2026-08-16）
```

**旧 §17.3「残（2026-08-23 前後に実施）」は、PR 作成権限の有効化と初回 PR レビューを
含んでいたため、この方針転換で内容が変わった。現行の残作業は §17.4 を見ること。**

### 17.4 残（稼働のために人間が行う）

```
[人間] H-9 Gmail のアプリパスワード発行         ← 2 段階認証が前提
        ↓
[人間] H-2 GEMINI_API_KEY を Secrets へ登録
       H-9 MAIL_USERNAME / MAIL_PASSWORD / MAIL_TO を Secrets へ登録
       H-3' Workflow permissions を Read and write に
        ↓
[人間] Actions → timetable-sync → Enable workflow  ← 手動 Disable を解除
        ↓
[人間] workflow_dispatch(dry_run=true)  → 計画ログを確認（変更もメールも起きない）
       workflow_dispatch(dry_run=false) → 初回の自動適用。main にコミットが増え、
                                          メールが届くこと（AC-8）を確認
        ↓
[人間] H-6 Cloudflare Pages のデプロイと実機を確認
        ↓
[人間] AC-4 の確認（変更が無い日にコミットもメールも発生しないこと）
[人間] AC-7 の確認（2026-08-23 オープンキャンパスの override とファイルが
       適用日経過後に削除されること。8/24 以降の実行で観測できる）
[人間] H-8 新 primary（gemini-3.6-flash）の無料枠実値を確認・必要なら間隔/上限を調整
```

- **依存の急所**:
  - **H-3'（Read and write permissions）未実施だと最初の実行で push が失敗する。**
  - **H-9（メール Secrets）未実施だと通知が届かず、自動適用の結果を誰も確認できない**
    （＝人間ゲートも通知も無い状態になるので、Enable より先に済ませる）。
  - 初回はメールが迷惑メールに入りやすい。届かないときは必ずスパムフォルダを確認する。
- **作業手順の具体（GitHub の画面操作・切り分け表・ローカル再現）は `HANDOFF.md` §3〜5 にまとめてある。**
  次に着手する人（人間・AI とも）はまずそちらを読む。
- **【v1.5 重要 / v1.6 で状況更新】GitHub Actions の `schedule` / `workflow_dispatch` はデフォルトブランチにワークフローファイルがある場合のみ動作する。**
  この前提は main 統合（2026-08-02）で満たされた。**現在停止しているのは手動 Disable によるもの**なので、
  稼働させるには Actions 画面で Enable する。それまでの検証は引き続きローカル実行で行う（§12.3 の注記）。
- **鍵なしでも進む範囲**: `SKIP_OCR=1` を付ければ抽出・分類・祝日・カレンダー計算まで無料枠を消費せず検証できる。
