# アーキテクチャ

## システムの範囲

`campus-bus-navi` は、福山大学スクールバスの時刻表と乗り場を表示する React の単一ページ PWA です。時刻表・カレンダー・お知らせは `public/data/` の JSON として配信され、**時刻表の閲覧に関わる機能は静的ファイルだけで完結します**。

ただし発車前の通知（Web Push）だけは例外で、配信サーバと D1 を使います。Web Push は「アプリのサーバが VAPID 署名付きで push サービスへ送る」構造で、時刻になったら送る何かが常時必要だからです。通知を使わない利用者に対しては、実行時のサーバ通信は発生しません。この層の構成・制約・運用は [backend-push.md](backend-push.md) が入口です。

| 層 | 場所 | 実行時の依存 |
|---|---|---|
| 表示（時刻表・地図・お知らせ） | `src/` | 静的 JSON のみ |
| 通知の購読と便の指定 | `functions/api/` | D1 |
| 通知の配信 | `server/` | Cron Trigger、D1、Durable Objects、APNs / FCM |
| 通知の受信 | `public/push-sw.js` | Service Worker（`workbox.importScripts` で生成 SW へ読み込む） |

同じリポジトリには、大学サイト上の時刻表画像を取得して `public/data/` を更新する Bot もあります。Bot は利用者向けアプリの実行経路には含まれませんが、**2026-08-16 以降は GitHub Actions が `main` へ直接コミットするため、配信データは自動で更新されます**（変更があった実行だけ運用者にメールが届きます）。詳細は [backend-bot.md](backend-bot.md) を参照してください。

## 技術構成

| 領域 | 採用技術 |
|---|---|
| UI | React 18、TypeScript |
| ビルド | Vite 5、Tailwind CSS v4（`@tailwindcss/vite`） |
| 日時 | Day.js と `utc` / `timezone` プラグイン、`Asia/Tokyo` 固定 |
| 地図 | Google マップ / Street View の埋め込み iframe（APIキー不要の非公式方式） |
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
  App --> Tabs[バス/マップ/メニュー タブ]
