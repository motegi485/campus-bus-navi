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
| 送信先の検査 | `server/src/pushProviders.ts` | 受け入れる push サービスのホスト許可リスト |
| 予約の写し | `src/utils/pushMirror.ts` | 端末の IndexedDB へ「当日の予約一覧」を写す |
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
- `reminders.date_key` により**当日限り**が構造で担保されます。Cron は当日ぶんしか引かず、毎時 00 分の実行で前日以前を削除します
- `reminders.notify_at` は「送信を始めてよい瞬間」（= 発車時刻 − `lead_minutes`）の epoch ミリ秒。登録時に計算して持ちます

**アカウントもユーザー識別子も持ちません。** 学内配布物の「登録不要」というコピーと衝突しません。

### 保持する項目と期間

| 項目 | 何のために | いつ消えるか |
|---|---|---|
| `subscriptions.endpoint` | 送信先 | 通知をオフにしたとき / push サービスが 404・410 を返したとき |
| `subscriptions.p256dh` / `auth` | **現在の送信では使いません**（ペイロードなし push のため）。将来ペイロード送信へ移す際に、全端末へ再購読を強いないために保持します | 同上 |
| `subscriptions.created_at` | 運用時の目安 | 同上 |
| `reminders.*` | 当日の便ごとの通知 | 日付が変わったあとの毎時 00 分の実行 / 通知オフ |

自動的な有効期限（TTL）は持ちません。**利用者が明示的にオフにするまで保持します。** README の「購読情報と便の予約をサーバーから削除します」がその契約です。TTL を入れるかどうかは、休眠端末の実数を本番で測ってから判断します（現時点では未計測）。API の IP 制限カウンターは購読・予約とは別に Cloudflare が管理し、アプリの D1 には保存しません。

### スキーマ変更

`server/src/schema.sql` は**新規作成時の正**です。既にデータベースがある場合の差分は `server/migrations/` に置きます。

```powershell
Set-Location server
npx wrangler d1 execute campus-bus-navi --remote --file=migrations/0001_add_notify_at.sql
```

| ファイル | 内容 |
|---|---|
| `0001_add_notify_at.sql` | `reminders.notify_at` の追加と索引の張り直し（2026-08-18） |

## 設計上の制約と、その帰結

### 外部サブリクエスト 50 件 / 実行（Workers 無料枠）

push 送信 1 件が外部 fetch 1 件なので、**1 実行で送れるのは最大 50 通**です。これを超える分は Durable Object へ分配します。DO の実行は独立した実行なので各自 50 件の枠を持ち、Cron から DO への呼び出しは Cloudflare サービス向けの枠（1,000 件）を使うため上限に当たりません。

`server/src/schedule.ts` の `BATCH_SIZE` を 40 にしているのは、ダイヤ取得の fetch も同じ枠を消費するための余裕です。

### CPU 10 ms / 実行（Workers 無料枠）

購読者ごとに本文を暗号化（ECDH + HKDF + AES-GCM）すると 50 人分で超える見込みのため、**ペイロードなし push** を送ります。表示内容は受信側の SW が `timetable-data` キャッシュから当日のダイヤを読んで組み立てます。VAPID の JWT 署名は push サービスのオリジンごとに 1 回で済み、使い回せます。

**iPhone のホーム画面 PWA でペイロードなし push が届くことは実機で確認済みです**（2026-08-16、Safari / APNs）。

### ペイロードが無くても「どの便か」を間違えない

ペイロードなし push には**予約の同定情報が載りません**。受信時刻から次の便を推測すると、予約した便より前の便や逆方向の便を断定してしまいます（例: 松永発 08:10 を 10 分前で予約すると、08:00 の push で既定ルートの大学発 08:20 を出す）。

そこで、サーバ（D1）が正である予約内容を端末の IndexedDB へ写します。

- `src/utils/pushMirror.ts` … `campusBusNaviPush` / store `settings` / key `current` に `{ dateKey, updatedAt, reminders[] }` を書く
- `src/hooks/useDepartureReminders.ts` … GET と保存のたびに**全ルートぶん**を写す
- `src/hooks/usePushSubscription.ts` … 通知をオフにしたら写しも消す
- `public/push-sw.js` … 写しを読み、受信時刻が `[発車 − リード分 − 1分, 発車 + 3分]` に入る予約だけを名指しする

