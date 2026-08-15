# アーキテクチャ

## システムの範囲

`campus-bus-navi` は、福山大学スクールバスの時刻表と乗り場を表示する React の単一ページ PWA です。利用者向けアプリは静的ファイルだけで動作し、実行時に専用 API やデータベースは使いません。時刻表・カレンダー・お知らせは `public/data/` の JSON として配信されます。

同じリポジトリには、大学サイト上の時刻表画像を取得して JSON 更新案を作る Bot もあります。Bot は利用者向けアプリの実行経路には含まれません。詳細は [backend-bot.md](backend-bot.md) を参照してください。

## 技術構成

| 領域 | 採用技術 |
|---|---|
| UI | React 18、TypeScript |
| ビルド | Vite 5、Tailwind CSS v4（`@tailwindcss/vite`） |
| 日時 | Day.js と `utc` / `timezone` プラグイン、`Asia/Tokyo` 固定 |
| 地図 | Leaflet、react-leaflet、OpenStreetMap タイル |
| PWA | vite-plugin-pwa、Workbox、workbox-window |
| 配信 | Cloudflare Pages |

依存関係と実行スクリプトは [package.json](../package.json) を正とします。

## 起動と責務の分割

```mermaid
flowchart TD
  HTML[index.html] --> Main[src/main.tsx]
  Main --> App[src/App.tsx]
  App --> Clock[useJSTClock]
  App --> Timetable[useTimetable]
  App --> Settings[useSettings]
  App --> News[useNews]
  Timetable --> Calendar[/data/calendar_rules.json]
  Calendar --> Rules[resolveCalendar]
  Rules --> Today[/data/timetables/当日ID.json]
  Rules --> Tomorrow[/data/timetables/翌日ID.json]
  App --> Cards[次発・一覧・地図・オーバーレイ]
```

### `index.html`

- PWA マニフェスト、アイコン、Google Fonts、Cloudflare Web Analytics のビーコンを読み込みます。
- React のマウント前に `campusBusNaviSettings` を読み、ダークテーマなら `<html>` に `dark` を付与します。これは初期描画の白いフラッシュを防ぐためです。
- viewport に `shrink-to-fit=no` を指定します。iPad Safari の起動時縮小を防ぐため、削除してはいけません。

### `src/main.tsx`

- `StrictMode` と `ErrorBoundary` の内側に `App` を描画します。
- 実ビューポート高を `--app-height` に同期します。
- 画面幅・向きの複数信号から `html.bp-active` を付け、PC / 横向き時の 2 カラム表示を制御します。単純な `innerWidth` だけの判定ではありません。
- React マウント前に待機中サービスワーカーを確認する iOS PWA 向けの救済処理を持ちます。

### `src/App.tsx`

`App` は画面全体の状態を合成します。

- 現在時刻、時刻表、オンライン状態、設定、お知らせを接続する
- 選択路線、ドロワー、お知らせ、設定、ヘルプ、更新中、Toast の状態を管理する
- 次発、残り本数、次発後の最大 4 本、終バス、翌日始発を毎分再計算する
- 特別ダイヤ、全便運休日、日付跨ぎでデータが古い状態を安全に分岐する
- `deriveDataStatus()` でデータ状態を 1 つに畳み、状態表示を排他的に描く
- PWA 更新検知とアプリ初期化を担当する
- オーバーレイが開いている間、背面を `inert` にする

地図だけは `React.lazy` で遅延読み込みされます。

## 時刻表のデータフロー

1. `useJSTClock` が JST の `dayjs` オブジェクトを返します。次の分境界に同期し、その後 60 秒ごとに更新します。タブの表示復帰時にも再同期します。
2. `useTimetable` が `/data/calendar_rules.json` を取得します。
3. `resolveCalendar()` が `overrides[YYYY-MM-DD]` を曜日の `default_rules` より優先し、今日・明日の時刻表 ID を決めます。
4. 今日と明日の時刻表を並列取得します。今日の取得失敗はエラー、明日の取得失敗は翌日始発が表示できない `null` として扱います。
5. `normalizeTimetable()` が取得済みデータの最低限の構造を検査し、不正な発車時刻を除外して昇順に整列します。
6. `App` が選択中路線の時刻表から表示用の情報を導出します。発車時刻が現在分と同じ便は既に通過したものとして扱い、次発には含めません。

ビルド前の完全なデータ検証と、配信後の最低限の防御は別です。前者は [data-model-and-operations.md](data-model-and-operations.md) を参照してください。

## 日付跨ぎの安全境界

時刻表には必ず対象日を紐付けます。`useTimetable` は `dateKey`、翌日先読み用の `tomorrowDateKey`、リクエスト世代を保持します。

- 日付変更後、先読み済みの翌日データが新しい当日と一致するときだけ当日データへ昇格します。
- 一致しない場合、または当日取得が失敗した場合は `stale` になります。
- `stale` 中は、前日の時刻表やダイヤ種別を当日の見出しで表示しません。日付変更の案内だけを出します。
- 競合する古い取得結果は、世代番号で破棄します。

