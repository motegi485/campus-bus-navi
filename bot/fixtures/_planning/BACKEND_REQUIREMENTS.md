# campus-bus-navi バックエンド（時刻表自動取り込みBot）要件定義書

| 項目 | 内容 |
|---|---|
| 文書バージョン | 1.4（リポジトリ・ライブ実態との再同期＋分類/取込規則の厳密化） |
| v1.1 変更点 | §3.1 SW プレキャッシュ挙動の正確化／§3.3 旧スナップショット混在の明記／§7.1 lockfile コミット必須／§7.4 テンプレ実名の確定／FR-9 手動キー欠損の情報警告追加／§15-6 追加 |
| v1.2 変更点 | §16（実装・導入の役割分担：Claude Code / 人間の分界と画像由来 fixtures の供給元）・§17（導入シーケンス）を追加 |
| v1.3 変更点 | ライブからイベント画像が削除された事実を反映：§12.1（page_snapshot は歴史的スナップショット・images/ 追加）・§12.3（実環境AC を「通常ダイヤのみ」に再構成、イベント経路はユニットテストへ、AC-7 追加） |
| v1.4 変更点 | 2026-07-07 の実地検証を反映：§3.1 プレキャッシュ記述の訂正（データJSONは globIgnores で除外済・NetworkFirst 3秒）／§3.4 に closed 追加／§4 命名非依存原則・画像レイアウト2種・除外根拠訂正・robots.txt／FR-2〜FR-5・FR-7・FR-9 の規則追加（空白許容日付パース・未来 start の regular 保留・過去 event スキップ・「日付ちょうど1つ」規則・event name 生成元確定・警告2種）／§7 保護ファイルの実態反映（テンプレは _examples/ へ移動済み・timetable_closed.json 明記）／§9 state スキーマ統一／§12 AC 再構成（AC-7 は 2026-07-18 で実走可）／§15-6・C-8 削除／§16-17 役割分担更新（fixtures 配置は C-10 化、_reviewRSD 削除前に複製必須） |
| 作成日 | 2026-06-13 |
| 位置づけ | **実装の正本**。BACKEND_DESIGN.md（v2ドラフト）と矛盾する場合は本書が優先する |
| 実装者 | Claude Code（本書を実装指示書として渡す） |
| 主要な訂正（v2ドラフトから） | ① SDKは `@google/genai`（旧 `@google/generative-ai` は使用禁止） ② Gemini 3系は **temperature を指定しない**（公式推奨。temp 0 指定は誤り） ③ `thinking_level` / `media_resolution` を使用 ④ create-pull-request は **v8** ⑤ 出力先は `public/data/timetables/` |

---

## 1. 目的とスコープ

### 1.1 目的
福山大学公式サイトに不定期掲載されるスクールバス時刻表画像を**日次で自動巡回**し、新規・変更を検知したら **Gemini API で画像→JSON 化**し、フロントエンド（campus-bus-navi PWA）が読む `public/data/` 配下のデータファイルを更新する **Pull Request を自動作成**する。**main への直接 push は行わず、人（Nano）が PR をレビューしてマージする。**

### 1.2 スコープ（v1 で全部実装する）
- 通常ダイヤ（授業日／休業日）の取り込み
- 長期休暇ダイヤ（春季・夏季・冬季 × 平日／休日）の取り込みと期間 override 生成
- イベントダイヤ（単日）の取り込みと override 生成
- 祝日の自動 override 生成（内閣府CSV由来）
- 期限切れデータのクリーンアップ（PR 経由）
- ドライラン（変更計画のログ出力のみ）

### 1.3 スコープ外
- JR 松永駅の時刻表（画像内に同居するが**読み取らない**。将来拡張候補）
- フロントエンドコードの変更（`src/`、`vite.config.ts`、`index.html` 等には**一切触れない**）
- `news.json` の自動更新
- 直接 push、自動マージ

### 1.4 大原則（違反禁止）
1. **無料運用**: GitHub Actions（公開リポジトリ）＋ Gemini API 無料枠のみ。
2. **キー非露出**: `GEMINI_API_KEY` は GitHub Secrets にのみ保管。クライアント・リポジトリ内ファイルへ書かない。
3. **人間レビュー**: 反映は必ず PR 経由。Bot は削除を含む全変更を PR に載せる。
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
- **【確認済みの付随挙動・2026-07-07 HEAD】** `vite.config.ts` の `globPatterns` は `json` を含むが、`globIgnores: ['data/**/*.json']` により **`/data/**` の JSON は SW プレキャッシュから除外されている**。したがって**データのみのマージでは precache manifest は変化せず、UpdateBanner（更新通知）は表示されない**。既存クライアントは次回起動時の NetworkFirst（通常起動・手動更新 `?t=` 付き・お知らせ取得のすべてがこの経路を通る）で新鮮なデータを取得し、取得済み分がオフライン用フォールバックになる。この挙動は `globIgnores` の除外設定に依存しており、フロント側でこれを外すと壊れる（CLAUDE.md にも明記あり）。Bot 側の対応は不要（マージ後に観測される正常挙動としてここに明記する）。

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
| 長期休暇・平日 | `timetable_vacation_{season}_weekday` | `vacation` を含む（`holiday` 判定より先） |
| 長期休暇・休日 | `timetable_vacation_{season}_holiday` | `vacation` かつ `holiday` |
| イベント | `timetable_event_{YYYYMMDD}` | `event` を含む |
| 全便運休日 | timetable_closed | closed を含む（判定は最優先） |

- **`timetable_closed`（全便運休ダイヤ）は Bot の生成・更新・削除の対象外**。`schedule` を空配列にした手動運用ファイルで、人が overrides から参照させて使う。判定順序は closed → event → vacation → holiday → weekday（`DayBadge.tsx` の実装と一致することを 2026-07-07 に確認済み）。
- `{season}` ∈ `spring` / `summer` / `winter`。**年を含めない**（季節ごとに上書き）。
- `{YYYYMMDD}` は**適用日**。1日1ダイヤなので一意（ユーザー決定）。
- **ID 文字列に `vac` 等の短縮形を使わない**（`vacation` 完全一致包含が必須）。

