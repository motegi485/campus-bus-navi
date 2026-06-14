# UNREAD_INDICATOR_DESIGN.md — お知らせ未読インジケーター デザイン仕様

未読のお知らせがあるときに、3つの導線へ未読インジケーターを追加する。本書は **見た目と差し込み位置のデザイン仕様** のみを定義する。

## このドキュメントの範囲

- **対象（本書で確定）**: 各インジケーターの色・形・サイズ・配置位置・既存マークアップへの差し込み方。
- **スコープ外（＝Claude Code 側で設計・実装）**: 未読の判定ロジック、`useNews` の配置（App.tsx への持ち上げ等）、状態の受け渡し、`localStorage` まわり。

本書では表示条件を次の2つの真偽値として **参照するだけ** で、その導出方法は規定しない。実装側で用意・命名すること。

- `hasUnread` … 未読のお知らせが1件以上あるか（ハンバーガーボタン・ドロワー項目で使用）
- `isUnread` … その個別のお知らせが未読か（カードで使用。`NewsScreen` には既存の per-item フラグがある）

確定した3パターン:

| ID | 場所 | 表現 |
|----|------|------|
| A1 | ハンバーガーボタン | コーナードット（白フチ） |
| B4 | ドロワー内「お知らせ」項目 | アイコンタイル右上のドット |
| C1 | お知らせカード | 左ボーダー＋「未読」ピル（塗り） |

---

## 共通デザイントークン

- **未読アクセント色**: `#0ea5e9`（スカイ）。次の4箇所で **同一色** を使う。
  1. ハンバーガーボタンのドット
  2. ドロワー項目のドット
  3. カードの左ボーダー
  4. カードの「未読」ピル背景
- **ドット標準サイズ**: 直径 `11px` / フチ（`box-shadow` リング）`2px`。
- **既存トークン（参考・変更しない）**: 行/カード背景 `var(--bg-card)`、文字色 `var(--text-primary | --text-secondary | --text-muted)`、「お知らせ」タグ `bg #dbeafe` / `color #2563eb`。

> スカイ `#0ea5e9` は緑（大学発）・紫（松永発）どちらのヘッダー上でも、白フチを併用することで確実に分離する。カード・ドロワー（白／ダーク背景）でも視認性は問題ない。

---

## 1. ハンバーガーボタン — A1：コーナードット（白フチ）

- **対象ファイル**: `src/App.tsx`（ヘッダー内のハンバーガーボタン）
- **見た目**: ボタンの右上に水色ドット。フチは**白固定**。
- **フチを白固定にする理由**: ヘッダーは緑／紫の有色グラデーションで、ライト・ダークいずれでも有色。白フチが最も安定して分離する（テーマ変数にしない）。
- **配置**: ボタンを `position: relative` のラッパーで包み、ドットを絶対配置の兄弟要素として追加する。`flexShrink: 0` はラッパー側へ移す。
- **表示条件**: `hasUnread` のときのみ（条件は実装側）。
- **アクセシビリティ**: ドットは `aria-hidden`。代わりに未読時はボタンの `aria-label` を `メニューを開く（未読のお知らせがあります）` にする（**文言は本書で指定／切替条件は実装側**）。

**Before**
```jsx
{/* ハンバーガーボタン */}
<button
  onClick={() => setDrawerOpen(true)}
  aria-label="メニューを開く"
  className="flex flex-col gap-[4.5px] items-center justify-center bg-white/[0.26] dark:bg-black/25"
  style={{ width: 43, height: 43, borderRadius: '50%', flexShrink: 0 }}
>
  <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
  <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
  <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
</button>
```

**After**
```jsx
{/* ハンバーガーボタン */}
<div style={{ position: 'relative', flexShrink: 0 }}>
  <button
    onClick={() => setDrawerOpen(true)}
    aria-label={hasUnread ? 'メニューを開く（未読のお知らせがあります）' : 'メニューを開く'}
    className="flex flex-col gap-[4.5px] items-center justify-center bg-white/[0.26] dark:bg-black/25"
    style={{ width: 43, height: 43, borderRadius: '50%' }}
  >
    <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
    <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
    <div style={{ width: 16, height: 1.8, background: '#fff', borderRadius: 2 }} />
  </button>

  {/* 未読インジケーター（表示条件 hasUnread は実装側） */}
  {hasUnread && (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute', top: -1, right: -1,
        width: 11, height: 11, borderRadius: '50%',
        background: '#0ea5e9', boxShadow: '0 0 0 2px #fff',
      }}
    />
  )}
</div>
```

