import { useStoredRef } from './core.js'
import {
  currentTimes,
  periodIndex,
  currentCampusId,
  currentSeasonId,
} from './timeConfig.js'
import { todayStr, MAX_WEEK, dateString } from './utils.js'

export const semester = useStoredRef('sl_semester', {
  start: (function defaultSemesterStart() {
    const d = new Date()
    const year = d.getFullYear()
    const month = d.getMonth()
    const p = (n) => String(n).padStart(2, '0')
    const isAfterSep = month >= 8
    return `${year + (isAfterSep ? 0 : -1)}-${p(isAfterSep ? 9 : 3)}-01`
  })(),
})

export const scheduleExceptions = useStoredRef('sl_schedule_exceptions', [])

export function weekOf(dateStr) {
  const start = new Date(semester.value.start + 'T00:00:00')
  const d = new Date(dateStr + 'T00:00:00')
  return Math.floor((d - start) / (7 * 86400000)) + 1
}

export function currentWeek() {
  return weekOf(todayStr())
}

export function mondayOfDate(dateStr) {
  const date = new Date(`${String(dateStr ?? '')}T00:00:00`)
  if (!dateStr || Number.isNaN(date.getTime())) return ''
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return dateString(date)
}

export function courseInWeek(c, week) {
  const sw = c.startWeek ?? 1
  const ew = c.endWeek ?? MAX_WEEK
  if (week < sw || week > ew) return false
  const t = c.weekType ?? 'all'
  if (t === 'odd') return week % 2 === 1
  if (t === 'even') return week % 2 === 0
  return true
}

export function scheduleExceptionForDate(date) {
  return scheduleExceptions.value.find((item) => item.date === date) ?? null
}

export function coursesForDate(courseList, date) {
  const target = new Date(date + 'T00:00:00')
  const actualDay = target.getDay() === 0 ? 6 : target.getDay() - 1
  const week = weekOf(date)
  const exception = scheduleExceptionForDate(date)
  if (exception?.type === 'off') return []
  const sourceDay = exception?.type === 'makeup'
    ? Math.min(6, Math.max(0, Number(exception.sourceDay) || 0))
    : actualDay
  return courseList
    .filter((course) => course.day === sourceDay && courseInWeek(course, week))
    .map((course) => ({
      ...course,
      displayDay: actualDay,
      sourceDay,
      exceptionDate: exception ? date : '',
    }))
}

export function weekLabel(c) {
  const sw = c.startWeek ?? 1
  const ew = c.endWeek ?? MAX_WEEK
  let base = sw === ew ? `${sw}周` : sw === 1 && ew === MAX_WEEK ? '全学期' : `${sw}-${ew}周`
  const t = c.weekType ?? 'all'
  if (t === 'odd') base += ' 单'
  if (t === 'even') base += ' 双'
  return base
}

export function dateForWeekDay(week, day) {
  const date = new Date(semester.value.start + 'T00:00:00')
  date.setDate(date.getDate() + (Number(week) - 1) * 7 + Number(day))
  return dateString(date)
}
