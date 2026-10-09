// 时区换算原语（zonedParts / dateInZone / wallTimeToEpoch 及其校验辅助）已迁到
// src/composables/zonedTime.js —— 前端 4 个文件也要用同一份实现，放在函数目录里会让
// "源码依赖部署目录"（依赖方向是反的）。这里 import 回来再把三个公开函数转出去，既让本文件
// 内部继续按短名调用，也保持 './availability.js' 这个入口对既有引用可用。
// 单一实现很重要：时区逻辑错一位就是"偶尔差一小时"，两份实现迟早漂移。
import { dateInZone, formatter, validClock, validDate, wallTimeToEpoch, zonedParts } from '../../../src/composables/zonedTime.js'

export { dateInZone, wallTimeToEpoch, zonedParts }

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

function pad(value) { return String(value).padStart(2, '0') }
function dateText(year, month, day) { return `${year}-${pad(month)}-${pad(day)}` }

function addDate(date, days) {
  const [year, month, day] = String(date).split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return dateText(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const result = []
  for (const interval of sorted) {
    const last = result[result.length - 1]
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end)
    else result.push({ start: interval.start, end: interval.end })
  }
  return result
}

function subtractIntervals(windows, busy) {
  let result = windows.map((item) => ({ ...item }))
  for (const block of mergeIntervals(busy)) {
    result = result.flatMap((window) => {
      if (block.end <= window.start || block.start >= window.end) return [window]
      const remaining = []
      if (block.start > window.start) remaining.push({ start: window.start, end: block.start })
      if (block.end < window.end) remaining.push({ start: block.end, end: window.end })
      return remaining
    })
  }
  return result
}

export function intersectIntervals(left, right) {
  const a = mergeIntervals(left); const b = mergeIntervals(right)
  const result = []
  let i = 0; let j = 0
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start)
    const end = Math.min(a[i].end, b[j].end)
    if (end > start) result.push({ start, end })
    if (a[i].end < b[j].end) i++
    else j++
  }
  return result
}

function weekMonday(date) {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return addDate(date, -(weekday === 0 ? 6 : weekday - 1))
}

function weekOf(semesterStart, date) {
  const start = Date.parse(`${weekMonday(semesterStart)}T00:00:00Z`)
  const current = Date.parse(`${weekMonday(date)}T00:00:00Z`)
  return Math.floor((current - start) / (7 * DAY_MS)) + 1
}

function dateException(exceptions, date) {
  return exceptions.find((item) => item?.date && (
    (item.type === 'off' && item.endDate && item.date <= date && date <= item.endDate)
    || item.date === date
  )) || null
}

function sourceWeekFor(exception, date, semesterStart) {
  const override = Number(exception?.sourceWeek)
  return exception?.type === 'makeup' && Number.isInteger(override) && override > 0
    ? override
    : weekOf(semesterStart, date)
}

function courseIsOn(course, week) {
  const start = Number(course.startWeek ?? 1)
  const end = Number(course.endWeek ?? 25)
  if (week < start || week > end) return false
  if (course.weekType === 'odd') return week % 2 === 1
  if (course.weekType === 'even') return week % 2 === 0
  return true
}

function seasonFor(date, campusId, config) {
  const available = config.seasons.filter((season) => !Array.isArray(season.campuses) || !season.campuses.length || season.campuses.includes(campusId))
  if (!available.length) return null
  if (available.length === 1) return available[0].id
  if (config.autoSeason === false) return config.currentSeason
  const monthDay = date.slice(5)
  const ordered = [...available].sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
  return ordered.filter((season) => /^\d{2}-\d{2}$/.test(season.startDate || '') && season.startDate <= monthDay).at(-1)?.id
    || ordered.at(-1)?.id
}

function timeRangeForCourse(course, date, timeConfig) {
  const campusId = course.campusId || timeConfig.currentCampus
  const seasonId = seasonFor(date, campusId, timeConfig)
  const startIndex = timeConfig.periods.findIndex((period) => period.id === course.start)
  const endIndex = timeConfig.periods.findIndex((period) => period.id === course.end)
  if (!seasonId || startIndex < 0 || endIndex < startIndex) return null
  const slots = timeConfig.times?.[seasonId]?.[campusId]
  const start = validClock(slots?.[startIndex]?.start)
  const end = validClock(slots?.[endIndex]?.end)
  if (start === null || end === null || end <= start) return null
  return { start, end, travel: Math.min(180, Math.max(0, Number(course.travelMinutes) || 0)) }
}

