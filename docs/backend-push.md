# 発車リマインダー配信基盤

発車前の通知（Web Push）を担うサーバ側の構成、安全境界、運用手順をまとめます。フロントエンドの責務は [architecture.md](architecture.md)、時刻表データの契約は [data-model-and-operations.md](data-model-and-operations.md) を参照してください。

この機能の導入により、**「バックエンドやデータベースを持たない静的構成」という以前の前提は成立しなくなりました。** 時刻表の閲覧は引き続き静的ファイルだけで完結しますが、通知には配信サーバと D1 が必要です。この判断の背景は [design-decisions.md](design-decisions.md) を参照してください。

## なぜサーバが要るのか

Web Push は「アプリのサーバが VAPID 署名付きで push サービス（APNs / FCM）へ送る」という構造で、**時刻になったら送る何かが常時動いている必要**があります。これは回避できません。代替手段は次のとおり検討し、いずれも成立しませんでした。

| 手段 | 結果 |
|---|---|
| Notification Triggers API（端末に通知を予約） | Chrome 80–83 / 86–88 のオリジントライアルのみで終了。標準化されず実験フラグ配下 |
| Service Worker に `setTimeout` | SW はアイドル時に OS が停止するため生存が保証されない |
| Periodic Background Sync | 分単位の精度が出ず、iOS は非対応 |
| ローカル通知 API（`UNUserNotificationCenter` / `AlarmManager`） | ネイティブアプリ専用。PWA からは呼べない |

## 構成

```
[ブラウザ / PWA]
   │ 購読の登録・解除、便の指定（同一オリジン、CORS 不要）
   ▼
[Pages Functions]  functions/api/*.ts ── campus-bus-navi.pages.dev/api/...
   │                                          │
   │                                          ▼
   │                                    [D1: campus-bus-navi]
   │                                          ▲
   ▼                                          │
[push-sw.js]  ◄── APNs / FCM ◄── [Worker + Cron Trigger]  1 分ごと
                                       │
                                       ├─ /data/*.json を取得して当日のダイヤを解決
                                       └─ Durable Object へ 40 件ずつ分配 → 各 DO が送信
```

| 要素 | 場所 | 責務 |
|---|---|---|
| 購読 API | `functions/api/` | 端末の登録・解除、便の指定、公開鍵の配布、状態の集計 |
| 配信 Worker | `server/src/index.ts` | Cron で起動し、送信対象を選んで DO へ分配 |
| 送信 DO | `server/src/sender.ts` | 最大 40 件へ送信し、結果を D1 へ記録 |
| 送信判定 | `server/src/schedule.ts` | 純関数。Cloudflare にも D1 にも依存せず vitest で検証できる |
| VAPID 署名 | `server/src/vapid.ts` | WebCrypto による ES256 署名 |
| 受信 | `public/push-sw.js` | `push` イベントで通知を組み立てて表示 |

Pages と Worker は**別々のデプロイ**で、**同じ D1 データベース**を指します。Pages が書き、Worker が読んで送ります。バインディングはリポジトリ直下の `wrangler.toml`（Pages）と `server/wrangler.toml`（Worker）の双方に記載します。

## 二層のデータモデル

```sql
subscriptions … 端末そのもの。設定画面のトグル（通知の根幹の許可）が作り、消す
reminders     … 「どの便に何分前」。本日の全時刻表の選択モードが作る。当日限り
```

分けている理由は、1 台の端末が同じ日に複数の便を指定できるためです。端末を主キーにした 1 テーブル構成では 1 件しか持てません。スキーマの実体は `server/src/schema.sql` が正本です。

- `subscriptions.id` は endpoint の SHA-256。再購読で自然に上書きされ、重複が構造的に生まれません
- `reminders.id` は `subscription_id + date_key + route + departure` から決定的に作ります。同じ便を二度指定しても行が増えません
- `reminders.date_key` により**当日限り**が構造で担保されます。Cron は当日ぶんしか引かず、日付が変わる分に前日以前を削除します

**アカウントもユーザー識別子も持ちません。** 学内配布物の「登録不要」というコピーと衝突しません。

## 設計上の制約と、その帰結

### 外部サブリクエスト 50 件 / 実行（Workers 無料枠）

push 送信 1 件が外部 fetch 1 件なので、**1 実行で送れるのは最大 50 通**です。これを超える分は Durable Object へ分配します。DO の実行は独立した実行なので各自 50 件の枠を持ち、Cron から DO への呼び出しは Cloudflare サービス向けの枠（1,000 件）を使うため上限に当たりません。

`server/src/schedule.ts` の `BATCH_SIZE` を 40 にしているのは、ダイヤ取得の fetch も同じ枠を消費するための余裕です。

### CPU 10 ms / 実行（Workers 無料枠）

購読者ごとに本文を暗号化（ECDH + HKDF + AES-GCM）すると 50 人分で超える見込みのため、**ペイロードなし push** を送ります。表示内容は受信側の SW が `timetable-data` キャッシュから当日のダイヤを読んで組み立てます。VAPID の JWT 署名は push サービスのオリジンごとに 1 回で済み、使い回せます。

**iPhone のホーム画面 PWA でペイロードなし push が届くことは実機で確認済みです**（2026-08-16、Safari / APNs）。

