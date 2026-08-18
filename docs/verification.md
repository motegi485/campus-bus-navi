# 検証と確認範囲

## 基本原則

検証は、実行したコマンド・確認日・環境に基づいて記録します。コードだけで確認できないデプロイ状態、GitHub 設定、実機動作、外部 API の応答を、未確認のまま「合格」や「稼働中」とは書きません。

## フロントエンドの品質ゲート

```powershell
npm run validate:data
npx tsc --noEmit
npm run build
npm run preview
```

| 確認 | 何を保証するか | 注意 |
|---|---|---|
| `npm run validate:data` | 時刻表、カレンダー、お知らせの構造・参照・不変条件 | `_examples/` は対象外 |
| `npx tsc --noEmit` | TypeScript の型、未使用ローカル・引数など | 実行時挙動は保証しない |
| `npm run build` | データ検証、型検査、Vite 出力 | `dist/` を作る |
| `npm run preview` | 本番ビルドのローカル表示 | PWA のキャッシュは実ブラウザで確認する |

ルートにはテスト・lint の npm スクリプトがありません。UI や PWA の変更では、コマンド結果だけでなく該当する手動確認を追加します。

## データ変更時の確認

- `calendar_rules.json` の override が実在日か、参照先の時刻表が存在するか
- `id` とファイル名、2 路線、時刻の形式・順序、座標、`note` が正しいか
- `closed` / `special` 以外の `schedule` を空にしていないか
- `special` と `closed` の表示意図を取り違えていないか
- `news.json` の HTML が信頼できる内容か、ID と未読フラグが正しいか
- 対象日を開き、片方向だけ・日付跨ぎ・終バス後など影響する画面を確認したか

詳細な検証器の対象は [data-model-and-operations.md](data-model-and-operations.md) を参照してください。

## PWA / 配信変更時の確認

- 通常起動で時刻表 JSON がネットワーク優先で取得される
- 更新ボタン後、オフラインにして再起動しても最新取得分が使われる
- 通信不能時に前回取得済みデータへフォールバックする
- 新 Service Worker をコールドスタート時と利用中で適切に扱う
- `dist/` に `_headers`、`_redirects`、マニフェスト、静的データが存在する
- iPhone / iPad、Android、デスクトップで、必要な表示・地図・PWA 導入を確認する

Cloudflare Pages の実デプロイ、HTTP ヘッダー、キャッシュ、Analytics は本番環境で別途確認します。確認できていない場合は、文書・リリース判断で未検証と明記します。

### 取得時刻とデータ状態の確認

`preview` は SW が有効なので、次を実ブラウザで確認します。`npm run dev` は SW が無効なため確認になりません。

| 状態 | 再現方法 |
|---|---|
| `offline` | 一度読み込む → DevTools の Network を Offline → リロード |
| `fetch-failed` | DevTools で `/data/*.json` を Block request URL に登録 → 更新ボタン |
| `no-data` | Application → Clear storage の後、上記をブロックした状態で初回アクセス |
| `stale` / `refetching-stale` | `/data/timetables/*.json` をブロックした状態で端末の日付を翌日へ進める。翌日分の先読みが成功していると昇格するので `stale` にならない |
| `stale-data` | 一度読み込んでキャッシュを作る → `localStorage.campusBusNaviFetchedAt` を 24 時間以上前の値へ書き換えてリロード。または OS はオンラインのまま `/data/` の応答だけを 3 秒以上遅延させ、キャッシュへフォールバックさせる |

### アクセシビリティ

| 確認 | 方法 |
|---|---|
| キーボードのフォーカスが見える | マウスを使わず Tab だけで一巡し、すべての操作要素にリングが出るか。タップで開いたオーバーレイにリングが出ないことも合わせて確認する |
| オーバーレイの隔離 | 初回のホーム画面追加案内（`MobilePwaGuide`）を出した状態で Tab を回し、背面のヘッダー・本文へ抜けないか。Escape で閉じて、元の位置へフォーカスが戻るか |
| 色のコントラスト | DevTools の computed style で `--text-muted` / `--past-text` とダイヤ種別バッジを実測し、[design-decisions.md](design-decisions.md) の表と一致するか。ライト・ダークの両方 |
| 更新の読み上げ | NVDA / VoiceOver で更新ボタンを押し、開始・成功・失敗が読み上げられるか。新しい Service Worker の検知バナーも同様 |

