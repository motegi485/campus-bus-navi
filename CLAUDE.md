# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## コマンド

```bash
npm run dev            # Vite 開発サーバー起動 (http://localhost:5173)
npm run validate:data  # public/data 配下の静的データを検証（scripts/validate-data.mjs）
npm run build          # データ検証 → TypeScript チェック → Vite ビルド → /dist 出力
npm run preview        # プロダクションビルドをローカルでプレビュー
npx tsc --noEmit       # ビルドせずに型チェックのみ実行
```

テスト・リントスクリプトは存在しない。TypeScript は `strict: true` に加え `noUnusedLocals` / `noUnusedParameters` も有効で、`tsc --noEmit` が `build` の一部として実行される。静的データ（時刻表・カレンダー・お知らせ）の検証は `validate:data`（`scripts/validate-data.mjs`）が `build` の最初のステップとして行う。検出するのは ID 参照切れ・時刻フォーマット崩れ・順序崩れに加え、**ランタイムが前提にしている不変条件**（`overrides` の存在、override キーが実在日であること、`closed`/`special` は schedule が空・それ以外は両方向 1 件以上、metadata と `news.json` 各フィールドの型）である。動作要件は Node.js 20 以上（Node 18 は EOL のため非推奨。CI の Bot ジョブは Node 22 を使う。`.nvmrc` 等によるバージョン固定はしていない）。

## アーキテクチャ

福山大学のバス時刻表を表示する **React 18 + TypeScript PWA**。全データは静的 JSON でバックエンドなし（データ更新を自動化する Bot は main 統合済みだが日次実行は停止中 — 後述「バックエンド Bot」節を参照）。Cloudflare Pages にデプロイ。エンドユーザー向け説明・お知らせ追加やダイヤ改正時の運用手順・デプロイ設定の具体値は `README.md` にまとまっている。

**スタック:** Vite 5、Tailwind CSS v4（`tailwind.config.js` は不要 — `index.css` 内の `@theme` ブロックで設定、`@tailwindcss/vite` プラグイン使用）、Leaflet + react-leaflet（地図）、Day.js（JST 時刻処理）、vite-plugin-pwa + Workbox（サービスワーカーキャッシュ。クライアント側の更新検知は workbox-window）。

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
- `timetables/` — 路線ごとの発車時刻。本番運用する時刻表のみを置く。常設は `timetable_weekday.json`（授業日）・`timetable_holiday.json`（休業日）で、これに Bot が生成する `timetable_vacation_{季節}_{weekday,holiday}` / `timetable_event_{YYYYMMDD}` と、手動運用の期間ダイヤ（例 `timetable_vacation_obon.json`）が加わる。`timetable_closed.json`〔全便運休日〕と `timetable_special.json`〔特別ダイヤ〕は **`schedule` が空配列の待機ファイル**で、必要な日に `overrides` から参照させる（`calendar_rules.json` から参照されていない期間があってよい）
- `_examples/` — 長期休暇・イベント日ダイヤのテンプレートと構造サンプル。`calendar_rules.json` からは参照されず、`validate:data` の検証対象にも含まれない（`public/` 配下のため `dist/data/_examples/` へは他の静的ファイルと同様にコピーされるが、アプリからは読み込まれないダミーデータである点に注意）。新しいダイヤを作るときはここからコピーして値を実データに置き換え、`timetables/` に配置する

ダイヤ改正時は該当 JSON ファイルを編集する。時刻表 JSON の `id` はファイル名（拡張子なし）と一致させること（`validate:data` が検証する）。`public/_headers` が Cloudflare に `/data/*.json` をキャッシュ無効化ヘッダー（`Cache-Control: no-cache, no-store, must-revalidate` ほか）で配信するよう指示しており、更新は即座に反映される。

### バックエンド Bot（main 統合済み・実行は停止中）

大学公式サイトの時刻表画像を日次巡回し、Gemini API で JSON 化して `public/data/` 更新の PR を自動作成するバックエンド Bot。`bot/` に本体一式、`.github/workflows/timetable-sync.yml` にワークフローがある。フロントとは依存を完全分離（`bot/package.json` は独立、`bot/package-lock.json` はコミット必須）。

