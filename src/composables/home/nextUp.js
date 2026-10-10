import { coursesForDates } from '../store/schedule.js'
import { courseTimeRange, currentTimes, periodIndex } from '../store/timeConfig.js'
import { isArchived, isBillDueSoon, isTaskActionable } from '../domain/state.js'
import { addAppDays, appDateTime } from '../timeContext.js'
import { courseTiming } from '../courseTime.js'
import { taskStages, taskTimeSummary } from '../tasks/taskTimePlan.ts'
import { countdownState } from '../store/countdown.js'
import { policyDateKey } from '../settingsPolicy.js'

function minutesOf(value) {
  if (!value) return null
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function itemAt(date, time = '23:59') {
  return appDateTime(date, time || '23:59')
}

/**
 * Build the home page's next-up projection from the current domain records.
 * The caller supplies one coherent snapshot and clock so the displayed item,
 * departure suggestion, and timing label cannot disagree during a render.
 */
export function selectHomeNextUp({
  courses = [],
  tasks = [],
  events = [],
  bills = [],
  milestones = [],
  now = new Date(),
  today,
} = {}) {
  const nowTs = now.getTime()
  const todayKey = today || new Date(nowTs).toISOString().slice(0, 10)
  const candidates = []
  const times = currentTimes()
  const activeCourses = courses.filter((course) => !isArchived(course))
  const dates = Array.from({ length: 8 }, (_, offset) => addAppDays(todayKey, offset))
  const dailyCourses = coursesForDates(activeCourses, dates)

  for (let offset = 0; offset <= 7; offset += 1) {
    const date = dates[offset]
    for (const course of dailyCourses[offset] || []) {
      const start = times[periodIndex(course.start)]?.start || '23:59'
      const end = times[periodIndex(course.end)]?.end || start
      const startAt = itemAt(date, start)
      const endAt = itemAt(date, end)
      const timing = courseTiming(startAt, endAt, now)
      if (timing.state !== 'ended') {
        candidates.push({
          kind: 'course', entity: course, date, time: start, endAt,
          dueAt: Math.max(startAt, nowTs), state: timing.state, timing,
        })
      }
    }
  }

  const add = (kind, entity, date, time = '') => {
    if (!entity || !date) return
    const dueAt = itemAt(date, time || '23:59')
    if (dueAt >= nowTs && dueAt <= nowTs + 7 * 86400000) {
      candidates.push({ kind, entity, date, time, dueAt, state: 'upcoming' })
    }
  }

  events.filter((item) => !isArchived(item)).forEach((item) => add('event', item, item.date, item.time))
  tasks.filter((item) => isTaskActionable(item, now)).forEach((item) => {
    if (!taskStages(item).length) { add('task', item, item.dueDate, item.dueTime); return }
    const plan = taskTimeSummary(item, nowTs)
    // 已结束待确认在风险区显示；这里仍可展示同一事项的后续安排。
    const entry = plan.next?.risk ? plan.following : plan.next
    if (entry?.date && entry.at <= nowTs + 7 * 86400000) candidates.push({ kind: 'task', entity: item, date: entry.date, time: entry.time, dueAt: Math.max(nowTs, entry.at), state: 'upcoming', timeSummary: entry.label, stageId: entry.stage?.id })
  })
  bills.filter((item) => isBillDueSoon(item, now)).forEach((item) => add('bill', item, item.nextDate))
  milestones.filter((item) => !isArchived(item)).forEach((item) => {
    const countdown = countdownState(item, now)
    if (countdown.target && !countdown.isPast) add('milestone', item, policyDateKey(countdown.target), item.time)
  })

  const nextUp = candidates.sort((a, b) => a.dueAt - b.dueAt)[0] || { kind: 'none' }
  const course = nextUp.kind === 'course' ? nextUp.entity : null
  const start = course ? times[periodIndex(course.start)]?.start : ''
  const startMinutes = minutesOf(start)
  const travelMinutes = Math.max(0, Number(course?.travelMinutes) || 0)

  return {
    nextUp,
    nextUpTimeRange: course ? courseTimeRange(course) : '',
    nextDeparture: course && travelMinutes && startMinutes !== null && startMinutes !== undefined
      ? `${course.campusId ? `${course.campusId} · ` : ''}建议 ${String(Math.floor(((startMinutes - travelMinutes + 1440) % 1440) / 60)).padStart(2, '0')}:${String((startMinutes - travelMinutes + 1440) % 60).padStart(2, '0')} 出发`
      : '',
    nextTimingLabel: course
      ? courseTiming(itemAt(nextUp.date, nextUp.time), nextUp.endAt, now).text
      : '',
  }
}
