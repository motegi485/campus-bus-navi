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
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000
    let intervalId: ReturnType<typeof setInterval>

    const timeoutId = setTimeout(() => {
      setNow(dayjs().tz(JST))
      intervalId = setInterval(() => {
        setNow(dayjs().tz(JST))
      }, 60_000)
    }, msUntilNextMinute)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setNow(dayjs().tz(JST))
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