```

### `index.html`

- PWA マニフェスト、アイコン、Google Fonts、Cloudflare Web Analytics のビーコンを読み込みます。
- React のマウント前に `campusBusNaviSettings` を読み、ダークテーマなら `<html>` に `dark` を付与します。これは初期描画の白いフラッシュを防ぐためです。

配色は 2 軸のカスケードで決まります。**テーマ**は `<html>` の `dark` クラス、**ルート**はアプリシェル（`.phone-shell-inner`）の `data-route` 属性で、どちらも `src/index.css` が同じ名前の CSS 変数を上書きします。松永発を選ぶとルート追従トークン（`--route-solid` / `--route-accent-fg` / `--slot-current-*` / `--next-card-bg` / `--gauge-track` など）がインディゴ系へ入れ替わり、シェル内側の全画面（オーバーレイ・タブバー・バナーを含む）へ届きます。コンポーネントはルートを見ずにトークン名だけを読みます。ルートと無関係な `--ui-accent-*` と `--tab-*`、意味色の `--status-*` / `--switch-on-bg` は `data-route` で変わりません。詳細は [design-decisions.md](design-decisions.md#ルート別テーマ色と中立色2026-09-11) を参照してください。
- viewport に `shrink-to-fit=no` を指定します。iPad Safari の起動時縮小を防ぐため、削除してはいけません。

### `src/main.tsx`

- `StrictMode` と `ErrorBoundary` の内側に `App` を描画します。
- 実ビューポート高を `--app-height` に同期します。
- レイアウトビューポートが実画面より短く確定していないか実測し、短ければ viewport メタを一度書き換えて WebKit に再評価させます（`recoverShortViewport()`）。iOS の PWA では起動直後（特に待機サービスワーカー適用のためのリロード直後）に高さが「実画面高 − 上部セーフエリア」で確定し、`position: fixed; bottom: 0` のボトムタブバーが下端から浮くことがあるためです。判定は全画面の iOS PWA に限り、1 セッション 1 回だけ試みます。**タブバーをビューポート外へ押し出す方向の補正はしないでください**（iOS は fixed の描画をビューポートでクリップするため中身が消えます。[design-decisions.md](design-decisions.md) 参照）。
- React マウント前に待機中サービスワーカーを確認する iOS PWA 向けの救済処理を持ちます。

3タブ構成への改修（2026-09）以降、PC / 横向き専用の2カラム表示（旧 `html.bp-active`）は廃止しました。画面幅に関わらず常に同じ縦1カラムのタブ構成で表示します。

### `src/App.tsx`

`App` は画面全体の状態を合成します。

- 現在時刻、時刻表、オンライン状態、設定、お知らせを接続する
- 表示中のタブ（`バス` / `マップ` / `メニュー`）、全時刻表シート、お知らせ、設定、ヘルプ、更新中、Toast の状態を管理する
- 次発、残り本数、次発後の最大 4 本、終バス、翌日始発を毎分再計算する
- 特別ダイヤ、全便運休日、日付跨ぎでデータが古い状態を安全に分岐する
- 選択中のルートをアプリシェル（`.phone-shell-inner`）の `data-route` 属性へ流す
- `deriveDataStatus()` でデータ状態を 1 つに畳み、状態表示を排他的に描く
- バスタブの「発車前に通知」行（タイムライン直下）を直接持つ。`usePushSubscription` の状態と `useDepartureReminders` の `loadState` から説明文（`reminderSummary`）とタップ先を決める。購読済みなら `FullTimetableSheet`、未購読なら `SettingsScreen` を開く（[design-decisions.md](design-decisions.md)）
- PWA 更新検知とアプリ初期化を担当する
- オーバーレイ（全時刻表シート・お知らせ・週間ダイヤ・設定・ヘルプ）が開いている間、背面を `inert` にする

ナビゲーションはルーティングライブラリを使わず、`App` が持つ `activeTab` state（`useState<'bus' | 'map' | 'menu'>`）で3つのタブ本文を排他的に描画します（`BottomTabBar` が切替UIを担う）。バス・メニュータブはタブ切替のたびに再マウントしますが、マップタブだけは非アクティブ時に地図・Street ViewのiframeをDOMから外し、アクティブな間だけマウントする条件付きレンダリングにしています（`MapTab`）。非表示中のiframeを保持し続ける必然性はないが、タブ切替のたびにGoogle埋め込みを再読み込みする無駄を避けるための方式。

## 時刻表のデータフロー

1. `useJSTClock` が JST の `dayjs` オブジェクトを返します。次の分境界に同期し、その後 60 秒ごとに更新します。タブの表示復帰時にも再同期します。
2. `useTimetable` が `/data/calendar_rules.json` を取得します。
3. `resolveCalendar()` が `overrides[YYYY-MM-DD]` を曜日の `default_rules` より優先し、今日・明日の時刻表 ID を決めます。
4. 今日と明日の時刻表を並列取得します。今日の取得失敗はエラー、明日の取得失敗は翌日始発が表示できない `null` として扱います。両日の時刻表 ID が同じなら 1 回だけ取得して使い回します。
5. `normalizeTimetable()` が取得済みデータの最低限の構造を検査し、不正な発車時刻を除外して昇順に整列します。`closed` / `special` 以外で全便が落ちたら `throw` します（空 `schedule` は運休日・特別ダイヤ専用の表現なので、そのまま返すと破損を「運行なし」と誤案内する）。
6. `App` が選択中路線の時刻表から表示用の情報を導出します。発車時刻が現在分と同じ便は既に通過したものとして扱い、次発には含めません。

ビルド前の完全なデータ検証と、配信後の最低限の防御は別です。前者は [data-model-and-operations.md](data-model-and-operations.md) を参照してください。

## 週間ダイヤのデータフロー

`useWeekTimetables`（`src/hooks/useWeekTimetables.ts`）は今日を含む 7 日分を解決します。`useTimetable` とは独立していて、あちらの `stale` 判定・翌日昇格・世代管理には触れません。

1. `/data/calendar_rules.json` を取得します。キャッシュバスターは付けません。
2. 各日に `resolveCalendar()` を適用し、日付・時刻表 ID・`resolveDiagramType()` の結果を先に返します。ダイヤ種別はカレンダーだけで決まるため、時刻表の取得を待たずに一覧が成立します。
3. **時刻表の本文は、週間ダイヤ画面が開いている間だけ**取得します。`days`（日付とダイヤ種別）は起動時から先読みしますが、本文が要るのは週間ダイヤ画面を開いたときだけなので、初回表示で 7 日分の本文まで先読みすると低速回線で無駄に待たせます。
4. 本文は時刻表 ID を一意化してから並列取得し、`normalizeTimetable()` を通します。7 日で参照されるユニークな ID は実測で 3 件程度に収束するため、日数分のリクエストにはなりません。
5. 取得できなかった ID の日は `status: 'error'` になります。前後の日のダイヤで代用しません。

`App` がこのフックを 1 回だけ呼び、結果を `WeeklyScreen` へ渡します（改修たたき台への移行でホームの帯は廃止し、バスタブの日付ピルをタップすると `WeeklyScreen` を直接開くようにした）。画面ごとに呼ぶと同じ 7 日分を二重に取得します。`useTimetable` と同じくリクエスト世代で古い応答を破棄します。

本文の取得は「`status: 'loading'` の日が残っているときだけ走る」effect が担います。取り終えると全日が `ok` / `error` になるので再入しません。`reload()` はカレンダーから読み直すので、全日が `loading` に戻り、本文も取り直されます。

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
| 6 | `stale-data` | 上記に該当せず、`fetchedAt` が 24 時間以上前 | `StatusBand`（白地） | 出す |
| — | `ok` | 上記以外（初回読み込み中を含む） | 描かない | 出す |

`offline` を `fetch-failed` より先に判定します。端末がオフラインを認識できている場合はそちらの方が行動につながるためで、この順により `fetch-failed` は「オンラインなのに取得できなかった」だけを意味します。初回読み込み中は既存のスピナーが担当します。

`stale-data` は「取得は成功したが、その本文が古い」状態です。SW の NetworkFirst は 3 秒でキャッシュへ**成功として**フォールバックするため、これが無いと最大 7 日前のダイヤを通常表示のまま最新として見せます。閾値の根拠は [design-decisions.md](design-decisions.md) を参照してください。

表現を 2 種類に分けているのは、状態の重さが違うためです。時刻を出せない状態ではカードが画面の主役なので全幅のカードで伝えます。時刻を出せる状態では発車時刻が主役で状態は脇役なので、ヘッダー直下の帯にしてカードの積み重ねへ参加させません。

### 取得時刻

`useTimetable` は当日分の本文が「サーバから返ってきた時刻」を `fetchedAt` として保持し、上表の異常系で表示します。判定根拠は `Date` レスポンスヘッダで、詳細と理由は [design-decisions.md](design-decisions.md) を参照してください。`fetchedAt` は `stale-data` の判定にも使います。

## 表示コンポーネント

| コンポーネント | 主な責務 |
|---|---|
| `BottomTabBar` | バス／マップ／メニューの固定3タブ。選択表示は色のみ。`position: fixed` で viewport 下端に常時表示する（各タブ本文は `--tabbar-h` ぶんの下パディングでスペースを確保する） |
| `NextBusCard` | 次発、残り本数、分単位の案内、円形ゲージ（前便からの間隔を満タンとし上限 60 分。中央は 60 分以上で「時間／分後」の 2 行）。通知を設定済みの便ならベルの印を出す |
| `UpcomingList` | 今後の発車時刻タイムライン。先頭行は次発（`NextBusCard` と同じ便）で以降4本が続く、計最大5本。通知を設定済みの便にベルの印を出す |
| `FullTimetableSheet` | ホームの「全時刻表 ›」から開く全画面シート。上端を58px開けて背後のヘッダーを覗かせ、シート自体は角丸。ルートトグルと日付ピルをシート内にも再掲し、通知選択フローを内包する。空 `schedule` は「本日の運行はありません」を表示する。上グラバーは下ドラッグで閉じるハンドル（`useSheetDragToClose`）で、開いている間は背面を固定する（`useBodyScrollLock`）。タイトルと閉じるボタンは本文と一緒にスクロールする |
| `TimetableGrid` | 発車時刻のグリッド本体。`FullTimetableSheet` と週間ダイヤの日別ビューが共用する。`nowMinutes` が `null` の日は過去便を灰色にしない。未来便セルの背景は `futureBg` prop で呼び出し元ごとに変える |
| `WeeklyScreen` | 週間ダイヤ（今日を含む 7 日）と、その入れ子の日別ビュー。バスタブの日付ピル（タップ）とメニュータブの「週間ダイヤ」から開く |
| `RouteToggle` | バスタブヘッダー・全時刻表シート・マップタブで共用するルート切替（塗りつぶしピル、選択中はグラデーション） |
| `RouteSwitch` | ページ面に置くルート切替。`RouteToggle` とは面の作りが違う。`WeeklyScreen` が使う |
| `EndOfServiceCard` | 終バス後または全便運休日と翌日始発 |
| `SpecialScheduleCard` | 時刻を出さず大学公式ページの確認先を示す |
| `DayBadge` | 時刻表 ID の命名規約からダイヤ種別を示す。`stale` 中と時刻表未取得時は描かない |
| `StatusCard` | 時刻を出せない状態のカード。取得時刻と再試行を持つ |
| `StatusBand` | 時刻を出せる状態の帯。ヘッダー直下に全幅で敷く |
| `StatusParts` | 上記 2 つが共有する状態アイコンと再試行ボタン |
| `MapTab` | マップタブのヘッダー・ルートトグル・ルート案内行（`buildMapUrl` の徒歩ナビリンク）・地図とStreet ViewのGoogle埋め込みiframe（`buildEmbedUrl.ts`、APIキー不要の非公式方式。Street Viewのパノラマ・向きはルート別定数 `STREET_VIEW_SPOTS` で固定）を直接持つ |
| `MenuTab` | メニュータブ。リンク／アプリ／その他の3グループを行ごとに個別カードで並べる。通知する便の指定はメニューに重複させず、バスタブの「発車前に通知」行から行う |
| `NewsScreen` / `SettingsScreen` / `HelpScreen` | 全画面型のオーバーレイ（メニュータブの各項目から開く） |
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

`useNews` は初回マウント時に `/data/news.json` を取得します。未読状態は `App` で一元化され、メニュータブとお知らせ画面で同じ状態を共有します。`news.json` の `body` は `dangerouslySetInnerHTML` で描画されるため、Git 管理された信頼できる静的データだけを前提にしています。動的 CMS 等へ移す場合は、サニタイズを導入する必要があります。

地図はマップタブがアクティブな間だけマウントします（前述のとおり、Google埋め込みの不要な再読み込みを避けるため）。地図・Street Viewとも`maps.google.com`のクロスオリジンiframeのため Service Worker ではキャッシュできず、オフライン時はこの2枚のカードが表示されません。徒歩経路 URL は OS を問わず Google マップのもの（`https://www.google.com/maps/dir/?api=1&...`）を生成します（`buildMapUrl.ts`、地図埋め込みとは別の仕組み）。この URL は Google マップアプリのユニバーサルリンク／App Link でもあるため、アプリがあればアプリが、無ければブラウザが開きます。以前は iOS / iPadOS だけ Apple Maps のリンクを返していましたが、実機で「Google マップで見たいのに Apple マップが開く」ことになるため 2026-09 に統一しました。

## 関連文書

- データの詳細: [data-model-and-operations.md](data-model-and-operations.md)
- PWA と配信: [pwa-and-deployment.md](pwa-and-deployment.md)
- 変更時に守る理由: [design-decisions.md](design-decisions.md)