```bash
cd bot
npm install
npx vitest run                        # ユニット/統合テスト
npx tsc --noEmit                      # 型チェック
$env:DRY_RUN="1"; $env:SKIP_OCR="1"   # 無料枠を消費せず変更計画だけ出力
npx tsx src/index.ts
npm run ocr:check -- fixtures/images/R8スクールバス時刻表.jpg fixtures/intermediate/regular.json
```

- **要件定義の正本（SSoT）は `bot/fixtures/_planning/BACKEND_REQUIREMENTS.md`（v1.7）**。他の資料と食い違う場合はこちらが優先し、版数は正本冒頭の変更履歴表で確認する。「今どうなっていて次に何をするか」は同ディレクトリの `HANDOFF.md`、導入時点の役割分担（§16）と導入シーケンス（§17.1・§17.2）は**歴史記録**で、残タスクは §17.3 にある。仕様の詳細は CLAUDE.md に転記せず、必要なときにこのファイルを読む。
- 大原則: main へ直接 push しない（PR + 人間レビュー必須）。Bot はフロントエンド（`src/` 等）には一切触れない。書込は `files.ts` のホワイトリスト（`timetable_weekday/holiday`・`timetable_vacation_{season}_{weekday,holiday}`・`timetable_event_{YYYYMMDD}`）に限定され、削除は event ファイルのみ。`timetable_closed.json`・`timetable_special.json` と `_examples/` には触れない（`timetable_special` は override から**参照する**だけ）。
- **読めない掲示は特別ダイヤで塗り潰す（フェイルセーフ）:** `needs_review` と判定したリンクのうち**期間の両端が読めているもの**は、その期間に `timetable_special` の override を自動で張る（`plan.ts` の `applySpecials` → `calendar.ts`）。PR を見落としても誤った時刻を表示しないための保険で、override の優先順位は **手動 > special > event > vacation > 祝日 > default_rules**。日付が読めない `needs_review` は従来どおり警告のみ。期間が `CONFIG.specialMaxRangeDays`（92日）を超えるものは日付の誤読を疑って適用しない。
- **手動 override は不可侵:** Bot が張った override を人が書き換える／削除すると、その日付は `suppressed_overrides` に記録され以後 Bot は触らない。お盆のように「読める日は個別ダイヤ、読めない日は特別ダイヤ」と人が精緻化した結果は上書きされない。
- **日付は実在検証を通す:** `dayjs.tz(d,'YYYY-MM-DD',TZ)` は strict parse ではなく、`2026-02-30` を `2026-03-02` へ黙って正規化する。`time.ts` の `isRealDate()`（format の往復一致）を `classifyLink` で通し、非実在日・逆転期間（start > end）の掲示は**期間を残さず** `needs_review` にする（誤読の疑いが強いので特別ダイヤの塗り潰しもしない）。`applySpecials` と `calendar.ts` にも state 経由の古い値に備えた同じガードがある。
- **消えた／延期されたイベントは連続確認で撤去する:** 掲載ページから消えた未来イベントを放置すると、中止・延期された日に存在しない便を表示し続ける。`plan.ts` の `reconcileEvents()` が `state.events[key].missing_count` を数え、`CONFIG.eventMissingRunsBeforeRemoval`（3 回 ＝ 日次実行で 3 日連続）に達したら state・override・`timetable_event_*.json` を撤去する。**ページから時刻表リンクを 1 件も抽出できなかった実行は数えない**（`extractionHealthy`）。撤去は PR に載るので人のレビューを必ず通る。延期（同一 URL・日付だけ変更）は「旧キーが消える → 新しい日付が新規イベントとして入る」で処理される。
- **同一 URL でもイベント日の増減はファイルへ反映する:** 画像が同じで掲載テキストの日付だけ変わると `meta_only` になるが、追加された日の `timetable_event_YYYYMMDD` が無いと `calendar.ts` の存在ゲートでその日の override が黙って落ちる。`plan.ts` の `syncEventFiles()` が既存 derived を複製して埋め、外れた日のファイルは撤去候補にする（イベント表は元々「1 画像 → 各日付に同内容」なので複製は設計どおり）。
- **警告だけで差分ゼロの実行は失敗させる:** その組み合わせでは PR が作られず、警告は gitignore 下の `bot/.out` と Step Summary にしか残らない。`index.ts` は書き込み前に差分の有無を判定し、`level: 'warn'` か検証失敗があって差分が無いときは `process.exitCode = 1` にする。ワークフローは `bot/.out/**` を `if: always()` で成果物として上げる。
- **1 実行の締切:** `CONFIG.runDeadlineMs`（15 分）。ワークフローの `timeout-minutes: 20` から後処理ぶんを引いた値で、`OcrClient` はこれを越えるリトライをせず `needs_review` へ収束させる。ジョブが強制終了されると PR 本文も Step Summary も残らないため。両者は対で維持すること。
- **取得先は allowlist に限定する:** `url.ts` の `checkUrl()` が https のみ・資格情報付き URL 不可・IP リテラル不可・許可ホストのみを強制し、`fetchPage.ts` はリダイレクトを自前で追って**各ホップで**再検証する。応答サイズは Content-Length の事前判定とストリーム上限で頭打ちにし、画像はマジックバイトで実体も確かめる。**大学が画像の配信先を別ホスト（CDN 等）へ変えたら `CONFIG.allowedImageHostSuffixes` に追加する**（忘れると `image_fetch_failed` で止まる ＝ 安全側）。
- **JSON 整形は既存ハウススタイルを維持する**（`bus_stop_coords` と schedule 各要素は1行）。素の `JSON.stringify(_, null, 2)` にすると Bot が触った全ファイルが全行差分になり、本システムの中核である PR レビューが機能しなくなる。`bot/test/files.test.ts` が既存ファイルとの byte 一致を固定しているので、ここを壊す変更はテストが落ちる。
- **`GEMINI_API_KEY` はローカルでは `bot/.env.local`（git 管理外）**、CI では GitHub Secrets。ファイルの中身を読み上げ・出力しない。
- 無料枠は RPD（1日あたり）が小さい（実測 `gemini-3.5-flash` で 20）。リトライも枠を消費するため 1 実行あたりの呼び出し上限（`geminiMaxCallsPerRun`）がある。枠を使わずに計画だけ見たいときは `SKIP_OCR=1`。
- **ワークフローは 2026-08-02 から手動 Disable 中。** コードは main にあるので `schedule` の前提（デフォルトブランチにワークフローが在ること）は満たしているが、実行は止めてある。稼働させるには ①Secrets に `GEMINI_API_KEY` 登録 ②Workflow permissions で「Allow GitHub Actions to create and approve pull requests」を有効化 ③ワークフローを Enable — の3つが必要。ワークフロー内の action は **full commit SHA で固定**してある（可変タグは移動・侵害され得る）。更新するときは SHA を引き直し、末尾のバージョンコメントも合わせること。`checkout` は `persist-credentials: false` で write token を後続ステップへ残さない。**現状と手順の詳細は `bot/fixtures/_planning/HANDOFF.md`**（次の作業は 2026-08-23 前後を予定）。それまでの検証はローカル実行（`DRY_RUN=1` / `SKIP_OCR=1`）で行う。