これは「日付は今日なのに時刻は昨日」という誤案内を防ぐ必須の安全設計です。

## データ状態の表示

`deriveDataStatus()`（`src/utils/deriveDataStatus.ts`）が、読み込み状態・再取得中・エラー・`stale`・データ有無・オンライン状態から `DataStatus` を 1 つ決めます。上から順に判定し、最初に該当したものだけを描きます。

| 優先 | `DataStatus` | 条件 | 表現 | 時刻 |
|---|---|---|---|---|
| 1 | `no-data` | エラーかつ時刻表が未取得 | `StatusCard`（赤地） | 出さない |
| 2 | `refetching-stale` | `stale` かつ再取得中 | `StatusCard`（白地） | 出さない |
| 3 | `stale` | `stale` かつ再取得中でない | `StatusCard`（白地） | 出さない |
| 4 | `offline` | オフラインかつデータあり | `StatusBand`（白地） | 出す |
| 5 | `fetch-failed` | エラー・データあり・オンライン | `StatusBand`（赤地） | 出す |
| — | `ok` | 上記以外（初回読み込み中を含む） | 描かない | 出す |

`offline` を `fetch-failed` より先に判定します。端末がオフラインを認識できている場合はそちらの方が行動につながるためで、この順により `fetch-failed` は「オンラインなのに取得できなかった」だけを意味します。初回読み込み中は既存のスピナーが担当します。

表現を 2 種類に分けているのは、状態の重さが違うためです。時刻を出せない状態ではカードが画面の主役なので全幅のカードで伝えます。時刻を出せる状態では発車時刻が主役で状態は脇役なので、ヘッダー直下の帯にしてカードの積み重ねへ参加させません。

### 取得時刻

`useTimetable` は当日分の本文が「サーバから返ってきた時刻」を `fetchedAt` として保持し、上表の異常系で表示します。正常時は表示しません。判定根拠は `Date` レスポンスヘッダで、詳細と理由は [design-decisions.md](design-decisions.md) を参照してください。

## 表示コンポーネント

| コンポーネント | 主な責務 |
|---|---|
| `NextBusCard` | 次発、残り本数、分単位の案内 |
| `UpcomingList` | 次発の後に続く最大 4 本 |
| `FullTimetable` | 開閉式の全時刻表。空 `schedule` は描画しない |
| `EndOfServiceCard` | 終バス後または全便運休日と翌日始発 |
| `SpecialScheduleCard` | 時刻を出さず大学公式ページの確認先を示す |
| `DayBadge` | 時刻表 ID の命名規約からダイヤ種別を示す。`stale` 中と時刻表未取得時は描かない |
| `StatusCard` | 時刻を出せない状態のカード。取得時刻と再試行を持つ |
| `StatusBand` | 時刻を出せる状態の帯。ヘッダー直下に全幅で敷く |
| `StatusParts` | 上記 2 つが共有する状態アイコンと再試行ボタン |
| `BusStopMap` | 乗り場、OSM タイル、徒歩ナビリンク |
| `DrawerMenu` / `NewsScreen` / `SettingsScreen` / `HelpScreen` | 全画面・ドロワー型のオーバーレイ |
| `UpdateBanner` / `Toast` / `MobilePwaGuide` | 更新通知、短い通知、PWA 導入案内 |

## 端末内に保存する状態

| キー | 内容 |
|---|---|
| `campusBusNaviSettings` | 初期路線、テーマ（light / dark / system）、文字サイズ |
| `campusBusNaviNewsReadIds` | 既読にしたお知らせ ID |
| `campusBusNaviRouteToggleHinted` | 路線切替ナッジを一度表示済みか |
| `campusBusNaviFetchedAt` | 当日分の時刻表がサーバから返ってきた時刻（epoch ミリ秒） |
| `swWaitingReloadAttempted` | 待機中サービスワーカー起動救済の 1 セッション用ガード |

アプリ初期化はサービスワーカー登録、localStorage、Cache Storage を削除してから再読み込みします。

## お知らせと地図

`useNews` は初回マウント時に `/data/news.json` を取得します。未読状態は `App` で一元化され、メニューとお知らせ画面で同じ状態を共有します。`news.json` の `body` は `dangerouslySetInnerHTML` で描画されるため、Git 管理された信頼できる静的データだけを前提にしています。動的 CMS 等へ移す場合は、サニタイズを導入する必要があります。

地図はオフライン時にもマウントします。取得済みの OSM タイルだけが表示でき、未取得範囲は空白になり得ます。iOS / iPadOS は Apple Maps、それ以外は Google Maps の徒歩経路 URL を生成します。iPadOS のデスクトップ UA は `maxTouchPoints` で補完して iOS 判定します。

## 関連文書

- データの詳細: [data-model-and-operations.md](data-model-and-operations.md)
- PWA と配信: [pwa-and-deployment.md](pwa-and-deployment.md)
- 変更時に守る理由: [design-decisions.md](design-decisions.md)
