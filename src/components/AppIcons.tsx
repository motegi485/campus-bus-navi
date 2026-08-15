import type { ReactElement, SVGProps } from 'react'

/**
 * アプリ共通アイコン（ラインスタイル）
 * ドロワーメニューと設定画面で使用する。
 *
 * 設計ルール（変更禁止）:
 * - viewBox は 24×24 固定。既定表示サイズは 20×20。
 * - 線幅 1.7 / linecap・linejoin ともに round。
 * - 色は必ず currentColor。呼び出し側が親要素の `color` で指定する。
 * - 装飾目的のため aria-hidden。項目名はテキストで併記されている。
 */

/**
 * アイコンコンポーネントの型。
 * 表示サイズは画面ごとに違う（ドロワー 20px / 設定 19px）ため、
 * 呼び出し側が要素ではなく「関数そのもの」を受け取ってサイズを指定できるようにしている。
 */
export type AppIcon = (props: SVGProps<SVGSVGElement>) => ReactElement

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
  | 'pink'

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
 * 週間ダイヤ: カレンダーと 1 週間分の帯
 *
 * 日付を升目で埋めると月表示のアイコンになってしまうため、本体の中央に
 * 横一列の刻みだけを置いて「1 週間」を表す。3 つなのは 20px 表示で
 * 4 つ以上にすると刻みの間隔が線幅に埋もれるため。
 */
export function IconCalendarWeek(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.2" y="4.4" width="17.6" height="16" rx="2.6" />
      <path d="M3.2 9.6h17.6" />
      <path d="M8 2.6v3.6" />
      <path d="M16 2.6v3.6" />
      <path d="M6.8 15h2.2" />
      <path d="M10.9 15h2.2" />
      <path d="M15 15h2.2" />
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

/* ========================================================================
   設定画面（SettingsScreen）で使うアイコン
   ====================================================================== */

/** デフォルトルート: 往復矢印（大学発 / 松永発の 2 方向） */
export function IconRouteSwap(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M3.6 8.8h13.2" />
      <path d="M13.6 5.4 17 8.8l-3.4 3.4" />
      <path d="M20.4 15.2H7.2" />
      <path d="M10.4 11.8 7 15.2l3.4 3.4" />
    </Base>
  )
}

/**
 * カラーテーマ: コントラスト円
 *
 * 右半分の塗り（r=8.7）は外周線（r=9・線幅 1.7 なので 8.15〜9.85 を占める）に
 * わずかに食い込ませてある。ここを 9 未満に下げると塗りと線の間に隙間が出る。
 */
export function IconContrast(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3.3a8.7 8.7 0 0 1 0 17.4z" fill="currentColor" stroke="none" />
    </Base>
  )
}

/** フォントサイズ: 大小の A（ベースラインを y=19.4 に揃えてある） */
export function IconFontSize(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M3.4 19.4 6.2 12.4l2.8 7" />
      <path d="M4.4 16.9h3.6" />
      <path d="M11.8 19.4 16.4 5.4l4.6 14" />
      <path d="M13.2 15.2h6.4" />
    </Base>
  )
}

/** 発車リマインダー: ベル */
export function IconBell(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M17.8 11.9a5.8 5.8 0 1 0-11.6 0c0 4.6-1.9 6.2-1.9 6.2h15.4c0 0-1.9-1.6-1.9-6.2z" />
      <path d="M12 6.1V4.3" />
      <path d="M10.3 18.9a1.9 1.9 0 0 0 3.4 0" />
    </Base>
  )
}

/**
 * バージョン: 情報（i）
 *
 * IconHelp（丸＋?）と外形が同じなのは承知のうえでの選択。
 * 使う画面が違うため統一・差別化の変更はしないこと。
 */
export function IconInfo(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.6v-5.2" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </Base>
  )
}