function addWallInterval(target, date, startMinute, endMinute, timeZone) {
  const startDate = addDate(date, Math.floor(startMinute / 1440))
  const endDate = addDate(date, Math.floor(endMinute / 1440))
  const startClock = `${pad(Math.floor((startMinute % 1440) / 60))}:${pad(startMinute % 60)}`
  const endValue = endMinute % 1440
  const endClock = `${pad(Math.floor(endValue / 60))}:${pad(endValue % 60)}`
  const start = wallTimeToEpoch(startDate, startClock, timeZone, 'start')
  const end = wallTimeToEpoch(endDate, endClock, timeZone, 'end')
  if (start !== null && end !== null && end > start) target.push({ start, end })
}

function courseBlocksForDate(values, profile, preferences, date) {
  const courses = values.sl_courses || []
  if (!courses.length) return { ok: true, blocks: [] }
  if (profile.semester_end && date > profile.semester_end) return { ok: true, blocks: [] }
  const semesterStart = values.sl_semester?.start
  const config = values.sl_timecfg
  if (!validDate(semesterStart) || !config || !Array.isArray(config.periods) || !Array.isArray(config.seasons)) return { ok: false, blocks: [] }
  const exception = dateException(values.sl_schedule_exceptions || [], date)
  if (exception?.type === 'off') return { ok: true, blocks: [] }
  const week = sourceWeekFor(exception, date, semesterStart)
  if (week < 1) return { ok: true, blocks: [] }
  const target = new Date(`${date}T00:00:00Z`).getUTCDay()
  const weekday = target === 0 ? 6 : target - 1
  const day = exception?.type === 'makeup' ? Math.max(0, Math.min(6, Number(exception.sourceDay) || 0)) : weekday
  const blocks = []
  for (const course of courses) {
    const courseDay = Number(course?.day)
    const startWeek = Number(course?.startWeek ?? 1)
    const endWeek = Number(course?.endWeek ?? 25)
    if (!course || !Number.isInteger(courseDay) || courseDay < 0 || courseDay > 6
        || !Number.isInteger(startWeek) || !Number.isInteger(endWeek) || startWeek < 1 || endWeek < startWeek || endWeek > 25
        || !['all', 'odd', 'even', undefined, null, ''].includes(course.weekType)
        || typeof course.start !== 'string' || typeof course.end !== 'string') return { ok: false, blocks: [] }
    if (courseDay !== day || !courseIsOn(course, week)) continue
    const range = timeRangeForCourse(course, date, config)
    if (!range) return { ok: false, blocks: [] }
    const before = Math.max(preferences.classBufferMinutes, range.travel)
    addWallInterval(blocks, date, range.start - before, range.end + preferences.classBufferMinutes, profile.timezone)
  }
  return { ok: true, blocks }
}

function eventBlocksForDate(values, profile, date) {
  const blocks = []
  for (const event of values.sl_events || []) {
    if (!event || event.archivedAt || event.deletedAt || event.tombstone || event.status === 'archived' || event.date !== date) continue
    if (!event.time) {
      addWallInterval(blocks, date, 0, 1440, profile.timezone)
      continue
    }
    const start = validClock(event.time)
    if (start === null) { addWallInterval(blocks, date, 0, 1440, profile.timezone); continue }
    let end = event.endTime ? validClock(event.endTime) : null
    if (end === null) end = start + 60
    else if (end <= start) end += 1440
    addWallInterval(blocks, date, start, end, profile.timezone)
  }
  for (const exam of values.sl_exams || []) {
    const examDate = exam?.date || exam?.targetDate || exam?.dueDate
    if (!exam || exam.archivedAt || exam.deletedAt || exam.tombstone || examDate !== date) continue
    if (!exam.time) { addWallInterval(blocks, date, 0, 1440, profile.timezone); continue }
    const start = validClock(exam.time)
    if (start === null) { addWallInterval(blocks, date, 0, 1440, profile.timezone); continue }
    const end = exam.endTime ? validClock(exam.endTime) : start + 120
    addWallInterval(blocks, date, start, end !== null && end > start ? end : start + 120, profile.timezone)
  }
  return blocks
}

function normalizedPreferences(profile) {
  const prefs = profile.availability_preferences || {}
  const startTime = validClock(prefs.startTime ?? '09:00')
  const endTime = validClock(prefs.endTime ?? '22:00')
  const minimumMinutes = Number(prefs.minimumMinutes ?? 90)
  const classBufferMinutes = Number(prefs.classBufferMinutes ?? 30)
  if (startTime === null || endTime === null || endTime <= startTime
      || !Number.isInteger(minimumMinutes) || minimumMinutes < 30 || minimumMinutes > 720
      || !Number.isInteger(classBufferMinutes) || classBufferMinutes < 0 || classBufferMinutes > 180) return null
  return { startTime, endTime, minimumMinutes, classBufferMinutes, includeWeekends: prefs.includeWeekends !== false }
}

