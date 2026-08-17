/**
 * 表示すべきデータ状態を 1 つに畳む。
 *
 * 以前は error の分岐と stale の分岐が独立していたため、日付跨ぎ＋取得失敗で
 * カードが 2 枚出ていた。上から順に判定し、最初に該当したものだけを返す。
 */
export type DataStatus =
  /** 一度も取得できていない。時刻を出さない */
  | 'no-data'
  /** 日付が変わり、当日分を取得中。時刻を出さない */
  | 'refetching-stale'
  /** 日付が変わったが当日分をまだ取得できていない。時刻を出さない */
  | 'stale'
  /** オフライン。前回取得分の時刻は出す */
  | 'offline'
  /** オンラインなのに取得できなかった。前回取得分の時刻は出す */
  | 'fetch-failed'
  /** 取得自体は成功したが、本文が古い（SW のキャッシュから返った）。時刻は出す */
  | 'stale-data'
  /** 正常。状態表示を描かない */
  | 'ok'

/**
 * 「取得できた」と言えなくなるまでの時間。
 *
 * SW の NetworkFirst はネットワークが 3 秒で応答しないと `timetable-data` キャッシュ
 * （最大 7 日保持）へ成功として落ちる。`navigator.onLine` が true で fetch も例外を
 * 投げないため、何もしないと**最大 7 日前のダイヤを通常表示のまま最新として見せる**。
 *
 * 閾値を 24 時間にしたのは、時刻表の更新が Bot の日次実行（07:00 JST）で入るため。
 * 24 時間以上前の本文は「1 回以上の更新機会を跨いだ」ことが確実に言える。
 * 時刻自体は隠さない（オフラインでの可用性を落とさない）。取得時刻を添えて
 * 帯で伝え、再取得の導線を出すところまでが役割。
 */
export const STALE_DATA_THRESHOLD_MS = 24 * 60 * 60 * 1000

interface DataStatusInput {
  loading: boolean
  refetching: boolean
  error: string | null
  stale: boolean
  hasTimetable: boolean
  isOnline: boolean
  /** 本日分の本文がサーバから返ってきた時刻（epoch ms）。不明なら null */
  fetchedAt: number | null
  /** 判定の基準時刻（epoch ms）。呼び出し側の時計を使い、ここで Date.now() を呼ばない */
  nowMs: number
}

/** 時刻を出せない状態（＝フルカードで伝える状態） */
export type HiddenTimesStatus = Extract<DataStatus, 'no-data' | 'refetching-stale' | 'stale'>

export function hidesTimes(status: DataStatus): status is HiddenTimesStatus {
  return status === 'no-data' || status === 'refetching-stale' || status === 'stale'
}

/** 時刻は出しつつ帯で状態を伝える状態 */
export type BandStatus = Extract<DataStatus, 'offline' | 'fetch-failed' | 'stale-data'>

export function showsBand(status: DataStatus): status is BandStatus {
  return status === 'offline' || status === 'fetch-failed' || status === 'stale-data'
}

export function deriveDataStatus({
  loading,
  refetching,
  error,
  stale,
  hasTimetable,
  isOnline,
  fetchedAt,
  nowMs,
}: DataStatusInput): DataStatus {
  // 初回ロード中はスピナーが担当する
  if (loading) return 'ok'
  if (error && !hasTimetable) return 'no-data'
  if (stale) return refetching ? 'refetching-stale' : 'stale'
  // オフラインを error より先に見る。端末がオフラインを認識できているなら、
  // そちらの方が行動につながる情報のため。この順にすることで fetch-failed は
  // 「オンラインなのに取れなかった」だけを意味する状態になる。
  if (!isOnline) return 'offline'
  if (error) return 'fetch-failed'
  // ここまで来れば「取得は成功した」が、その本文がいつのものかは別の話。
  // 端末時計の巻き戻しで差分が負になる場合は判定しない（推測するより出さない）
  if (fetchedAt !== null) {
    const age = nowMs - fetchedAt
    if (age >= STALE_DATA_THRESHOLD_MS) return 'stale-data'
  }
  return 'ok'
}