### 3.5 既存ファイルの更新ポリシー（ユーザー決定 C）
- **既存ファイルは `routes.*.schedule` 配列のみ置換**。`id`・`name`・`origin`・`destination`・`bus_stop_name`・`bus_stop_coords` その他のフィールドとキー順は保持する（`JSON.parse` → schedule のみ代入 → `JSON.stringify(obj, null, 2) + "\n"`。JS のキー挿入順保持に依る）。
- 新規作成時のみ §8.6.4 の既定 `name` を設定する。

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
- regular / vacation 画像: 上段「授業日」・下段「休業日」。各段にスクールバス（**時｜松永発｜時｜大学発** — 松永発と大学発が**それぞれ専用の「時」列を左隣に持つ**4列グループ）と **JR 松永駅時刻表（上り福山方面／下り尾道方面）が同居**。
- event 画像: 「松永発｜**時**｜大学発」の1テーブルのみ（1種別）。regular と異なり**中央の「時」列を両方向で共有**する。**表レイアウトが画像種別で異なる**ため、単一の固定列マッピングを前提にした実装・プロンプトは誤抽出のもと（§8.5.3 規則4参照）。
- いずれも電子生成画像（Excel系）。セル内に2桁の「分」が横位置バラバラに 0 個以上並ぶ。
- **重大リスク**: JR 列の時刻もバスと同形式（`HH:mm` 相当）のため、取り違えはスキーマ検証で検出不能。OCR プロンプト（§8.5.3）と PR レビューで防ぐ。
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
| OCR モデル | 既定 **`gemini-3.5-flash`**（2026-05-19 GA）／フォールバック **`gemini-3.1-flash-lite`** | config で差し替え可能。§8.5.5 |
| 生成設定 | `responseMimeType: 'application/json'` + `responseSchema`、`thinkingConfig: { thinkingLevel: 'low' }`、画像 Part に `media_resolution_high` | **temperature / top_p / top_k は設定しない**（Gemini 3 公式推奨: 既定 1.0 のまま。低温指定はループ・劣化要因）。決定性は「2回読み照合」(§8.5.4) で担保 |
| HTML パース | `cheerio` ^1 | |
| 検証 | `zod` ^4 | |
| 文字コード | `iconv-lite` | 祝日CSV（Shift_JIS）デコード用 |
| 日時 | `dayjs`（`utc`/`timezone`、`Asia/Tokyo` 固定） | フロントと同一流儀 |
| HTTP | Node 組み込み `fetch` | UA: `campus-bus-navi-bot/1.0 (+https://github.com/motegi485/campus-bus-navi)` |
| ハッシュ | `node:crypto` SHA-256 | |
| テスト | `vitest` | フィクスチャ駆動（§12） |
| PR 作成 | **`peter-evans/create-pull-request@v8`** | checkout は `actions/checkout@v6`、Node は `actions/setup-node` 現行版（v5系） |
| 祝日データ | 内閣府 CSV `https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv` | CC-BY。Shift_JIS・CRLF。1行目ヘッダ `国民の祝日・休日月日,国民の祝日・休日名称`、データ行 `YYYY/M/D,名称`（月日ゼロ埋めなし）。振替休日込み。1955年〜翌年分。**URL は過去に一時変更歴ありのため config 化＋キャッシュフォールバック必須** |

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
     9. validate       : Zod + 整合検証。NG はファイル不出力＋PR 警告
    10. writeFiles     : timetables/ へ書き込み（§3.5 ポリシー、保護ファイル除外）
    11. updateCalendar : 望ましい管理 override 集合を計算 → overrides 差し替え（手動不可侵）
    12. cleanup        : 過去日付の管理 override・event ファイル削除（計画を PR に明記）
    13. writeState     : bot/state.json 更新（PR に同梱 → マージ時に確定）
    14. prBody         : bot/.out/pr-body.md 生成（git 管理外）
  └─ peter-evans/create-pull-request@v8
     : 差分があれば単一ローリングブランチ bot/timetable-sync を更新し PR 作成/更新
