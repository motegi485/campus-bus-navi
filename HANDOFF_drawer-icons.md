# 実装指示書: ドロワーメニューのアイコンを独自 SVG に置き換える

- 対象リポジトリ: `campus-bus-navi`
- 作業ブランチ: `sandbox`（`main` へ直接 push しない。PR を作成し Nano がレビュー・マージ）
- 実装者: Claude Code
- 設計確定日: 2026-07-25

---

## 0. 概要

`DrawerMenu` の 8 項目で使っているシステム絵文字（🏫 🚶 🚉 💻 📢 ⚙️ ❓ 🔄）を、
自作の SVG ラインアイコンに置き換える。デザインは確定済みで、**このドキュメントに書かれた
パスデータをそのまま使うこと**（形の作り直し・調整は不要かつ禁止）。

あわせて、現在ハードコードされているアイコンタイルの背景色（`#ede9fe` 等）を
CSS カスタムプロパティ化し、ダークテーマで適切な色に切り替わるようにする。

### なぜ絵文字をやめるのか（背景・実装時の判断材料）

- 絵文字は端末 / OS バージョンごとに字形も色も変わるため、アプリ側でデザインを確定できない。
- Windows と iOS で見え方が大きく違い、実機確認のコストが高い。
- 絵文字は色を持つため、ダークテーマでの調和を制御できない。

---

## 1. スコープ

### やること

1. 新規ファイル `src/components/DrawerIcons.tsx` を追加（8 個のアイコンコンポーネント）
2. `src/index.css` にアイコン配色の CSS 変数を追加（ライト / ダーク）
3. `src/components/DrawerMenu.tsx` を改修（`icon` を `ReactNode` 化、`iconBg` を `tone` 化）

### やらないこと（今回のスコープ外）

- `src/components/SettingsScreen.tsx` の `SettingRow` の絵文字（別途対応。**今回は触らない**）
- `src/App.tsx` のハンバーガーボタン（3 本線）のデザイン変更
- 未読インジケーター（A4 / B4 / C1）の仕様変更
- タイルサイズ・角丸・行の余白などレイアウト値の変更

---

## 2. 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `src/components/DrawerIcons.tsx` | 新規 | アイコン 8 個 + `IconTone` 型 |
| `src/index.css` | 追記 | `:root` と `.dark` にアイコン配色変数 16 組 |
| `src/components/DrawerMenu.tsx` | 変更 | import / `LINKS` / `DrawerItemProps` / タイル描画 / 各 `DrawerItem` 呼び出し |
| `package.json` | 任意 | `version` を patch bump（表示上の `ver` 更新のみ。判断は Nano） |

---

## 3. 新規ファイル: `src/components/DrawerIcons.tsx`

以下を**そのまま**新規作成すること。パスの数値は最適化済みなので変更しない。