### 通知（便の同定）

| 確認 | 方法 |
|---|---|
| 予約した便と通知が一致する | 実機で便を予約し、届いた通知の時刻・方向が予約と一致するか。**逆方向や別時刻が出たら不具合** |
| 同定できないときの挙動 | 予約が無い状態で `server/tools/send-test-push.ts` から 1 通送り、「まもなく発車です／アプリを開いて時刻表を確認してください」になるか |
| 通知オフで写しが消える | オフにしたあと DevTools の Application → IndexedDB で `campusBusNaviPush` が空になっているか |

### 週間ダイヤの確認

- 同じ日について、ホームの `DayBadge` と週一覧のラベルが完全に一致する
- Network タブで、同じ時刻表 ID の日が複数あってもリクエストは ID ごとに 1 回だけ
- 週間ダイヤを連打で開閉しても、古い応答が後から表示されない
- `timetable_closed` の日に時刻が出ず「運行なし」、`timetable_special` の日に時刻が出ず大学ホームページへの誘導が出る
- `/data/timetables/` の 1 ファイルだけを Block request URL に登録し、その日だけ「取得できません」になり、他の日のダイヤで代用されない
- 当日を開いたときだけ過去便が灰色になり、他の日は全便が同じ濃さ
- ホームの帯は「すべて見る」チップ以外を押しても遷移しない
- 日付跨ぎで当日分が未取得（`stale`）の間、ホームの帯が表示されない
- `bp-active`（PC・横向き）で帯が左カラム末尾に入り、地図の高さ追従が崩れていない

取得時刻の根拠が `Date` レスポンスヘッダのままかは、コンソールで次を実行して確認できます。キャッシュに残る古いエントリが、取得当時の `Date` を保っていれば正常です。

```js
const c = await caches.open('timetable-data')
for (const req of await c.keys()) {
  const res = await c.match(req)
  console.log(new URL(req.url).pathname, res.headers.get('date'))
}
```

2026-08-15 に `npm run preview` と Chrome で確認した時点では、`Date` ヘッダが付き、SW キャッシュ経由でも取得当時の値が保持されていました。Cloudflare Pages 本番での同確認は未実施です。

## Bot の品質ゲート

```powershell
Set-Location bot
npm ci
npx vitest run
npx tsc --noEmit
$env:DRY_RUN = "1"
$env:SKIP_OCR = "1"
npx tsx src/index.ts
```

Bot は `DRY_RUN` と `SKIP_OCR` を付けた安全な確認から始めます。ローカル実行は commit も push もしません。

**Bot のテストは実ネットワークへ出てはいけません。** 大学サイトへ無断でアクセスしないこと自体が Bot の要件です。同一 URL の再検証を扱うテスト（`bot/test/detectChanges.test.ts`）は `fetch` をスタブし、`bot/test/plan.test.ts` の state には `checked_at` を入れて再検証が走らないようにしてあります。`detectChanges` を呼ぶテストを足すときは、どちらかの手当てを必ず行ってください。

ワークフローが適用前に通す検証器と同じものを、リポジトリ直下でも実行できます。

```powershell
Set-Location ..
node scripts/validate-data.mjs
```

OCR、実ファイル書込、GitHub Actions での自動適用とメール送信を伴う確認は、必要な権限・鍵がそろった人間管理下で段階的に実施します。

**2026-08-16 に PR 承認フローを廃止し、取得から `main` への反映までを自動化しました。** 誤りを公開前に止める人間ゲートは無くなり、確認は事後の通知メールに移っています。この設計判断と残存リスクは `BACKEND_REQUIREMENTS.md` の §1.1 と §15-1 を正とします。

次の状態はコードだけでは保証できません。

- GitHub Actions が有効か
- `GEMINI_API_KEY` が Secrets に登録されているか
- メール用の `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_TO` が登録されているか
- Workflow permissions が `main` への push を許可しているか
- 実 API の現時点の応答、利用枠、画像品質
- 本番での自動コミット、メール到達（迷惑メール判定を含む）、Pages 反映

**自動適用とメール通知は GitHub 上で 1 度も実行していません。** 未検証の受け入れ基準は AC-4（変更が無い日に何も起きない）、AC-7（イベントのライフサイクル）、AC-8（通知）です。

Bot の受け入れ基準と人間が行う確認は `BACKEND_REQUIREMENTS.md` と `HANDOFF.md` を正とします。

