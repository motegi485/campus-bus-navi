# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## コマンド

```bash
npm run dev            # Vite 開発サーバー起動 (http://localhost:5173)
npm run validate:data  # public/data 配下の静的データを検証（scripts/validate-data.mjs）
npm run build          # データ検証 → TypeScript チェック → Vite ビルド → /dist 出力
npm run preview        # プロダクションビルドをローカルでプレビュー
npx tsc --noEmit       # ビルドせずに型チェックのみ実行
```

テスト・リントスクリプトは存在しない。TypeScript は `strict: true` に加え `noUnusedLocals` / `noUnusedParameters` も有効で、`tsc --noEmit` が `build` の一部として実行される。静的データ（時刻表・カレンダー・お知らせ）の ID 参照切れや時刻フォーマット崩れは `validate:data`（`scripts/validate-data.mjs`）が `build` の最初のステップとして検出する。

## アーキテクチャ

福山大学のバス時刻表を表示する **React 18 + TypeScript PWA**。全データは静的 JSON でバックエンドなし。Cloudflare Pages にデプロイ。

**スタック:** Vite 5、Tailwind CSS v4（`tailwind.config.js` は不要 — `index.css` 内の `@theme` ブロックで設定、`@tailwindcss/vite` プラグイン使用）、Leaflet + react-leaflet（地図）、Day.js（JST 時刻処理）、Workbox（サービスワーカーキャッシュ）。

### データフロー

1. **`useTimetable`** が `/public/data/calendar_rules.json` を取得し、`resolveCalendar()` で今日の時刻表 ID を解決（日付指定の上書きが曜日デフォルトより優先）、今日・明日の時刻表 JSON を並列フェッチする。
2. **`useJSTClock`** は `Asia/Tokyo` の Day.js オブジェクトを返す。次の `:00` 秒境界に同期後、60秒ごとに更新。タブの表示状態変化時に再同期する。
3. **`App.tsx`** これらのフックを合成し、クロックの更新ごとに `findNextBus()` / `findUpcomingBuses()` を実行。当日の発車便がなくなると `isEndOfService = true` になる。`visibilitychange` でフォアグラウンド復帰時に SW の新バージョンを確認する。
4. 設定（路線・テーマ・フォントサイズ）は `useSettings` 経由で **localStorage** に保存される。
5. **`useNews`** が `/public/data/news.json` を素の URL で取得し（NetworkFirst 経由。オフライン時は SW キャッシュの前回取得分にフォールバック）、既読 ID を localStorage で管理する。`App.tsx` が未読有無（`hasUnread`）を算出し、ハンバーガーボタンとドロワーの「お知らせ」項目に未読ドットを表示する。

### 静的データファイル

時刻表・お知らせデータはすべて `/public/data/` 以下に置かれ、Git で管理される：

- `calendar_rules.json` — 曜日デフォルト + 日付単位の上書き（YYYY-MM-DD キー）
- `news.json` — お知らせ（本文に HTML 使用可、`tag` フィールドで `important/info/change/event` を分類）
- `timetables/` — 路線ごとの発車時刻。`calendar_rules.json` から実際に参照される本番用の時刻表のみを置く（現状 `timetable_weekday.json`・`timetable_holiday.json`・`timetable_closed.json`〔全便運休日、`schedule` が空配列〕）
- `_examples/` — 長期休暇・イベント日ダイヤのテンプレートと構造サンプル。`calendar_rules.json` からは参照されず、`validate:data` の検証対象にも含まれない（`public/` 配下のため `dist/data/_examples/` へは他の静的ファイルと同様にコピーされるが、アプリからは読み込まれないダミーデータである点に注意）。新しいダイヤを作るときはここからコピーして値を実データに置き換え、`timetables/` に配置する

ダイヤ改正時は該当 JSON ファイルを編集する。時刻表 JSON の `id` はファイル名（拡張子なし）と一致させること（`validate:data` が検証する）。リポジトリルートの `_headers` が Cloudflare に `/data/*.json` を `Cache-Control: no-cache` で配信するよう指示しており、更新は即座に反映される。

### 重要な設計判断

**時刻処理:** 全時刻は JST（`Asia/Tokyo`）。バス発車時刻の照合は分単位の文字列比較（`HH:mm > now`）。`useJSTClock` の境界同期パターンはクロックドリフト防止とサブ分単位のちらつき抑制のために意図的に採用している。

