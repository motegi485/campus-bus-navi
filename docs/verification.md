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

Bot は `DRY_RUN` と `SKIP_OCR` を付けた安全な確認から始めます。OCR、実ファイル書込、GitHub Actions、PR 作成を伴う確認は、必要な権限・鍵・レビューがそろった人間管理下で段階的に実施します。

次の状態はコードだけでは保証できません。

- GitHub Actions が有効か
- `GEMINI_API_KEY` が Secrets に登録されているか
- PR 作成権限が有効か
- 実 API の現時点の応答、利用枠、画像品質
- 本番での PR 作成、レビュー、マージ、Pages 反映

Bot の受け入れ基準と人間が行う確認は `BACKEND_REQUIREMENTS.md` と `HANDOFF.md` を正とします。

## 文書変更時の確認

- リンク先のパス・見出し・コマンドが存在するか
- 実装の説明は、対象のコード・設定・データを読み直しているか
- 「現在」「完了」「稼働中」といった表現に確認日と根拠があるか
- 仕様の正本を複製して矛盾させていないか
- README が利用者向けの説明に留まり、実装詳細は `docs/` を指しているか
- AGENTS.md と CLAUDE.md が新しい文書への導線を持つか

Markdown 専用の自動リンク検査は現在導入していません。文書を追加・移動したら、相対リンクを目視確認し、必要に応じてリポジトリ内検索で旧パスが残っていないか確認してください。

