export type WeekType = 'all' | 'odd' | 'even'

export interface Course {
  id: string
  name: string
  teacher?: string
  room?: string
  color?: string
  day: number
  start: string
  end: string
  startWeek?: number
  endWeek?: number
  weekType?: WeekType
}

export interface PeriodTime {
  start: string
  end: string
}

export interface Campus {
  id: string
  name: string
}

export interface Season {
  id: string
  name: string
  startDate: string
  campuses?: string[]
}

export interface TimeConfig {
  campuses: Campus[]
  seasons: Season[]
  currentCampus: string
  currentSeason: string
  autoSeason: boolean
  periods: Array<{ id: string; label: string }>
  times: Record<string, Record<string, PeriodTime[]>>
  updatedAt?: string
}

export interface Task {
  id: string
  title: string
  done: boolean
  course?: string
  courseId?: string
  dueDate?: string
  dueTime?: string
  priority?: 'high' | 'normal' | 'low'
  completedAt?: string | null
  createdAt?: string
  updatedAt?: string
  repeat?: 'none' | 'weekly'
  estimateMinutes?: number
  note?: string
}
