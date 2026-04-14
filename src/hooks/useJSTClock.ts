import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const JST = 'Asia/Tokyo'

/**
 * 1分ごとに更新されるJSTのdayjsオブジェクトを返す
 * カウントダウンは分のみ表示のため秒更新は不要
 */
export function useJSTClock(): dayjs.Dayjs {
  const [now, setNow] = useState(() => dayjs().tz(JST))

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    let intervalId: ReturnType<typeof setInterval>

    // タイマーを現在時刻の秒数に合わせて正確に仕掛け直す関数
    const syncTimer = () => {
      // 念のためセット済みのタイマーをクリア
      clearTimeout(timeoutId)
      clearInterval(intervalId)

      const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000

      // 次の00秒の瞬間に1回更新し、その後1分おきのインターバルを開始
      timeoutId = setTimeout(() => {
        setNow(dayjs().tz(JST))
        intervalId = setInterval(() => {
          setNow(dayjs().tz(JST))
        }, 60_000)
      }, msUntilNextMinute)
    }

    // 1. 初回マウント時にタイマーを同期してスタート
    syncTimer()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // 2. 復帰した瞬間に時刻を最新化
        setNow(dayjs().tz(JST))
        // 3. 次の00秒に向けたタイマーを「再計算」して仕掛け直す
        syncTimer()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return now
}