---

## 2. ドロワー内「お知らせ」項目 — B4：アイコン角ドット

- **対象ファイル**: `src/components/DrawerMenu.tsx`（`DrawerItem` のアイコンタイル）
- **見た目**: 📢タイルの右上に水色ドット。フチは **`var(--bg-card)`**（行の背景色）。
- **フチを `var(--bg-card)` にする理由**: 暖色のタイル（`#fef3c7`）と行背景の双方からドットを切り抜くように分離でき、ライト／ダークに自動追従する。
- **構造**: `DrawerItem` のアイコン用 `div` を `position: relative` のラッパーで包み、ドットを絶対配置で追加。汎用コンポーネントなので、**表示可否を渡す任意プロパティ**（例 `showDot?: boolean`）を追加し、「お知らせ」項目のみ有効にする。プロパティ名・受け渡しは実装側裁量。
- **表示条件**: 「お知らせ」項目かつ `hasUnread` のとき（条件は実装側）。
- **アクセシビリティ**: ドットは `aria-hidden`。

**Before（props 定義）**
```ts
interface DrawerItemProps {
  icon: string
  iconBg: string
  title: string
  sub: string
  chevron?: string
  onClick?: () => void
  titleColor?: string
}
```

**After（props 定義に任意フラグを追加）**
```ts
interface DrawerItemProps {
  icon: string
  iconBg: string
  title: string
  sub: string
  chevron?: string
  onClick?: () => void
  titleColor?: string
  showDot?: boolean   // 未読インジケーター表示（条件は実装側）
}
```

**Before（アイコンブロック）**
```jsx
<div style={{ width: 36, height: 36, borderRadius: 11, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
  {icon}
</div>
```

**After（アイコンブロック）**
```jsx
<div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
  <div style={{ width: 36, height: 36, borderRadius: 11, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
    {icon}
  </div>

  {/* 未読インジケーター（表示条件は実装側。お知らせ項目のみ showDot=true） */}
  {showDot && (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute', top: -3, right: -3,
        width: 11, height: 11, borderRadius: '50%',
        background: '#0ea5e9', boxShadow: '0 0 0 2px var(--bg-card)',
      }}
    />
  )}
</div>
```

**呼び出し箇所（お知らせ項目）**
```jsx
<DrawerItem icon="📢" iconBg="#fef3c7" title="お知らせ" sub="バス運行情報・重要連絡" chevron="›"
  showDot={hasUnread}   {/* hasUnread の供給は実装側 */}
  onClick={onOpenNews} />
```

---

## 3. お知らせカード — C1：左ボーダー＋「未読」ピル（塗り）

- **対象ファイル**: `src/components/NewsScreen.tsx`（リストのカード）
- **見た目の変更点**:
  1. 左ボーダー色を `#10b981` → **`#0ea5e9`** に変更。
  2. タグの右隣に **「未読」ピル（塗り）** を追加。`bg #0ea5e9` / 文字 `#fff` / `fontSize 10` / `fontWeight 700` / `padding 3px 8px` / `borderRadius 20`。タグとの間隔は `gap 7`。
  3. 既存の **右下ドット（C0 由来）を削除** し、ピルへ置き換える。
- **ピルは必ず塗り（白文字）にする**: 「お知らせ」タグ自体が青パステル（`#dbeafe`/`#2563eb`）のため、ピルもパステルにすると “青いピルが2つ” に見えて状態とタグが混同する。塗りにすることで状態バッジとして分離する。
- **表示条件**: そのカードが未読のとき（`NewsScreen` に既存の per-item フラグあり。**値の扱い・導出は実装側**）。
- **アクセシビリティ**: `aria-label` は既存どおり、未読時に `（未読）` を付与する挙動を維持。

