# 実装指示書：次のバスカードに「本日の残り運行本数」バッジを追加（案2 確定版）

## 0. 概要

「次のバス」カード（`NextBusCard`）の見出し行 右側に、**本日の残り運行本数**を示すバッジを追加する。

- 通常時 … 🚍 `残り{N}本`
- 残りが次発の1本のみ（= 本日最終便）… 🚍 `最終便`

あわせて、**発車時刻の横に出ていた `note`（実データ上は「最終」）のピルを削除**する。最終便のときに右上バッジ「最終便」と意味が重複するため。

判定はカウントベース（`remaining === 1`）で行い、`note` 文字列には依存しない。

**新規ファイルは作成しない。** 既存3ファイルの編集のみ：

| ファイル | 変更内容 |
|---|---|
| `src/utils/findNextBus.ts` | 残数算出関数 `countRemainingBuses` を追加 |
| `src/App.tsx` | import 追加 → `remainingCount` を算出 → `NextBusCard` に `remaining` を渡す |
| `src/components/NextBusCard.tsx` | `remaining` prop 追加・見出し行にバッジ・`note` ピル削除・`BusIcon` 追加 |

---

## 1. 前提・遵守事項

- TypeScript / React 18 / Tailwind CSS v4。**`tailwind.config.js` は無い**ので、バッジは Tailwind コアのユーティリティクラスのみで実装する（追加設定不要）。
- `vite.config.ts` は変更しない。
- `window.location.reload()` は追加しない。
- コメント・JSDoc は日本語。
- ロジックはコンポーネントに肥大化させず `utils/` 側に置く（残数算出は `findNextBus.ts`）。
- 既存の配色・角丸・余白トークンを崩さない（カード R22px、見出し `text-[13px] tracking-widest uppercase text-white/75`）。

---

## 2. 変更①：`src/utils/findNextBus.ts`

既存の import（`dayjs` / `ScheduleEntry` / `parseHHmmToMinutes`）で足りるため **追加 import は不要**。
`findNextBus` 関数の直後に、以下の関数を追加する。

```ts
/**
 * 現在時刻以降に残っている運行本数を返す（次発を含む）。
 * findNextBus と同じ判定（depMinutes > nowMinutes）で数えるため、
 * findNextBus が次発を返す状況では必ず 1 以上になる（次発自身を含む）。
 * 不正な departure フォーマットの便はカウントしない。運行終了後は 0。
 */
export function countRemainingBuses(
  schedule: ScheduleEntry[],
  now: dayjs.Dayjs
): number {
  const nowMinutes = now.hour() * 60 + now.minute()
  let count = 0
  for (let i = 0; i < schedule.length; i++) {
    const depMinutes = parseHHmmToMinutes(schedule[i].departure)
    if (depMinutes === null) continue
    if (depMinutes > nowMinutes) count++
  }
  return count
}
```

> **整合性メモ**：`findNextBus` は `depMinutes > nowMinutes`（厳密に大きい）で次発を判定している。`countRemainingBuses` も同一の比較・同一の `parseHHmmToMinutes` を使うため、両者は常に整合する（`nextBus !== null` ⇔ `remaining >= 1`、かつ次発自身がカウントに含まれる）。

---

## 3. 変更②：`src/App.tsx`

### 3-1. import に `countRemainingBuses` を追加

**Before**
```tsx
import { findNextBus, findUpcomingBuses, findFirstBus } from './utils/findNextBus'
```

**After**
```tsx
import { findNextBus, findUpcomingBuses, findFirstBus, countRemainingBuses } from './utils/findNextBus'
```

### 3-2. 残数を算出（「時刻計算」ブロック内、`nextBus` の直後に1行追加）

**Before**
```tsx
  const nextBus = schedule.length > 0 ? findNextBus(schedule, now) : null
  const upcoming = nextBus ? findUpcomingBuses(schedule, nextBus.index, 4) : []
```

**After**
```tsx
  const nextBus = schedule.length > 0 ? findNextBus(schedule, now) : null
  const remainingCount = countRemainingBuses(schedule, now)
  const upcoming = nextBus ? findUpcomingBuses(schedule, nextBus.index, 4) : []
```

> `now` は毎分 `useJSTClock` が更新するため、App 再レンダーのたびに `remainingCount` が再計算される（= 発車に応じて自動的に減る）。`useMemo` は導入せず既存スタイルを踏襲（schedule は約28件で O(n) は無視できる）。

### 3-3. `NextBusCard` に `remaining` を渡す

