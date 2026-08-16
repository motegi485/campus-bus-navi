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
| `npm test` | 送信の窓、当日限りの判定、運休日・特別ダイヤの除外、JWT の署名形式 | Cloudflare ランタイムには依存しない |
| `npx wrangler deploy --dry-run` | バンドルとバインディング定義が成立するか | 実際のデプロイ状態は保証しない |

`wrangler` のコマンドは必ず `server/` で実行します。リポジトリ直下の `wrangler.toml` は Pages の設定なので、直下で `wrangler deploy` を実行してはいけません。

コードだけでは確認できないものは次のとおりです。実施日と方法を伴わない限り「確認済み」とは書きません。

- 実機での通知到達（iPhone ホーム画面 PWA / Android / PC）
- Cron の稼働と D1 の内容（`npx wrangler tail`、`/api/status`）
- Cloudflare 側の設定（D1 の作成、バインディング、シークレット、デプロイ）
- 無料枠の実消費

### 現時点の確認状況（2026-08-16）

| 項目 | 状況 |
|---|---|
| VAPID 署名と単体送信（PC / Chrome / FCM） | 実機で確認済み |
| ペイロードなし push の受信（iPhone ホーム画面 PWA / Safari / APNs） | 実機で確認済み |
| `/api/*` が `_redirects` の SPA フォールバックに飲み込まれないこと | `/api/vapid-key` の応答で確認済み |
| 購読 API と D1 の往復（登録・保存・削除） | 確認済み |
| **Cron 経由での実地の通知到達** | **未確認。** 通常ダイヤの日での確認が必要 |
| Android のメーカー独自省電力下での配送 | 未確認 |
| 実運用規模での無料枠消費 | 未確認（見積もりのみ） |

## 文書変更時の確認

- リンク先のパス・見出し・コマンドが存在するか
- 実装の説明は、対象のコード・設定・データを読み直しているか
- 「現在」「完了」「稼働中」といった表現に確認日と根拠があるか
- 仕様の正本を複製して矛盾させていないか
- README が利用者向けの説明に留まり、実装詳細は `docs/` を指しているか
- AGENTS.md と CLAUDE.md が新しい文書への導線を持つか

Markdown 専用の自動リンク検査は現在導入していません。文書を追加・移動したら、相対リンクを目視確認し、必要に応じてリポジトリ内検索で旧パスが残っていないか確認してください。

