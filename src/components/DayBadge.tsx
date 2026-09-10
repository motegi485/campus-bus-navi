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
 * weekday の rgb(52,107,196) は改修たたき台の授業日ダイヤバッジと同値（原本が
 * 唯一描いている種別）。他の種別は原本に無いため、既存の値をそのまま踏襲する。
 *
 * 表現は改修たたき台に合わせてフラットな単色塗りにした（旧・ガラス風のグラデーション
 * ハイライト／二重リング／落ち影は廃止）。塗り自体の色は変えていないため、
 * 下記の「塗りそのもの」の実測値はそのまま有効。ハイライトが乗る位置の値
 * （このコメントでは省略）は廃止した表現のものなので、これ以上は参照しないこと。
 *
 * vacation_weekday / vacation_holiday だけは合成由来ではなく、直接選んだ不透明色。
 * 長期休暇のダイヤは中身が平日・休日と同じ運行なので、色も weekday / holiday の
 * 同系に寄せ、色相をずらして別種と分かるようにしている（ΔE*ab で weekday から 33、
 * holiday から 27。同系の deep blue / deep rose であって、別の色ではない）。
 *
 * ⚠️ 白文字に対するコントラスト（塗りそのもの）:
 *   weekday 5.19 ・ holiday 5.52 ・ vacation 2.73 ・
 *   vacation_weekday 5.78 ・ vacation_holiday 5.89 ・
 *   event 4.04 ・ closed 6.22 ・ special 5.36
 * 見た目を優先した配色で、WCAG AA の通常文字 4.5:1 を満たさない種別がある
 * （13px bold は large text の 3:1 の基準にも掛からない vacation のみ要注意）。
 *
 * 配色を変えるときは、必ずこの比を測り直すこと。
 * 詳細は docs/design-decisions.md の「色のコントラスト」を参照。
 */
const BADGE_MAP: Record<DiagramType, { label: string; rgb: string; color: string }> = {
  weekday:          { label: '授業日ダイヤ',          rgb: '52,107,196',  color: '#fff' },
  holiday:          { label: '休業日ダイヤ',          rgb: '185,61,65',   color: '#fff' },
  vacation:         { label: '長期休暇ダイヤ',        rgb: '193,151,17',  color: '#fff' },
  vacation_weekday: { label: '平日ダイヤ（長期休暇）', rgb: '15,109,148',   color: '#fff' },
  vacation_holiday: { label: '休日ダイヤ（長期休暇）', rgb: '178,51,103',   color: '#fff' },
  event:            { label: 'イベント日ダイヤ',       rgb: '199,98,30',   color: '#fff' },
  closed:           { label: '運休日',                rgb: '90,97,111',   color: '#fff' },
  special:          { label: '特別ダイヤ',            rgb: '136,75,203',  color: '#fff' },
}

export function DayBadge({ type }: Props) {
  const { label, rgb, color } = BADGE_MAP[type]
  return (
    <span
      className="flex items-center whitespace-nowrap"
      style={{
        gap: 4,
        fontSize: 11.5,
        fontWeight: 700,
        color,
        padding: '4px 8px',
        borderRadius: 9999,
        backgroundColor: `rgb(${rgb})`,
      }}
    >
      <span style={{ fontSize: 6 }}>●</span>
      {label}
    </span>
  )
}
