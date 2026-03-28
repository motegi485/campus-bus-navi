# 🚌 campus-bus-navi

**福山大学スクールバス 時刻表＆乗り場案内 PWA**

学生・教職員が「次のバスにすぐ乗れる」ことを目的とした Progressive Web App です。  
「時刻表を探す手間」と「乗り場に迷うストレス」を極限まで省きます。

---

## ✨ 主な機能

- **リアルタイムカウントダウン** — 次発バスまでの残り時間を秒単位で表示
- **ルート切り替え** — 「キャンパス発 ↔ 駅発」をワンタップで切り替え
- **直近4本の一覧 + 全時刻表** — 今日の全便をその場で確認
- **乗り場マップ** — OpenStreetMap ベースの埋め込み地図 + ナビアプリ連携
- **終バス後の案内** — 翌日の始発時刻を自動算出して表示
- **特別ダイヤ対応** — `calendar_rules.json` による日付ごとのダイヤ切り替え
- **オフライン対応** — Service Worker キャッシュで圏外でも時刻表を閲覧可能
- **PWAインストール** — ホーム画面に追加してネイティブアプリのように使用可能

---

## 🛠️ 技術スタック

| カテゴリ | 採用技術 |
|---|---|
| フレームワーク | React 18 + TypeScript 5 |
| ビルドツール | Vite 5 |
| スタイリング | Tailwind CSS v4（CSS変数ベース、設定ファイル不要） |
| 地図 | react-leaflet + OpenStreetMap（完全無料） |
| PWA | vite-plugin-pwa + Workbox |
| 時刻計算 | Day.js（JST固定） |
| デプロイ | Cloudflare Pages |

> **方針:** APIキー・課金サービスは一切使用しません。すべてオープンソース・標準APIのみで構成しています。

---

## 📁 ディレクトリ構成

```
campus-bus-navi/
├── public/
│   ├── data/
│   │   ├── calendar_rules.json      # 日付→ダイヤ対応ルール
│   │   ├── timetable_weekday.json   # 平日ダイヤ（例）
│   │   ├── timetable_holiday.json   # 休日ダイヤ（例）
│   │   └── news.json                # お知らせデータ（GitOps管理）
│   ├── icons/                       # PWAアイコン（192px・512px）
│   └── manifest.json                # PWAマニフェスト
├── src/
│   ├── components/                  # UIコンポーネント
│   │   ├── BusStopMap.tsx           # Leafletマップ
│   │   ├── NextBusCard.tsx          # 次発バス強調カード
│   │   ├── UpcomingList.tsx         # 直近4本リスト
│   │   ├── FullTimetable.tsx        # 全時刻表
│   │   ├── RouteToggle.tsx          # ルート切り替えUI
│   │   ├── DrawerMenu.tsx           # ハンバーガーメニュー
│   │   ├── EndOfServiceCard.tsx     # 終バス後の表示
│   │   ├── NewsScreen.tsx           # お知らせ画面
│   │   ├── HelpScreen.tsx           # ヘルプ画面
│   │   ├── SettingsScreen.tsx       # 設定画面
│   │   ├── UpdateBanner.tsx         # SW更新通知バナー
│   │   ├── DayBadge.tsx             # 適用ダイヤ表示バッジ
│   │   └── Toast.tsx                # トースト通知
│   ├── hooks/                       # カスタムフック（ロジック集約）
│   │   ├── useJSTClock.ts           # JST現在時刻（1秒更新）
│   │   ├── useTimetable.ts          # 時刻表データ取得・計算
│   │   ├── useNews.ts               # お知らせデータ取得
│   │   ├── useOnlineStatus.ts       # オンライン/オフライン検知
│   │   └── useSettings.ts           # ユーザー設定管理
│   ├── utils/
│   │   ├── resolveCalendar.ts       # 適用ダイヤ解決ロジック
│   │   ├── findNextBus.ts           # 次発バス検索ロジック
│   │   └── buildMapUrl.ts           # ナビアプリURL生成
│   ├── types/
│   │   └── timetable.d.ts           # 型定義
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                    # Tailwind CSS v4 変数定義
├── _headers                         # Cloudflare Pages キャッシュ設定
├── _redirects                       # Cloudflare Pages SPA ルーティング
├── vite.config.ts
└── package.json
```

---

## 📊 データ管理（GitOps方式）

バックエンド・DBは持たず、`public/data/` 以下の静的 JSON ファイルを Git で管理します。  
時刻表の変更はファイルを編集してコミット・プッシュするだけでデプロイされます。