**PWA アップデート:** `registerType: 'prompt'` — 操作中の強制更新は行わない。ただし**コールドスタート時（起動から `COLD_START_GRACE_MS = 5000` 以内）に新 SW を検知した場合のみ自動適用**（`updateServiceWorker(true)`）し、それ以降のセッション中の検知は `UpdateBanner` でユーザーに通知する（`App.tsx`。「あとで」でバナーを閉じてもセッション中は再表示しない）。`useRegisterSW` の `needRefresh` が発火しない iOS PWA（standalone）向けに、`navigator.serviceWorker` で `waiting` 状態の SW を直接検出して `SKIP_WAITING` を送るフォールバックを `App.tsx` と `main.tsx`（React マウント前）に用意している。`main.tsx` 側のこのフローは sessionStorage（`swWaitingReloadAttempted`）によるワンショットガード付きで、待機 SW が activate できない端末でも「起動 → 2秒待ち → リロード」を無限に繰り返さない（1 セッション 1 回まで）。スタック状態の解消には完全リセット（SW 登録解除 + localStorage クリア + Cache Storage 削除 + リロード）が用意されている。

**サービスワーカーキャッシュ戦略:**
- 時刻表・カレンダー・お知らせ JSON → NetworkFirst（タイムアウト 3秒、失敗時は `timetable-data` キャッシュの前回取得分にフォールバック）
- OSM 地図タイル → CacheFirst（オフライン動作）
- JS/CSS/アセット → Workbox プレキャッシュ

**データ JSON はプリキャッシュしない（重要）:** `data/**/*.json` を `vite.config.ts` の `workbox.globIgnores` で**プリキャッシュ対象から除外**している。`globPatterns` に `json` が含まれるため除外しないと `/data/*.json` の素の URL がプリキャッシュに先勝ちでヒットし、NetworkFirst が「通常起動の読み込み経路」では効かなくなる（ビルド時スナップショットが固定表示され、サーバ更新が更新ボタンを押すまで反映されない）。除外することで**通常起動・更新ボタン・お知らせ取得のすべてが NetworkFirst を通り**、常に最新を取得しつつ取得済み分をオフライン用フォールバックとして保持する。`globIgnores` を外すとこの挙動が壊れるので注意。なお `_examples/` やテンプレート（`*_SEASON_*` / `*_YYYYMMDD`）もこれにより本番プリキャッシュから外れる。

**SW キャッシュ URL パターンの注意点:** データ JSON の `urlPattern` は `/\/data\/.*\.json(\?.*)?$/`。`useTimetable` の手動更新ボタンのみ `?t=timestamp` のキャッシュバスター付き URL でフェッチするため末尾の `(\?.*)?` が必要（`useNews` は素の URL のみでキャッシュバスターは付けない）。`/\.json$/` に変えるとキャッシュバスター付き URL がマッチせず NetworkFirst が適用されない。

**地図:** Leaflet は動的インポート（lazy）でSSR 問題を回避。iOS/Android 判定は `src/utils/platform.ts` の `isIOS()` / `isAndroid()` に共通化（`buildMapUrl.ts`・`MobilePwaGuide.tsx`・`useNativeBounce.ts` が共通で参照する）。`isIOS()` は UA の `iPad|iPhone|iPod` に加え、iPadOS 13+ がデスクトップ UA（`Macintosh`）を送る問題を `navigator.maxTouchPoints > 1` の補完で吸収する。iOS は Apple Maps のユニバーサルリンク（`https://maps.apple.com/?daddr=...`。非対応環境では Web にフォールバック）、それ以外は Google Maps リンクでナビを開く。

**ダイヤ種別** は時刻表 ID 文字列から推定（6種類）：`closed` を含む → `'closed'`（全便運休日）、`event` を含む → `'event'`、`vacation` を含む → `holiday` も含めば `'vacation_holiday'` / 含まなければ `'vacation_weekday'`、`holiday` を含む → `'holiday'`、それ以外 → `'weekday'`。`vacation_*_holiday` は `vacation` と `holiday` の両方を含むため、`vacation` を `holiday` より先に判定する順序が必須。判定順序は `closed → event → vacation → holiday → weekday`。推定ロジックは `DayBadge.tsx` の `resolveDiagramType()` に実装されている。全便運休日は時刻表の `schedule` を空配列にすることで表現し、`App.tsx` はこれを `isNoService` として検出して次発カードの代わりに「本日の運行はありません」＋翌日始発を表示する（`timetable_closed.json` を `calendar_rules.json` の `overrides` から参照させて運用する）。

