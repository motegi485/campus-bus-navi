# campus-bus-navi

福山大学スクールバス向けの **時刻表・乗り場案内 Progressive Web App（PWA）** です。学生・教職員が「次のバスにすぐ乗れる」ことと、「時刻表を探す手間」「乗り場に迷うストレス」を減らすことを目的としています。バックエンドやデータベースは持たず、静的ホスティングと JSON データで運用します。

---

## 1. プロジェクトの概要と目的

- **概要:** スクールバスの発着時刻を一覧・次発強調表示し、各路線の乗り場位置を地図上で示します。特別ダイヤや学期ごとの JSON を `calendar_rules.json` で切り替えます。
- **目的:** スマートフォン中心で素早く参照できる UI と、オフラインでも閲覧しやすいキャッシュ設計により、キャンパス周辺の移動判断を支援します。
- **方針:** 有料 API や API キーに依存せず、オープンソースと標準 Web API のみで構成しています（地図は OpenStreetMap タイル）。

---

## 2. 主な機能

| 機能 | 説明 |
|------|------|
| 次発バス表示 | 現在時刻（JST）に基づき次の発車時刻と、**あと何分**で発車するかを表示（内部は分単位。時計は約 1 分ごとに同期更新） |
| ルート切り替え | `station_to_campus`（松永方面→大学）と `campus_to_station`（大学→松永方面）を切り替え |
| 直近 4 本・全時刻表 | 次発以降の複数便と、その日の全便を一覧 |
| 終バス後の案内 | 当日の運行が終わった場合、翌日の始発などを `EndOfServiceCard` で表示 |
| 乗り場マップ | `react-leaflet` + OSM。マーカー・ポップアップ、「現在地からのルートを見る」で外部ナビ起動 |
| ダイヤ切り替え | 曜日デフォルト + 日付単位の上書き（春休みダイヤなど） |
| お知らせ | `news.json` を画面で表示（HTML 本文に対応） |
| 設定 | デフォルトルート、テーマ（ライト/ダーク）、フォントサイズ（`localStorage`） |
| PWA | ホーム画面追加、`standalone` 表示、Service Worker によるアセット・データキャッシュ |
| 手動更新 | ヘッダーの更新ボタンで JSON を再取得（キャッシュバスター付き）。アプリ初期化で SW / Cache / `localStorage` をクリア可能 |

---

## 3. 技術スタック

| カテゴリ | 採用技術 |
|----------|----------|
| 言語・フレームワーク | TypeScript 5、React 18 |
| ビルド | Vite 5（`npm run build` で `tsc` のあと Vite ビルド） |
| スタイル | Tailwind CSS v4（`@tailwindcss/vite`、`src/index.css` の `@theme` でフォント等を定義。従来の `tailwind.config` は不使用） |
| 地図 | Leaflet 1.9、`react-leaflet` 4.x、OSM タイル |
| 日付・時刻 | Day.js（`utc` / `timezone` プラグイン、`Asia/Tokyo` 固定） |
| PWA | `vite-plugin-pwa`、Workbox（`vite.config.ts` でランタイムキャッシュ定義）、`workbox-window`（登録 UI 用） |
| デプロイ想定 | Cloudflare Pages（`_headers` / `_redirects` を同梱） |

バージョンは `package.json` の `version` を参照。ビルド時に `__APP_VERSION__` として埋め込み可能（`vite.config.ts` の `define`）。

---

## 4. ディレクトリ構成