### 重要な設計判断

**時刻処理:** 全時刻は JST（`Asia/Tokyo`）。バス発車時刻の照合は分単位の文字列比較（`HH:mm > now`）。`useJSTClock` の境界同期パターンはクロックドリフト防止とサブ分単位のちらつき抑制のために意図的に採用している。

**日付跨ぎのガード（重要）:** `useTimetable` は取得したデータに**対象日（`dateKey`）と翌日 prefetch の対象日（`tomorrowDateKey`）を必ず添えて**保持し、リクエスト世代（`seqRef`）で古い応答を破棄する。日付が変わったときは、①保持中の翌日 prefetch が新しい今日と一致すればそれを当日データへ昇格させる、②一致しなければ `stale: true` を返す。`App.tsx` は `stale` の間 **時刻を一切描画しない**（`showTimes`）で「日付が変わりました」のカードだけを出す。これがないと、オフラインでの日付跨ぎや取得失敗時に「見出しは今日・時刻は前日」という最悪の誤表示になる。正典の「推測するより出さない」と同じ判断。

**PWA アップデート:** `registerType: 'prompt'` — 操作中の強制更新は行わない。ただし**コールドスタート時（起動から `COLD_START_GRACE_MS = 5000` 以内）に新 SW を検知した場合のみ自動適用**（`updateServiceWorker(true)`）し、それ以降のセッション中の検知は `UpdateBanner` でユーザーに通知する（`App.tsx`。「あとで」でバナーを閉じてもセッション中は再表示しない）。`useRegisterSW` の `needRefresh` が発火しない iOS PWA（standalone）向けに、`navigator.serviceWorker` で `waiting` 状態の SW を直接検出して `SKIP_WAITING` を送るフォールバックを `App.tsx` と `main.tsx`（React マウント前）に用意している。`main.tsx` 側のこのフローは sessionStorage（`swWaitingReloadAttempted`）によるワンショットガード付きで、待機 SW が activate できない端末でも「起動 → 2秒待ち → リロード」を無限に繰り返さない（1 セッション 1 回まで）。スタック状態の解消には完全リセット（SW 登録解除 + localStorage クリア + Cache Storage 削除 + リロード）が用意されている。

