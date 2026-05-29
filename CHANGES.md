# CHANGES — iPad PWA 縦潰れ（ビューポート高さ復元）バグ修正

- 日付: 2026-05-29
- 種別: バグ修正（iOS/iPadOS 限定のレイアウト不具合）
- スコープ: `src/main.tsx`, `src/App.tsx` の 2 ファイルのみ
- `window.location.reload()` は使用しない（初期化フロー以外での reload 禁止ルールを遵守）

---

## 1. 症状

iPad の Safari および PWA（ホーム画面に追加して起動）で、

1. 初回起動時は UI が正しく表示される。
2. 一度アプリを終了（バックグラウンド送り／他アプリへ切替）してから再度開くと、**UI が縦方向に潰れて表示される**。
3. Safari ではページ更新、PWA ではアプリ初期化を行うと正常表示に戻る。
4. しかし再びアプリを終了して開き直すと、再発する（無限に繰り返す）。

iPhone（モバイル）・PC・Chrome（Google アプリ）では発生しない。**iPad の WebKit standalone/Safari のみ**で発生する。

---

## 2. 原因

iOS/iPadOS の standalone PWA（および Safari）では、**動的ビューポート単位 `100dvh` が（再）起動直後に正しく初期化されない**既知の WebKit 挙動がある。`100dvh` は回転（portrait → landscape → portrait）やリロードといった「ビューポートの再計算を強制するイベント」が起きるまで、前回セッションのキャッシュ済み寸法（本来より小さい／未確定の高さ）のまま解決される。一方 `100vh` は standalone モードでは起動時から正しい値になる。

参考: <https://gist.github.com/fozzedout/5e77925381991a9570151550992baf14>（2026-04 時点の検証メモ。standalone PWA における `100dvh` のコールドスタート初期化不良と `100vh` の挙動について）

本アプリは `src/App.tsx` のフォンシェル（外側・内側の 2 つの `div`）で高さの基準に **`minHeight: '100dvh'`** を使用している。再起動（前面復帰）時にこの `100dvh` が小さく解決されることで、フォンシェルの最小高さが実画面より低くなり、ヘッダーやカードが画面上部に詰め込まれて「縦に潰れて見える」状態になる。リロード／初期化はビューポートを再計算させるため正常表示に戻る。

### なぜ iPhone/PC/Chrome では起きないか

- iPhone の standalone は実質フルスクリーン固定ポートレートのため、前面復帰時もビューポート寸法が一致しやすい。
- iPad は回転に加え Split View / Stage Manager でウィンドウサイズが可変なため、復帰時に前回寸法と現在の画面が食い違いやすい。
- Chrome / デスクトップは WebKit の standalone ビューポート復元クセを持たない。

### なぜ既存の対策で直らなかったか

`src/main.tsx` の `bp-active` ロジックは **幅（カラム数・パディングのしきい値）の判定**のみを扱っており、`visibilitychange` / `pageshow` で再評価はしているが、**高さ（`100dvh`）には一切触れていない**。崩れているのは高さ側であるため、幅の再評価だけでは対処できていなかった。

---

## 3. 修正方針

`dvh` に依存せず、確定後は正しい値となる `window.innerHeight` / `window.visualViewport.height` を CSS 変数 `--app-height` に書き込み、CSS 側は `min-height: var(--app-height, 100vh)` を使う。前面復帰（`visibilitychange` / `pageshow`）時に、iOS のビューポート確定遅れを見込んで複数タイミング（次フレーム + 250ms 後）で再測定する。

この方法は「どの `vh` 系単位を iOS が誤るか」に依存しないため堅牢。フォールバックの `100vh` は JS が変数を設定するまでの初回 1 フレームのみ使用され、standalone では `100vh` が起動時から正しいのでコールド初回描画も崩れない。Safari タブ表示でも確定後は `--app-height`（= `innerHeight`）が即座に上書きするため正しい可視高さになる。

---

## 4. 変更内容

### 4.1 `src/main.tsx`

#### (a) 高さ同期関数 `syncAppHeight()` を追加

`syncBpActiveClass()` の直後（`resyncBp` の前）に以下を追加する。

```ts
// 実ビューポート高さ(px)を CSS 変数 --app-height に反映する。
// iOS/iPadOS の standalone PWA では 100dvh が(再)起動直後に正しく初期化されず、
// 回転 or リロードまで誤った高さのままになる(= UI が縦に潰れて見える主因)。
// window.innerHeight / visualViewport.height は確定後は正しいので、これを採用する。
function syncAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  if (h > 0) {
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`)
  }
}
```

#### (b) `resyncBp()` を `resync()` に置き換え（bp + 高さの両方を再評価）

変更前:

```ts
function resyncBp() {
  syncBpActiveClass()
  // iPad PWA は再起動直後 screen.* / matchMedia の値が遅れて更新されることがあるため、
  // 次フレームでも再評価して取りこぼしを防ぐ
  requestAnimationFrame(syncBpActiveClass)
}
```

変更後:

```ts
function resync() {
  syncBpActiveClass()
  syncAppHeight()
  // iPad PWA は前面復帰直後 screen.* / innerHeight が遅れて確定するため、
  // 次フレーム + 250ms 後にも再評価して取りこぼし(縦潰れ)を防ぐ
  requestAnimationFrame(() => { syncBpActiveClass(); syncAppHeight() })
  setTimeout(() => { syncBpActiveClass(); syncAppHeight() }, 250)
}
```

> 注: 関数名を `resyncBp` → `resync` に変更しているため、`main()` 内の呼び出し箇所もすべて差し替える（次項参照）。他に `resyncBp` を参照している箇所がないことを確認すること。

#### (c) `main()` 内のイベント配線を差し替え

`main()` 内の `resyncBp()` 呼び出しから `pageshow` 登録までのブロックを置き換える。

変更前:

```ts
  resyncBp()

  // orientation 変化（回転）
  screen.orientation?.addEventListener('change', syncBpActiveClass)

  // matchMedia の変化（orientation / breakpoint しきい値）
  window.matchMedia('(orientation: portrait)').addEventListener('change', syncBpActiveClass)
  window.matchMedia('(min-width: 1024px)').addEventListener('change', syncBpActiveClass)

  // viewport サイズ変更（ウィンドウリサイズ等）
  window.addEventListener('resize', syncBpActiveClass)

  // PWA が前面に出るたびに再評価
  // iPad PWA で 2 回目以降の起動時に screen.* が前回セッションの古い値を返す問題への対策
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resyncBp()
  })

  // pageshow（BFCache からの復元時も含めて発火）
  window.addEventListener('pageshow', resyncBp)
