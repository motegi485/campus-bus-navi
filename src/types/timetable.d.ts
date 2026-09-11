export type RouteKey = 'station_to_campus' | 'campus_to_station'

export interface BusStopCoords {
  lat: number
  lng: number
}

export interface ScheduleEntry {
  departure: string // "HH:mm"
  note: string
}

export interface Route {
  origin: string
  destination: string
  bus_stop_name: string
  bus_stop_coords: BusStopCoords
  schedule: ScheduleEntry[]
}

export interface Timetable {
  id: string
  name: string
  routes: Record<RouteKey, Route>
}

export interface CalendarRules {
  default_rules: Record<string, string> // "0"~"6" → timetable id
  overrides: Record<string, string>      // "YYYY-MM-DD" → timetable id
}

export interface NextBusInfo {
  entry: ScheduleEntry
  minutesUntil: number
  index: number
  /**
   * 前便の発車から次発の発車までの間隔（分）。次のバスカードの円形ゲージが
   * 「満タン」とみなす基準に使う。始発（前便なし）や前便の時刻が不正なときは null。
   */
  headwayMinutes: number | null
}

export type DiagramType =
  | 'weekday'
  | 'holiday'
  | 'vacation'
  | 'vacation_weekday'
  | 'vacation_holiday'
  | 'event'
  | 'closed'
  | 'special'

export interface NewsItem {
  id: number
  tag: 'important' | 'info' | 'change' | 'event'
  tagLabel: string
  date: string
  title: string
  preview: string
  body: string
  unread: boolean
}

export type FontSize = 'small' | 'medium' | 'large'
export type Theme = 'light' | 'dark' | 'system'
export type DefaultRoute = 'campus_to_station' | 'station_to_campus'

export interface AppSettings {
  defaultRoute: DefaultRoute
  theme: Theme
  fontSize: FontSize
}