**PWA マニフェスト:** vite-plugin-pwa による自動生成ではなく `public/manifest.json` を直接使う（`vite.config.ts` で `manifest: false` を指定）。

**サービスワーカーキャッシュ戦略:**
- 時刻表・カレンダー・お知らせ JSON → NetworkFirst（タイムアウト 3秒、失敗時は `timetable-data` キャッシュの前回取得分にフォールバック）
- OSM 地図タイル → CacheFirst（オフライン動作）
- JS/CSS/アセット → Workbox プレキャッシュ

**データ JSON はプリキャッシュしない（重要）:** `data/**/*.json` を `vite.config.ts` の `workbox.globIgnores` で**プリキャッシュ対象から除外**している。`globPatterns` に `json` が含まれるため除外しないと `/data/*.json` の素の URL がプリキャッシュに先勝ちでヒットし、NetworkFirst が「通常起動の読み込み経路」では効かなくなる（ビルド時スナップショットが固定表示され、サーバ更新が更新ボタンを押すまで反映されない）。除外することで**通常起動・更新ボタン・お知らせ取得のすべてが NetworkFirst を通り**、常に最新を取得しつつ取得済み分をオフライン用フォールバックとして保持する。`globIgnores` を外すとこの挙動が壊れるので注意。なお `_examples/` やテンプレート（`*_SEASON_*` / `*_YYYYMMDD`）もこれにより本番プリキャッシュから外れる。

**SW キャッシュ URL パターンの注意点:** データ JSON の `urlPattern` は `/\/data\/.*\.json(\?.*)?$/`。`useTimetable` の手動更新ボタンのみ `?t=timestamp` のキャッシュバスター付き URL でフェッチするため末尾の `(\?.*)?` が必要（`useNews` は素の URL のみでキャッシュバスターは付けない）。`/\.json$/` に変えるとキャッシュバスター付き URL がマッチせず NetworkFirst が適用されない。

**手動更新と正規 URL のキャッシュ同期（重要）:** Cache API のマッチングは既定でクエリ文字列を無視しないため、`?t=` 付きで取得したレスポンスは SW のキャッシュでは**素の URL とは別キー**になる。そのままだと「更新ボタンを押した直後にオフラインで起動すると旧ダイヤに戻る」（通常起動は素の URL を要求し、NetworkFirst が前回の素の URL のエントリへフォールバックするため）。対策として `useTimetable` の `fetchJSON` が、キャッシュバスター付き取得の成功時に同じレスポンスを `caches.open('timetable-data')` 経由で**素の URL のキーにも書き込む**（`putCanonical`）。キャッシュ名 `timetable-data` は `vite.config.ts` の `runtimeCaching.options.cacheName` と結合しているので、変更するときは両方を直すこと。

