# campus-bus-navi

福山大学スクールバス向けの **時刻表・乗り場案内 Progressive Web App（PWA）** です（マニフェスト上の表示名は **バスNAVI**）。学生・教職員が「次のバスにすぐ乗れる」ことと、「時刻表を探す手間」「乗り場に迷うストレス」を減らすことを目的としています。バックエンドやデータベースは持たず、静的ホスティングと JSON データで運用します。

## 目次

1. [概要と目的](#1-概要と目的)
2. [主な機能](#2-主な機能)
3. [技術スタック](#3-技術スタック)
4. [ディレクトリ構成](#4-ディレクトリ構成)
5. [データ管理](#5-データ管理)
6. [開発手順](#6-開発手順)
7. [デプロイ](#7-デプロイ)
8. [PWA・Service Worker](#8-pwaservice-worker)
9. [乗り場マップ](#9-乗り場マップ)
10. [時刻・タイムゾーン](#10-時刻タイムゾーン)
11. [モバイル最適化](#11-モバイル最適化)
12. [ライセンス](#12-ライセンス)

---

## 1. 概要と目的

- **概要:** スクールバスの発着時刻を一覧表示し、次発を強調します。各路線の乗り場は OpenStreetMap 上で表示し、外部マップアプリへ遷移して徒歩ルートを開けます。適用する時刻表 JSON は `calendar_rules.json` で曜日デフォルトと日付単位の上書きにより切り替わります。
- **目的:** スマートフォン中心で素早く参照できる UI と、オフラインでも閲覧しやすいキャッシュ設計により、キャンパス周辺の移動判断を支援します。
- **方針:** 有料 API や独自 API キーに依存せず、オープンソースと標準 Web API のみで構成しています（地図タイルは OpenStreetMap）。

---

## 2. 主な機能

| 機能 | 説明 |
|------|------|
| 次発バス表示 | 現在時刻（JST）に基づき、次の発車時刻と **あと何分** で発車するかを表示（内部は分単位。時計は約 1 分ごとに更新） |
| ダイヤ種別バッジ | 読み込んだ時刻表 ID から `DayBadge` で種別ラベルを表示（`holiday` / `vac` / `event` を含む ID で休業・長期休暇・イベントを推定。それ以外は授業日扱い） |
| ルート切り替え | `station_to_campus`（松永方面→大学）と `campus_to_station`（大学→松永方面）を切り替え |
| 直近 4 本・全時刻表 | `findUpcomingBuses` で次発以降最大 4 本を表示。全便は `FullTimetable` で一覧（モバイルは地図の上、768px 以上は下段フル幅） |
| 終バス後の案内 | 当日の運行が終了している場合、翌日の始発などを `EndOfServiceCard` で表示 |
| 乗り場マップ | `react-leaflet` + OSM。ポップアップ、「現在地からのルートを見る」で外部ナビ起動 |
| ダイヤ切り替え | 曜日デフォルト + 日付単位の上書き（春休みダイヤなど） |
| お知らせ・設定・ヘルプ | ドロワーから `NewsScreen` / `SettingsScreen` / `HelpScreen` を表示。お知らせは `news.json`（HTML 本文可） |
| 設定 | デフォルトルート、テーマ（ライト/ダーク）、フォントサイズ（`localStorage`） |
| PWA | ホーム画面追加、`standalone` 表示、Service Worker によるアセット・データ・タイルのキャッシュ |
| 時刻データの手動更新 | ヘッダーの更新ボタンで JSON を再取得（`?t=` キャッシュバスター + `cache: 'reload'`）。**ページはリロードせず**、結果は `Toast` で通知 |
| アプリ初期化 | ドロワーから実行。SW 登録解除 → `localStorage` 全削除 → Cache Storage 全削除のあと **`location.reload()`**（トラブル時のリセット用） |
| バージョン表示 | `package.json` の `version` をビルド時に `__APP_VERSION__` として注入。ドロワー・設定・ヘルプに表示 |

---

## 3. 技術スタック

| カテゴリ | 採用技術 |
|----------|----------|
| 言語・フレームワーク | TypeScript 5、React 18 |
| ビルド | Vite 5（`npm run build` で `tsc` のあと Vite ビルド） |
| スタイル | Tailwind CSS v4（`@tailwindcss/vite`、`src/index.css` の `@theme` でフォント等を定義。従来の `tailwind.config` は不使用） |
| フォント | Noto Sans JP（`index.html` で Google Fonts を読み込み） |
| 地図 | Leaflet 1.9、`react-leaflet` 4.x、OSM タイル |
| 日付・時刻 | Day.js（`utc` / `timezone` プラグイン、`Asia/Tokyo` 固定） |
| PWA | `vite-plugin-pwa`、Workbox（`vite.config.ts` でランタイムキャッシュ定義）、`workbox-window`（クライアント登録）、`virtual:pwa-register/react` |
| デプロイ想定 | Cloudflare Pages（`_headers` / `_redirects` を同梱） |

依存パッケージの正確な版は `package.json` を参照してください。`__APP_VERSION__` は `vite.config.ts` の `define` で `package.json` の `version` から埋め込まれます。

---

## 4. ディレクトリ構成

```
campus-bus-navi/
├── public/
│   ├── data/
│   │   ├── calendar_rules.json          # 曜日デフォルト + 日付上書き → 適用する時刻表ファイル名（拡張子なし ID）
│   │   ├── timetable_weekday.json       # 授業日ダイヤ（例）
│   │   ├── timetable_holiday.json       # 休日ダイヤ（例）
│   │   ├── timetable_spring_vac_wd_2026.json
│   │   ├── timetable_spring_vac_hld_2026.json
│   │   ├── timetable_event_example.json # イベント用サンプル
│   │   ├── timetable_sample.json        # 汎用サンプル
│   │   └── news.json                    # お知らせ（JSON 配列）
│   ├── icons/                           # PWA / favicon 用 PNG
│   └── manifest.json                    # PWA マニフェスト
├── src/
│   ├── components/
│   │   ├── BusStopMap.tsx               # 乗り場マップ（Leaflet）
│   │   ├── DayBadge.tsx                 # ダイヤ種別バッジ + resolveDiagramType
│   │   ├── DrawerMenu.tsx
│   │   ├── EndOfServiceCard.tsx
│   │   ├── FullTimetable.tsx
│   │   ├── HelpScreen.tsx
│   │   ├── NewsScreen.tsx
│   │   ├── NextBusCard.tsx
│   │   ├── RouteToggle.tsx
│   │   ├── SettingsScreen.tsx
│   │   ├── Toast.tsx                    # 時刻データ更新などの短い通知
│   │   ├── UpcomingList.tsx
│   │   └── UpdateBanner.tsx             # 新 SW 検知時の更新バナー
│   ├── hooks/
│   │   ├── useJSTClock.ts               # JST の現在時刻（分境界付近に同期 + 1 分間隔）
│   │   ├── useTimetable.ts              # カレンダー解決 + 時刻表 JSON 取得
│   │   ├── useNews.ts
│   │   ├── useOnlineStatus.ts
│   │   └── useSettings.ts
│   ├── utils/
│   │   ├── resolveCalendar.ts
│   │   ├── findNextBus.ts
│   │   └── buildMapUrl.ts               # ナビ用 URL（iOS / それ以外で分岐）
│   ├── types/timetable.d.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── _headers                             # Cloudflare: キャッシュ制御
├── _redirects                           # SPA: `/*` → `/index.html`（200）
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 5. データ管理

- **方式:** `public/data/` 配下の **静的 JSON** を Git で管理し、デプロイ先の CDN から配信する想定です。
- **`calendar_rules.json`**
  - `default_rules`: キー `"0"`〜`"6"`（日曜〜土曜）に、適用する時刻表ファイル ID（拡張子なし）を指定。
  - `overrides`: キー `YYYY-MM-DD` で、その日だけ別ダイヤを指定。
- **`timetable_*.json`**
  - `id`, `name`, `routes` を持つ。`routes` は `station_to_campus` / `campus_to_station` それぞれに `origin`, `destination`, `bus_stop_name`, `bus_stop_coords`, `schedule`（`departure`: `HH:mm`, `note`）を定義。
- **`news.json`**
  - お知らせの **配列**。各要素の形は `src/types/timetable.d.ts` の `NewsItem`（`id`, `tag`, `tagLabel`, `date`, `title`, `preview`, `body`, `unread` など）に合わせます。
- **取得ロジック:** `useTimetable` が `calendar_rules.json` を読み、当日・翌日のダイヤ ID を解決してから `/data/{id}.json` を並列取得します。JST の日付が変わったときだけ通常フェッチが走ります（`now.format('YYYY-MM-DD')` 依存の `useEffect`）。手動更新では `?t=タイムスタンプ` と `cache: 'reload'` でキャッシュを避けます。フェッチに失敗した場合はエラー文のほか「キャッシュされた時刻表を使用しています」という案内が出ます（SW 経由で古いレスポンスが残っている場合など）。

---

## 6. 開発手順

### 前提

- **Node.js:** 18 以上を推奨（Vite 5 の一般的な要件に合わせた目安です。`package.json` に `engines` は未定義です）
- **パッケージマネージャ:** npm（例: `npm install`）

### セットアップと起動

```bash
git clone https://github.com/motegi485/campus-bus-navi.git
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

時刻表・カレンダー・お知らせを変更する場合は `public/data/` の JSON を編集し、動作確認のうえコミットします。

---

## 7. デプロイ

**Cloudflare Pages** を想定した構成です。

| 項目 | 値 |
|------|-----|
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| Node.js | 18 以上（プロジェクト側の推奨に合わせる） |

- **`_headers`:** ルートは短いキャッシュ、`/assets/*` は長期 immutable、`/data/*.json` は `no-cache` / `no-store` 系でブラウザ・中間キャッシュに古いダイヤが残りにくいよう指示。
- **`_redirects`:** クライアントサイドの単一ページのため、`/*` を `/index.html` に **200** で返す一行設定。

リポジトリを Pages に接続し、上記ビルド設定を指定すればデプロイ可能です。`index.html` には Cloudflare Web Analytics のビーコンが埋め込まれている場合があります（運用ポリシーに合わせて削除・差し替えしてください）。

---

## 8. PWA・Service Worker

| 項目 | 内容 |
|------|------|
| 登録方式 | `registerType: 'prompt'`。新しい SW を検知すると `UpdateBanner` を表示し、ユーザーが「更新」を選ぶまで強制更新しません。 |
| フォアグラウンド復帰 | `App.tsx` で `visibilitychange` 時に `registration.update()` を呼び、バックグラウンドから戻ったあとにも更新を確認します。 |
| マニフェスト | `manifest: false` により **`public/manifest.json` をそのまま利用**（プラグイン生成マニフェストは使わない） |
| プリキャッシュ | Workbox の `globPatterns` で JS/CSS/HTML/画像/JSON 等をビルド成果物からキャッシュ |
| `/data/*.json` | **NetworkFirst**（`networkTimeoutSeconds: 5`）。同一キャッシュ名内は最大 20 件・最長 7 日で整理（`vite.config.ts` の `expiration`） |
| OSM タイル | **CacheFirst**、最大 500 エントリ・最大 30 日。一度表示した周辺タイルはオフラインでも再利用しやすい |
| 時刻データ更新（UI） | ヘッダー更新は `Toast` で進捗・成功・失敗を表示（アプリシェルのリロードは行わない） |
| アプリ初期化 | ドロワーから SW 登録解除 → `localStorage` 全削除 → Cache Storage 全削除 → `location.reload()` |

---

## 9. 乗り場マップ

- **読み込み:** `BusStopMap` は `App.tsx` から **`React.lazy` で動的 import**。Leaflet は SSR に不向きなためです。
- **タイル:** `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`、帰属表示あり。Service Worker 側のマッチは `a` / `b` / `c` サブドメイン向けの正規表現です。
- **表示:** 高さ 220px、**初期ズーム 17**、`minZoom` 14 / **`maxZoom` 18**。ルート切替時は `flyTo` で中心移動（約 1.2 秒、ズーム 17）。
- **マーカー:** Leaflet 既定クラスの `_getIconUrl` を削除し、CDN 上の既定 PNG（Retina/標準/影）を `mergeOptions` で指定（Vite バンドル時の欠落対策）。乗り場は **`L.divIcon`** で、インライン HTML/CSS から **ティアドロップ型のピン**（ローズ色 `#E11D48`、回転した角丸四角＋中央の白丸、48×48 の配置枠、`filter: drop-shadow` で影）を描画します。
- **重なり:** 親に `isolation: 'isolate'` と `z-index` を与え、ドロワーがタイルレイヤより下に潜る問題を防ぎます。
- **ナビ連携:** `buildMapUrl.ts` — **iOS**（`iPad` / `iPhone` / `iPod` の UA）は `maps://`（Apple マップ・徒歩）。**それ以外** は Google マップの徒歩ルート（`https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&destination_place_id={encodeURIComponent(label)}&travelmode=walking` の形。`label` は停留所名）。「現在地からのルートを見る」の文字色はルートに応じて切り替わります（`campus_to_station` は `#10b981`、`station_to_campus` は `#6c63d5`）。
- **オフライン:** オンライン・オフラインで同じ `BusStopMap` を表示します。タイルは SW の CacheFirst により、**既にキャッシュされた範囲は表示できる**ことがあります。未キャッシュ領域は取得に失敗することがあります。

---

## 10. 時刻・タイムゾーン

- **基準タイムゾーン:** すべて **日本標準時（JST）**。Day.js の `timezone` で `Asia/Tokyo` を使用します。
- **端末設定:** 「今日」「今何時か」の判定は JST に揃える実装です（端末のタイムゾーン設定に依存しない意図）。
- **`useJSTClock`:** 初回マウント時、**端末時計の秒**を使って「次の分の 0 秒付近」まで待ってから `now` を更新し、以降 **60 秒ごと**に更新します。また、タブが非表示→表示に戻ったとき（`visibilitychange`）にも即時に `now` を更新します。カウントダウン文言は分単位のため、秒単位の再描画は行いません。
- **時刻表データ:** `departure` は `HH:mm` 文字列。当日の分単位比較で次便・終バスを判定（`findNextBus.ts` など）。

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

- 本リポジトリの **アプリ本体のライセンス** は、大学・組織の運用方針に従ってください（リポジトリルートに `LICENSE` ファイルは含まれていません）。
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
