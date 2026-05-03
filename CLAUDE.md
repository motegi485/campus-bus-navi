# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## コマンド

```bash
npm run dev       # Vite 開発サーバー起動 (http://localhost:5173)
npm run build     # TypeScript チェック → Vite ビルド → /dist 出力
npm run preview   # プロダクションビルドをローカルでプレビュー
npx tsc --noEmit  # ビルドせずに型チェックのみ実行
```

テスト・リントスクリプトは存在しない。TypeScript は `strict: true` に加え `noUnusedLocals` / `noUnusedParameters` も有効で、`tsc --noEmit` が `build` の一部として実行される。

## アーキテクチャ

福山大学のバス時刻表を表示する **React 18 + TypeScript PWA**。全データは静的 JSON でバックエンドなし。Cloudflare Pages にデプロイ。

**スタック:** Vite 5、Tailwind CSS v4（`tailwind.config.js` は不要 — `index.css` 内の `@theme` ブロックで設定、`@tailwindcss/vite` プラグイン使用）、Leaflet + react-leaflet（地図）、Day.js（JST 時刻処理）、Workbox（サービスワーカーキャッシュ）。

### データフロー

1. **`useTimetable`** が `/public/data/calendar_rules.json` を取得し、`resolveCalendar()` で今日の時刻表 ID を解決（日付指定の上書きが曜日デフォルトより優先）、今日・明日の時刻表 JSON を並列フェッチする。
2. **`useJSTClock`** は `Asia/Tokyo` の Day.js オブジェクトを返す。次の `:00` 秒境界に同期後、60秒ごとに更新。タブの表示状態変化時に再同期する。
3. **`App.tsx`** これらのフックを合成し、クロックの更新ごとに `findNextBus()` / `findUpcomingBuses()` を実行。当日の発車便がなくなると `isEndOfService = true` になる。`visibilitychange` でフォアグラウンド復帰時に SW の新バージョンを確認する。
4. 設定（路線・テーマ・フォントサイズ）は `useSettings` 経由で **localStorage** に保存される。

### 静的データファイル

時刻表・お知らせデータはすべて `/public/data/` に置かれ、Git で管理される：

- `calendar_rules.json` — 曜日デフォルト + 日付単位の上書き（YYYY-MM-DD キー）
- `timetable_weekday.json`、`timetable_holiday.json`、`timetable_spring_vac_*.json` — 路線ごとの発車時刻
- `news.json` — お知らせ（本文に HTML 使用可、`tag` フィールドで `important/info/change/event` を分類）

ダイヤ改正時は該当 JSON ファイルを編集する。リポジトリルートの `_headers` が Cloudflare に `/data/*.json` を `Cache-Control: no-cache` で配信するよう指示しており、更新は即座に反映される。

### 重要な設計判断

**時刻処理:** 全時刻は JST（`Asia/Tokyo`）。バス発車時刻の照合は分単位の文字列比較（`HH:mm > now`）。`useJSTClock` の境界同期パターンはクロックドリフト防止とサブ分単位のちらつき抑制のために意図的に採用している。

**PWA アップデート:** `registerType: 'prompt'` — サービスワーカーは自動更新しない。`UpdateBanner` コンポーネントがユーザーに通知する。スタック状態の解消には完全リセット（SW 登録解除 + localStorage クリア + Cache Storage 削除 + リロード）が用意されている。

**サービスワーカーキャッシュ戦略:**
- 時刻表 JSON → NetworkFirst（タイムアウト 5秒、失敗時は SW キャッシュにフォールバック）
- OSM 地図タイル → CacheFirst（オフライン動作）
- JS/CSS/アセット → Workbox プレキャッシュ

**地図:** Leaflet は動的インポート（lazy）でSSR 問題を回避。iOS 端末（UA に `iPad|iPhone|iPod`）は Apple Maps リンク、それ以外は Google Maps リンクでナビを開く。

**ダイヤ種別** は時刻表 ID 文字列から推定：`holiday` を含む → `'holiday'`、`vac` → `'vacation'`、`event` → `'event'`、それ以外 → `'class'`。

**路線:** 2路線のみ — `station_to_campus`（松永駅→大学）と `campus_to_station`（大学→松永駅）。`RouteKey` 型は `src/types/timetable.d.ts` で定義。

**バージョン:** `__APP_VERSION__` がビルド時に `package.json` の `version` フィールドから注入される（`vite.config.ts` の `define`）。UI の複数箇所で参照される。

### コンポーネント構成

```
App.tsx                  ← ルート状態管理・レイアウト統括
src/hooks/
  useJSTClock.ts         ← 分境界に同期した JST 時刻
  useTimetable.ts        ← カレンダー解決・時刻表データのフェッチ
  useSettings.ts         ← 路線/テーマ/フォントサイズの localStorage 管理
  useNews.ts             ← news.json 取得・既読状態管理
  useOnlineStatus.ts     ← オンライン/オフライン検知
  useInstallPrompt.ts    ← ホーム画面追加（A2HS）プロンプト管理
src/utils/
  findNextBus.ts         ← 次の便・直近4便・翌日始発の計算（純粋関数）
  resolveCalendar.ts     ← 日付 → 時刻表 ID のマッピング
  buildMapUrl.ts         ← iOS / Android 向けナビ URL 生成
src/components/          ← UI コンポーネント（NextBusCard, UpcomingList,
                            FullTimetable, BusStopMap, DrawerMenu 等）
src/types/
  timetable.d.ts         ← 共通 TypeScript 型定義
```

### テーマ

Tailwind v4 + CSS カスタムプロパティ — `index.css` 内で `:root`（ライト）と `.dark` クラス（ダーク）に定義。主要変数: `--bg-page`、`--bg-card`、`--bg-card2`、`--bg-input`、`--text-primary`、`--text-muted`、`--text-secondary`、`--border`、`--border2`、`--past-text`、`--past-bg`。フォントサイズは設定でトグルされる CSS クラスで制御。

### ビルド出力

`npm run build` は `/dist` に出力する。リポジトリルートの `_headers` と `_redirects` は Cloudflare Pages の設定ファイルで、`_redirects` には SPA ルーティング用の `/* /index.html 200` が含まれる。