export function userFreeIntervals({ snapshot, profile, confirmedInvitations = [] }, range) {
  const start = Number(range?.start); const end = Number(range?.end)
  if (!profile || !snapshot?.payload?.values || !Number.isFinite(snapshot.revision)
      || !Number.isFinite(start) || !Number.isFinite(end) || end <= start
      || end - start > 32 * DAY_MS || !validDate(profile.semester_end)) return { known: false, intervals: [], revision: snapshot?.revision ?? null }
  let zone
  try { formatter(profile.timezone || 'Asia/Shanghai').format(new Date(start)); zone = profile.timezone || 'Asia/Shanghai' } catch { return { known: false, intervals: [], revision: snapshot.revision } }
  const values = snapshot.payload.values
  if (!Array.isArray(values.sl_courses) || !Array.isArray(values.sl_events) || !Array.isArray(values.sl_exams)) {
    return { known: false, intervals: [], revision: snapshot.revision }
  }
  const preferences = normalizedPreferences(profile)
  if (!preferences) return { known: false, intervals: [], revision: snapshot.revision }
  const lastDate = dateInZone(end - 1, zone)
  if (!validDate(profile.schedule_complete_through) || profile.schedule_complete_through < lastDate) {
    return { known: false, intervals: [], revision: snapshot.revision }
  }
  const firstDate = addDate(dateInZone(start, zone), -1)
  const afterLastDate = addDate(lastDate, 1)
  const busy = []
  for (let date = firstDate; date < afterLastDate; date = addDate(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (!preferences.includeWeekends && (weekday === 0 || weekday === 6)) continue
    const courseResult = courseBlocksForDate(values, profile, preferences, date)
    if (!courseResult.ok) return { known: false, intervals: [], revision: snapshot.revision }
    busy.push(...courseResult.blocks, ...eventBlocksForDate(values, profile, date))
    for (const invitation of confirmedInvitations) {
      const inviteStart = Date.parse(invitation.starts_at)
      const inviteEnd = Date.parse(invitation.ends_at)
      if (Number.isFinite(inviteStart) && Number.isFinite(inviteEnd)) busy.push({ start: inviteStart, end: inviteEnd })
    }
  }
  const daily = []
  for (let date = firstDate; date < afterLastDate; date = addDate(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (!preferences.includeWeekends && (weekday === 0 || weekday === 6)) continue
    const s = wallTimeToEpoch(date, `${pad(Math.floor(preferences.startTime / 60))}:${pad(preferences.startTime % 60)}`, zone, 'start')
    const e = wallTimeToEpoch(date, `${pad(Math.floor(preferences.endTime / 60))}:${pad(preferences.endTime % 60)}`, zone, 'end')
    if (s !== null && e !== null && e > s) daily.push({ start: s, end: e })
  }
  const free = subtractIntervals(daily, busy).map((item) => ({ start: Math.max(start, item.start), end: Math.min(end, item.end) }))
    .filter((item) => item.end > item.start)
  return { known: true, intervals: mergeIntervals(free), revision: snapshot.revision, minimumMinutes: preferences.minimumMinutes }
}

export function mutualFreeIntervals(first, second, range) {
  const a = userFreeIntervals(first, range)
  const b = userFreeIntervals(second, range)
  if (!a.known || !b.known) return { known: false, intervals: [], revisions: {} }
  const minDuration = Math.max(a.minimumMinutes, b.minimumMinutes) * MINUTE_MS
  return {
    known: true,
    intervals: intersectIntervals(a.intervals, b.intervals).filter((item) => item.end - item.start >= minDuration),
    minimumMinutes: Math.max(a.minimumMinutes, b.minimumMinutes),
    revisions: {
      [first.profile.user_id]: { revision: a.revision, profileUpdatedAt: first.profile.updated_at },
      [second.profile.user_id]: { revision: b.revision, profileUpdatedAt: second.profile.updated_at },
    },
  }
}

export function intervalIsAvailable(intervals, start, end) {
  return intervals.some((item) => item.start <= start && item.end >= end)
}

export function localDayRange(timeZone, days, now = Date.now()) {
  const dayCount = Math.max(1, Math.min(30, Number(days) || 7))
  const today = dateInZone(now, timeZone)
  const midnight = wallTimeToEpoch(today, '00:00', timeZone, 'start')
  return {
    start: Math.max(now, midnight ?? now),
    end: wallTimeToEpoch(addDate(today, dayCount), '00:00', timeZone, 'end'),
    startDate: today,
    endDateExclusive: addDate(today, dayCount),
  }
}

export function invitationRange(startsAt, endsAt, timeZone) {
  const start = Date.parse(startsAt); const end = Date.parse(endsAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 12 * 60 * MINUTE_MS) return null
  const date = dateInZone(start, timeZone)
  return { start, end, startDate: addDate(date, -1), endDateExclusive: addDate(dateInZone(end, timeZone), 2) }
}