人がレビュー＆マージ → Cloudflare Pages（GitHub App 連携）が main push を検知して再デプロイ
```

**状態確定の仕組み**: Bot は常に main をチェックアウトして state.json を読む。PR 未マージのうちは main の state が旧いままなので、再実行は同じ差分を再計算して**同一ブランチを上書き更新**するだけ（PR 重複なし・冪等）。マージされて初めて state が前進する。

**注意（既知の仕様）**: `GITHUB_TOKEN` で作成した PR は他の Actions ワークフローを**トリガーしない**。本プロジェクトの CI は存在せず、デプロイは Cloudflare Pages の GitHub App 連携（Actions ではない）なので影響なし。将来 main への push をトリガーとする Actions を追加する場合は PAT 等の検討が必要（現時点では不要）。

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
│   │   ├── fetchPage.ts
│   │   ├── extractLinks.ts     # 抽出＋分類＋日付解析（§8.2〜8.3）
│   │   ├── detectChanges.ts
│   │   ├── fetchImage.ts
│   │   ├── ocr.ts              # Gemini 呼び出し（§8.5）
│   │   ├── assemble.ts         # §8.6
│   │   ├── validate.ts         # §8.7
│   │   ├── calendar.ts         # §8.8（overrides 計算・クリーンアップ）
│   │   ├── holidays.ts         # §8.9
│   │   ├── files.ts            # 読み書き・保護ファイルガード・JSON 整形規約
│   │   └── prBody.ts
│   ├── test/                   # vitest（§12）
│   ├── fixtures/               # §12.1 正解データ
│   ├── state.json              # §9（初期値 { "version": 1 }）
│   ├── holidays.json           # 祝日キャッシュ（初期値は実装時に1度取得して同梱）
│   ├── .out/                   # 実行時生成物（pr-body.md）。.gitignore 対象
│   ├── .gitignore              # .out/ , node_modules/
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

  modelPrimary: 'gemini-3.5-flash',
  modelFallback: 'gemini-3.1-flash-lite',
  geminiMinIntervalMs: 6000,          // 無料枠RPM対策: 呼び出し間隔の下限
  geminiMaxRetries429: 3,             // 429: 30s/60s/120s 指数バックオフ

  holidayCsvUrl: 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv',

  dataDir: 'public/data/timetables',
  calendarRulesPath: 'public/data/calendar_rules.json',
  statePath: 'bot/state.json',
  holidaysCachePath: 'bot/holidays.json',
  prBodyPath: 'bot/.out/pr-body.md',

  seasonMap: { '春': 'spring', '夏': 'summer', '冬': 'winter' } as const,
  vacationKeywords: ['休暇', '春休み', '夏休み', '冬休み'],

  protectedFiles: [                    // §7.4。書込/削除はホワイトリスト方式が正であり、これは追加の明示ガード
    'timetable_closed.json',           // 全便運休ダイヤ（手動運用）。Bot は読み書き・削除しない
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
| `GEMINI_API_KEY` | ✔ | Gemini API。GitHub Secrets から注入 |
| `DRY_RUN` | – | `1` でファイル書込・PR をスキップし、変更計画を JSON でログ出力 |
| `TZ` | – | ワークフローで `Asia/Tokyo` を設定（日付演算の事故防止。コード側でも dayjs.tz を明示） |

### 7.4 保護ファイル（FR-PROT）
- **実体（2026-07-07 HEAD で確認済み）**: `public/data/timetables/` に存在するのは本番3ファイル（`timetable_weekday.json`・`timetable_holiday.json`・`timetable_closed.json`）のみ。テンプレート（`timetable_vacation_SEASON_weekday.json`・`timetable_vacation_SEASON_holiday.json`・`timetable_event_YYYYMMDD.json` 等）は **`public/data/_examples/` へ移動済み**で、Bot の入出力ディレクトリ（`CONFIG.dataDir`）の外にある。`timetable_event_temp.json` はリポジトリに存在しない。
- **防御はホワイトリスト方式を正とする**: `files.ts` は、書込を `^timetable_(weekday|holiday)\.json$`・`^timetable_vacation_(spring|summer|winter)_(weekday|holiday)\.json$`・`^timetable_event_\d{8}\.json$` に合致するファイル名のみに、削除を `^timetable_event_\d{8}\.json$` のみに許可し、それ以外への書込・削除要求は例外を投げる。`timetable_closed.json`・`_examples/` 配下・その他の未知ファイルは構造的に対象外となる。
- `CONFIG.protectedFiles`（現在は `timetable_closed.json` のみ）は上記に加えた明示ガードであり、リストのファイルが存在しなくてもエラーにしない。Bot は `public/data/_examples/` に一切アクセスしない。

---

## 8. 機能要件

### FR-1: ページ取得（fetchPage）
- `CONFIG.pageUrl` を GET（UA 付与、タイムアウト 30s、3xx 追従）。
- 非 200・ネットワーク失敗 → **ジョブ失敗（exit 1）**。この時点で一切の変更を行っていないため安全。

### FR-2: リンク抽出（extractLinks）
1. `cheerio` でロードし、`div.md-box a[href]` を全走査。
2. 条件: (a) `decodeURIComponent(href)` が `imageExtPattern` に一致、かつ (b) アンカーテキストに `時刻表` を含む。**2条件 AND**（2シグナル）。
3. 各ヒットについて、**アンカーの最近接ブロック要素（`<p>` 等）のテキスト全体**（リンク含む行）を `lineText` として取得。同一ブロック内に対象アンカーが複数ある場合は `<br>` でテキストを分割し、当該アンカーを含むセグメントを `lineText` とする（スナップショット実測では 1 `<p>` に 1 リンクだが、将来のマークアップ変化への防御）。
4. URL 正規化: デコード、相対→絶対化。同一正規化 URL は重複排除。
5. **トリップワイヤー**: ページ取得成功かつヒット 0 件 → エラーログ（「ページ構造変更の可能性。セレクタ確認要」）を出して **exit 1**。削除・state 変更は行わない。「前回より減った」では発火させない（イベントは正当に消えるため）。
6. **サイレント欠落対策（警告・処理は続行）**: (a) href が `imageExtPattern` に一致するが条件 (b)（『時刻表』文言）に不一致で、かつ `lineText` に FR-3 の日付パターンを含むアンカーがあれば、needs_review 警告として PR/ログに URL を記載する（リンク文言の変更による取りこぼしの検知。乗り場写真・キャンパスマップは日付を含まないため誤発火しない）。(b) `state.regular` が存在するのに今回 regular リンクが 1 件も抽出できなかった場合、情報警告を PR/ログに記載する（既存の weekday/holiday の削除・変更は行わない）。

### FR-3: 分類・日付解析（classify）
`lineText` を前処理（全角数字→半角、全角空白 U+3000→半角空白、**連続する空白は 1 つに圧縮**、波ダッシュは `U+FF5E ～` と `U+301C 〜` の両方を許容〔スナップショット実測は U+FF5E〕）してから:

| 優先 | 判定 | 種別 | 取得値 |
|---|---|---|---|
| 1 | `vacationKeywords` のいずれかを含む | **vacation** | season（`seasonMap` の漢字 1 文字を検索。`春季/夏季/冬期/冬季/春休み…` を吸収）、期間 `start`〜`end`（`(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日` を行内から最大2つ抽出（**年月日の間の空白を許容** — 2026-07 ライブの「2026年 7月  5日」形式に対応。年なし形は `(\d{1,2})月\s*(\d{1,2})日`）。`～` 区切り） |
| 2 | 日付が1つ以上あり `～` を**含まない** | **event** | 行内の**全日付**（複数日掲載に対応。各日付ごとに 1 ファイル＋1 override を生成、OCR は 1 回で結果を共用）、label（行から日付・曜日括弧・記号・「時刻表はコチラ」を除去した残り。例 `日商簿記検定試験日`→ trim） |
| 3 | 日付が**ちょうど1つ**＋`～` あり | **regular** | 開始日（情報としてログ・PR に記載。処理上は常設扱い）。※日付が2つ以上あるのに `vacationKeywords` に不一致の行（例: 語彙が「休業」等に変わった長期休暇告知）は regular に落とさず **needs_review**（通常ダイヤを休暇ダイヤで上書きする事故の防止） |
| 4 | 上記いずれにも該当しない | **needs_review** | OCR せず PR 警告のみ（「分類不能の時刻表リンクあり」＋URL） |

補助規則:
- 2つ目の日付に年が無い場合（例 `8月1日～9月20日`）: 開始日と同年。それでも `end < start` なら end に +1 年。
- 年が完全に無い日付: 現在 JST 年を補い、結果が `today - 180日` より過去なら +1 年。**推定した場合は PR に「年推定」フラグ**。
- vacation で end が取れない場合: ファイル生成と OCR は行うが **override 生成をスキップ**し、PR に「期間不明・手動で override 追加要」警告。
- event の label（lineText 由来）は PR 表示・ログ用。**timetable の `name` 生成には OCR の day_type ラベルを使う**（FR-7 の 5 参照）。

### FR-4: 変更検知（detectChanges）
- 論理キー: regular は固定キー `regular`、vacation は `vacation:{season}`、event は `event:{YYYY-MM-DD}`（複数日イベントは画像単位で `event:{最初の日付}` をキーにし、`dates[]` を保持）。
- 判定: state に同キーが**無い** → 新規。**URL が異なる** → 画像 DL → **SHA-256 が state と同じなら「URL のみ変更」として state の URL を更新するだけ（OCR しない）**、異なれば変更として OCR。URL 同一 → スキップ（日次の通常ケース。Gemini 呼び出し 0 回）。
- vacation/event の `dates`・期間がテキスト側だけ変わった場合（画像同一）も override 再計算には反映する（OCR 不要）。
- **regular の適用開始日が未来（start > today JST）の場合は取り込まない**（画像 DL・OCR・state 書込のいずれも行わない）。ログおよび（他に変更があれば）PR に「将来開始の通常ダイヤを検知（YYYY-MM-DD〜）。開始日以降に自動取込」と情報記載し、毎日再評価して today ≥ start となった実行で通常フローに乗せる（現行ダイヤの前倒し上書き防止）。
- **regular リンクが複数併存する場合**（前期・後期の移行期等）: start ≤ today のうち start が最新の 1 件を採用し、他はログに記録する。start が解析できない regular リンクは needs_review。
- **event は dates[] の全日付が today より過去ならスキップ**（画像 DL・OCR・state 書込を行わない。ログのみ）。一部の日付のみ過去の複数日イベントは、**today 以降の日付についてのみ**ファイル・override を生成し、過去日はログに記録する。
- **state.events のプルーニング**: writeState 時、dates の全日付が today より過去のエントリは state から削除する（上記スキップ規則により再取込は発生しないため安全。ファイル削除は FR-9、override の消滅は FR-9 の「today 以降のみ」規則が担う）。

### FR-5: 画像取得（fetchImage）
- `resizedSuffixPattern` に一致する URL は、サフィックス除去した**原寸 URL を先に試行**。非 200 ならリンク記載 URL にフォールバック。
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
```
あなたは福山大学スクールバス時刻表画像の読み取り器です。
画像から「スクールバスの発車時刻」だけを抽出し、指定スキーマのJSONのみを返してください。

厳守事項:
1. 抽出対象は「スクールバス時刻表」の2列のみ:
   - "松永発"（→ matsunaga）
   - "大学発"（→ university）
2. 「JR」「松永駅」「上り」「下り」「福山方面」「尾道方面」と書かれた列・表は鉄道の時刻表です。
   これらは絶対に含めないでください。バスとJRの時刻は形式が似ているため、列の見出しを必ず確認し、
   取り違えを厳禁とします。
3. 画像に「授業日」「休業日」のように複数のダイヤ種別がある場合、day_typesの別要素として
   両方を抽出してください。種別が1つしかない画像はday_typesを1要素にしてください。
4. 表のレイアウトは2種類あります:
   - 通常/休暇ダイヤ画像:「時｜松永発｜時｜大学発」のように、松永発と大学発が
     それぞれ専用の「時」列を左隣に持ちます。各方向は必ず自分の左隣の「時」列と
     組にして読んでください。
   - イベントダイヤ画像:「松永発｜時｜大学発」のように、中央の「時」列を両方向で
     共有します。
   各時間帯セルには2桁の「分」が0個以上書かれています。書かれている分をすべて
   minutesに列挙してください。存在しない時刻を捏造しない。存在する時刻を省略しない。
   発車のない時間帯（空のセル）はminutesを空配列[]にしてください。空の行を
   読み飛ばして後続の行を繰り上げないでください（各行は必ず「時」列の値と組で読む）。
5. labelは画像内の表記をそのまま使ってください。
6. 出力はJSONのみ。説明文・マークダウン・コードフェンスを含めないでください。
```

#### 8.5.4 2回読み照合（決定性の担保）
1. 同一画像で `generateContent` を 2 回実行（呼び出し間隔 ≥ `geminiMinIntervalMs`）。
2. 正規化（day_types を label 昇順、各 rows を hour 昇順、minutes を昇順・重複除去）して deep-equal 比較。
3. 一致 → 採用。不一致 → 3 回目を実行し、**3 つのうち 2 つが一致すればそれを採用**（PR に「3回読み・多数決採用」注記）。全不一致 → その画像は **needs_review**（ファイル不出力、PR に元画像 URL と不一致箇所を記載）。
4. 1 画像あたり Gemini 呼び出しは最大 3 回。

#### 8.5.5 モデル・レート制御
- 429: 30s → 60s → 120s の指数バックオフで最大 3 リトライ。なお失敗ならジョブ失敗（**黙って成功扱いにしない**）。
- モデル不存在/権限エラー（無料枠から対象モデルが外れた場合等）: `modelFallback` で 1 回だけ再試行し、成功時は PR 本文に「フォールバックモデル使用」を明記。フォールバックも失敗ならジョブ失敗。
- 想定呼び出し回数: 更新なし日 0 回／更新日 = 変更画像数 × 2〜3 回（典型 2〜9 回）。無料枠 RPD に対し十分小さいが、無料枠の正確な数値は変動するため**実値は AI Studio のプロジェクト画面で確認**して運用する。

### FR-7: 組み立て（assemble）
入力: 中間構造 + 種別 + メタ。出力: §3.2 形式の timetable オブジェクト（種別ごとに 1〜2 個）。
1. 各方向: 全 `(hour, minutes[])` を `HH:mm`（ゼロ埋め）へ展開 → 昇順整列 → 重複除去。
2. `note`: 末尾（その方向の最終便）のみ `"最終"`、他は `""`。**「最終」は画像に存在しない Bot 付与の推論情報**（§4.3）。
3. day_type → 出力ファイルのマッピング:
   - regular: label に `授業` または `平日` を含む → `timetable_weekday`、`休業`・`休日`・`土日`・`祝` のいずれかを含む → `timetable_holiday`。両方に振れない/重複 → needs_review。
   - vacation: 同上の label 判定で `timetable_vacation_{season}_weekday` / `_holiday`。
   - event: day_types は 1 要素のはず（2 要素なら needs_review）。`dates[]` の各日付につき `timetable_event_{YYYYMMDD}` を同内容で生成。
4. メタ: 既存ファイルがあれば **schedule のみ差し替え**（§3.5）。新規なら `CONFIG.busStops` と `newFileNames` で全体を構築し、`id` = ファイル名（拡張子なし）。
5. **event の `name`**: `${day_types[0].label}ダイヤ`（**OCR の day_type ラベル基準**。fixtures の期待値「簿記検定ダイヤ」「オープンキャンパスダイヤ」と一致する）。OCR ラベルが空・空白のみの場合は lineText 由来の label（FR-3）にフォールバックする。既存ファイル更新時は §3.5 のとおり `name` は保持。

### FR-8: 検証（validate / zod）
ファイル出力前に各 timetable オブジェクトへ適用。**1 つでも失敗したらそのファイルは書かず**、対応する override も生成せず、PR に「要手動確認」として理由・元画像 URL を記載する。
- `departure` が `^([01]\d|2[0-3]):[0-5]\d$`。
- 各方向: 厳密昇順（重複不可）、件数 ≥ 1、全時刻が 05:00〜23:59。
- `note`: 末尾要素のみ `最終`、それ以外は空文字。
- `id` === ファイル名（拡張子なし）。`routes` のキーが `station_to_campus` / `campus_to_station` の 2 つ丁度。
- 2回読み照合が成立していること（§8.5.4）。
- （SHOULD・警告のみ）既存ファイル更新時、便数変化が ±50% 超なら PR に注意書き。

### FR-9: カレンダー更新（calendar）— 中核アルゴリズム

**優先順位（確定）: 手動 > イベント > 長期休暇 > 祝日(baseline) > default_rules**

```
入力: live overrides O, state.managed_overrides M(前回), 
      今回の有効データ {events, vacations(期間), holidays(CSV)}, today(JST)

1) 改ざん検査: 各 (k,v) ∈ M について
   - O[k] が存在し v と異なる → k を「手動化」: M から除外し、O[k] は現状維持。PR 警告（revert しない）
   - O[k] が存在しない（人が削除）→ M から除外（再追加しない）。PR 警告