**OSM タイルのホスト:** `BusStopMap` のタイル URL は OSMF のタイル利用ポリシーが指定する `https://tile.openstreetmap.org/{z}/{x}/{y}.png`（単一ホスト）。`{s}` の a/b/c サブドメインは非推奨なので使わない。`vite.config.ts` の `osm-tiles` の `urlPattern` は端末に残った旧サブドメインのエントリも拾えるよう `([abc]\.)?` を任意扱いにしてある。

**地図:** Leaflet は動的インポート（lazy）でSSR 問題を回避。iOS/Android 判定は `src/utils/platform.ts` の `isIOS()` / `isAndroid()` に共通化（`buildMapUrl.ts`・`MobilePwaGuide.tsx`・`useNativeBounce.ts` が共通で参照する）。`isIOS()` は UA の `iPad|iPhone|iPod` に加え、iPadOS 13+ がデスクトップ UA（`Macintosh`）を送る問題を `navigator.maxTouchPoints > 1` の補完で吸収する。iOS は Apple Maps のユニバーサルリンク（`https://maps.apple.com/?daddr=...`。非対応環境では Web にフォールバック）、それ以外は Google Maps リンクでナビを開く。**オフライン時も地図はマウントする**（タイルは `osm-tiles` の CacheFirst から出る。README・ヘルプの「一度読み込んだ地図タイルはオフラインでも閲覧可能」という説明と実装を一致させるため）。未取得の範囲は空白になるので、オフライン時のみ地図の下に注記を出す。

**オーバーレイのフォーカス制御:** ドロワー・お知らせ・設定・ヘルプの 4 画面は開閉アニメーションのため閉時も transform で画面外に置いたまま DOM に残る。`useOverlayA11y` が **`inert` を DOM プロパティ経由で**付け外しし（React 18 は `inert={false}` を `inert="false"` として出してしまうため JSX 属性は使わない）、閉時・被覆時は Tab 順とアクセシビリティツリーから外す。開いた瞬間に内部の最初の操作要素へフォーカスし、閉じたら呼び出し元へ戻す。`App.tsx` は背面（ヘッダー・本文・バナー）を 1 枚の `<div>` で包み、いずれかのオーバーレイが開いている間 `setInert` する。この方式なら JS のフォーカストラップを書かずに WAI-ARIA の modal dialog パターンを満たせる。お知らせの詳細パネルと設定のサブ画面も、開いている間は背後のナビバー・リストを inert にする。

**オーバースクロール（バウンス）表現:** JS による弾性エミュレーション（touchmove 乗っ取り + rAF）はコンポジタ駆動のネイティブ慣性に体感レベルで追従できないことが実機検証で確定しており、再挑戦しない。両 OS とも OS ネイティブ表現を解放する方式が最終形 — `useNativeBounce.ts` が iOS には `bounce-native`（ラバーバンドバウンス + ヘッダークッションのグラデ stop 位置算出）、Android 等のタッチ主体端末には `bounce-stretch`（`overscroll-behavior-y: contain` + ネイティブストレッチ）を適用し、PC はバウンス無し。改修は `overscroll-behavior` とクッションの枠内で行う。詳細は同フック冒頭のコメントを参照。