```
campus-bus-navi/
├── public/
│   ├── data/
│   │   ├── calendar_rules.json          # 曜日デフォルト + 日付上書き → 適用する時刻表ファイル名
│   │   ├── timetable_weekday.json       # 授業日ダイヤ（例）
│   │   ├── timetable_holiday.json       # 休日ダイヤ（例）
│   │   ├── timetable_spring_vac_wd_2026.json
│   │   ├── timetable_spring_vac_hld_2026.json
│   │   ├── timetable_event_example.json # イベント用サンプル
│   │   ├── timetable_sample.json        # 汎用サンプル
│   │   └── news.json                    # お知らせ（配列）
│   ├── icons/                           # PWA / favicon 用 PNG
│   └── manifest.json                  # PWA マニフェスト（名前・テーマ・アイコン等）
├── src/
│   ├── components/                    # 画面パーツ（地図、時刻表、ドロワー、各種スクリーン等）
│   ├── hooks/
│   │   ├── useJSTClock.ts             # JST の「現在」時刻（分境界同期 + 1 分間隔）
│   │   ├── useTimetable.ts            # カレンダー解決 + 時刻表 JSON 取得
│   │   ├── useNews.ts
│   │   ├── useOnlineStatus.ts
│   │   └── useSettings.ts
│   ├── utils/
│   │   ├── resolveCalendar.ts
│   │   ├── findNextBus.ts
│   │   └── buildMapUrl.ts             # ナビ用 URL（iOS / Android で分岐）
│   ├── types/timetable.d.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── _headers                             # Cloudflare: キャッシュ制御（特に `/data/*.json`）
├── _redirects                           # SPA 用（`/*` → `/index.html`）
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 5. データ管理

- **方式:** `public/data/` 配下の **静的 JSON** を Git で管理する GitOps 的な運用。デプロイで CDN 経由で配信されます。
- **`calendar_rules.json`**
  - `default_rules`: キー `"0"`〜`"6"`（日〜土）に、適用する時刻表ファイル ID（拡張子なし）を指定。
  - `overrides`: キー `YYYY-MM-DD` で特定日だけ別ダイヤを指定。
- **`timetable_*.json`**
  - `id`, `name`, `routes` を持つ。`routes` は `station_to_campus` / `campus_to_station` それぞれに `origin`, `destination`, `bus_stop_name`, `bus_stop_coords`, `schedule`（`departure`: `HH:mm`, `note`）を定義。
- **`news.json`**
  - お知らせの **配列**。各要素は `id`（数値）、`tag`, `tagLabel`, `date`, `title`, `preview`, `body`（HTML 文字列）、`unread` など（`src/types/timetable.d.ts` の `NewsItem` と一致）。
- **取得ロジック:** `useTimetable` が `calendar_rules.json` を読み、当日・翌日のダイヤ ID を解決してから `/data/{id}.json` を取得。手動更新時は `?t=タイムスタンプ` と `cache: 'reload'` でキャッシュを避けます。

---

## 6. 開発手順

### 前提

- Node.js 18 以上（`package.json` と整合するバージョンを推奨）
- npm 9 以上

### セットアップと起動

```bash
git clone <リポジトリURL>
cd campus-bus-navi
npm install
npm run dev
```

開発サーバーは通常 `http://localhost:5173`（Vite デフォルト）。

### ビルド・プレビュー

```bash
npm run build    # tsc 後に dist/ へ出力
npm run preview  # 本番ビルドのローカル確認
```

### データ編集

時刻表やカレンダー、お知らせを変更する場合は `public/data/` の JSON を編集し、動作確認後にコミットします。

---

## 7. デプロイ

**Cloudflare Pages** を想定した構成です。

| 項目 | 値 |
|------|-----|
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| Node.js | 18 以上 |

- **`_headers`:** ルートは短いキャッシュ、`/assets/*` は長期 immutable、`/data/*.json` はブラウザ・中間キャッシュで古いダイヤが残りにくいよう `no-store` 系の指示を付与。
- **`_redirects`:** クライアントルーティング用に `/*` を `/index.html` へ（404 ではなく 200 で SPA を返す設定）。

リポジトリを Pages に接続し、上記ビルド設定を指定すればデプロイ可能です。

---

## 8. PWA・Service Worker の設計方針

| 項目 | 内容 |
|------|------|
| 登録方式 | `registerType: 'prompt'` — 新 SW 検知時は `UpdateBanner` でユーザーが「更新」を選ぶまで強制更新しない |
| マニフェスト | `manifest: false` により **`public/manifest.json` をそのまま利用**（プラグイン生成マニフェストは使わない） |
| プリキャッシュ | Workbox の `globPatterns` で JS/CSS/HTML/画像/JSON 等をビルド成果物からキャッシュ |
| `/data/*.json` | **NetworkFirst**（`networkTimeoutSeconds: 5`）。古い時刻表の長期表示を避ける。URL は `\/data\/.*\.json(\?.*)?$` でクエリ付きもマッチ |
| OSM タイル | **CacheFirst**、最大 500 エントリ・最大 30 日 — 一度表示した周辺タイルはオフラインでも再利用しやすい |
| バージョン | `package.json` の `version` を `__APP_VERSION__` として注入可能 |
| アプリ初期化 | ドロワーから SW 登録解除 → `localStorage` 全削除 → Cache Storage 全削除 → `location.reload()`（通常の更新ボタンは `reload` しない） |

---

## 9. 乗り場マップの仕様

- **実装:** `BusStopMap.tsx` を `App.tsx` から **動的 import（`lazy`）** — Leaflet は SSR に不向きなため。
- **タイル:** `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`、帰属表示あり。
- **表示:** 高さ 220px、初期ズーム 16、`minZoom` 14 / `maxZoom` 17。ルート切替時は `flyTo` で中心移動（約 1.2 秒）。
- **マーカー:** デフォルトアイコンは CDN の Leaflet 画像で補正（Vite バンドル対策）。乗り場はカスタム `divIcon`（バス絵文字のピン風）。
- **重なり:** 親に `isolation: 'isolate'` と `z-index` を与え、ドロワー（`z-index` 低め）がタイルレイヤより下に潜る問題を防ぐ。
- **ナビ連携:** `buildMapUrl.ts` — **iOS** は `maps://`（Apple マップ・徒歩）、**それ以外** は Google マップのルート URL（`travelmode=walking`）。ラベルはクエリ用にエンコード。
- **オフライン:** オンライン/オフラインで同じ `BusStopMap` を表示。タイルは SW の CacheFirst により、**既にキャッシュされた範囲は表示可能**な場合がある。未キャッシュ領域はタイル取得に失敗しうる。

---

## 10. 時刻・タイムゾーンの扱い

- **基準タイムゾーン:** すべて **日本標準時（JST）**。Day.js の `timezone` で `Asia/Tokyo` を使用。
- **端末設定:** 表示上の「今日」「今何時か」は JST に揃えるため、端末のタイムゾーン設定に依存しない意図で実装されています。
- **`useJSTClock`:** 次の分の 0 秒に合わせてから **1 分ごと**に `now` を更新（カウントダウン文言は分単位のため、秒単位の再描画は行わない）。
- **デバッグ:** ソース内コメントで、特定日時に固定した `useState` に差し替える例を記載可能。
- **時刻表データ:** `departure` は `HH:mm` 文字列。当日の分単位比較で次便・終バスを判定（`findNextBus.ts` 等）。

---

## 11. モバイル最適化

- **レイアウト:** `viewport-fit=cover`、ヘッダー・メインに `env(safe-area-inset-top/bottom)` でノッチ・ホームインジケータ対応。
- **高さ:** `min-height: 100dvh` でモバイルブラウザの UI 伸縮に追従。
- **ブレークポイント:** `md`（768px）未満は 1 カラム、以上は時刻表と地図の 2 カラム + 全時刻表は下段フル幅。
- **PWA 表示:** `manifest.json` の `display: "standalone"`、`orientation: "portrait"`。
- **操作感:** グローバルに `user-select: none`、タップハイライト無効化（入力系は選択可能）。ネイティブアプリに近い誤操作抑制。
- **テーマ:** ライト/ダーク切替で CSS 変数（`index.css` の `:root` / `.dark`）を切り替え。

---

## 12. ライセンス

- 本リポジトリの **アプリ本体のライセンス** は運用方針に従ってください（大学内部・非公開運用など、組織のルールに合わせる想定）。
- 利用している主な OSS のライセンス例:

| 名称 | ライセンス |
|------|------------|
| React | MIT |
| Vite | MIT |
| Tailwind CSS | MIT |
| Leaflet / react-leaflet | BSD 2-Clause |
| Day.js | MIT |
| Workbox（vite-plugin-pwa 経由） | MIT |
| OpenStreetMap データ | [ODbL](https://www.openstreetmap.org/copyright) |

各パッケージの詳細は `node_modules` 内または各公式リポジトリを参照してください。