**同定できないときは便を断定しません。** 写しが無い・当日でない・当日のダイヤにその便が実在しない・運休日や特別ダイヤ、のいずれでも「まもなく発車です／アプリを開いて時刻表を確認してください」に落とします。時刻表側の「推測するより表示しない」を通知へ適用したものです。

通知のタグは `departure-reminder-<route>-<HH:mm>` で便ごとに分けます。予約窓が重なると、別便の push でも前の便が候補になります。SW は同じ IndexedDB store の別キー `displayed-reminders` に `{ dateKey, tags[] }` を記録し、表示済み便は `renotify: false` / `silent: true` で更新します。同時 push は直列化し、1 回最大 4 件の上限では未表示便を先に選びます（2026-10-15）。

`userVisibleOnly` の約束を守るため、重複 push も単に捨てず通知を静かに更新します。利用者が閉じた通知は再表示される可能性があり、厳密な「一度だけ表示」を保証するものではありません。台帳は予約ミラーの保存・削除や同日の再購読では消さず、別日の表示で置換します。IndexedDB へ保存できない場合は同じ SW のメモリでのみ重複を抑止するため、SW 再起動後の抑止は保証できません。

受信側の日本時間は UTC に 9 時間を加えて UTC getter で読みます。端末が夏時間を使う地域にあっても、夏時間切替前後のオフセットに影響されません。

⚠️ IndexedDB の名前・キー・データの形は `src/utils/pushMirror.ts` と `public/push-sw.js` で結合しています。`push-sw.js` はビルドを通らない素の JS として配信されるため import できません。片方だけ変えてはいけません。

### 送信の窓

送信判定は `[発車時刻 − リード分, 発車時刻)` の**窓**で行い、「ちょうど N 分前」の等号一致にはしていません。Cron は 1 分間隔ですが実行が遅れることがあり、等号一致だと遅延した回で取りこぼします。窓なら遅れても送れ、通知の文面は受信側が実時刻から組み立てるので「あと N 分」は正しいままです。二重送信は `reminders.sent_at` が防ぎます。

`sent_at` が番人として成り立つよう、`POST /api/reminders`（`functions/api/reminders.ts`）は**選択から外れた便の行だけを消し、選択に残る便の行は UPSERT で保ちます**（`lead_minutes` / `notify_at` だけ更新し、`sent_at` は触りません）。2026-09-12 までは DELETE → INSERT で全行を作り直していたため、送信窓の中で再保存すると送信済みの便が `sent_at = NULL` に戻り、次の分の Cron が同じ便へもう一度送っていました（通知を受け取ってから別の便を足す、という典型的な操作で起きます。`push-sw.js` は同じタグでも `renotify: true` で再通知します）。契約として、**送信済みの便はリード時間を変えても同じ日には再送しません**（1 便 1 通）。

**同じ窓を SQL 側でも掛けます**（`notify_at <= now AND now < notify_at + lead_minutes × 60000`）。下限だけだと、窓を過ぎても未送信のまま残った行（運休・ダイヤ差し替え・配信停止で生じる）が**その日の残り時間ずっと引かれ続け**、件数が 0 にならないので毎分ダイヤを取りに行くことになります。「対象 0 件ならダイヤの取得すらしない」という判断が効かなくなり、`LIMIT` の枠も過去の行に食われます。最終的な判断は `selectDue` が持ち、SQL 側は引く行を減らすためのものです。⚠️ 両者の窓は対なので、片方だけ変えてはいけません（境界の一致は `server/test/schedule.test.ts` が固定しています）。

窓を過ぎた行は送信対象から外れるだけで、**削除はされません**。`/api/status` の `overdueReminders` がそれを数えて配信停止の兆候として見せ、行そのものは翌日の毎時 00 分の掃除で消えます。

### Service Worker を `injectManifest` へ移行していない

`vite.config.ts` の `workbox.importScripts` で `public/push-sw.js` を生成 SW へ読み込ませています。既存のキャッシュ設定（`globIgnores` / NetworkFirst 3 秒 / `timetable-data`。導入当時は OSM タイルのキャッシュも含んでいたが、地図の Google 埋め込み化で 2026-09 に無くなった）に一切触れずに push 対応を足すための構成です。詳細は [pwa-and-deployment.md](pwa-and-deployment.md) を参照してください。