### `calendar_rules.json` — 適用ダイヤルール

```json
{
  "default_rules": {
    "0": "timetable_holiday",   // 日曜
    "1": "timetable_weekday",   // 月曜
    ...
    "6": "timetable_holiday"    // 土曜
  },
  "overrides": {
    "2026-04-05": "timetable_special_01",  // 特定日に別ダイヤを適用
    "2026-08-10": "timetable_summer_vac"
  }
}
```

### `timetable_*.json` — 時刻表データ

```json
{
  "id": "timetable_weekday",
  "name": "通常平日ダイヤ",
  "routes": {
    "station_to_campus": {
      "origin": "福山駅発",
      "destination": "キャンパス行き",
      "bus_stop_coords": { "lat": 34.4897, "lng": 133.3622 },
      "schedule": [
        { "departure": "08:15", "note": "急行" },
        { "departure": "08:45", "note": "" }
      ]
    },
    "campus_to_station": { ... }
  }
}
```

### `news.json` — お知らせ

```json
[
  {
    "id": "news-001",
    "date": "2026-04-01",
    "title": "春季ダイヤ改正のお知らせ",
    "body": "..."
  }
]
```

---

## 🚀 開発手順

### 必要な環境

- Node.js 18以上
- npm 9以上

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/your-org/campus-bus-navi.git
cd campus-bus-navi

# 依存関係をインストール
npm install

# 開発サーバー起動（http://localhost:5173）
npm run dev
```

### ビルド

```bash
npm run build       # dist/ に本番ビルドを出力
npm run preview     # ビルド結果をローカルでプレビュー
```

---

## ☁️ デプロイ（Cloudflare Pages）

1. このリポジトリを Cloudflare Pages に接続
2. ビルド設定を以下のように指定：

| 項目 | 値 |
|---|---|
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| Node.jsバージョン | `18` 以上 |

`_headers` と `_redirects` は Cloudflare Pages が自動で読み込みます（設定不要）。

---

## ⚙️ PWA・Service Worker の設計方針

| 項目 | 方針 | 理由 |
|---|---|---|
| `registerType` | `prompt`（手動更新） | 操作中に強制リロードされることを防ぐ |
| JSONデータのキャッシュ | `NetworkFirst` | 古い時刻表の表示リスクを排除 |
| JSONフェッチURL | `?t=タイムスタンプ` を付与 | CDNキャッシュを回避してキャッシュバスティング |
| OSMタイル | `CacheFirst`（30日） | オフライン時もキャッシュ済みタイルを表示 |
| 初期化シーケンス | SW解除 → localStorage.clear() → キャッシュ削除 → リロード | 起動時のみ `window.location.reload()` を使用 |

---

## 🗺️ 乗り場マップの仕様

- **オンライン時:** `react-leaflet` + OpenStreetMap タイルでインタラクティブマップを表示
- **オフライン時:** 地図コンポーネントを非表示にし、「現在オフラインのため地図は表示できません」と表示
- **ナビ連携:** 「現在地からのルートを見る」ボタンで Google Maps などのナビアプリを起動
- **z-index制御:** `isolation: 'isolate'` を適用し、ドロワーメニューとの重なりを防止

---

## 🕐 時刻・タイムゾーンの扱い

- すべての時刻処理は **日本標準時（JST / UTC+9）固定**
- ユーザーの端末タイムゾーン設定に依存しない
- `Day.js` を使用して JST 現在時刻を1秒ごとに更新
- 開発時のデバッグ用に `useJSTClock.ts` 内の `DEBUG_TIME` 定数で時刻を固定可能

---

## 📱 モバイル最適化

- フルスクリーン対応（モバイル）/ センタリングカード（デスクトップ）
- iOSの Safe Area（ノッチ・Dynamic Island）への対応（`env(safe-area-inset-*)` 使用）
- `user-select: none` による誤テキスト選択の防止
- `manifest.json` の `display: "standalone"` でネイティブアプリライクな表示

---

## 📋 ライセンス

このプロジェクトは大学内部の運用を目的としたプライベートリポジトリです。  
使用するオープンソースライブラリはそれぞれのライセンスに従います。

| ライブラリ | ライセンス |
|---|---|
| React | MIT |
| Vite | MIT |
| Tailwind CSS | MIT |
| Leaflet / react-leaflet | BSD-2-Clause |
| Day.js | MIT |
| OpenStreetMap データ | ODbL |
| Workbox | MIT |
