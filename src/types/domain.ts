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
  campusId?: string
  travelMinutes?: number
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
  kind?: 'todo' | 'homework' | 'review' | 'exam-prep'
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'archived'
  createdFrom?: 'manual' | 'quick-record' | 'ocr' | 'clipboard' | 'import'
  sourceType?: string
  sourceId?: string
  relationId?: string
}

export interface QuickEvent {
  id: string
  title: string
  date?: string
  time?: string
  courseId?: string
  courseName?: string
  note?: string
  createdAt?: string
  updatedAt?: string
  createdFrom?: string
  sourceType?: string
  sourceId?: string
}

export interface QuickNote {
  id: string
  title: string
  content: string
  createdAt?: string
  updatedAt?: string
  courseId?: string
  courseName?: string
  createdFrom?: string
  sourceType?: string
  sourceId?: string
  inboxStatus?: 'inbox' | 'organized' | 'archived'
  organizedAt?: string
}

export interface Transaction {
  id: string
  name: string
  amount: number
  date: string
  direction?: 'expense' | 'income'
  billId?: string
  billingPeriodKey?: string
  createdAt?: string
  updatedAt?: string
  createdFrom?: string
}

export interface Milestone {
  id: string
  name: string
  date: string
  time?: string
  kind?: 'exam' | 'countdown' | 'deadline' | 'anniversary'
  courseId?: string
  courseName?: string
  createdAt?: string
  updatedAt?: string
}