## 送信しない条件

存在しない便を知らせないため、次の場合は送信しません（`server/src/schedule.ts` の `selectDue`）。

- 時刻表を取得できなかった日
- 運休日・特別ダイヤの日（`resolveDiagramType` の判定を `src/utils/diagramType.ts` でフロントと共有）
- 当日のダイヤに、指定された時刻の便が実在しない場合（ダイヤ差し替えで消えた便）
- 対象日が当日でないもの

## 受け入れる入力の境界

無認証の公開 API なので、受け取った値をそのまま信じません。

### 送信先（endpoint）

`server/src/pushProviders.ts` の許可リストに載ったホストだけを受け入れます（FCM / Mozilla / Apple / WNS）。加えて、`https`、2,048 文字以内、標準ポート、ブラウザの URL シリアライズと一致する正規表記であることを検査します。資格情報、空の `#` を含むフラグメント、IP リテラルを拒否します。前後空白・大文字ホスト・明示的な `:443` など、同じ URL に正規化される別表記を別購読として保存させません。

- **ホスト許可リストが要る理由**: 保存した endpoint へは配信 Worker が VAPID 署名付きの POST を送ります。scheme だけの検査では、任意の第三者サーバを送信先に指定して、公開 API から外向き通信を反復させられます。
- **フラグメントを拒む理由**: HTTP 送信時にフラグメントは落ちるため、`#a` と `#b` で「別 ID・同一宛先」の行をいくらでも作れます（同じ宛先への送信の増幅）。
- **対応ブラウザを増やすときは、実機で得た endpoint のホストを許可リストへ追加してください。** 忘れると購読が 400 で拒否され、利用者には「通知をオンにできない」形で現れます（黙って第三者へ送るより安全側）。

送信時も `redirect: 'manual'` とし、許可した push サービスから別 URL への転送を追従しません。これはリダイレクト先へ VAPID の Authorization を転送しないための防御です。

### HTTP リクエストと応答

変更系 API は `server/src/apiRequest.ts` を共用します。`Origin` がある場合は要求 URL と同一オリジンに限定し、`null` Origin も拒否します。直接の API 呼出しとの互換性のため、Origin が無い要求は許容します。`Content-Type: application/json` のみ受理し、本文は実際に読みながら **8 KiB** で打ち切ります。宣言された Content-Length だけには依存しません。不正 UTF-8、不正 JSON、`null`、配列など object 以外を 400 にします。

拒否は D1 アクセス前に行い、別 Origin は 403、過大本文は 413、JSON 以外の媒体型は 415 を返します。購読・予約・状態とエラーの応答は `Cache-Control: no-store` / `X-Content-Type-Options: nosniff` を API 自身が付けます。公開鍵の正常応答だけは既存の公開キャッシュを維持します。Pages の `_headers` は Functions の応答には適用されません。

これはブラウザを経由した別サイトからの書込みを防ぐ境界です。Origin を偽装・省略した直接 HTTP の大量要求を防ぐ認証やレート制限の代わりにはなりません。

### 対象日（dateKey）

`POST /api/reminders` は**サーバの時計で判定した JST の当日ぶんだけ**を受け付けます。実在しない日付（`2026-02-30` など）も拒否します。

当日に閉じることで、1 購読が持てる行数が「2 ルート × 12 便」で構造的に頭打ちになります。これが無いと、未来日をいくらでも登録して D1 の日次書き込み枠（無料枠 100,000 行/日）を枯渇させられます。

日付が変わった直後に古い `dateKey` で届いた保存は 400 になります。応答に `today` を含めるので、クライアントは日付跨ぎだと判別できます。アプリ側は `useJSTClock` の毎分更新と `useTimetable` の日付跨ぎ再取得で 1 分以内に自己回復します。

### API の連打対策（2026-10-15）