## 通知（Web Push）の品質ゲート

配信基盤はフロントエンド・Bot と依存を分離しています。設計の背景は [backend-push.md](backend-push.md) を参照してください。

```powershell
Set-Location server
npm run typecheck
npm test
npx wrangler deploy --dry-run --outdir .wrangler/dry
```

| 確認 | 何を保証するか | 注意 |
|---|---|---|
| `npm run typecheck` | Worker（Cloudflare の型）と tools・test（Node の型）の両方 | 両ランタイムで動く共通モジュールは両方で検査される |
| `npm test` | 送信の窓、当日限りの判定、運休日・特別ダイヤの除外、JWT の署名形式、endpoint の許可リスト、`push-sw.js` の便の同定、送信結果の分類（失効・絞り込み・**署名の拒否**・鍵の設定不備） | Cloudflare ランタイムには依存しない |
| `npx wrangler deploy --dry-run` | バンドルとバインディング定義が成立するか | 実際のデプロイ状態は保証しない |

`server/test/pushSw.test.ts` は `public/push-sw.js` をテキストで読んで評価します。ルートにテストランナーが無いため、通知まわりのテストをここへ寄せています。`public/push-sw.js` の内部関数名（`selectReservations` / `buildNotifications`）を変えるとこのテストが落ちます。

SQL 側の絞り込み（送信の窓 `notify_at <= now AND now < notify_at + lead_minutes × 60000` と `ORDER BY notify_at`）は vitest では検証できません。`server/test/schedule.test.ts` は「SQL と同じ式を書いた補助関数と `selectDue` が、窓の下端・上端・窓を過ぎた時刻のすべてで一致すること」までを固定し、実際のクエリ計画と行数は `wrangler d1 execute --local` で別途確認します。**SQL 側を変えたら、この補助関数（`matchesSql`）も必ず直してください。**

`wrangler` のコマンドは必ず `server/` で実行します。リポジトリ直下の `wrangler.toml` は Pages の設定なので、直下で `wrangler deploy` を実行してはいけません。

コードだけでは確認できないものは次のとおりです。実施日と方法を伴わない限り「確認済み」とは書きません。

- 実機での通知到達（iPhone ホーム画面 PWA / Android / PC）
- Cron の稼働と D1 の内容（`npx wrangler tail`、`/api/status`）
- Cloudflare 側の設定（D1 の作成、バインディング、シークレット、デプロイ）
- 無料枠の実消費

### 現時点の確認状況（2026-08-18 更新）

| 項目 | 状況 |
|---|---|
| VAPID 署名と単体送信（PC / Chrome / FCM） | 実機で確認済み（2026-08-16） |
| ペイロードなし push の受信（iPhone ホーム画面 PWA / Safari / APNs） | 実機で確認済み（2026-08-16） |
| `/api/*` が `_redirects` の SPA フォールバックに飲み込まれないこと | `/api/vapid-key` の応答で確認済み（2026-08-16） |
| 購読 API と D1 の往復（登録・保存・削除） | 確認済み（2026-08-16）。2026-08-18 に `/api/status` が `devices: 1` / `remindersToday: 3` を返すことで再確認 |
| **Cron 経由での実地の通知到達** | **未達。原因は特定済み・対処は未実施。** 下記参照 |
| Android のメーカー独自省電力下での配送 | 未確認 |
| 実運用規模での無料枠消費 | 未確認（見積もりのみ） |

#### Cron 経由の通知が届かない（2026-08-18 調査。原因特定済み、対処は未実施）

2026-08-18（`timetable_vacation_summer_weekday`。運休日でも特別ダイヤでもない日）に iPhone のホーム画面 PWA から 3 便へ通知を設定したところ、**1 通も届きませんでした。** 同日 16:46 JST の `/api/status` は次を返しています。

```json
{ "devices": 1, "remindersToday": 3, "sentToday": 0, "pendingToday": 3,
  "staleReminders": 0, "overdueReminders": 3 }
```

**原因: 配信 Worker がデプロイされたまま更新されておらず、現在の D1 スキーマと噛み合っていません。**

`npx wrangler deployments list` で確認した最後のデプロイは 2026-08-15T18:51:05Z（= 2026-08-16 03:51 JST）で、これは `server/src` の変更履歴では commit `5867b85` の時点です。その約 1 時間後の `8b90b41` / `e7888d5`（2026-08-16 04:56）で、リマインドは「端末ごとに 1 件の常設予約」から「当日の便ごとの `reminders` 行」へ作り直されています。デプロイ済みの Worker が毎分実行しているのは変更前のクエリです。