**押下フィードバック（アフォーダンス）:** `index.css` の `* { -webkit-tap-highlight-color: transparent }` が OS 標準のタップ反応を全要素で消しているため、その代替を `usePressable`（`src/hooks/usePressable.ts`）に集約している。CSS の `:active` は iOS Safari のタッチで発火しないことがあるので使わず、Pointer Events で押下状態を持つ。適用先はヘッダーの 2 ボタン（ハンバーガー・更新）・「表示する」チップ・設定行。触覚は `src/utils/haptics.ts` の `tapFeedback()` に集約し、ルート切替・更新ボタン・チップ開閉の 3 箇所だけで呼ぶ（iOS Safari は Vibration API 非対応で無反応なのが正常。`prefers-reduced-motion` は視覚モーションの設定なので触覚は抑制対象にしない）。**更新ボタンの 720° 回転は `<button>` ではなく内側の `<svg>` に掛ける** — ボタン側は押下の `scale()` を使うので、同一要素に 2 つの transform を書くと片方が消える。

**ルート切替トグルの配色（重要）:** 面は `.frost-surface`、ノブは `.toggle-knob`（どちらも `index.css`）。`RouteToggle` は位置・アニメーションと、ダーク用ティント（`--toggle-tint` / `--toggle-tint-fb`）を route ごとに渡す役目だけを持つ。**ライトは透明な白ガラス、ダークはルート色のスモークガラス＋黒ガラスのノブ**とテーマで作りが反転するため、選択中ラベルの色もテーマ変数（`--toggle-on-campus` / `--toggle-on-station`）で切り替える。未選択ラベルはヘッダーの他の文字（タイトル・日付）と揃えて白。**ライトではこの白ラベルが地のグラデに対して 1.5〜2.7:1 で WCAG AA を満たさないが、これは見た目を優先した意図的な選択**（変更前の元デザインと同水準）であり、可読性を理由に面を暗くしない。ダークは 5.3〜7.5:1 で AA を満たす。面の alpha・ティント・ラベル色を触るときは、`backdrop-filter` の `saturate()` を含めた合成後の色から相対輝度を計算し直すこと。ノブ幅 `calc(50% - 4px)` がボタン位置と一致するのはトラックの `padding: 4px`・ボタン `flex:1`・**`gap` なし**の 3 つが揃っているからで、`gap` を足すと崩れる。初回ナッジは localStorage キー `campusBusNaviRouteToggleHinted`（設定本体の `campusBusNaviSettings` とは別）で 1 回に制限し、`prefers-reduced-motion` ではアニメーションのみ止める。

**ダイヤ種別** は時刻表 ID 文字列から推定（8種類）：`closed` を含む → `'closed'`（全便運休日）、`special` を含む → `'special'`（特別ダイヤ）、`event` を含む → `'event'`、`vacation` を含む → `holiday` も含めば `'vacation_holiday'` / `weekday` も含めば `'vacation_weekday'` / どちらも無ければ `'vacation'`（平日・休日で分かれない単一表。お盆ダイヤ等）、`holiday` を含む → `'holiday'`、それ以外 → `'weekday'`。`vacation_*_holiday` は `vacation` と `holiday` の両方を含むため、`vacation` を `holiday` より先に判定する順序が必須。判定順序は `closed → special → event → vacation → holiday → weekday`。推定ロジックは `DayBadge.tsx` の `resolveDiagramType()` に実装されている。

**時刻を表示しない2つの状態:** どちらも時刻表の `schedule` を空配列にして表現し、待機ファイルを `calendar_rules.json` の `overrides` から参照させて運用する。

- **全便運休日**（`timetable_closed.json`）— `App.tsx` が `isNoService` として検出し、次発カードの代わりに「本日の運行はありません」＋翌日始発を表示する
- **特別ダイヤ**（`timetable_special.json`）— 既定のフォーマットで表現できないダイヤ（運休日と通常日が混在する期間、「大学発のみ最終便が変わる」といった但し書き付きのダイヤなど）。`App.tsx` が `isSpecial` として検出し、`SpecialScheduleCard` で大学ホームページ（`src/constants/links.ts` の `SCHOOL_BUS_INFO_URL`）へ誘導する。掲示に書かれていない側（多くは松永発）を推測で埋めると「行きはあるが帰りが無い」時刻を出しかねないため、**推測するより出さない**という判断にもとづく