**Before**
```tsx
                    <NextBusCard next={nextBus} route={route} fontSize={fontSize} />
```

**After**
```tsx
                    <NextBusCard next={nextBus} route={route} fontSize={fontSize} remaining={remainingCount} />
```

---

## 4. 変更③：`src/components/NextBusCard.tsx`

### 変更点

1. `Props` に `remaining: number` を追加。
2. `next` 非null時の見出し `<p>次のバス</p>` を **flex 行**にし、右側に残数バッジを配置。
3. **発車時刻横の `note` ピルを削除**（`flex items-baseline gap-3` のラッパーごと、時刻 `<p>` 単体に置換）。
4. バスアイコン用の `BusIcon` を追加（`Decoration` と同様にファイル下部に関数定義）。
5. `next` が null の分岐（運行終了 / `--:--`）と、`あと◯分` のカウントダウン表示は **変更しない**。

### 差し替え後の全文（このファイルをそのまま置き換えてよい）

```tsx
import type { NextBusInfo, RouteKey } from '../types/timetable'
import type { FontSize } from '../types/timetable'

interface Props {
  next: NextBusInfo | null
  route: RouteKey
  fontSize: FontSize
  /** 本日の残り運行本数（次発を含む）。next が null のときは未使用 */
  remaining: number
}

const FONT_SIZE_MAP: Record<FontSize, { time: string; text: string }> = {
  small:  { time: 'text-5xl', text: 'text-xl' },
  medium: { time: 'text-[60px]', text: 'text-[26px]' },
  large:  { time: 'text-7xl', text: 'text-[31px]' },
}

export function NextBusCard({ next, route, fontSize, remaining }: Props) {
  const isCampus = route === 'campus_to_station'
  const gradientClass = isCampus
    ? 'bg-gradient-to-br from-[#0d9966] to-[#34d399]'
    : 'bg-gradient-to-br from-[#6c63d5] to-[#a78bfa]'
  const endedGradient = 'linear-gradient(135deg, #374151, #4b5563)'

  const fs = FONT_SIZE_MAP[fontSize]

  if (!next) {
    return (
      <div
        className="rounded-[22px] px-6 py-[22px] text-white relative overflow-hidden"
        style={{ background: endedGradient }}
      >
        <Decoration />
        <p className="text-[13px] font-bold tracking-widest uppercase text-white/75 mb-2">
          次のバス
        </p>
        <p className={`${fs.time} font-black text-white tracking-tight leading-none mb-2`}>
          --:--
        </p>
        <p className="text-[17px] text-white/90 font-semibold">
          <b className="font-black text-white text-[22px]">本日の運行は終了しました</b>
        </p>
      </div>
    )
  }

  // remaining === 1 のとき、次発が本日の最終便
  const isLastBus = remaining === 1

  return (
    <div className={`${gradientClass} rounded-[22px] px-6 py-[22px] text-white relative overflow-hidden`}>
      <Decoration />

      {/* 見出し行: 左「次のバス」／右に本日の残数バッジ */}
      <div className="flex items-center justify-between mb-[5px]">
        <p className="text-[13px] font-bold tracking-widest uppercase text-white/75">
          次のバス
        </p>
        <span className="inline-flex items-center gap-1.5 bg-white/20 rounded-full px-[11px] py-1 text-[12px] font-extrabold whitespace-nowrap">
          <BusIcon />
          {isLastBus ? '最終便' : `残り${remaining}本`}
        </span>
      </div>

      {/* 発車時刻（「最終」ピルは右上バッジと重複するため表示しない） */}
      <p className={`${fs.time} font-black text-white tracking-tight leading-none mb-[7px]`}>
        {next.entry.departure}
      </p>

      <p className="text-[17px] text-white/90 font-medium">
        {next.minutesUntil >= 60 ? (
          <>
            あと{' '}
            <b className="font-black text-white text-[22px]">{Math.floor(next.minutesUntil / 60)}</b>
            {' '}時間{' '}
            {next.minutesUntil % 60 > 0 && (
              <>
                <b className="font-black text-white text-[22px]">{next.minutesUntil % 60}</b>
                {' '}分
              </>
            )}
          </>
        ) : (
          <>
            あと{' '}
            <b className="font-black text-white text-[22px]">{next.minutesUntil}</b>
            {' '}分
          </>
        )}
      </p>
    </div>
  )
}

function BusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="11" rx="2.5" />
      <path d="M3 11h18" />
      <circle cx="7.5" cy="18.5" r="1.4" />
      <circle cx="16.5" cy="18.5" r="1.4" />
    </svg>
  )
}

function Decoration() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        right: '-24px',
        top: '-24px',
        width: '120px',
        height: '120px',
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.09)',
      }}
    />
  )
}
```

