# campus-bus-navi（バスNAVI）

福山大学スクールバスの **時刻表・乗り場案内アプリ（PWA）** です。「次のバスにすぐ乗れる」「時刻表を探す手間をなくす」「乗り場に迷わない」ことを目的に、学生・教職員向けに提供しています。

🌐 **アプリを開く → <https://campus-bus-navi.pages.dev/>**

> **現在 β 版（ver 1.0.2-beta）として運用中です。** 表示される時刻に万一誤りがあった場合に備え、試験や重要な予定の際は大学公式の時刻表も併せてご確認ください。

バックエンドやデータベースを持たない静的構成（React PWA + JSON データ）で、Cloudflare Pages から配信しています。

---

## 目次

1. [できること](#1-できること)
2. [使い方](#2-使い方)
3. [時刻表データの更新方法（運用者向け）](#3-時刻表データの更新方法運用者向け)
4. [開発者向け情報](#4-開発者向け情報)
5. [アーキテクチャ概要](#5-アーキテクチャ概要)
6. [ライセンス](#6-ライセンス)

---

## 1. できること

| 機能 | 説明 |
|------|------|
| 次のバスがひと目でわかる | 現在時刻（日本時間）に基づき、次の発車時刻と「あと何分」を大きく表示。本日の残り本数も表示し、残り 1 本なら「最終便」と知らせます |
| 今後の発車時刻・全時刻表 | 次発に続く直近 4 本と、本日の全時刻表（開閉式）を表示。過ぎた便はグレー表示 |
| ルート切り替え | 「大学発（→松永）」と「松永発（→大学）」をワンタップで切り替え |
| その日のダイヤを自動適用 | 授業日／休業日／長期休暇（平日・休日）／イベント日／**全便運休日** の 6 種類を日付から自動で選び、画面上部にダイヤ種別バッジを表示 |
| 終バス後・運休日の案内 | 本日の運行終了後や全便運休日には、翌日の始発時刻を案内 |
| 乗り場マップ | OpenStreetMap 上に乗り場ピンを表示。「現在地からのルートを見る」で端末の地図アプリ（iPhone・iPad は Apple マップ、その他は Google マップ）の徒歩ナビを起動 |
| お知らせ | 運行情報や重要連絡を配信。未読があるとメニューボタンにパルスドットを表示 |
| オフライン対応 | 一度読み込んだ時刻表・お知らせ・地図タイルは電波のない場所でも閲覧可能 |
| カスタマイズ | 起動時のデフォルトルート／カラーテーマ（ライト・ダーク・システム連動）／時刻の文字サイズを設定可能 |
| アプリとしてインストール | ホーム画面に追加すると全画面のネイティブアプリのように動作（PWA） |

---

## 2. 使い方

### 画面の見方

- **ヘッダー**: 現在のルート名・今日の日付・ダイヤ種別バッジ。左上の「≡」でメニュー、右上の「⟳」で時刻データを手動更新できます。
- **次のバスカード**: 次の発車時刻と「あと何分」。右上のバッジは本日の残り本数です。
- **今後の発車時刻**: 次発に続く最大 4 本。
- **本日の全時刻表**: 「表示する」で全便を一覧表示。現在の次発はハイライトされます。
- **乗り場マップ**: ピンが乗り場の位置。下のボタンで徒歩ルート案内を開きます。

### ホーム画面に追加（インストール）

- **iPhone / iPad**: Safari で開き、共有ボタン →「ホーム画面に追加」。
- **Android**: Chrome のメニュー（⋮）→「ホーム画面に追加」からインストール。

初回アクセス時に案内が表示されます（「今後表示しない」で非表示にできます）。

### データの更新について

- 時刻表・お知らせは起動のたびにサーバーから最新を取得し、取得できないとき（オフライン等）は前回取得分を表示します。
- アプリ本体の新バージョンは、起動直後であれば自動適用され、利用中に見つかった場合は画面下部のバナーから任意のタイミングで更新できます。

### 困ったとき

1. **表示が古い・おかしい** → 右上の更新ボタン（⟳）をタップ。
2. **それでも直らない** → メニュー →「アプリの初期化」（キャッシュ・設定をリセットして再読み込みします）。
3. **不具合報告・ご意見** → メニュー →「ヘルプ」→「フィードバックを送る」（Google フォーム）。

---

## 3. 時刻表データの更新方法（運用者向け）

すべてのデータは `public/data/` 配下の JSON で管理し、Git にコミット → デプロイで反映します。`_headers` により `/data/*.json` は no-cache 配信されるため、**デプロイ後は即座に全ユーザーへ反映**されます（アプリ本体の再ビルドは不要。JSON 編集のみの場合もデプロイは必要）。

### ファイル構成

```
public/data/
├── calendar_rules.json      # 「どの日にどのダイヤを使うか」のルール
├── news.json                # お知らせ
├── timetables/              # 時刻表本体（calendar_rules の ID が指す先）
│   ├── timetable_weekday.json   # 授業日ダイヤ
│   ├── timetable_holiday.json   # 休業日ダイヤ
│   └── timetable_closed.json    # 全便運休日（schedule は空配列）
└── _examples/               # テンプレート・サンプル（本番では読み込まれない）
    ├── timetable_vacation_SEASON_weekday.json  # 長期休暇（平日）テンプレ
    ├── timetable_vacation_SEASON_holiday.json  # 長期休暇（休日）テンプレ
    ├── timetable_event_YYYYMMDD.json           # イベント日テンプレ
    └── timetable_sample.json                   # 構造サンプル
```

### ダイヤの命名規約（6 種別）

ダイヤ種別バッジは **時刻表 ID（= ファイル名）から自動判定** されるため、命名規約の遵守が必須です。JSON 内の `id` はファイル名（拡張子なし）と一致させてください。

| ID パターン | 種別バッジ |
|-------------|-----------|
| `timetable_weekday` | 授業日ダイヤ |
| `timetable_holiday` | 休業日ダイヤ |
| `timetable_vacation_[季節]_weekday`（例 `..._summer_weekday`） | 長期休暇ダイヤ（平日） |
| `timetable_vacation_[季節]_holiday` | 長期休暇ダイヤ（休日） |
| `timetable_event_[YYYYMMDD]` | イベント日ダイヤ |
| `timetable_closed` | 運休日 |

### よくある作業

- **ダイヤ改正**: 該当の `timetables/*.json` の `schedule`（`departure`: `"HH:mm"`、`note`: 補足文字列）を編集。
- **特定日だけ別ダイヤ**（祝日授業・イベント・運休など）: `calendar_rules.json` の `overrides` に `"YYYY-MM-DD": "時刻表ID"` を追加。`default_rules` は曜日（`"0"`=日曜〜`"6"`=土曜）ごとのデフォルトです。
- **長期休暇ダイヤの新設**: `_examples/` のテンプレートをコピーして `SEASON` を実際の季節名に置換、`timetables/` に配置して `calendar_rules.json` から参照。
- **全便運休日**: `overrides` で `timetable_closed` を指定するだけ（アプリは「本日の運行はありません」と翌日始発を表示します）。
- **お知らせの追加**: `news.json` の配列先頭に追加。`id` は既存と重複しない数値、`tag` は `important` / `info` / `change` / `event`、`body` は HTML 可（信頼できる内容のみ）。`unread: true` で未読バッジの対象になります。

### 検証

コミット前に必ず実行してください（ID の参照切れ・時刻フォーマット・順序などを機械チェックします）:

```bash
npm run validate:data
```

`npm run build` にも同じ検証が組み込まれているため、不正なデータはビルド段階で検出されます。

---

## 4. 開発者向け情報

### 技術スタック

| カテゴリ | 採用技術 |
|----------|----------|
| 言語・UI | TypeScript 5（strict）、React 18 |
| ビルド | Vite 5 |
| スタイル | Tailwind CSS v4（`@tailwindcss/vite`。設定は `src/index.css` の `@theme`、`tailwind.config` 不使用） |
| 地図 | Leaflet 1.9 + react-leaflet 4（OpenStreetMap タイル） |
| 日時 | Day.js（`utc`/`timezone` プラグイン、`Asia/Tokyo` 固定） |
| PWA | vite-plugin-pwa（Workbox）、`registerType: 'prompt'` |
| ホスティング | Cloudflare Pages（`_headers` / `_redirects` 同梱） |

### セットアップ

```bash
git clone https://github.com/motegi485/campus-bus-navi.git
cd campus-bus-navi
npm install
npm run dev        # http://localhost:5173
```

| コマンド | 内容 |
|----------|------|
| `npm run dev` | 開発サーバー起動（Service Worker は無効） |
| `npm run validate:data` | `public/data/` の JSON を検証 |
| `npm run build` | データ検証 → 型チェック（tsc）→ `dist/` へビルド |
| `npm run preview` | 本番ビルドをローカル確認（**SW・オフライン動作の確認はこちらで**） |

テストフレームワーク・リンターは導入していません。型チェック（`strict` + `noUnusedLocals` / `noUnusedParameters`）とデータ検証スクリプトが品質ゲートです。

### ディレクトリ構成（src）

```
src/
├── App.tsx                  # ルート状態管理・レイアウト統括
├── main.tsx                 # 起動処理（SW 更新フォールバック・ビューポート同期）
├── components/              # UI コンポーネント
│   ├── NextBusCard / UpcomingList / FullTimetable / EndOfServiceCard
│   ├── BusStopMap（Leaflet・遅延ロード） / DayBadge / RouteToggle
│   ├── DrawerMenu / NewsScreen / SettingsScreen / HelpScreen
│   ├── Toast / UpdateBanner / MobilePwaGuide / ErrorBoundary
├── hooks/
│   ├── useJSTClock          # 分境界に同期した JST 時計（1 分間隔）
│   ├── useTimetable         # カレンダー解決 + 時刻表フェッチ
│   ├── useNews / useSettings / useOnlineStatus / useNativeBounce
├── utils/
│   ├── resolveCalendar      # 日付 → 時刻表 ID
│   ├── findNextBus          # 次発・直近・残数・翌日始発の算出
│   ├── normalizeTimetable   # 取得データの構造検証・ソート
│   ├── parseTime / buildMapUrl / platform（iOS・Android 判定）
└── types/timetable.d.ts     # 共通型定義
```

### デプロイ（Cloudflare Pages）

| 項目 | 値 |
|------|-----|
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| Node.js | 18 以上 |

- `_headers`: ルートは再検証必須、`/assets/*` は 1 年 immutable、`/data/*.json` は no-cache/no-store（ダイヤ更新の即時反映用）。
- `_redirects`: SPA のため `/* → /index.html 200`。
- `index.html` に Cloudflare Web Analytics のビーコンを含みます（フォーク時は削除・差し替えてください）。

---

## 5. アーキテクチャ概要

### データフロー

1. `useTimetable` が `calendar_rules.json` を取得し、`resolveCalendar()` で今日・明日の時刻表 ID を解決（日付上書き > 曜日デフォルト）→ 該当 JSON を並列フェッチ → `normalizeTimetable` で構造検証・昇順ソート。
2. `useJSTClock` が分境界に同期した JST 時刻を毎分供給し、`App` が `findNextBus` / `findUpcomingBuses` / `countRemainingBuses` を再計算。JST の日付が変わると自動再フェッチ。
3. 設定・お知らせ既読は `localStorage` に保存。

### PWA・キャッシュ戦略

| 対象 | 戦略 |
|------|------|
| JS / CSS / HTML / 画像 | Workbox プリキャッシュ（ビルド時） |
| `/data/*.json`（時刻表・カレンダー・お知らせ） | **NetworkFirst**（タイムアウト 3 秒 → 前回取得分にフォールバック）。プリキャッシュからは意図的に除外（`globIgnores`） |
| OSM 地図タイル | CacheFirst（最大 500 枚・30 日） |

- **更新方式**: `registerType: 'prompt'`。起動直後（5 秒以内）に新 SW を検知した場合のみ自動適用し、利用中の検知は更新バナーで通知（強制リロードしない）。iOS PWA で更新イベントが発火しないケースに備え、待機中 SW の直接検出フォールバックあり（無限リロード防止のワンショットガード付き）。
- **手動更新**: ヘッダーの更新ボタンが `?t=` キャッシュバスター + `cache: 'reload'` で再取得し、結果をトーストで通知（失敗時は失敗と表示）。

### 実装上の要注意ポイント（変更禁止級）

- `index.html` の viewport メタの **`shrink-to-fit=no`** — iPad Safari の縦潰れ（shrink-to-fit）対策の本体。削除すると再発します。
- `vite.config.ts` の **`globIgnores: ['data/**/*.json']`** — 外すとプリキャッシュが NetworkFirst に先勝ちし、ダイヤ更新が反映されなくなります。
- SW urlPattern 末尾の **`(\?.*)?`** — 手動更新のキャッシュバスター付き URL をマッチさせるために必須。
- **バウンス表現**（`useNativeBounce` + `.header-cushion`）— OS ネイティブに委譲する現構成が実機検証済みの最終形です。
- ブレークポイント判定は CSS メディアクエリではなく `main.tsx` の `syncBpActiveClass`（`html.bp-active`）で行います（iPadOS の `innerWidth` 復元バグ回避）。

---

## 6. ライセンス

- アプリ本体のライセンスは大学・組織の運用方針に従ってください（`LICENSE` ファイルは未同梱）。
- 主な利用 OSS: React / Vite / Tailwind CSS / Day.js / Workbox（MIT）、Leaflet / react-leaflet（BSD 2-Clause）。
- 地図データ: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors（ODbL）。タイルは OSM 公式タイルサーバーを利用しています。