```tsx
import type { SVGProps } from 'react'

/**
 * ドロワーメニュー用アイコン（ラインスタイル）
 *
 * 設計ルール（変更禁止）:
 * - viewBox は 24×24 固定。既定表示サイズは 20×20。
 * - 線幅 1.7 / linecap・linejoin ともに round。
 * - 色は必ず currentColor。呼び出し側が親要素の `color` で指定する。
 * - 装飾目的のため aria-hidden。項目名はテキストで併記されている。
 */

/** アイコンタイルの配色トークン。index.css の --icon-*-bg / --icon-*-fg と対応する。 */
export type IconTone =
  | 'violet'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'amber'
  | 'indigo'
  | 'slate'
  | 'red'

function Base({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 大学ホームページ: 学士帽 */
export function IconGradCap(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M2.4 9.1 12 5.1l9.6 4-9.6 4z" />
      <path d="M6.5 11.05v4.6c0 1.6 2.5 2.85 5.5 2.85s5.5-1.25 5.5-2.85v-4.6" />
      <path d="M20.6 9.55v5" />
      <circle cx="20.6" cy="16" r="1.35" />
    </Base>
  )
}

/** 通学情報: バス停標識 */
export function IconBusStop(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.4" y="2.6" width="17.2" height="8.6" rx="2.2" />
      <path d="M6.6 5.6h10.8" />
      <path d="M6.6 8.2h6.4" />
      <path d="M12 11.4v9.4" />
      <path d="M8.8 20.8h6.4" />
    </Base>
  )
}

/** JR松永駅時刻表: 車両の正面 */
export function IconTrain(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="4.6" y="2.9" width="14.8" height="15.1" rx="3.4" />
      <rect x="7.1" y="5.7" width="9.8" height="5.1" rx="1.3" />
      {/* 前照灯は塗り。線画のままだと 20px で潰れるため意図的に fill にしている */}
      <circle cx="8.5" cy="14.3" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14.3" r="1.05" fill="currentColor" stroke="none" />
      <path d="M8.8 18 6.4 21.3" />
      <path d="M15.2 18l2.4 3.3" />
    </Base>
  )
}

/** サークルホームページ: ノートPC + コード記号 */
export function IconLaptopCode(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.7" y="4.3" width="16.6" height="11.2" rx="2" />
      <path d="M2.1 18.7h19.8" />
      <path d="M9.7 7.9 7.5 9.9l2.2 2" />
      <path d="M14.3 7.9l2.2 2-2.2 2" />
    </Base>
  )
}

/** お知らせ: メガホン */
export function IconMegaphone(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4.9 9.9 14.2 5.4v13.2L4.9 14.1z" />
      <rect x="1.9" y="9.7" width="3" height="4.6" rx="1.4" />
      <path d="M17.2 8.7a5.2 5.2 0 0 1 0 6.6" />
      <path d="M19.8 6.3a8.6 8.6 0 0 1 0 11.4" />
    </Base>
  )
}

/**
 * 設定: 歯車（6歯）
 *
 * 歯先 R=9.9 / 歯元 r=6.7 / 歯先半角 9° / 歯元半角 13° を 30° 回転させ、
 * 真上（270°）と真下（90°）に歯の中心が来るようにしたもの。
 * 6 歯なのは、8 歯だと 20px 表示で歯の谷が線幅に埋もれて円に見えてしまうため。
 * このパスは計算生成物なので手で書き換えないこと。
 */
export function IconGear(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M16.90 16.57A6.7 6.7 0 0 1 13.51 18.53L13.55 21.78A9.9 9.9 0 0 1 10.45 21.78L10.49 18.53A6.7 6.7 0 0 1 7.10 16.57L4.31 18.23A9.9 9.9 0 0 1 2.76 15.55L5.59 13.96A6.7 6.7 0 0 1 5.59 10.04L2.76 8.45A9.9 9.9 0 0 1 4.31 5.77L7.10 7.43A6.7 6.7 0 0 1 10.49 5.47L10.45 2.22A9.9 9.9 0 0 1 13.55 2.22L13.51 5.47A6.7 6.7 0 0 1 16.90 7.43L19.69 5.77A9.9 9.9 0 0 1 21.24 8.45L18.41 10.04A6.7 6.7 0 0 1 18.41 13.96L21.24 15.55A9.9 9.9 0 0 1 19.69 18.23L16.90 16.57Z" />
      <circle cx="12" cy="12" r="2.9" />
    </Base>
  )
}

/** ヘルプ: ? */
export function IconHelp(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.5a2.65 2.65 0 1 1 3.55 2.5c-.9.35-.95 1.05-.95 1.8v.4" />
      <circle cx="12" cy="16.7" r="1.05" fill="currentColor" stroke="none" />
    </Base>
  )
}

/** アプリの初期化: 円環矢印 */
export function IconReset(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M18.28 6.73A8.2 8.2 0 1 1 12 3.8" />
      <path d="M8.7 1.6 12 3.8 8.7 6" />
    </Base>
  )
}
```

---

## 4. `src/index.css` への追記

**既存の `:root { … }` ブロックの末尾**に以下を追記する（ブロックを新設しないこと）。

