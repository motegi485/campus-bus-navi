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
  /** 正常。状態表示を描かない */
  | 'ok'

interface DataStatusInput {
  loading: boolean
  refetching: boolean
  error: string | null
  stale: boolean
  hasTimetable: boolean
  isOnline: boolean
}

/** 時刻を出せない状態（＝フルカードで伝える状態） */
export type HiddenTimesStatus = Extract<DataStatus, 'no-data' | 'refetching-stale' | 'stale'>

export function hidesTimes(status: DataStatus): status is HiddenTimesStatus {
  return status === 'no-data' || status === 'refetching-stale' || status === 'stale'
}

export function deriveDataStatus({
  loading,
  refetching,
  error,
  stale,
  hasTimetable,
  isOnline,
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
  return 'ok'
}