**路線:** 2路線のみ — `station_to_campus`（松永駅→大学）と `campus_to_station`（大学→松永駅）。`RouteKey` 型は `src/types/timetable.d.ts` で定義。

**バージョン:** `__APP_VERSION__` がビルド時に `package.json` の `version` フィールドから注入される（`vite.config.ts` の `define`）。UI の複数箇所で参照される。

**iPad/iOS の縦潰れ（shrink-to-fit）対策:** iPad の Safari・PWA で 2 回目以降の起動時に UI が縦方向に潰れる事象があった。原因は Safari の **shrink-to-fit**（起動直後に一瞬ビューポート幅を超える要素が描画されると、iOS が `width=device-width` を無視してレイアウト幅を ~1280px に広げ、ページ全体を ~0.64 倍に縮小描画する挙動）。対処は `index.html` の viewport メタに **`shrink-to-fit=no`** を付与すること。これが修正本体なので削除しない。なお高さ（`dvh`）・`bp-active`・倍率固定（`minimum/maximum-scale`）・`viewport-fit` のトグルはいずれも無効で原因でもなかったため、再発時にそれらを疑わないこと。`src/main.tsx` の `syncAppHeight`（`--app-height`）と `syncBpActiveClass`（`bp-active`）は本件とは別目的の同期処理。

### コンポーネント構成

```
App.tsx                  ← ルート状態管理・レイアウト統括
src/hooks/
  useJSTClock.ts         ← 分境界に同期した JST 時刻
  useTimetable.ts        ← カレンダー解決・時刻表データのフェッチ
  useSettings.ts         ← 路線/テーマ/フォントサイズの localStorage 管理
  useNews.ts             ← news.json 取得・既読状態管理
  useOnlineStatus.ts     ← オンライン/オフライン検知
src/utils/
  findNextBus.ts         ← findNextBus / findUpcomingBuses / findFirstBus（翌日始発）/ countRemainingBuses（本日の残り本数）を export
  resolveCalendar.ts     ← 日付 → 時刻表 ID のマッピング
  normalizeTimetable.ts  ← 取得した時刻表データの構造検証・不正エントリ除去・発車時刻の昇順ソート
  buildMapUrl.ts         ← iOS / Android 向けナビ URL 生成
  platform.ts            ← isIOS() / isAndroid() 判定の共通実装
  parseTime.ts           ← HH:mm 文字列を分単位の数値に変換（findNextBus が使用）
src/components/          ← UI コンポーネント（NextBusCard, UpcomingList,
                            FullTimetable, BusStopMap, DrawerMenu,
                            MobilePwaGuide, ErrorBoundary, Toast 等）
src/types/
  timetable.d.ts         ← 共通 TypeScript 型定義
scripts/
  validate-data.mjs      ← public/data 配下の静的データ検証（npm run validate:data / build から実行）
```

### テーマ

Tailwind v4 + CSS カスタムプロパティ — `index.css` 内で `:root`（ライト）と `.dark` クラス（ダーク）に定義。主要変数: `--bg-page`、`--bg-card`、`--bg-card2`、`--bg-input`、`--text-primary`、`--text-muted`、`--text-secondary`、`--border`、`--border2`、`--past-text`、`--past-bg`。フォントサイズは設定でトグルされる CSS クラスで制御。

テーマ設定は `light` / `dark` / `system` の 3 種（`useSettings` で localStorage 管理）。`system` は `prefers-color-scheme` に追従し、`App.tsx` が `<html>` の `.dark` を同期する。初回描画の FOUC 防止のため、React マウント前に `index.html` のインラインスクリプトが同一ロジックで `.dark` を付与する（判定ロジックとストレージキー `campusBusNaviSettings` は `useSettings` / `App.tsx` と一致させること）。

### ビルド出力

`npm run build` は `/dist` に出力する。リポジトリルートの `_headers` と `_redirects` は Cloudflare Pages の設定ファイルで、`_redirects` には SPA ルーティング用の `/* /index.html 200` が含まれる。