`functions/api/_middleware.ts` は `/api/*` の全メソッドを D1 の手前で検査します。Pages は native Rate Limiting binding に対応しないため、Pages の `API_RATE_LIMITER` Service binding から、既存の配信 Worker の名前付き `ApiRateLimiter` entrypoint を内部呼出しします。公開 HTTP の入口は追加せず、既存の Cron / 送信 DO を維持します。[Pages と Workers の対応表](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)、[Pages の Service bindings](https://developers.cloudflare.com/pages/functions/bindings/)、[名前付き RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)。

| 制限 | binding | 暫定値 |
|---|---|---|
| 同じ IP の全 API 要求 | `API_RATE_LIMIT` | 600 件 / 60 秒 |
| 同じ IP の変更系要求 | `API_MUTATION_RATE_LIMIT` | 300 件 / 60 秒 |

変更系は GET / HEAD / OPTIONS 以外です。Cloudflare の `CF-Connecting-IP` だけを使い、任意の転送ヘッダーへ代用しません。IPv6 の表記違いは正規化します。IP をログや D1 へ保存しません。

超過は 429、IP / binding の欠落・不正応答・内部サービス障害は 503 を返し、`next()` を呼びません。どちらも `no-store` と `Retry-After: 60` を付けます。**保護サービスが使えないと通知 API も利用できなくなります。** 静的な時刻表はこの middleware の対象外です。

学内 Wi-Fi や携帯回線は多数の利用者が IP を共有するため、閾値は正規利用の 429 件数を観測して調整します。native カウンターは拠点ごと・結果整合であり、厳密な世界共通上限ではありません。分散 IP や持続的な攻撃による D1 日次枠の枯渇は保証できず、拒否要求も Pages Function を起動するので Workers の日次要求枠の消費は止められません。[Rate Limiting の特性とキー選択](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

設定は両 `wrangler.toml` にあります。namespace ID は `2659274278` / `1076940132`。本番前にアカウント内の別用途と衝突しないことを確認します。**Worker を先に反映してから Pages を反映**し、実際の公開ホストで正常・429・503 を確認します。独自ドメイン用 WAF が `pages.dev` にも効くという前提は置きません。2026-10-15 のローカル実装・実ランタイム検証は完了しましたが、本番の binding 接続・レート制限は未確認です。

## 秘密情報

| 値 | 置き場所 |
|---|---|
| `VAPID_PRIVATE_KEY` | Cloudflare のシークレット（`npx wrangler secret put`）と、ローカルの `server/.dev.vars`（`.gitignore` 済み） |
| `VAPID_PUBLIC_KEY` | 公開してよい値。`wrangler.toml` の `vars` に記載し、`/api/vapid-key` が配る |

**秘密鍵をリポジトリに入れてはいけません。** 鍵を作り直すと既存の購読はすべて無効になります（購読は公開鍵と紐づくため）。

### 鍵の入れ替え・不一致からの復旧

購読はブラウザが `applicationServerKey`（VAPID 公開鍵）と結び付けて作るため、**鍵を替えると既存の購読はすべて無効になります**。`/api/vapid-key` が返す公開鍵と Worker の秘密鍵がずれると、送信は失敗し続けます。利用者からは「静かに届かない」だけに見えますが、**運用側からは Cron の実行失敗として見えます**（push サービスの 401 / 403 を障害として扱うため。上の「Cron の失敗として扱うもの」を参照）。

漏えい・不一致が疑われるときの順序:

1. 影響を止める。Worker の Cron を止める（`server/wrangler.toml` の `[triggers]` を外して deploy、または Cloudflare のダッシュボードで無効化）。止めないと、無効な鍵で送信を続けて枠を消費します。
2. 新しい鍵を作る（`server/` で `npm run keygen`）。**秘密鍵は画面に出しません。**
3. 秘密鍵を Worker のシークレットへ入れる（`npx wrangler secret put VAPID_PRIVATE_KEY`）。
4. 公開鍵を `wrangler.toml`（Pages）と `server/wrangler.toml`（Worker）の**両方**へ書き、両方を deploy する。片方だけだと `/api/vapid-key` と署名鍵がずれます。
5. D1 の `subscriptions` を空にする（旧鍵に紐づく行は二度と届かないため、残すと毎分無駄なサブリクエストを使う）。`reminders` も一緒に消えます。
6. 利用者に再購読してもらう。アプリ側の導線は設定画面のトグルをオフ→オンにするだけです。

`/api/vapid-key` の応答と `server/wrangler.toml` の `VAPID_PUBLIC_KEY` が一致しているかは、公開前と鍵の入れ替え後に必ず突き合わせてください（値そのものは公開してよい値です）。

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

### 更新時（⚠️ Worker は自動では反映されません）

**Pages は `git push` で自動反映されますが、配信 Worker は `npx wrangler deploy` を実行するまで古いままです。** 両者は別々のデプロイなので、片方だけが新しい状態を作れてしまいます。

```powershell
Set-Location server
npx wrangler deploy
```

デプロイし直す必要があるのは次の場合です。

- `server/` 配下を変更したとき
- `src/utils/diagramType.ts` や `src/types/timetable.d.ts` を変更したとき（`server/src/schedule.ts` が直接 import しているため）
- **D1 のスキーマを変更したとき。migration の適用と Worker のデプロイは必ず同じ作業でまとめること**

**2026-09-12 に運用者が `npx wrangler deploy` を実行し、Worker は当日の `server/src`（`vapid.ts` の JWT 署名合流を含む）と同じ版になりました**（当時の wrangler 3.114.17、Version ID `daec2b2b-7f16-408c-a0e0-bd85932ab43b`。バインディングは DO `SENDER`・D1 `campus-bus-navi`・vars 3 件）。デプロイ後の Cron の成否と実端末への到達は未確認で、[verification.md](verification.md) の「Cron 経由の通知が届かない」の確認手順（`wrangler tail`・`/api/status` の `sentToday`・翌日の `staleReminders`）がそのまま残っています。`functions/api/reminders.ts`（再保存で送信済みの記録を保つ）は Pages 側なので `git push` で反映されます。スキーマ変更はありません。2026-10-15 の公開前監査で開発用依存を Wrangler 4.151.0 と対応する型定義 5.20261015.1 へ更新し、ローカルのテスト・型検査・依存監査を通しました。この更新による本番デプロイは行っていません。

最後の項目を分けると、Worker だけが古いスキーマを前提にしたクエリを毎分投げ続け、Cron が失敗し続けます。利用者からは「通知が来ない」だけに見えます（実例は [verification.md](verification.md) の「Cron 経由の通知が届かない」）。現在デプロイされている版は次で確認できます。

```powershell
Set-Location server
npx wrangler deployments list
```

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
  "overdueReminders": 0,
  "warning": null
}
```

| 値 | 意味 | 0 より大きいとき |
|---|---|---|
| `staleReminders` | 前日以前の指定が残っている件数 | 日付が変わる分の掃除が動いていない＝ Cron が止まっている兆候。まず Worker の稼働を確認する |
| `overdueReminders` | 発車時刻を過ぎたのに未送信で残っている当日の件数 | 配信が止まった兆候。ただし**運休日・特別ダイヤ・ダイヤ差し替えで消えた便では正常に増える**（送らないのが正しい状態） |

集計は 1 文にまとめてあります（無認証の公開エンドポイントなので、1 リクエストで発生する D1 の読み取りを増やさない）。例外の内容は応答へ返さず、サーバのログにだけ残します。

### Cron の失敗として扱うもの

「送らないのが正しい状態」と「送れない障害」を区別します。後者は `scheduled` から throw して Cron の実行を失敗させます。ログへ畳むと、通知が止まっていることに誰も気づけません。

| 事象 | 扱い |
|---|---|
| 対象 0 件 / 運休日 / 特別ダイヤ / 便が実在しない | 正常。ログだけ |
| `calendar_rules.json`・時刻表 JSON を取得できない | **失敗**（throw） |
| Durable Object への分配が失敗した | **失敗**（送りきったうえで throw） |
| DO が送信結果を D1 へ記録できなかった | **失敗**（DO が 500 を返し、Worker が throw）。記録できないと次の分で再送し、重複通知になる |
| VAPID の設定が誤っている（秘密鍵が未登録・形式違い、`VAPID_SUBJECT` が不正） | **失敗**（DO が 500 を返し、Worker が throw） |
| push サービスが署名を拒否した（401 / 403） | **失敗**（送れた分を記録したうえで DO が 500 を返す） |
| 個々の push がそれ以外の 4xx / 5xx・ネットワーク層の失敗 | ログと警告のみ（購読は残す）。410 / 404 は失効として購読ごと削除、429 は次の分に任せる |

設定の誤り（鍵）を「個々の送信失敗」と分けているのは、**待っても直らないから**です。鍵が対になっていない限り毎分同じ失敗を繰り返し、ログへ畳むと利用者からは「静かに届かない」だけに見えます。同じ理由で、署名の生成そのものは `server/src/send.ts` の `try` の**外**で行います（中に入れると鍵の不備が `code: 0` の送信失敗に化け、Cron の実行結果は成功のままになります）。

送れた分の `sent_at` は 500 を返す前に記録します。記録せずに実行を失敗させると、次の分で同じ便へもう一度送ってしまいます。

### 実行ログ

```powershell
Set-Location server
npx wrangler tail
```

送信対象が 0 件でも、運休日・特別ダイヤのときは理由をログに残します。通常ダイヤで送信対象がないだけの分は、ログを溢れさせないため出力しません。取得失敗は throw するので Cron の失敗として現れます。

### 無料枠の目安（Workers Free）

| 項目 | 無料枠 | 300 人規模での想定 |
|---|---|---|
| Workers リクエスト | 100,000 / 日 | Cron 1,440 + API 呼出し・DO 配信（実測は未確認） |
| CPU 時間 | 10 ms / 実行 | ペイロードなし push で削減する設計。実測は未確認 |
| 外部サブリクエスト | 50 / 実行 | DO 分配で回避 |
| D1 行読み取り | 5,000,000 / 日 | 索引利用で数万 |
| D1 行書き込み | 100,000 / 日 | 300 人が各 2 便なら 600 予約。再保存・送信記録・削除・索引更新が別途加算 |

数千人規模になったら Workers Paid（$5/月）を検討します。**無料プランは上限を超えても自動課金されません。**

2026-10-15 に [Workers の制限](https://developers.cloudflare.com/workers/platform/limits/) と [D1 の料金・計数方法](https://developers.cloudflare.com/d1/platform/pricing/) を再確認しました。人数だけで無料枠内を保証せず、特に D1 の書込みは索引更新も数えるため、公開後に `rows_read` / `rows_written` と CPU の実測を確認します。

この見積もりは正規利用の仮定です。API の直接要求も入力境界（当日限定・1 購読 24 行）と上記のレート制限を通りますが、これらから日次の消費上限を保証することはできません。実測と監視が必要です。

## 公開前チェックリスト

コードだけでは満たせない項目です。**実施日と方法を記録してください。**

- [ ] D1 に `server/src/schema.sql`（新規）または `server/migrations/`（既存）を適用した
- [ ] **その D1 スキーマを前提とする版の配信 Worker をデプロイした**（`npx wrangler deployments list` の最終デプロイ時刻と、`server/` の最終変更を突き合わせる）
- [ ] `/api/vapid-key` の公開鍵と `server/wrangler.toml` の `VAPID_PUBLIC_KEY` が一致している
- [ ] Worker→Pages の順で反映し、`API_RATE_LIMITER` 接続・namespace ID 非衝突・正常利用と超過時の429・障害時の503を実際の公開ホストで確認した
- [ ] `/api/status` が期待どおりの件数を返し、`staleReminders` と `overdueReminders` が 0 である
- [ ] 実機（iPhone ホーム画面 PWA / Android / PC）で、**予約した便と通知に出る便が一致する**ことを確認した
- [ ] 通知をオフにしたあと、D1 から購読とリマインドが消えていることを確認した

## 未確認事項

- Android のメーカー独自の省電力（Xiaomi・Huawei・Oppo 等）による配送遅延・欠落。実機での確認が済んでいません
- 実運用規模での日次消費。現時点では見積もりであり、実測値ではありません
- 通常ダイヤの日での実地の通知到達。単体の送信確認（PC・iPhone）は済んでいますが、**Cron 経由の一連の流れは 2026-08-18 に試して届きませんでした**（`/api/status` は予約 3 件・送信 0 件・overdue 3 件）。切り分けの手順は [verification.md](verification.md) の「Cron 経由の通知が届かない」を参照してください
- 予約の写しを使った便の同定は、単体テスト（`server/test/pushSw.test.ts`）でのみ確認しています。実機での push 受信を通した確認は未実施です（2026-08-18 時点）
- 休眠端末の実数。保持期間（TTL）を入れるかどうかの判断材料が揃っていません
