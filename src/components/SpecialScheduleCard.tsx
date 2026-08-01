import { SCHOOL_BUS_INFO_URL } from '../constants/links'

interface Props {
  /** オフラインだとリンク先を開けないため、その旨を添える */
  isOnline: boolean
}

/**
 * 既定の時刻表フォーマットで表現できないダイヤの日に、次発カードの代わりに表示するカード。
 *
 * 例: お盆期間（運休日と通常日が混在し、「大学発のみ最終便が変わる」といった
 * 但し書きが付く）。こうした掲示は松永発の扱いが書かれていないことが多く、
 * 推測で埋めると「大学へは行けるが帰れない」時刻を表示しかねない。
 * そのため時刻は一切出さず、大学の掲示そのものへ誘導する。
 */
export function SpecialScheduleCard({ isOnline }: Props) {
  return (
    <div
      className="rounded-[22px] px-6 py-[22px] text-white"
      style={{ background: 'linear-gradient(135deg, #7e22ce, #a855f7)' }}
    >
      <p className="text-[13px] font-bold tracking-widest uppercase text-white/75 mb-[5px]">
        次のバス
      </p>
      <p className="text-[34px] font-black text-white tracking-tight leading-tight mb-[10px]">
        特別な運行日程
      </p>
      <p className="text-[15px] text-white/90 font-semibold leading-relaxed mb-[18px]">
        本日の発車時刻は特別な日程になっています。大学ホームページでご確認ください。
      </p>

      <a
        href={SCHOOL_BUS_INFO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-[6px] bg-white/20 rounded-[16px] px-4 py-[14px]"
        style={{ textDecoration: 'none' }}
      >
        <span className="text-[15px] font-bold text-white">大学ホームページで確認</span>
        <span aria-hidden="true" className="text-[14px] text-white/80">↗</span>
      </a>

      {!isOnline && (
        <p className="text-[12px] text-white/70 mt-3 text-center">
          オフラインのため、リンクを開くには通信が必要です
        </p>
      )}
    </div>
  )
}
