import { normalizeFocusSession } from './focusTimer.js'

function pad(value) { return String(value).padStart(2, '0') }

export function dayText(value = new Date()) {
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const COURSE_CHECKIN_STATES = Object.freeze({
  understood: 'understood',
  unclear: 'unclear',
  review: 'review',
  absent: 'absent',
})

const VALID_CHECKINS = new Set(Object.values(COURSE_CHECKIN_STATES))

export function normalizeCourseCheckins(value) {
  if (!Array.isArray(value)) return []
  const seen = new Map()
  for (const item of value) {
    if (!item || typeof item !== 'object' || !item.courseId || !item.date || !VALID_CHECKINS.has(item.state)) continue
    seen.set(`${item.date}:${item.courseId}`, {
      id: String(item.id || `${item.date}:${item.courseId}`),
      date: String(item.date),
      courseId: String(item.courseId),
      courseName: String(item.courseName || ''),
      state: item.state,
      updatedAt: String(item.updatedAt || ''),
    })
  }
  return [...seen.values()].sort((left, right) => `${right.date}${right.updatedAt}`.localeCompare(`${left.date}${left.updatedAt}`))
}

export function upsertCourseCheckin(list, value, now = new Date()) {
  const date = value.date || dayText(now)
  if (!value.courseId || !VALID_CHECKINS.has(value.state)) return normalizeCourseCheckins(list)
  const item = {
    id: `${date}:${value.courseId}`,
    date,
    courseId: String(value.courseId),
    courseName: String(value.courseName || ''),
    state: value.state,
    updatedAt: new Date(now).toISOString(),
  }
  return normalizeCourseCheckins([...(Array.isArray(list) ? list : []).filter((entry) => `${entry?.date}:${entry?.courseId}` !== item.id), item])
}

export function rescueTaskPatch(action, now = new Date()) {
  const base = new Date(now)
  base.setHours(0, 0, 0, 0)
  if (action === 'tonight') return { dueDate: dayText(base), dueTime: '20:00', priority: 'high', status: 'pending' }
  if (action === 'tomorrow') { base.setDate(base.getDate() + 1); return { dueDate: dayText(base), dueTime: '', status: 'pending' } }
  if (action === 'next-week') { base.setDate(base.getDate() + 7); return { dueDate: dayText(base), dueTime: '', status: 'pending' } }
  if (action === 'archive') return { status: 'archived' }
  return null
}

export function focusElapsedSeconds(active, now = Date.now()) {
  if (!active) return 0
  const plannedSeconds = Math.max(1, Number(active.durationMinutes) || 25) * 60
  const legacyPausedElapsed = active.pausedAt
    ? plannedSeconds - Math.max(0, Number(active.remainingSeconds) || plannedSeconds)
    : 0
  const accumulated = Math.max(0, Number(active.elapsedSeconds) || legacyPausedElapsed)
  if (active.pausedAt) return Math.min(plannedSeconds, accumulated)
  const segmentStarted = new Date(active.segmentStartedAt || active.startedAt).getTime()
  const segmentElapsed = Number.isFinite(segmentStarted)
    ? Math.max(0, Math.floor((new Date(now).getTime() - segmentStarted) / 1000))
    : 0
  return Math.min(plannedSeconds, accumulated + segmentElapsed)
}

function checkinTimestamp(item) {
  const date = new Date(`${item?.date || ''}T00:00:00`).getTime()
  const updated = new Date(item?.updatedAt || '').getTime()
  return Number.isFinite(date) ? date + (Number.isFinite(updated) ? updated % 86400000 : 0) : -Infinity
}

function latestCheckinsByCourse(checkins, now) {
  const latest = new Map()
  const nowTime = new Date(now).getTime()
  for (const item of Array.isArray(checkins) ? checkins : []) {
    if (!item?.courseId || !VALID_CHECKINS.has(item.state)) continue
    const timestamp = checkinTimestamp(item)
    if (!Number.isFinite(timestamp) || timestamp > nowTime) continue
    const current = latest.get(item.courseId)
    if (!current || timestamp >= checkinTimestamp(current)) latest.set(item.courseId, item)
  }
  return latest
}

export function courseWorkload(courses, tasks, checkins, now = new Date()) {
  const courseMap = new Map((Array.isArray(courses) ? courses : []).map((course) => [course.id, course]))
  const latestCheckins = latestCheckinsByCourse(checkins, now)
  const reviewExpiry = new Date(now).getTime() - 14 * 86400000
  const rows = [...courseMap.values()].map((course) => {
    const related = (Array.isArray(tasks) ? tasks : []).filter((task) => task.courseId === course.id && !task.done && task.status !== 'archived')
    const latestCheckin = latestCheckins.get(course.id)
    const reviewCount = latestCheckin?.state === COURSE_CHECKIN_STATES.review && checkinTimestamp(latestCheckin) >= reviewExpiry ? 1 : 0
    const overdue = related.filter((task) => task.dueDate && new Date(`${task.dueDate}T${task.dueTime || '23:59'}`).getTime() < new Date(now).getTime()).length
    return { course, taskCount: related.length, reviewCount, overdue, score: overdue * 4 + reviewCount * 3 + related.length }
  })
  return rows.filter((row) => row.score > 0).sort((left, right) => right.score - left.score || left.course.name.localeCompare(right.course.name, 'zh-CN'))
}

function mondayOf(now) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date
}

export function weeklyPulse({ tasks = [], focusSessions = [], courseCheckins = [], moodLog = {} } = {}, now = new Date()) {
  const start = mondayOf(now).getTime()
  const end = start + 7 * 86400000
  const done = tasks.filter((task) => task.completedAt && new Date(task.completedAt).getTime() >= start && new Date(task.completedAt).getTime() < end).length
  const minutes = focusSessions.filter((item) => item.endedAt && new Date(item.endedAt).getTime() >= start && new Date(item.endedAt).getTime() < end).reduce(
    (sum, item) => sum + Math.round((normalizeFocusSession(item)?.actualFocusSeconds || 0) / 60),
    0
  )
  const reviewCourses = new Set(courseCheckins.filter((item) => {
    const time = new Date(`${item.date}T00:00:00`).getTime()
    return item.state === COURSE_CHECKIN_STATES.review && time >= start && time < end
  }).map((item) => item.courseId)).size
  const moodDays = Object.keys(moodLog || {}).filter((key) => new Date(`${key}T00:00:00`).getTime() >= start && new Date(`${key}T00:00:00`).getTime() < end).length
  const suggestion = reviewCourses
    ? `有 ${reviewCourses} 门课标记为需要复习，给其中一门安排 25 分钟就好。`
    : minutes ? '本周已经有稳定投入，下一次专注可以直接从行动清单开始。' : '从一件 15 分钟的小任务开始，进度会自然出现。'
  return { done, minutes, reviewCourses, moodDays, suggestion }
}
