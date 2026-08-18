import type { DiagramType } from '../types/timetable'

// 種別の判定そのものは UI から独立した純関数として utils にある（server/ とも共有する）。
// 既存の import 元を壊さないよう、ここから再エクスポートする。
export { resolveDiagramType } from '../utils/diagramType'

interface Props {
  type: DiagramType
}

/**
 * バッジの配色。
 *
 * 半透明の明るい色（旧 `rgba(基色, 0.82〜0.9)`）を **ダーク面へ合成した結果** を、
 * そのまま 1 色として持つ。値は `rgba(基色, α - 0.08)` を `--bg-card`（ダーク）の
 * #1f2937 に合成したもの。ダークで見えていたはっきりした色をライトでも同じに出す、
 * というのが狙い。テーマでも行の面（--bg-card / --bg-card2）でも見えが変わらない。
 *
 * ガラス感は透過ではなく、上端の白いハイライト・内側の光のリング・同色の落ち影で作る。
 * バッジが載る面はべた塗りの単色なので、`backdrop-filter: blur()` を掛けても
 * 視覚的には何も変わらない。だから意図的に使っていない（合成レイヤだけが増える）。
 *
 * ⚠️ 白文字に対するコントラスト（上端のハイライトが最大の位置 / 塗りそのもの）:
 *   weekday 3.41/5.19 ・ holiday 3.72/5.52 ・ vacation 2.15/2.73 ・
 *   vacation_holiday 2.75/3.84 ・ event 2.91/4.04 ・ closed 3.77/6.22 ・ special 3.53/5.36
 * 見た目を優先した配色で、WCAG AA の通常文字 4.5:1 は満たさない（13px bold は
 * large text の 3:1 の基準にも掛からない）。旧・半透明時の 1.78〜3.60 よりは上がっている。
 *
 * 配色を変えるときは、必ずこの比を測り直すこと。
 * 詳細は docs/design-decisions.md の「色のコントラスト」を参照。
 */
const BADGE_MAP: Record<DiagramType, { label: string; rgb: string; color: string }> = {
  weekday:          { label: '授業日ダイヤ',          rgb: '52,107,196',  color: '#fff' },
  holiday:          { label: '休業日ダイヤ',          rgb: '185,61,65',   color: '#fff' },
  vacation:         { label: '長期休暇ダイヤ',        rgb: '193,151,17',  color: '#fff' },
  vacation_weekday: { label: '長期休暇ダイヤ（平日）', rgb: '193,151,17',  color: '#fff' },
  vacation_holiday: { label: '長期休暇ダイヤ（休日）', rgb: '171,121,13',  color: '#fff' },
  event:            { label: 'イベント日ダイヤ',       rgb: '199,98,30',   color: '#fff' },
  closed:           { label: '運休日',                rgb: '90,97,111',   color: '#fff' },
  special:          { label: '特別ダイヤ',            rgb: '136,75,203',  color: '#fff' },
}

/**
 * ダイヤ種別の代表色を返す。
 *
 * バッジ以外の表現（週間ダイヤの帯の色分けなど）から参照する用。BADGE_MAP を
 * 唯一の定義元にしておくことで、色を写し取った第二の定義が生まれないようにする。
 *
 * 参照先（WeekStrip の 5px の帯）は文字を載せない装飾なので、文字コントラストの
 * 要件は掛からない。種別の識別は同じ行の日付・曜日とバッジ本体が担う。
 */
export function badgeColor(type: DiagramType): string {
  return `rgb(${BADGE_MAP[type].rgb})`
}

export function DayBadge({ type }: Props) {
  const { label, rgb, color } = BADGE_MAP[type]
  return (
    <span
      className="text-[13px] font-bold px-[9px] py-[3px] rounded-[20px] flex items-center gap-1"
      style={{
        color,
        backgroundColor: `rgb(${rgb})`,
        // 上ほど白い＝ガラスの照り返し。塗りは不透明なので、面が変わっても見えは変わらない
        backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0))',
        boxShadow: [
          'inset 0 1px 0 rgba(255,255,255,0.5)',    // 上端の光
          'inset 0 0 0 1px rgba(255,255,255,0.28)', // 縁のリング
          `0 2px 6px -2px rgba(${rgb},0.55)`,       // 同色の落ち影
        ].join(', '),
        textShadow: '0 1px 1px rgba(0,0,0,0.18)',
      }}
    >
      <span style={{ fontSize: '7px' }}>●</span>
      {label}
    </span>
  )
}