**Before（カード全体／関連部分）**
```jsx
<button
  type="button"
  key={item.id}
  onClick={() => openDetail(item)}
  aria-label={`${item.tagLabel} ${item.title}${isUnread ? '（未読）' : ''}`}
  style={{
    background: 'var(--bg-card)', borderRadius: 18, padding: '16px 18px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 8, width: '100%', textAlign: 'left', font: 'inherit',
    border: 'none', borderLeft: isUnread ? '4px solid #10b981' : '4px solid transparent',
  }}
>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
    <NewsTag tag={item.tag} tagLabel={item.tagLabel} />
    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.date}</span>
  </div>
  <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>{item.title}</p>
  <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
    {item.preview}
  </p>
  {isUnread && (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
    </div>
  )}
</button>
```

**After（カード全体／関連部分）**
```jsx
<button
  type="button"
  key={item.id}
  onClick={() => openDetail(item)}
  aria-label={`${item.tagLabel} ${item.title}${isUnread ? '（未読）' : ''}`}
  style={{
    background: 'var(--bg-card)', borderRadius: 18, padding: '16px 18px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 8, width: '100%', textAlign: 'left', font: 'inherit',
    border: 'none', borderLeft: isUnread ? '4px solid #0ea5e9' : '4px solid transparent',
  }}
>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
    {/* タグ ＋ 未読ピル */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <NewsTag tag={item.tag} tagLabel={item.tagLabel} />
      {isUnread && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#0ea5e9', color: '#fff' }}>
          未読
        </span>
      )}
    </div>
    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.date}</span>
  </div>
  <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>{item.title}</p>
  <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
    {item.preview}
  </p>
  {/* 旧 C0 の右下ドットは削除（ピルへ置換） */}
</button>
```

> `isUnread` の導出は実装側（既存の per-item フラグを使用、または再設計）。本書は上記のとおり、左ボーダー色・未読ピルの見た目・差し込み位置のみを定める。

---

## ライト／ダーク・ヘッダー色での見え方（分離の担保）

| 要素 | 背景 | フチ | 分離の仕方 |
|------|------|------|------------|
| A1 ボタンドット | 緑／紫ヘッダー（有色・テーマ非依存） | 白固定 `#fff` | 白フチで両ヘッダーから分離 |
| B4 ドロワードット | `var(--bg-card)` × 暖色タイル | `var(--bg-card)` | 行背景色のフチでタイル・行から切り抜き、テーマ追従 |
| C1 左ボーダー／ピル | `var(--bg-card)`（白／ダーク） | なし | `#0ea5e9` が白・ダーク双方で視認可。ピルは塗り＋白文字 |

---

## 受け入れ条件（見た目）

- [ ] 未読あり時、ハンバーガーボタン右上に白フチの水色ドットが出る。緑・紫ヘッダー双方で視認できる。
- [ ] 未読あり時、ドロワーの「お知らせ」項目の📢タイル右上に水色ドットが出る。ライト・ダーク双方で視認できる。
- [ ] 未読のお知らせカードは、左ボーダーが水色（`#0ea5e9`・4px）になり、タグの右隣に塗りの「未読」ピル（水色背景・白文字）が出る。
- [ ] 既存の右下ドット（C0 由来）は表示されない。
- [ ] 既読になった項目はピル・ボーダー強調が消え、すべて既読になればボタン／ドロワーのドットも消える（状態遷移として成立すること。条件導出は実装側）。
- [ ] ライト／ダーク、緑／紫ヘッダーのいずれでもレイアウト崩れ・視認性低下がない。

## 備考

- A1・B4 は「件数」ではなく「未読の有無」を示すドット。桁あふれ（9+ 等）の考慮は不要。
- ドット 11px・フチ 2px・ピル `fontSize 10` / `radius 20` は、既存のタグや「近日公開」ピルとサイズ感を揃えている。
- 変更対象は `src/App.tsx`・`src/components/DrawerMenu.tsx`・`src/components/NewsScreen.tsx` の3ファイルのみ。新規ファイルは作らない。`vite.config.ts` 等の保護対象は触らない。