```css
  /* ── ドロワーメニューのアイコン配色 ──
     bg = タイル背景 / fg = アイコンの線色（currentColor で参照される）
     DrawerIcons.tsx の IconTone と 1:1 で対応する。 */
  --icon-violet-bg: #ede9fe;  --icon-violet-fg: #7c3aed;
  --icon-blue-bg:   #dbeafe;  --icon-blue-fg:   #2563eb;
  --icon-green-bg:  #dcfce7;  --icon-green-fg:  #16a34a;
  --icon-yellow-bg: #fef9c3;  --icon-yellow-fg: #ca8a04;
  --icon-amber-bg:  #fef3c7;  --icon-amber-fg:  #d97706;
  --icon-indigo-bg: #f0f4ff;  --icon-indigo-fg: #4f46e5;
  --icon-slate-bg:  #f4f4f8;  --icon-slate-fg:  #64748b;
  --icon-red-bg:    #fef2f2;  --icon-red-fg:    #ef4444;
```

**既存の `.dark { … }` ブロックの末尾**に以下を追記する。

```css
  /* ── ドロワーメニューのアイコン配色（ダーク）──
     淡いパステルはダーク背景で浮くため、fg を明度の高い同系色にし、
     bg はその色の 16% 透過にして地の色と馴染ませる。 */
  --icon-violet-bg: rgba(167, 139, 250, 0.16);  --icon-violet-fg: #a78bfa;
  --icon-blue-bg:   rgba(96, 165, 250, 0.16);   --icon-blue-fg:   #60a5fa;
  --icon-green-bg:  rgba(74, 222, 128, 0.16);   --icon-green-fg:  #4ade80;
  --icon-yellow-bg: rgba(250, 204, 21, 0.16);   --icon-yellow-fg: #facc15;
  --icon-amber-bg:  rgba(251, 191, 36, 0.16);   --icon-amber-fg:  #fbbf24;
  --icon-indigo-bg: rgba(129, 140, 248, 0.16);  --icon-indigo-fg: #818cf8;
  --icon-slate-bg:  rgba(148, 163, 184, 0.16);  --icon-slate-fg:  #94a3b8;
  --icon-red-bg:    rgba(248, 113, 113, 0.16);  --icon-red-fg:    #f87171;
```

`@theme` ブロックには追加しない（Tailwind のユーティリティとして使う予定はないため）。

---

## 5. `src/components/DrawerMenu.tsx` の差分

### 5-1. import

**before**

```tsx
import { useEffect } from 'react'
```

**after**

```tsx
import { useEffect, type ReactNode } from 'react'
import {
  IconGradCap,
  IconBusStop,
  IconTrain,
  IconLaptopCode,
  IconMegaphone,
  IconGear,
  IconHelp,
  IconReset,
  type IconTone,
} from './DrawerIcons'
```

### 5-2. `LINKS`

`icon` を JSX 要素に、`bg`（生の hex）を `tone` に置き換える。**URL・title・sub は一切変更しない。**

**before**

```tsx
const LINKS = [
  { icon: '🏫', title: '大学ホームページ', sub: 'fukuyama-u.ac.jp', bg: '#ede9fe', url: 'https://www.fukuyama-u.ac.jp/' },
  { icon: '🚶', title: '通学情報', sub: 'スクールバス、駐車場・駐輪場', bg: '#dbeafe', url: 'https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/' },
  { icon: '🚉', title: 'JR松永駅時刻表', sub: '糸崎・三原方面 / 岡山・福山方面', bg: '#dcfce7', url: 'https://transit.yahoo.co.jp/timetable/27407' },
  { icon: '💻', title: 'サークルホームページ', sub: 'fukupro.club',  bg: '#fef9c3', url: 'https://www.fukupro.club/' },
]
```

**after**

