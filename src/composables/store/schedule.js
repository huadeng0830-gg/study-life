import { clock, touchStoredRef, useStoredRef } from './core.js'
import {
  currentTimes,
  periodIndex,
  currentCampusId,
  currentSeasonId,
} from './timeConfig.js'
import { todayStr, MAX_WEEK, dateString } from './utils.js'

export const semester = useStoredRef('sl_semester', {
  start: (function defaultSemesterStart() {
    const d = new Date(clock.value)
    const year = d.getFullYear()
    const month = d.getMonth()
    const p = (n) => String(n).padStart(2, '0')
    const isAfterSep = month >= 8
    return `${year + (isAfterSep ? 0 : -1)}-${p(isAfterSep ? 9 : 3)}-01`
  })(),
})

export const scheduleExceptions = useStoredRef('sl_schedule_exceptions', [])

export function upsertScheduleException(value) {
  if (!value?.date) return null
  const type = value.type === 'makeup' ? 'makeup' : 'off'
  const endDate = type === 'off' && value.endDate && value.endDate > value.date ? value.endDate : null
  const sourceWeek = type === 'makeup' && Number.isFinite(Number(value.sourceWeek)) && Number(value.sourceWeek) > 0
    ? Number(value.sourceWeek)
    : null
  const exception = {
    id: value.id || `exception-${value.date}`,
    date: value.date,
    type,
    sourceDay: type === 'makeup' ? Math.min(6, Math.max(0, Number(value.sourceDay) || 0)) : null,
    sourceWeek,
    endDate,
    note: value.note,
    updatedAt: value.updatedAt || new Date().toISOString(),
  }
  const index = value.id
    ? scheduleExceptions.value.findIndex((item) => item.id === value.id)
    : scheduleExceptions.value.findIndex((item) => item.date === exception.date)
  if (index >= 0) scheduleExceptions.value[index] = exception
  else scheduleExceptions.value.push(exception)
  touchStoredRef('sl_schedule_exceptions')
  return exception
}

export function removeScheduleException(id) {
  const index = scheduleExceptions.value.findIndex((item) => item.id === id)
  if (index < 0) return null
  const exception = scheduleExceptions.value.splice(index, 1)[0]
  touchStoredRef('sl_schedule_exceptions')
  return exception
}

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
  return scheduleExceptions.value.find((item) => {
    if (!item || !item.date) return false
    if (item.type === 'off' && item.endDate && item.date <= date && date <= item.endDate) return true
    return item.date === date
  }) ?? null
}

export function scheduleDateContext(date) {
  const target = new Date(date + 'T00:00:00')
  const actualDay = target.getDay() === 0 ? 6 : target.getDay() - 1
  const week = weekOf(date)
  const exception = scheduleExceptionForDate(date)
  const sourceDay = exception?.type === 'makeup'
    ? Math.min(6, Math.max(0, Number(exception.sourceDay) || 0))
    : actualDay
  const sourceWeek = exception?.type === 'makeup' && Number.isFinite(Number(exception.sourceWeek)) && Number(exception.sourceWeek) > 0
    ? Number(exception.sourceWeek)
    : week
  return {
    actualDay,
    week,
    exception,
    sourceDay,
    sourceWeek,
  }
}

function courseDayIndex(courseList) {
  const index = new Map()
  for (const course of Array.isArray(courseList) ? courseList : []) {
    const bucket = index.get(course?.day) ?? []
    bucket.push(course)
    index.set(course?.day, bucket)
  }
  return index
}

function coursesForDateFromIndex(index, date) {
  const { actualDay, exception, sourceDay, sourceWeek } = scheduleDateContext(date)
  if (exception?.type === 'off') return []
  return (index.get(sourceDay) ?? [])
    .filter((course) => course.day === sourceDay && courseInWeek(course, sourceWeek))
    .map((course) => ({
      ...course,
      displayDay: actualDay,
      sourceDay,
      exceptionDate: exception ? date : '',
    }))
}

export function coursesForDate(courseList, date) {
  return coursesForDateFromIndex(courseDayIndex(courseList), date)
}

// 同一轮需要多个日期时只建立一次星期索引，避免首页/周回顾对整张课表重复扫描。
export function coursesForDates(courseList, dates) {
  const index = courseDayIndex(courseList)
  return (Array.isArray(dates) ? dates : []).map((date) => coursesForDateFromIndex(index, date))
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