2) 手動キー集合 H = { k ∈ O | k ∉ M }   // Bot は H に一切触れない
3) 望ましい管理集合 D を優先順に構築（today 以降の日付のみ）:
   a. event: 各イベント日 d → D[d] = timetable_event_{d}
   b. vacation: 各期間内の日 d（d ∉ D）→ 月〜金かつ祝日でない → _weekday / 土日または祝日 → _holiday
   c. holiday baseline: CSV の祝日 d（today ≤ d ≤ CSV最終日, 月〜金, d ∉ D）→ timetable_holiday
4) 衝突解決: d ∈ D かつ d ∈ H → D から削除（手動が勝つ）。値が異なる場合のみ PR 警告
5) 整合: D の各値 id に対応する {id}.json が（今回の書き込み後に）存在しない → その d を D から外し PR 警告
6) 新 overrides = H ∪ D を日付昇順で並べ、calendar_rules.json を再構築
   （default_rules は無変更。ただし参照先ファイル欠如を検知したら PR 警告）
7) state.managed_overrides ← D（カテゴリ別 holiday/vacation/event に分けて記録）
```
- **D の構築は「本実行の結果を反映した後の state」から行う**（state.regular / state.vacations / state.events の全既知エントリ＋holidays キャッシュ。今回 OCR した分だけを入力にすると、変更のなかった日の管理 override が消える誤実装になる）。state.events の過去日プルーニングは FR-4 参照。
- クリーンアップは 3) の「today 以降のみ」から自然に導かれる: **過去日付の旧管理キーは新 overrides に含まれず消える**。
- **event ファイル削除**: 旧 `M.event` にあり、日付 < today、ファイル名が `^timetable_event_\d{8}\.json$`、かつ保護リスト外 → 削除（PR の Deleted 欄に列挙）。**state に記録のない event ファイル（人が手置きしたもの）は削除しない**。
- vacation ファイルは削除しない（翌季に同名上書き）。`timetable_weekday/holiday` も削除しない。
- （SHOULD・情報警告）**手動キー**の参照先 `{id}.json` が `timetables/` に存在しない場合、PR 本文に情報として列挙する（**修正・削除は行わない**。旧命名の遺残 override や手入力ミスの検知が目的）。

### FR-10: 祝日取得（holidays）
1. `holidayCsvUrl` を GET → `iconv-lite` で Shift_JIS → UTF-8、CRLF/最終行欠落を許容してパース。1 行目ヘッダをスキップ、`YYYY/M/D,名称` を `{ date:'YYYY-MM-DD', name }` に正規化。
2. 成功 → `bot/holidays.json` を `{ fetched_at, source_sha256, holidays:[...] }` で上書き（PR に同梱）。
3. 失敗（非200/パース不能）→ **既存キャッシュを使用**して処理続行、PR に「祝日CSV取得失敗・キャッシュ使用」警告。キャッシュも無い初回失敗時のみ祝日 baseline をスキップして警告。

### FR-11: PR 作成
- `peter-evans/create-pull-request@v8`。`branch: bot/timetable-sync`（単一ローリング）、`base: main`、`delete-branch: true`、`title: "🤖 時刻表データの自動更新 (YYYY-MM-DD)"`、`body-path: bot/.out/pr-body.md`、`add-paths: public/data/** , bot/state.json , bot/holidays.json`。
- 差分ゼロならアクションが何もしない（PR は作られない）。
- **pr-body.md テンプレート**（生成内容）:
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

## 検証
- 2回読み照合: 一致 {n}/{m}（多数決採用: {件数}）
- スキーマ検証: すべて合格 / ⚠ 失敗 {件数}（下記）

## ⚠ 要手動確認
- {あれば列挙。なければ「なし」}

## レビュー観点
- [ ] 元画像と便の突き合わせ（特に JR 列の混入がないか）
- [ ] override の日付・参照先
```

### FR-12: ドライラン
`DRY_RUN=1` のとき: 手順 1〜9・11(計算) まで実行し、**ファイル書込・state 更新・PR を行わず**、変更計画（書く予定のファイル一覧・overrides 差分・削除予定・警告）を JSON でログ出力。workflow_dispatch の boolean 入力 `dry_run` と連動。

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
    "processed_at": "2026-06-13T07:00:00+09:00"
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
  "managed_overrides": {
    "event":    { "2026-06-14": "timetable_event_20260614", "2026-06-20": "timetable_event_20260620" },
    "vacation": { "2026-08-03": "timetable_vacation_summer_weekday", "...": "..." },
    "holiday":  { "2026-09-21": "timetable_holiday", "...": "..." }
  },
  "holidays_source": { "fetched_at": "…", "sha256": "…" }
}
```
- 初期値はリポジトリに `{ "version": 1 }` でコミット（＝初回実行で全件が「新規」扱いになり、現行ページの全時刻表を取り込む PR が出る）。
- **初回導入の注意**: 既存 overrides（祝日・土曜授業日等の手動分）はすべて「手動」扱いとなり Bot は触れない。祝日 baseline が手動キーと同日になった場合は衝突スキップ（値が同じなら警告も不要）。

---

## 10. GitHub Actions ワークフロー（確定 YAML）

`.github/workflows/timetable-sync.yml`
```yaml
name: timetable-sync

on:
  schedule:
    - cron: '0 22 * * *'        # 07:00 JST（UTC+9）。GitHub の cron は遅延し得る
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'ドライラン（PRを作らず計画のみログ出力）'
        type: boolean
        default: false

concurrency:
  group: timetable-sync
  cancel-in-progress: false      # 多重起動防止（前の実行を待つ）

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      TZ: Asia/Tokyo
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: bot/package-lock.json

      - name: Install
        run: npm ci
        working-directory: bot

      - name: Run sync
        run: npx tsx src/index.ts
        working-directory: bot
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          DRY_RUN: ${{ inputs.dry_run == true && '1' || '' }}

      - name: Create Pull Request
        if: ${{ inputs.dry_run != true }}
        uses: peter-evans/create-pull-request@v8
        with:
          branch: bot/timetable-sync
          base: main
          delete-branch: true
          commit-message: 'bot: 時刻表データの自動更新'
          title: '🤖 時刻表データの自動更新'
          body-path: bot/.out/pr-body.md
          add-paths: |
            public/data/**
            bot/state.json
            bot/holidays.json
```

### 10.1 リポジトリ初期設定チェックリスト（実装時に必ず実施）
1. **Secrets**: `Settings → Secrets and variables → Actions` に `GEMINI_API_KEY` を登録（Google AI Studio で発行）。
2. **PR 作成許可**: `Settings → Actions → General → Workflow permissions` で
   - 「Read and write permissions」を選択
   - **「Allow GitHub Actions to create and approve pull requests」にチェック**（create-pull-request 公式要件。未設定だと PR 作成が失敗する）。
3. AI Studio のプロジェクト画面で `gemini-3.5-flash` の無料枠レート（RPM/RPD）を確認し、必要なら `geminiMinIntervalMs` を調整。
4. 運用注意: スケジュールワークフローは**リポジトリに 60 日コミットがないと自動無効化**される（フロント開発が続く間は問題なし。Actions タブの無効化通知に留意）。

---

## 11. 非機能要件

| ID | 要件 |
|---|---|
| NFR-1 | **冪等性**: 同一入力（ページ・画像・state）での再実行は同一の差分を生成し、同一ブランチを上書きするのみ。PR の重複を作らない |
| NFR-2 | **JSON 整形規約**: UTF-8（BOM なし）・LF・2 スペースインデント・末尾改行 1 つ。overrides キーは日付昇順。既存ファイル更新時はキー順を保持（§3.5） |
| NFR-3 | **安全側default**: 判定不能・検証失敗・取得失敗は「書かない・消さない・PR/ログで顕在化」。黙って成功扱いにしない |
| NFR-4 | **ログ**: 各ステップの判断（リンク分類結果、変更検知の理由、OCR 照合結果、override 差分）を console に構造化出力。`GITHUB_STEP_SUMMARY` にも要約を書く（SHOULD） |
| NFR-5 | **依存分離**: `bot/package.json` はフロントの `package.json`・lockfile と独立。フロントのビルドへ影響を与えない |
| NFR-6 | **タイムゾーン**: すべての「今日」「日付」判定は JST（dayjs.tz('Asia/Tokyo')）。`new Date()` の素の比較を禁止 |
| NFR-7 | **プライバシー/利用規約**: Gemini へ送るのは公開時刻表画像のみ。無料枠の「入力がモデル改善に利用され得る」性質は本用途で許容済み |
| NFR-8 | **アクセス礼節**: 対象ページへのアクセスは 1 実行あたり 1 回、画像 DL は変更分のみ。日次 1 回の cron 以上に頻度を上げない |

---

## 12. テスト・受け入れ基準

### 12.1 フィクスチャ（`bot/fixtures/`）
> **重要**: fixtures は意図的に「凍結したスナップショット」である。大学サイトのライブ状態（イベント画像はイベント終了後に削除される）とは独立。イベント処理の検証はライブではなくこの凍結データで行う。
> **供給元（2026-07 更新）**: 下記ファイルの原本はすべてリポジトリ内 `_reviewRSD/` に存在する（チャット貼付からリポジトリ内在へ状況が変わった）。**`_reviewRSD/` はレビュー完了後に削除される予定のため、Phase 0 の最初（削除前）に `bot/fixtures/` への複製（C-10）を必ず実施すること。**対応: `page_snapshot.html`→そのまま／`intermediate_regular.json`→`intermediate/regular.json`／`intermediate_event_20260614.json`→`intermediate/event_20260614.json`／`intermediate_event_20260620.json`→`intermediate/event_20260620.json`／`timetable_weekday.json`・`timetable_holiday.json`・`timetable_event_20260614.json`・`timetable_event_20260620.json`→`expected/` 配下／画像3枚→`images/` 配下。

| ファイル | 内容 |
|---|---|
| `page_snapshot.html` | **イベントを含む歴史的スナップショット**（regular + 簿記2026-06-14 + オープンキャンパス2026-06-20 の3リンクを含む、本書 §4.2 の構造）。**あえてこの版を使う**（ライブ再取得ではイベントが消えており分類テストが不能になるため）。`_reviewRSD/page_snapshot.html` をそのまま複製する |
| `images/` | 元の時刻表画像3枚（`R8…jpg` / `0614…jpg` / `0620…jpg`）。**provenance（監査・再検証用）として保存推奨**。ライブから消えても fixtures の出所が辿れる。テストは決定性のため JSON fixtures のみを使い、画像は provenance（監査・再検証用）として保存する（Claude Code は画像を閲覧**できる**ため、必要になれば fixtures と画像の照合検証も可能） |
| `intermediate/regular.json`・`event_20260614.json`・`event_20260620.json` | 3 画像ぶんの中間構造（提供済み）。OCR 正解 |
| `expected/timetable_weekday.json`・`timetable_holiday.json`・`timetable_event_20260614.json`・`timetable_event_20260620.json` | 正解 JSON（提供済み）。**weekday/holiday は現在もライブにある通常ダイヤ画像由来で、本番データと一致確認済み** → 実走AC（AC-2）の通常ダイヤ照合にも使える。event 2本は歴史的データ（ライブには無い） |
| `holidays_sample.csv` | 内閣府 CSV の先頭ヘッダ＋当年分を含む Shift_JIS サンプル（C-5 で生成） |
| `calendar_rules_live.json` | HEAD の calendar_rules スナップショット（手動キー保護テスト用、C-6 で生成） |

### 12.2 ユニットテスト（vitest）
1. `extractLinks(page_snapshot.html)` → 3 件、(regular: 2026-04-04 開始, event: 2026-06-14 簿記, event: 2026-06-20 オープンキャンパス) に分類される。キャンパスマップ等を拾わない。
2. アンカー 0 件の HTML → トリップワイヤー（例外）。
3. 日付パース: 全角数字・`〜`(U+301C)・年なし日付（+1 年補正）・vacation 期間（end 年省略）。
4. `assemble(intermediate)` → `expected/*` と schedule 配列が完全一致（最終便 note 含む）。
5. `validate`: 降順データ・`24:00`・note 位置違反・id 不一致をそれぞれ検出。
6. `calendar`: (a) 手動キー不可侵（live スナップショットの `2026-05-02: weekday` 等が保持される）、(b) 優先順位（同日に event と vacation と祝日 → event が勝つ）、(c) 改ざん検知（managed キーの値を変えた state を与える → 手動化＋警告）、(d) 過去日付クリーンアップ、(e) 祝日 baseline が手動キーと衝突 → スキップ。
7. `files`: 保護ファイル名への書込・削除要求が拒否される。既存ファイル更新で `name`・キー順が保持される。
8. `holidays`: Shift_JIS サンプルのデコード・パース、取得失敗→キャッシュフォールバック。

### 12.3 受け入れ基準（実環境）
> 前提: ライブ掲載は変動するため、AC はライブ状態に依存しない形で定義する（「実行時点のライブ掲載リンク集合」を基準に読む）。参考: **2026-07-07 時点のライブは regular（R8・2026-04-04〜）＋event 2026-07-05 ビジネス能力検定（過去日→スキップ対象）＋event 2026-07-18 オープンキャンパス（未来→取込対象）の3リンク**。ロジックの網羅検証は §12.2 のユニットテスト（凍結 fixtures）が担い、実走 AC は配線（Actions・PR・権限）の確認を主目的とする。

| AC | 条件 | 合格基準 |
|---|---|---|
| AC-1 | state 初期値で workflow_dispatch（dry_run=true） | 計画ログに: **通常ダイヤ（weekday/holiday）の取り込み**、実行時点のライブにある**未来 event の取り込み計画**、**過去日 event のスキップ記録**、祝日 baseline override の追加計画（窓内の平日祝日）、既存の手動 override は保持。ファイル変更ゼロ |
| AC-2 | 同条件で dry_run=false | PR が1本作成され、`timetables/timetable_weekday.json`・`timetable_holiday.json` が更新（**生成 schedule が fixtures/expected の weekday/holiday と一致**）、未来 event があれば `timetable_event_{YYYYMMDD}.json` の生成と `overrides` 追加が含まれ、**過去日 event のファイルは生成されない**。`calendar_rules.json` に祝日 baseline override 追加（手動キーは保持）、`state.json`・`holidays.json` を含む。PR 本文はテンプレ通り |
| AC-3 | AC-2 をマージ後に再実行 | 差分ゼロで PR が作られない（冪等） |
| AC-4 | マージせず再実行 | 既存 PR（同一ブランチ）が更新されるのみで重複 PR なし |
| AC-5 | `GEMINI_API_KEY` 未設定で実行 | OCR 対象が無ければ成功、有ればジョブ失敗（明確なエラー）。いずれも不正なファイルを書かない |
| AC-6 | **イベント取り込み・クリーンアップ（ロジック検証）** | **ユニットテスト 6（優先順位・クリーンアップ）と 4（event の assemble）で検証する**。実走での確認は AC-7 が担う |
| AC-7 | **イベント実走**（2026-07-18 オープンキャンパスがライブ掲載中のため実走可能） | 2026-07-18 より前の実行で `timetable_event_20260718.json` 生成＋`overrides["2026-07-18"]` 追加が PR に出る。適用日経過後の実行で当該 override とファイルの削除が PR に出る。`timetable_closed.json`・`_examples/` 配下は常に無傷 |

---

## 13. 実装フェーズ（Claude Code への指示単位）

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | `bot/` 雛形（package/tsconfig/config/types）、fetchPage/extractLinks/classify、holidays、state 読み書き、**ドライラン経路**、ユニットテスト 1–3,8 | AC-1 相当のドライランがローカル（`npx tsx src/index.ts` + DRY_RUN=1）で通る |
| 1 | fetchImage/ocr/assemble/validate/files/calendar/prBody、ワークフロー YAML、テスト 4–7 | AC-2〜AC-5 |
| 2 | クリーンアップ動作の実地確認、STEP_SUMMARY、便数±50%警告、運用調整 | AC-6 |

※ローカル開発（Windows 11 / PowerShell）: `cd bot; npm install; $env:GEMINI_API_KEY="..."; $env:DRY_RUN="1"; npx tsx src/index.ts`。コード・コメントは日本語。

---

## 14. 運用（Runbook 抜粋）

- **PR に「要手動確認」がある**: 元画像リンクを開いて該当ファイルを手修正 → 同 PR に追いコミットしてマージ（state は PR 内の値のままで良い。sha256 が記録済みなので再 OCR は走らない）。
- **モデル変更**: `config.ts` の `modelPrimary` を書き換えるだけ。
- **強制再 OCR**: `state.json` から該当キーを削除して push（次回実行で新規扱い）。※適用日がすべて過去の event は FR-4 のスキップ規則により削除しても再取込されない（過去分のダイヤを再生成したい場合は手動対応）。
- **誤マージの巻き戻し**: PR を revert（state も一緒に戻るので整合が保たれる）。
- **大学ページの構造変更（トリップワイヤー発火）**: Actions の失敗通知 → `announceBoxSelector` / 抽出条件を実ページに合わせて修正。
- **無料枠変更で 429/権限エラーが続く**: フォールバックモデル運用 or AI Studio で枠確認。Bot の消費は微小なので、多くの場合は `geminiMinIntervalMs` 引き上げで足りる。

---

## 15. 既知の制約・残存リスク（合意済み）

1. **バス/JR 取り違え**は機械検証不能 → プロンプト＋2回照合＋PR レビューの 3 層で抑止（残存リスクとして受容）。
2. **分類キーワード依存**（通常/休暇/イベントの判定は `lineText` の語彙に依存）→ 不能時は needs_review に落ちる設計で安全側。
3. **Gemini 3.5 Flash の無料枠数値は非公表・変動** → フォールバック＋429 顕在化で対応。実値は導入時に確認。
4. **cron 遅延・60 日無効化・祝日 CSV の URL 変更歴** → 各所に注意として明記済み（§5, §10.1, FR-10）。
5. 本書の確認済みスナップショット（ページ構造・ライブ calendar_rules・テンプレファイル名）が実装時点で変わっている可能性 → 実装着手時に §7.4 と §3.3 の「実体確認」を必ず行う。
6. **状態依存記述の陳腐化リスク**: 本書の「確認済み」記述（ページ構造・ライブ掲載・リポジトリ実体）は執筆時点のスナップショットである。v1.3 の「ライブにイベントなし」「テンプレが timetables/ に実在」「CLAUDE.md に旧命名残存」はいずれも v1.4 時点で事実と不一致となり訂正済み。**実装着手時に §7.4 の実体と §4 のライブ状態を必ず再確認する**こと（旧命名 `timetable_spring_vac_*` はリポジトリから解消済みで対応不要）。

---

## 16. 実装・導入の役割分担

### 16.1 結論
本書を Claude Code に渡せば**コードと設定はほぼ全量を自動実装できる**が、**完全自動では完了しない**。理由は次の2系統が Claude Code の外にあるため。
- **(A) リポジトリ外の認証・権限・観測タスク**（API キー発行、GitHub Secrets、リポジトリ設定、PR レビュー/マージ、デプロイ観測、無料枠確認）。
- **(B) 供給物の配置順序**。時刻表画像・正解 fixtures は現在リポジトリ内 `_reviewRSD/` に存在し、Claude Code は画像の閲覧も含めて扱える（v1.3 の「Claude Code は画像を読めない」は誤りだったため訂正）。fixtures 配置は Claude Code の機械的コピー作業（C-10）で完結するが、**`_reviewRSD/` の削除前に実施することが必須**という順序制約がある。

### 16.2 Claude Code が行う（リポジトリ内で完結）
| # | 作業 | 補足 |
|---|---|---|
| C-1 | `bot/` 一式の実装（§7.1 の全ファイル）：fetch/extract/classify/detect/ocr/assemble/validate/calendar/holidays/files/prBody/index | 本書 §8 が仕様の正本 |
| C-2 | `bot/package.json`・`tsconfig.json`・`.gitignore` 作成と `npm install`→`package-lock.json` 生成（§7.1, §5） | 依存はフロントと分離 |
| C-3 | `.github/workflows/timetable-sync.yml` 配置（§10 の確定 YAML をそのまま） | |
| C-4 | ユニットテスト実装（§12.2 の 1〜8）と `vitest` 設定 | 正解データは C-7/C-10 供給分を使用 |
| C-5 | `bot/holidays.json` 初期キャッシュ生成＋`fixtures/holidays_sample.csv`（Shift_JIS）作成 | Claude Code は実行環境にネット接続があるため内閣府CSVを取得・エンコードできる。取得不可なら H-7 に降格 |
| C-6 | `fixtures/calendar_rules_live.json` を **HEAD の実体からコピー**して作成（§12.1） | |
| C-7 | `mediaResolution` 等 SDK の正確な enum/型を**インストール済み `@google/genai` の型定義で確定**（§8.5.1 の留保解消） | |
| C-8 | （v1.4 で解消済みのため作業なし）旧命名残存は確認の結果すでに存在しない | — |
| C-9 | ローカル/CI でのドライラン実行と全テストのグリーン化（§13 Phase 0〜2 の各完了条件） | 実 OCR を伴う検証は H-1 の鍵が前提 |
| C-10 | `_reviewRSD/` から `bot/fixtures/` への fixtures 複製（§12.1 の対応表どおり。**`_reviewRSD/` 削除前に必ず実施**） | 旧 H-4 を移管 |

### 16.3 人間（Nano）が行う（Claude Code 不可）
| # | 作業 | 手段 | これがないと |
|---|---|---|---|
| H-1 | Google AI Studio で **`GEMINI_API_KEY` を発行** | AI Studio（Google ログイン要） | OCR 不能 |
| H-2 | GitHub に **`GEMINI_API_KEY` を登録** | `Settings → Secrets and variables → Actions`（または `gh secret set`） | Actions 実行時に OCR 不能 |
| H-3 | **「Allow GitHub Actions to create and approve pull requests」を有効化**＋Workflow permissions を Read/Write に | `Settings → Actions → General`（または `gh api -X PUT repos/:owner/:repo/actions/permissions/workflow -F default_workflow_permissions=write -F can_approve_pull_request_reviews=true`） | **PR 作成が必ず失敗**（create-pull-request 公式要件） |
| H-4 | （C-10 に移管）`_reviewRSD/` を削除する前に C-10 が完了していることの確認のみ | 目視 | fixtures 原本が失われテストが書けない |
| H-5 | Bot が出した **PR をレビューしてマージ**（本システムの人間ゲート） | GitHub PR 画面。元画像と便を突き合わせ | データが反映されない（設計どおり） |
| H-6 | マージ後の **Cloudflare Pages デプロイ反映を確認** | Pages のデプロイ履歴／実機 | — |
| H-7 | （C-5 が不可だった場合のみ）祝日 CSV 取得・初期キャッシュの手当て | 手動 DL → 配置 | 祝日 baseline 不可 |
| H-8 | 導入後、AI Studio で **`gemini-3.5-flash` の無料枠 RPM/RPD を確認**し必要なら `geminiMinIntervalMs` 調整 | AI Studio | 429 のリスク評価 |

> H-2/H-3 は `gh` CLI が admin 権限で認証済みなら Claude Code に代行させることも技術的には可能。ただし秘密情報の取り扱いとリポジトリ権限変更は**人間が明示実施するのが安全**なので、本書では人間タスクとする。

#### 16.3.1 画像由来 fixtures（C-10 の中身・供給元）
| ファイル（`bot/fixtures/` 配下） | 供給元 | 状態 |
|---|---|---|
| `expected/timetable_weekday.json` | `_reviewRSD/timetable_weekday.json`（画像との一致検証済み） | **`_reviewRSD/` に在中**（C-10 で複製） |
| `expected/timetable_holiday.json` | `_reviewRSD/timetable_holiday.json` | **`_reviewRSD/` に在中**（C-10 で複製） |
| `expected/timetable_event_20260614.json` | `_reviewRSD/timetable_event_20260614.json` | **`_reviewRSD/` に在中**（C-10 で複製） |
| `expected/timetable_event_20260620.json` | `_reviewRSD/timetable_event_20260620.json` | **`_reviewRSD/` に在中**（C-10 で複製） |
| `intermediate/regular.json` | `_reviewRSD/intermediate_regular.json` | **`_reviewRSD/` に在中**（C-10 で複製） |
| `intermediate/event_20260614.json` | `_reviewRSD/intermediate_event_20260614.json` | **`_reviewRSD/` に在中**（C-10 で複製） |
| `intermediate/event_20260620.json` | `_reviewRSD/intermediate_event_20260620.json` | **`_reviewRSD/` に在中**（C-10 で複製） |
| `page_snapshot.html` | **`_reviewRSD/page_snapshot.html` を複製**（ライブ再取得は不可：イベント構成が変わると §12.2 テスト1の前提が崩れるため、この凍結スナップショットを使う） | **`_reviewRSD/` に在中**（C-10 で複製） |

### 16.4 役割の境界（誤解防止）
- Claude Code は **OCR の精度を保証しない**。fixtures による検証は assemble/validate/calendar の**ロジック**を保証するもので、実画像に対する読み取り精度は実行時の 2 回照合＋PR レビュー（H-5）で担保する。
- Claude Code は **PR を作るところまで**。マージ（反映）は常に人間（H-5）。
- Claude Code は **calendar_rules の手動キーを生成も削除もしない**実装を作るが、既存の手動 override の正しさ自体は人間の責任領域。

---

## 17. 導入シーケンス（推奨手順）

```
[人間] H-1 Gemini APIキー発行
[Claude Code] C-10 fixtures を `_reviewRSD/` から `bot/fixtures/` へ複製（expected×4 / intermediate×3 / page_snapshot.html / images×3）※`_reviewRSD/` 削除前に必須
        ↓
[Claude Code] Phase 0: C-10/C-1(一部)/C-2/C-5/C-6 + 抽出・分類・祝日・state・ドライラン経路 + テスト1-3,8
        → 完了条件: ローカルで DRY_RUN=1 のドライランが通り、テスト緑（AC-1 相当＝通常ダイヤ取り込み＋祝日計画）
        ↓
[Claude Code] Phase 1: C-1(残)/C-3/C-4/C-7 + OCR・組立・検証・calendar・PR本文 + テスト4-7
        ↓
[人間] H-2 Secrets 登録 / H-3 PR作成権限の有効化   ← Actions 実走の前に必須
        ↓
[人間 or 手動トリガー] workflow_dispatch(dry_run=false) で初回実行 → 初回 PR 生成
[人間] H-5 初回 PR をレビュー（元画像と突き合わせ）→ マージ → H-6 デプロイ確認
        ↓
[Claude Code] Phase 2: クリーンアップ動作確認・STEP_SUMMARY 等（AC-6）
[人間] H-8 無料枠の実値確認・必要なら間隔調整
```

- **依存の急所**: H-3（PR作成権限）は Phase 1 完了後・初回実走前までに必ず実施。未実施だと最初の自動実行で PR 作成が失敗する。
- **鍵なしでも進む範囲**: Phase 0 のドライランは OCR を伴わない経路（抽出・分類・祝日・state）まで検証可能。OCR を含む Phase 1 のローカル検証には H-1 の鍵が要る。