```sql
SELECT * FROM subscriptions WHERE last_sent_on IS NULL OR last_sent_on != ? LIMIT ?
```

現在の `subscriptions` に `last_sent_on` 列は無いため、D1 が `no such column` を返し、`run()` が throw、`scheduled` が再 throw します。**2026-08-16 04:56 以降、Cron は毎分失敗し続けています。**（`VAPID_PRIVATE_KEY` は `npx wrangler secret list` で登録済みを確認。鍵は原因ではありません。）

対処は Worker の再デプロイです。**人間が実行します。**

```powershell
Set-Location server
npx wrangler deploy
```

デプロイ後の確認:

1. `npx wrangler tail` を出したまま 10 分程度先の便へ通知を設定し、`送信対象 N 件 / M バッチ` のログと実機の受信を確認する
2. `/api/status` の `sentToday` が増えることを確認する
3. 翌日、`staleReminders` が 0 のままであることを確認する（毎時 00 分の掃除が動いている証拠）

なお、発車時刻を過ぎた `overdueReminders` は `selectDue` の窓（`[発車 − リード分, 発車)`）を外れているため、デプロイしても遡って送信されることはありません。

#### この乖離が起きる構造

**Pages は `git push` で自動反映されますが、配信 Worker は `npx wrangler deploy` を人間が実行するまで古いままです。** `server/src/schedule.ts` は `src/utils/diagramType.ts` と `src/types/timetable.d.ts` を直接 import しているため、フロントエンド側の変更でも Worker の再デプロイが要る場合があります。D1 のスキーマを変えたときは、**migration の適用と Worker のデプロイを必ず同じ作業でまとめてください。**

## 依存関係の既知脆弱性

`npm audit` は 3 つのパッケージ（ルート / `bot` / `server`）で個別に実行します。

```powershell
npm audit                # 全依存
npm audit --omit=dev     # 本番依存だけ
```

### 2026-08-18 時点の測定

| 対象 | 全依存 | 本番依存（`--omit=dev`） |
|---|---|---|
| ルート | low 1 / moderate 4 / high 8 / critical 0 | **0** |
| `bot` | high 1 / critical 0 | **0** |
| `server` | moderate 2 / high 4 / critical 0 | **0** |

**high はすべて開発・ビルド・デプロイ用のツールチェーン側です。** ブラウザへ配信されるコードの依存には既知の advisory がありません（3 領域とも `--omit=dev` が 0）。

| 到達経路 | 該当 | 誰が処理する入力か |
|---|---|---|
| ルートのビルド（`vite` / `postcss` / `@babel/*` / `nanoid` / `brace-expansion` / `lodash` / `serialize-javascript`） | high 8 | 自分のソースと `public/` の内容 |
| `bot` の実行（`nanoid`） | high 1 | 大学サイトの HTML・画像（境界は `bot/src/url.ts` と `fetchPage.ts`） |
| `server` のデプロイ（`wrangler` → `esbuild` / `miniflare` / `sharp` / `undici` / `ws`） | high 4 | 自分のソースと Cloudflare API |

いずれも「攻撃者が任意の入力を送り込める公開経路」ではありませんが、CI で外部由来のデータ（大学サイトの HTML・画像）を処理するのは `bot` なので、そこが最も注意すべき経路です。

**依存の更新は行っていません。** major 更新を伴うものが含まれ、ビルド・デプロイの回帰確認とセットでないと判断できないためです。更新するときは、advisory ごとに上表の到達経路を確かめ、実施日とバージョンをここへ記録してください。

## 文書変更時の確認

- リンク先のパス・見出し・コマンドが存在するか
- 実装の説明は、対象のコード・設定・データを読み直しているか
- 「現在」「完了」「稼働中」といった表現に確認日と根拠があるか
- 仕様の正本を複製して矛盾させていないか
- README が利用者向けの説明に留まり、実装詳細は `docs/` を指しているか
- AGENTS.md と CLAUDE.md が新しい文書への導線を持つか

Markdown 専用の自動リンク検査は現在導入していません。文書を追加・移動したら、相対リンクを目視確認し、必要に応じてリポジトリ内検索で旧パスが残っていないか確認してください。