> バッジの文字色は親カードの `text-white` を継承し、`BusIcon` は `stroke="currentColor"` で白になる。背景 `bg-white/20` は緑・紫いずれのグラデーション上でも視認できる（既存の note ピルと同じ不透明度）。

---

## 5. 受け入れ条件（Acceptance Criteria）

| 状態 | remaining | バッジ表示 | 発車時刻横「最終」ピル |
|---|---|---|---|
| 運行中（多め） | 12 | 🚍 `残り12本` | なし |
| 残り少 | 3 | 🚍 `残り3本` | なし |
| 最終便 | 1 | 🚍 `最終便` | **なし（削除済み）** |
| 運行終了 | 0 | NextBusCard 非表示（`EndOfServiceCard` 表示） | — |
| 時刻表データ無し（schedule 空） | 0 | バッジ非表示（`--:--`／終了表示） | — |

加えて以下を満たすこと：

- **両ルート**（大学発=緑／松永発=紫）でバッジが視認できる。
- **ライト／ダーク**両テーマで破綻しない（カードはテーマ非依存のグラデーション）。
- **フォントサイズ 小／標準／大** のいずれでも見出し行が崩れない（バッジは12px固定で時刻サイズの影響を受けない）。
- `あと◯分` / `あと◯時間◯分` のカウントダウン表示が従来どおり。
- `npm run build` / 型チェックがエラーなく通る（`remaining` を渡し忘れると型エラーになる＝安全側）。

---

## 6. エッジケース・補足

1. **`note` ピル削除のトレードオフ**
   現行データの `note` は「最終」のみのため、実質「最終」だけが消える。将来、次発に「最終」以外の `note`（臨時・経由変更 等）を付ける運用が生じる場合は、完全削除ではなく **最終便のときだけ非表示** にする選択肢がある。その場合は手順4で削除した部分を以下に置き換える（`flex` ラッパーを復活させる）：

   ```tsx
      <div className="flex items-baseline gap-3 mb-[7px]">
        <p className={`${fs.time} font-black text-white tracking-tight leading-none`}>
          {next.entry.departure}
        </p>
        {next.entry.note && !isLastBus && (
          <span className="text-sm text-white/80 bg-white/20 px-2 py-0.5 rounded-lg font-bold">
            {next.entry.note}
          </span>
        )}
      </div>
   ```
   **今回は承認済みデザイン通り「完全削除」で実装する。** 上記は将来の判断材料として記載。

2. **`残り1本` は数値表示しない**：仕様として `最終便` に置換するため、数値で出る最小は `残り2本`。`残り0本` や負数は `next` 非null時に発生しないため表示されない（手順2の整合性メモ参照）。

3. **分境界での更新**：残数は `now` 依存。タイマー再アンカーは既存 `useJSTClock` に委ねており、追加対応は不要。

4. **`EndOfServiceCard` は変更しない**（残数バッジは付けない）。

---

## 7. 動作確認手順

1. `npm run dev` でローカル起動。端末時計、または時刻表 JSON の値を調整して **多め／残り少／最終便／運行終了** の各状態を再現し、表4の通りになるか確認。
2. `sandbox` ブランチに push → Cloudflare Pages のプレビュー URL で確認。
3. 実機（iPad / iPhone の PWA）で **緑/紫 × ライト/ダーク × フォント3サイズ** を確認（実機検証方針に従う）。とくに最終便時に「最終」ピルが消えていること、バッジが装飾円と干渉しないことを確認。

---

## 8. リリース（`package.json` version bump）

- 本件は**コード変更**のため、ビルドで JS バンドルのハッシュが変わり、SW（vite-plugin-pwa, `registerType: 'prompt'`）の更新は検知される。README/データのみの変更と異なり、更新検知のための version bump は**必須ではない**。
- ただしプロジェクト慣習として `package.json` の `version` をパッチ更新すると、UI 表示バージョン（`__APP_VERSION__`）も更新され、インストール済み iPad での更新通知がより確実になる。**リリースに含めるかは判断に委ねる**（含める場合は patch を1つ上げる）。

---

## 9. 作業フロー（推奨）

`sandbox` ブランチで実装 → プレビュー & 実機で確認 → `main` へ PR（直接 push しない）。
