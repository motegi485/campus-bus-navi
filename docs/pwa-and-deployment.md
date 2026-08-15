# PWA、キャッシュ、配信

## ビルドと配信の全体像

Vite はアプリを `dist/` へ出力します。Cloudflare Pages はこのビルド出力を配信する前提です。

```text
public/                 -- Vite が dist/ へコピー
  _headers              -- Cloudflare の配信ヘッダー
  _redirects            -- SPA フォールバック
  manifest.json         -- PWA マニフェスト
  push-sw.js            -- push 受信ハンドラ（生成 SW から importScripts される）
  data/                 -- 実行時に取得する静的データ
functions/api/          -- Pages Functions（通知の購読 API）
src/ + index.html       -- Vite がビルド
wrangler.toml           -- Pages のバインディング（D1、公開鍵）
dist/                   -- Cloudflare Pages の出力ディレクトリ
```

想定する Cloudflare Pages のビルド設定は、ビルドコマンドが `npm run build`、出力ディレクトリが `dist` です。実際の Pages プロジェクト設定や公開状態はリポジトリだけでは確認できないため、デプロイ時に管理画面で確認してください。

リポジトリ直下の `wrangler.toml` に `pages_build_output_dir` とバインディングを書いてあるため、**Pages のバインディングと環境変数はダッシュボードではなくこのファイルが正**になります。設定がリポジトリに残り、「どこで設定したか分からない」状態を避けられます。配信 Worker の設定は別で、`server/wrangler.toml` にあります（[backend-push.md](backend-push.md)）。

`public/_redirects` の `/* /index.html 200` は直接 URL を開いたときにも SPA を表示するために必要です。`_headers` と `_redirects` をリポジトリ直下へ移すと、`dist` を配信する構成では効きません。

Pages では **Functions が `_redirects` より先に評価される**ため、`/api/*` は SPA フォールバックに飲み込まれません（2026-08-16 に `/api/vapid-key` の応答で確認済み）。

## Service Worker の構成

`vite.config.ts` は `vite-plugin-pwa` を `registerType: 'prompt'` で設定しています。PWA マニフェストは自動生成せず、`public/manifest.json` をそのまま使います。

| 対象 | 方針 | 設定 |
|---|---|---|
| JS、CSS、HTML、アイコン等 | Workbox のプリキャッシュ | ビルド成果物 |
| `/data/*.json` | NetworkFirst | ネットワーク 3 秒待機後に `timetable-data` キャッシュへフォールバック、最大 20 件・7 日 |
| OSM タイル | CacheFirst | `osm-tiles`、最大 500 件・30 日 |

### データ JSON をプリキャッシュしない理由

`workbox.globPatterns` は JSON も対象にしますが、`globIgnores: ['data/**/*.json']` でデータ JSON を明示的に除外しています。

これを外すと、ビルド時のプリキャッシュが `/data/*.json` の素の URL に先に応答し、通常起動で NetworkFirst が通らなくなります。その結果、サーバー上の時刻表を更新しても、ユーザーが更新操作をするまで古いビルド時スナップショットが優先されます。データの鮮度を保つため、この除外は必須です。

`public/data/_examples/` もこの除外に含まれるため、本番プリキャッシュには入りません。

### push ハンドラを `injectManifest` へ移行せずに足している理由

`push` イベントを扱うには生成 SW に独自コードが要りますが、`injectManifest` へ全面移行すると上記のキャッシュ設定（`globIgnores`、NetworkFirst の 3 秒タイムアウト、`timetable-data` の名前、OSM タイル、skip-waiting のフロー）をすべて書き直すことになり、リグレッションのリスクが高くなります。

代わりに `workbox.importScripts` を使い、`public/push-sw.js` を生成 SW へ読み込ませています。**既存のキャッシュ設定には一切触れません。**

```ts
workbox: {
  importScripts: [`/push-sw.js?v=${packageJson.version}`],
  globIgnores: ['data/**/*.json'],   // 以下、従来どおり
  runtimeCaching: [ /* ... */ ],
}
```

URL にバージョンを含めているのは、SW の `updateViaCache` の既定が `'imports'` で、import したスクリプトが HTTP キャッシュから返るためです。固定 URL だと更新が端末へ届きません。

`push-sw.js` が読み込めないと **SW 全体がインストールに失敗**します。`public/` に置いてあるので常に `dist/` へコピーされますが、この結合は意識しておいてください。