### 送信の窓

送信判定は `[発車時刻 − リード分, 発車時刻)` の**窓**で行い、「ちょうど N 分前」の等号一致にはしていません。Cron は 1 分間隔ですが実行が遅れることがあり、等号一致だと遅延した回で取りこぼします。窓なら遅れても送れ、通知の文面は受信側が実時刻から組み立てるので「あと N 分」は正しいままです。二重送信は `reminders.sent_at` が防ぎます。

### Service Worker を `injectManifest` へ移行していない

`vite.config.ts` の `workbox.importScripts` で `public/push-sw.js` を生成 SW へ読み込ませています。既存のキャッシュ設定（`globIgnores` / NetworkFirst 3 秒 / `timetable-data` / OSM タイル）に一切触れずに push 対応を足すための構成です。詳細は [pwa-and-deployment.md](pwa-and-deployment.md) を参照してください。

## 送信しない条件

存在しない便を知らせないため、次の場合は送信しません（`server/src/schedule.ts` の `selectDue`）。

- 時刻表を取得できなかった日
- 運休日・特別ダイヤの日（`resolveDiagramType` の判定を `src/utils/diagramType.ts` でフロントと共有）
- 当日のダイヤに、指定された時刻の便が実在しない場合（ダイヤ差し替えで消えた便）
- 対象日が当日でないもの

## 秘密情報

| 値 | 置き場所 |
|---|---|
| `VAPID_PRIVATE_KEY` | Cloudflare のシークレット（`npx wrangler secret put`）と、ローカルの `server/.dev.vars`（`.gitignore` 済み） |
| `VAPID_PUBLIC_KEY` | 公開してよい値。`wrangler.toml` の `vars` に記載し、`/api/vapid-key` が配る |

**秘密鍵をリポジトリに入れてはいけません。** 鍵を作り直すと既存の購読はすべて無効になります（購読は公開鍵と紐づくため）。

## 運用手順

### 初期セットアップ

```powershell
Set-Location server
npm install
npm run keygen                      # 鍵を生成し .dev.vars へ保存（公開鍵だけ画面に出る）
npx wrangler login
npx wrangler d1 create campus-bus-navi
# 出力の database_id を wrangler.toml と server/wrangler.toml の両方へ記入
npx wrangler d1 execute campus-bus-navi --remote --file=src/schema.sql
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler deploy
```

Pages 側のバインディングはリポジトリ直下の `wrangler.toml` に書いてあるので、push すれば反映されます。ダッシュボードでの設定は不要です。

### 単体での送信確認

```powershell
Set-Location server
npm run send-test                   # 購読情報を貼り付けると 1 通だけ送る
```

購読情報はアプリの「表示・通知オプション」→ 通知 → 購読後に取得できます。

### 検証

```powershell
Set-Location server
npm run typecheck                   # Worker 用と Node 用の 2 構成
npm test                            # 送信判定・VAPID 署名・送信結果の分類
npx wrangler deploy --dry-run --outdir .wrangler/dry
```

## 監視

**無料枠を超えると該当する操作がエラーになるだけで、利用者からは「静かに壊れた」ように見えます。** しかも日次枠のリセットは UTC 00:00 = **JST 09:00** なので、夜に枯れると最終便の通知が最も要る時間帯を含めて翌朝まで復旧しません。

### 状態の確認

```powershell
curl.exe https://campus-bus-navi.pages.dev/api/status
```

```json
{
  "today": "2026-10-16",
  "devices": 42,
  "remindersToday": 57,
  "sentToday": 12,
  "pendingToday": 45,
  "staleReminders": 0,
  "warning": null
}
```

`staleReminders` が 0 より大きい場合、前日以前の指定が残っています。**日付が変わる分の掃除が動いていない＝ Cron が止まっている兆候**なので、まず Worker の稼働を確認してください。

### 実行ログ

```powershell
Set-Location server
npx wrangler tail
```

送信対象が 0 件でも、運休日・特別ダイヤ・取得失敗のときは理由をログに残します。通常ダイヤで送信対象がないだけの分は、ログを溢れさせないため出力しません。

### 無料枠の目安（Workers Free）

| 項目 | 無料枠 | 300 人規模での想定 |
|---|---|---|
| Workers リクエスト | 100,000 / 日 | Cron 1,440 + API 数百 |
| CPU 時間 | 10 ms / 実行 | ペイロードなし push なら数 ms |
| 外部サブリクエスト | 50 / 実行 | DO 分配で回避 |
| D1 行読み取り | 5,000,000 / 日 | 索引利用で数万 |
| D1 行書き込み | 100,000 / 日 | 1 日数十 |

数千人規模になったら Workers Paid（$5/月）を検討します。**無料プランは上限を超えても自動課金されません。**

## 未確認事項

- Android のメーカー独自の省電力（Xiaomi・Huawei・Oppo 等）による配送遅延・欠落。実機での確認が済んでいません
- 実運用規模での日次消費。現時点では見積もりであり、実測値ではありません
- 通常ダイヤの日での実地の通知到達。単体の送信確認（PC・iPhone）は済んでいますが、Cron 経由の一連の流れは未確認です（2026-08-16 時点）
