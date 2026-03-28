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
  // 1. テストしたい日時を文字列で指定する（例: 2026年4月1日の朝8時30分）
  // const [now, setNow] = useState(() => dayjs('2026-04-01T08:30:00').tz(JST))

  useEffect(() => {
    // 次の分の00秒に同期してから1分ごとに更新

    //
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000
    let intervalId: ReturnType<typeof setInterval>

    const timeoutId = setTimeout(() => {
      setNow(dayjs().tz(JST))
      intervalId = setInterval(() => {
        setNow(dayjs().tz(JST))
      }, 60_000)
    }, msUntilNextMinute)

    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
      //
      
  }, [])

  return now
}
