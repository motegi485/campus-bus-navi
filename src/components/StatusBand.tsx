import type dayjs from 'dayjs'
import type { DataStatus } from '../utils/deriveDataStatus'
import { formatFetchedAt } from '../utils/formatFetchedAt'
import { StatusIcon, RetryButton } from './StatusParts'

interface Props {
  /** 時刻を出せる 2 状態のみを受ける */
  status: Extract<DataStatus, 'offline' | 'fetch-failed'>
  fetchedAt: number | null
  now: dayjs.Dayjs
  refreshing: boolean
  onRetry: () => void
}

/**
 * 時刻を出したまま状態を伝える帯。ヘッダーと本文の境目に全幅で敷く。
 *
 * この 2 状態では発車時刻が画面の主役で、状態はそれを修飾する脇役になる。
 * StatusCard と同じフルカードを最上部に積むと主役より重く見えるため、
 * 角丸も影も持たない帯にしてカードの積み重ねには参加させない。
 *
 * 通常フローに置くので safe-area-inset-top・.header-cushion・iOS のネイティブバウンスとは
 * 干渉しない。帯の出入りで本文が上下するが、一度きりの移動なのでアニメーションは付けない。
 */
export function StatusBand({ status, fetchedAt, now, refreshing, onRetry }: Props) {
  const isError = status === 'fetch-failed'
  const stamp = fetchedAt !== null ? formatFetchedAt(fetchedAt, now) : null

  return (
    <div
      className="flex flex-wrap items-center gap-x-[11px] gap-y-2 px-4 py-[11px]"
      style={{
        background: isError ? 'rgba(239,68,68,0.1)' : 'var(--bg-card)',
        borderBottom: isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--card-border)',
        transition: 'background 0.35s',
      }}
    >
      <StatusIcon status={status} size={16} />

      <p className="flex-1 min-w-[130px] text-[12px] leading-normal">
        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
          {isError ? '時刻表を取得できませんでした' : 'オフラインです'}
        </span>
        {/* 取得時刻が不明なときは出さない（推測するより出さない）。
            赤地では --text-secondary が AA をわずかに割るため --chip-text を使う */}
        {stamp && (
          <span
            className="tabular-nums"
            style={{ color: isError ? 'var(--chip-text)' : 'var(--text-secondary)' }}
          >
            {'　'}
            {stamp}
          </span>
        )}
      </p>

      <RetryButton size="sm" refreshing={refreshing} onRetry={onRetry} />
    </div>
  )
}