```

変更後:

```ts
  resync()

  // 回転・しきい値変化 → bp と高さの両方を再評価
  screen.orientation?.addEventListener('change', resync)
  window.matchMedia('(orientation: portrait)').addEventListener('change', resync)
  window.matchMedia('(min-width: 1024px)').addEventListener('change', syncBpActiveClass)

  // リサイズ(Split View / Stage Manager 含む) → 即時に bp と高さを反映
  window.addEventListener('resize', () => { syncBpActiveClass(); syncAppHeight() })

  // visualViewport の変化(より早く確定する) → 高さを反映
  window.visualViewport?.addEventListener('resize', syncAppHeight)

  // 前面復帰 / BFCache 復元 → 再評価(縦潰れの主因に対処)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resync()
  })
  window.addEventListener('pageshow', resync)
```

### 4.2 `src/App.tsx`

`minHeight: '100dvh'` が **2 か所**ある（外側の `relative w-full` の `div` と、内側の `phone-shell-inner` の `div`）。両方を次のように変更する。

```diff
-            minHeight: '100dvh',
+            minHeight: 'var(--app-height, 100vh)',
```

> 確認: `100dvh` の出現は App.tsx 内のこの 2 か所のみ。`@media (min-width: 9999px)` のインライン `<style>` ブロック（角丸・影用のダミーガード）はそのまま残す。

### 4.3 変更しないもの

- `src/index.css` の `html { height: 100% }` / `body { min-height: 100% }` は変更不要。実際の表示高さを決めているのは内側 `phone-shell-inner` のため。
- `index.html` の viewport メタ（`width=device-width, initial-scale=1.0, viewport-fit=cover`）は変更不要。
- `bp-active` 関連のロジック・CSS は維持（幅／カラム制御として引き続き機能する）。

---

## 5. 動作確認手順

1. ビルド & デプロイ（Cloudflare Pages）。PWA はバージョン更新で SW 更新が走る。確実にするため `package.json` の version を上げてから出す。
2. クリーン検証する場合は iPad のホーム画面から一度アプリを削除し、再追加する。
3. 以下を **3 回以上** 繰り返し、毎回正常表示が維持されることを確認する:
   - コールド起動 → 正常表示を確認
   - アプリをバックグラウンドへ（他アプリへ切替／ホームへ）
   - 再度開く → **リロードなしで縦潰れしない**ことを確認
4. 回転（縦↔横）でレイアウトが崩れないこと、Safari タブ表示でも崩れないことを併せて確認する。
5. リグレッション確認: iPhone / PC / Chrome で従来どおり正しく表示されること。

### 期待結果

再起動後もリロード／初期化なしで UI の高さが正しく保たれる。初回フレームは `100vh` フォールバック、その後 JS が `--app-height` を実測値で確定。前面復帰時は次フレーム + 250ms で再測定され、縦潰れが起きない。

---

## 6. ロールバック

`src/main.tsx` と `src/App.tsx` を本変更前の状態に戻すだけでよい（2 ファイル完結）。`--app-height` は CSS 変数なので、未設定でも `var(--app-height, 100vh)` のフォールバックが効くため、App.tsx 側だけ戻して main.tsx を残しても破綻はしない。

---

## 7. 既知の制約・今後のエスカレーション

- 本修正は「高さ（`dvh`）の復元ズレ」という推定に基づく。実機でのピクセル挙動は未検証のため、デプロイ後に §5 の手順で要確認。これで縦潰れが解消すれば原因はこれで確定。
- **万一、修正後も縦潰れが残る場合**: 高さではなく**レイアウトビューポートの幅／スケール自体**が誤って復元されている可能性が残る。その場合は、前面復帰時（`visibilitychange` / `pageshow`）に `<meta name="viewport">` の content を一時的に書き換えて強制再レイアウトさせる追加策で対処する（`reload` は使わない）。この追加策が必要になった場合は別途仕様を起こす。
- 復帰直後にごく短時間だけ前回高さが見える可能性があるが、次フレーム + 250ms の再測定で補正される。チラつきが気になる場合は再測定タイミング（例: 100ms / 300ms / 500ms の多段）を調整する。
- 過去対応の iPad Pro 12.9" ポートレート 1024px 幅のエッジケース（幅判定）は本件とは別問題であり、本修正の対象外。
