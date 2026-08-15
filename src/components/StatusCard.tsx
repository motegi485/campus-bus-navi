import type dayjs from 'dayjs'
import type { HiddenTimesStatus } from '../utils/deriveDataStatus'
import { formatFetchedAt } from '../utils/formatFetchedAt'
import { SCHOOL_BUS_INFO_URL, FEEDBACK_URL } from '../constants/links'
import { StatusIcon, RetryButton } from './StatusParts'

interface Props {
  /** 時刻を出せない 3 状態のみを受ける */
  status: HiddenTimesStatus
  isOnline: boolean
  fetchedAt: number | null
  now: dayjs.Dayjs
  refreshing: boolean
  onRetry: () => void
  /** 取得に失敗したときの生メッセージ（no-data で報告の手掛かりとして出す） */
  errorMessage?: string | null
}

/**
 * 時刻を出せない状態に出すカード。この 3 状態ではカードが画面の主役なので、
 * 全幅のカードで伝える。時刻を出せる状態（オフライン・取得失敗）は主役が時刻の側なので
 * StatusBand が担当する。
 *
 * 器（背景・境界・影・角丸・余白）は既存の 2 種類をそのまま使う。影・境界・稜線は
 * index.css の .section-card が単一の真実源なので、ここでは書き足さない。
 */
export function StatusCard({
  status,
  isOnline,
  fetchedAt,
  now,
  refreshing,
  onRetry,
  errorMessage,
}: Props) {
  const isError = status === 'no-data'
  const stamp = fetchedAt !== null ? formatFetchedAt(fetchedAt, now) : null

  return (
    <div
      className={isError ? 'rounded-[20px] p-5 text-center' : 'section-card rounded-[20px] p-5 text-center'}
      style={
        isError
          ? {
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              // 縁は専用の赤を保ちつつ、浮き方だけ他のカードと揃える
              boxShadow: 'var(--card-shadow)',
            }
          : undefined
      }
    >
      <div className="flex flex-col items-center gap-2">
        <div className="mb-0.5">
          <StatusIcon status={status} />
        </div>

        <p className="text-[14px] font-bold leading-normal" style={{ color: 'var(--text-primary)' }}>
          {status === 'no-data' ? '時刻表を取得できませんでした' : '日付が変わりました'}
        </p>

        {/* 赤地では --text-secondary がライトで 4.29:1 と AA をわずかに割るため、
            この AA 問題のために用意された --chip-text（6.63:1）を使う */}
        <p
          className="text-[12px] leading-relaxed"
          style={{ color: isError ? 'var(--chip-text)' : 'var(--text-secondary)' }}
        >
          {status === 'no-data' && (
            <>
              通信環境をご確認のうえ、再試行してください。
              <br />
              大学ホームページでも時刻表をご確認いただけます。
            </>
          )}
          {status === 'refetching-stale' && '本日のダイヤを取得しています。'}
          {status === 'stale' && '本日のダイヤをまだ取得できていないため、時刻を表示していません。'}
        </p>

        {/* 取得時刻が不明なときは行ごと出さない（推測するより出さない） */}
        {stamp && (
          <p
            className="text-[12px] font-semibold tabular-nums"
            style={{ color: isError ? 'var(--chip-text)' : 'var(--text-secondary)' }}
          >
            {stamp}
          </p>
        )}

        {/* 取得中は進行を見せるだけでよく、押させる相手がいない */}
        {status !== 'refetching-stale' && (
          <RetryButton size="lg" refreshing={refreshing} onRetry={onRetry} />
        )}

        {status === 'no-data' && (
          <>
            <div className="flex flex-wrap justify-center gap-x-[18px] gap-y-1.5 mt-0.5">
              <a
                href={SCHOOL_BUS_INFO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-semibold"
                style={{
                  color: 'var(--chip-text)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--chip-border)',
                  paddingBottom: 1,
                }}
              >
                大学ホームページ ↗
              </a>
              <a
                href={FEEDBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-semibold"
                style={{
                  color: 'var(--chip-text)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--chip-border)',
                  paddingBottom: 1,
                }}
              >
                不具合を報告 ↗
              </a>
            </div>

            {!isOnline && (
              <p className="text-[11px]" style={{ color: 'var(--chip-text)' }}>
                オフラインのため、リンクを開くには通信が必要です
              </p>
            )}

            {/* 報告時の手掛かり。読ませる文ではないので最小サイズで置く */}
            {errorMessage && (
              <p className="text-[10.5px] leading-snug break-all" style={{ color: 'var(--text-muted)' }}>
                {errorMessage}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