```tsx
const LINKS: { icon: ReactNode; tone: IconTone; title: string; sub: string; url: string }[] = [
  { icon: <IconGradCap />,   tone: 'violet', title: '大学ホームページ', sub: 'fukuyama-u.ac.jp', url: 'https://www.fukuyama-u.ac.jp/' },
  { icon: <IconBusStop />,   tone: 'blue',   title: '通学情報', sub: 'スクールバス、駐車場・駐輪場', url: 'https://www.fukuyama-u.ac.jp/campuslife/student-affairs/attending-school/' },
  { icon: <IconTrain />,     tone: 'green',  title: 'JR松永駅時刻表', sub: '糸崎・三原方面 / 岡山・福山方面', url: 'https://transit.yahoo.co.jp/timetable/27407' },
  { icon: <IconLaptopCode />, tone: 'yellow', title: 'サークルホームページ', sub: 'fukupro.club', url: 'https://www.fukupro.club/' },
]
```

### 5-3. `DrawerItem` の呼び出し 5 箇所

`iconBg="…"` を `tone="…"` に、`icon="絵文字"` を `icon={<IconXxx />}` に置き換える。
`showDot` / `titleColor` / `chevron` / `onClick` は現状のまま。

| 項目 | before | after |
|---|---|---|
| リンク（map 内） | `icon={link.icon} iconBg={link.bg}` | `icon={link.icon} tone={link.tone}` |
| お知らせ | `icon="📢" iconBg="#fef3c7"` | `icon={<IconMegaphone />} tone="amber"` |
| 設定 | `icon="⚙️" iconBg="#f0f4ff"` | `icon={<IconGear />} tone="indigo"` |
| ヘルプ | `icon="❓" iconBg="#f4f4f8"` | `icon={<IconHelp />} tone="slate"` |
| アプリの初期化 | `icon="🔄" iconBg="#fef2f2"` | `icon={<IconReset />} tone="red"` |

### 5-4. `DrawerItemProps`

**before**

```tsx
interface DrawerItemProps {
  icon: string
  iconBg: string
  title: string
  sub: string
  chevron?: string
  onClick?: () => void
  titleColor?: string
  showDot?: boolean   // 未読インジケーター表示（お知らせ項目のみ true）
}

function DrawerItem({ icon, iconBg, title, sub, chevron, onClick, titleColor, showDot }: DrawerItemProps) {
```

**after**

```tsx
interface DrawerItemProps {
  icon: ReactNode
  tone: IconTone
  title: string
  sub: string
  chevron?: string
  onClick?: () => void
  titleColor?: string
  showDot?: boolean   // 未読インジケーター表示（お知らせ項目のみ true）
}

function DrawerItem({ icon, tone, title, sub, chevron, onClick, titleColor, showDot }: DrawerItemProps) {
```

### 5-5. アイコンタイルの描画

`fontSize: 17`（絵文字用）を削除し、背景色と線色を CSS 変数から引く。
**幅・高さ・角丸（36 / 36 / 11）は変更しない。** ここを変えると未読ドットの
`top: -3 / right: -3` の見え方がずれる。

**before**

```tsx
<div style={{ width: 36, height: 36, borderRadius: 11, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
  {icon}
</div>
```

**after**

```tsx
{/* アイコンの色は currentColor 経由で子の <svg> に渡る。
    テーマ切替時のちらつきを避けるため、行の背景（0.35s）と同じ時間で遷移させる。 */}
<div
  style={{
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: `var(--icon-${tone}-bg)`,
    color: `var(--icon-${tone}-fg)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background-color 0.35s, color 0.35s',
  }}
>
  {icon}