`push-sw.js` は `timetable-data` キャッシュ名を参照します。`vite.config.ts` の `cacheName` と `src/hooks/useTimetable.ts` の `DATA_CACHE` に加えて、ここも結合先です。

## 時刻表の更新と正規 URL キャッシュ

手動更新では `useTimetable` が `?t=<timestamp>` を付け、`cache: 'reload'` でデータを取得します。Workbox の `/data/.*\.json(\?.*)?$` はこのクエリ付き URL にもマッチする必要があります。

Cache API はクエリ文字列を既定では無視しません。したがって、クエリ付き更新結果をそのままにすると、次にオフラインで素の URL を要求したとき、古いキャッシュが出る可能性があります。

このため `useTimetable` は更新成功後、同じレスポンスを `timetable-data` キャッシュの素の URL キーにも書き込みます。次の二つは一組です。

- `vite.config.ts` の `runtimeCaching.options.cacheName: 'timetable-data'`
- `src/hooks/useTimetable.ts` の `DATA_CACHE = 'timetable-data'`

どちらかの名前だけを変えてはいけません。

## アプリ更新の挙動

- 新しい Service Worker を起動から 5 秒以内に検知したときは、コールドスタートとして自動適用します。
- それ以降に検知した更新は `UpdateBanner` に表示し、利用者が任意のタイミングで適用します。
- `visibilitychange` でフォアグラウンドへ戻ったとき、登録済み Service Worker に更新確認を依頼します。
- iOS の standalone PWA で通常の更新通知が届かない場合に備え、`App.tsx` と `main.tsx` は待機中 worker を直接検出します。
- `main.tsx` は `sessionStorage` の `swWaitingReloadAttempted` により、待機 worker が有効化できない端末でも 1 セッション内の無限リロードを防ぎます。

アプリの「初期化」は、この更新機構とは別に、Service Worker の登録解除、localStorage、Cache Storage の削除、再読み込みを行います。

## Cloudflare の配信ヘッダー

`public/_headers` には次の意図があります。

| パス | 意図 |
|---|---|
| `/` | 毎回再検証 |
| `/assets/*` | 1 年の immutable キャッシュ |
| `/data/*.json` と `/data/timetables/*.json` | `no-cache, no-store, must-revalidate` により配信元キャッシュを抑止 |
| `/icons/*` | 1 日キャッシュ |

サーバーの `no-store` と、Service Worker が保持するオフライン用キャッシュは別の層です。オンラインでは NetworkFirst で最新取得を優先し、通信失敗または低速時は端末内にある前回取得分を使います。

`_headers` は `Date` レスポンスヘッダを落としていません。アプリはこのヘッダを「本文が実際にサーバから返ってきた時刻」として読み、鮮度表示の根拠にします。Cache API はレスポンスをヘッダごと保存するため、キャッシュから返った場合も取得当時の値が残ります。`Date` を落とす設定を足すと、鮮度表示は `navigator.onLine` と localStorage によるフォールバック経路へ落ち、精度が下がります。理由は [design-decisions.md](design-decisions.md) を参照してください。

## 外部リソース

- Google Fonts は `index.html` の `<link>` から読み込みます。
- Cloudflare Web Analytics のビーコンが `index.html` に埋め込まれています。フォークや別の運用へ移すときは、運用先に応じて削除または差し替えてください。
- OSM タイルは `https://tile.openstreetmap.org/{z}/{x}/{y}.png` を使います。旧 `a` / `b` / `c` サブドメインのキャッシュも読めるよう、Workbox のパターンでは任意扱いにしています。

## 変更時の確認

- Service Worker や `vite.config.ts` を変えたら、[verification.md](verification.md) の PWA / オフライン確認を実施する。
- `/data/` の URL、キャッシュ名、クエリ付き更新を変えたら、通常起動・更新後オフライン起動の両方を確認する。
- `_headers`、`_redirects`、マニフェストを変えたら、`npm run build` の `dist/` にコピーされることを確認する。
- 配信ヘッダーを変えたら、`/data/*.json` に `Date` が残っているかを確認する。
- Cloudflare Pages の設定や本番デプロイを変更した場合は、実際のレスポンスヘッダーと公開 URL を別途確認し、その確認日を運用記録に残す。