**両者は `schedule` が空という点で同じなので、描画側は `isSpecial` を `isNoService` より先に判定すること。** 直近4本（`nextBus` が null になる）と全時刻表（`FullTimetable` が null を返す）は空 schedule のガードで自動的に消えるため、追加の分岐は要らない。

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
  useNativeBounce.ts     ← バウンス/ストレッチ表現のネイティブ委譲（iOS はクッションの stop 位置も算出）
  useOverlayA11y.ts      ← オーバーレイの inert / 初期フォーカス / フォーカス復帰 / Esc（setInert も export）
  usePressable.ts        ← ポインタ押下状態（tap-highlight 無効化の代替。押下表現の共通土台）
src/utils/
  findNextBus.ts         ← findNextBus / findUpcomingBuses / findFirstBus（翌日始発）/ countRemainingBuses（本日の残り本数）を export
  resolveCalendar.ts     ← 日付 → 時刻表 ID のマッピング
  normalizeTimetable.ts  ← 取得した時刻表データの構造検証・不正エントリ除去・発車時刻の昇順ソート
  buildMapUrl.ts         ← iOS / Android 向けナビ URL 生成
  platform.ts            ← isIOS() / isAndroid() 判定の共通実装
  parseTime.ts           ← HH:mm 文字列を分単位の数値に変換（findNextBus が使用）
  haptics.ts             ← tapFeedback()（navigator.vibrate のラッパー。呼び出しはここ 1 箇所に集約）
src/components/          ← UI コンポーネント（NextBusCard, UpcomingList,
                            FullTimetable, BusStopMap, DrawerMenu,
                            EndOfServiceCard, SpecialScheduleCard,
                            MobilePwaGuide, ErrorBoundary, Toast 等）
src/constants/
  links.ts               ← 複数画面から参照する外部リンク（SCHOOL_BUS_INFO_URL）
src/types/
  timetable.d.ts         ← 共通 TypeScript 型定義
scripts/
  validate-data.mjs      ← public/data 配下の静的データ検証（npm run validate:data / build から実行）
```

### テーマ

Tailwind v4 + CSS カスタムプロパティ — `index.css` 内で `:root`（ライト）と `.dark` クラス（ダーク）に定義。主要変数: `--bg-page`、`--bg-card`、`--bg-card2`、`--bg-input`、`--text-primary`、`--text-muted`、`--text-secondary`、`--border`、`--border2`、`--past-text`、`--past-bg`。アフォーダンス用に `--row-active`（設定行の押下ハイライト）、`--chip-border` / `--chip-highlight` / `--chip-rim` / `--chip-text`（「表示する」チップの厚みと文字。`--text-secondary` は 12px に対し 4.26:1 で AA 未達のため専用変数を持つ）、`--toggle-on-campus` / `--toggle-on-station`（トグルの選択中ラベル）が加わる。フォントサイズは設定でトグルされる CSS クラスで制御。

テーマ設定は `light` / `dark` / `system` の 3 種（`useSettings` で localStorage 管理）。`system` は `prefers-color-scheme` に追従し、`App.tsx` が `<html>` の `.dark` を同期する。初回描画の FOUC 防止のため、React マウント前に `index.html` のインラインスクリプトが同一ロジックで `.dark` を付与する（判定ロジックとストレージキー `campusBusNaviSettings` は `useSettings` / `App.tsx` と一致させること）。

### ビルド出力

`npm run build` は `/dist` に出力する。Cloudflare Pages の設定ファイル `_headers` / `_redirects` は **`public/` に置く**（Vite がそのまま `dist/` へコピーする）。Pages はこれらを**ビルド出力ディレクトリから読む**ので、リポジトリルートに置くと出力ディレクトリが `dist` の本プロジェクトでは一切適用されない（`/data/*.json` の no-store も効かなくなる）。移動させないこと。`_redirects` には SPA ルーティング用の `/* /index.html 200` が含まれる。`index.html` には Cloudflare Web Analytics のビーコンスクリプトが埋め込まれている（このデプロイ固有のもので、フォーク・複製時は削除または差し替えが必要。詳細は README.md）。