</div>
```

---

## 6. 設計意図・変更してはいけない数値

| 値 | 理由 |
|---|---|
| `viewBox="0 0 24 24"` / 表示 20×20 | 8 個の光学サイズを揃えるための共通グリッド |
| `strokeWidth={1.7}` | 20px 実寸で線が細すぎず、歯車の谷が潰れない上限 |
| `strokeLinecap/Linejoin="round"` | 8 個の端部処理の統一。角丸タイルとの相性 |
| 歯車が 6 歯であること | 8 歯だと 20px で歯の谷（約 2.3px）が線幅 1.42px に埋もれ、円に見える |
| 歯車の 30° 回転 | 真上・真下に歯の中心を置くための回転。パスに焼き込み済み |
| 電車の前照灯・ヘルプの点が `fill` | 半径 1.05 の円を線で描くと 20px では黒点に潰れるため、意図的に塗り |
| タイル 36×36 / 角丸 11 | 既存レイアウトと未読ドット位置の前提 |

---

## 7. 受け入れ基準

1. ドロワーの 8 項目すべてが SVG アイコンで表示され、ソース中に該当の絵文字が残っていない
2. ライトテーマで、タイル背景・線色が現行のパステル配色と同等に見える
3. ダークテーマで、タイルが半透明の同系色になり、線色が明るい同系色に切り替わる
4. 設定 → カラーテーマ → 「システム」で、OS のライト / ダーク切替に追従して色が変わる
5. アイコンタイルのサイズ・行の高さ・区切り線の位置が現行から 1px も動いていない
6. 「お知らせ」の未読ドット（パルスリング + 行背景色フチ）が従来どおり右上に出る
7. `npx tsc --noEmit` がエラー 0
8. `npm run build` が成功する
9. スクリーンリーダーで各行が「大学ホームページ、fukuyama-u.ac.jp」のように読まれ、
   アイコンが読み上げに混ざらない（`aria-hidden="true"` が効いている）

---

## 8. 触ってはいけないもの

- `vite.config.ts`（特に `workbox.globIgnores: ['data/**/*.json']`）
- `index.html` の viewport（`shrink-to-fit=no`）とテーマ初期化インラインスクリプト
- `src/main.tsx` の `syncBpActiveClass`（`screen.*` を使った多重シグナル判定）
- `src/hooks/useJSTClock.ts` の可視性復帰時の再同期処理
- SW の skip-waiting リロードフロー、`handleInitApp` の完全リセット
- `window.location.reload()` を新たに追加しないこと
- 未読インジケーターの実装（`unread-pulse-ring`、`top/right: -3`、`boxShadow`）
- `src/components/SettingsScreen.tsx`（今回はスコープ外）
- `public/data/` 配下すべて
- `DrawerMenu` のスクロール領域の `overscrollBehavior: 'contain'` と
  `minHeight: 'calc(100% + 1px)'`

---

## 9. ローカル検証手順（Windows 11 / PowerShell）

```powershell
# 1. 型チェック
npx tsc --noEmit

# 2. 開発サーバー
npm run dev
```

`http://localhost:5173` で以下を確認する。

1. ハンバーガーを開き、8 項目すべてのアイコンを目視
2. 設定 → カラーテーマ → ダーク に切り替え、ドロワーを再度開いて配色を確認
3. 設定 → カラーテーマ → システム にして、OS 側のダークモードを切り替え、追従を確認
4. DevTools のデバイスツールバーで iPhone SE 相当（375px 幅）にし、
   **ブラウザのズームを 100% のまま**アイコンが潰れていないか確認
   （特に歯車の歯の谷と、電車の前照灯 2 点）
5. 未読のお知らせがある状態にして、ドロワーの「お知らせ」に未読ドットが出ることを確認

```powershell
# 3. 本番ビルド + SW 込みの確認
npm run build
npm run preview
```

### 実機確認（Nano が担当）

`sandbox` ブランチへ push 後、Cloudflare Pages のプレビュー URL を iOS / Android の実機で開き、
20px 実寸での可読性を確認する。**歯車の 6 歯が歯車として読めるか**が最大の確認ポイント。

---

## 10. 申し送り（今回は対応しないが把握しておくこと）

1. **`SettingsScreen` の `SettingRow` は絵文字のまま**になる。タイルが 34×34 / 角丸 10 と
   ドロワー（36 / 11）で異なるため、統一するなら別タスクで寸法方針から決める。
2. **ダークテーマでの「アプリの初期化」の色ずれ**: タイトルの `titleColor="#ef4444"` は
   ハードコードのままなので、ダークではアイコン（`#f87171`）とわずかに色が違う。
   気になる場合は `--icon-red-fg` を流用する形に寄せられるが、今回は現状維持とする。
3. `package.json` の `version` を上げるかは Nano の判断。上げなくても JS バンドルの
   ハッシュは変わるため更新検知は働く。ドロワー最下部の `ver` 表示だけが変わる。
