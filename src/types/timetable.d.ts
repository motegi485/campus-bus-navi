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
}

export type DiagramType = 'class' | 'holiday' | 'vacation' | 'event'

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
export type Theme = 'light' | 'dark'
export type DefaultRoute = 'campus_to_station' | 'station_to_campus'

export interface AppSettings {
  defaultRoute: DefaultRoute
  theme: Theme
  fontSize: FontSize
}
