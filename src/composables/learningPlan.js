import { isActiveEntity, isTaskActionable, taskStatus } from './domain/state.js'
import { countdownState } from './store/countdown.js'
import { coursesForDate, isScheduleDate } from './store/schedule.js'
import { autoSeasonIdFor, currentCampusId, currentSeasonId, timeConfig } from './store/timeConfig.js'
import { appDateTime, appNow, appToday, getAppTime, getAppToday } from './timeContext.js'
import { timestampOf } from './settingsPolicy.js'
import { buildStudyBlockSuggestions, clockMinutes, studyFreeIntervals, STUDY_DAY_END, STUDY_DAY_START } from './studyBlockSuggestions.js'

const live = (item) => item && !item.deletedAt && !item.tombstone
const active = (item) => live(item) && isActiveEntity(item)

/** Read new structured links and the original study-block:<task ID>:<date> records. */
export function studyBlockTaskId(event) {
  if (event?.sourceType === 'study-block' && event.sourceId) return String(event.sourceId)
  return /^study-block:(.+):\d{4}-\d{2}-\d{2}$/.exec(String(event?.sourceText || ''))?.[1] || ''
}

export function learningTasks(tasks, courses, now = appNow.value) {
  const byId = new Map(courses.filter(live).map((course) => [String(course.id), course]))
  const byName = new Map()
  for (const course of courses.filter(live)) {
    const name = String(course.name || '').trim()
    if (name) byName.set(name, byName.has(name) ? null : course)
  }
  return tasks.filter((task) => {
    if (!live(task) || !isTaskActionable(task, now)) return false
    const course = task.courseId ? byId.get(String(task.courseId)) : byName.get(String(task.course || task.courseName || '').trim())
    if (course && !isActiveEntity(course)) return false
    return course || task.courseId || ['homework', 'review'].includes(task.kind) || task.course === '学习'
  }).map((task) => {
    const course = task.courseId ? byId.get(String(task.courseId)) : byName.get(String(task.course || task.courseName || '').trim())
    return { ...task, courseId: task.courseId || course?.id || '', courseName: course?.name || task.courseName || task.course || '' }
  })
}

/** Derived from the existing course, task, calendar, and focus records; no extra store. */
export function buildLearningDay({ courses = [], tasks = [], events = [], focusSessions = [] } = {}, date = appToday.value, now = appNow.value) {
  if (!isScheduleDate(date)) return { suggestions: [], blocks: [], candidates: [], busyIntervals: [], freeMinutes: 0, focusSeconds: 0, plannedMinutes: 0 }
  const today = getAppToday(now)
  const nowMinutes = date < today ? STUDY_DAY_END : date === today ? clockMinutes(getAppTime(now)) : STUDY_DAY_START
  const busyIntervals = []
  const campus = currentCampusId()
  const season = (timeConfig.value.autoSeason ? autoSeasonIdFor(campus, timeConfig.value, new Date(appDateTime(date, '12:00'))) : null) || currentSeasonId()
  const times = timeConfig.value.times?.[season]?.[campus] || []
  const periodIndices = new Map(timeConfig.value.periods.map((period, index) => [period.id, index]))
  for (const course of coursesForDate(courses.filter(active), date)) {
    const start = clockMinutes(times[periodIndices.get(course.start)]?.start)
    const end = clockMinutes(times[periodIndices.get(course.end)]?.end)
    if (start !== null && end !== null && end > start) busyIntervals.push({ start, end })
  }
  const taskMap = new Map(tasks.filter(live).map((task) => [String(task.id), task]))
  const blocks = []
  const plannedTaskIds = new Set()
  for (const event of events.filter(active)) {
    if (event.date !== date) continue
    const start = clockMinutes(event.time)
    const explicitEnd = clockMinutes(event.endTime)
    const end = start !== null ? explicitEnd !== null && explicitEnd > start ? explicitEnd : Math.min(24 * 60, start + 60) : null
    if (start !== null && end !== null) busyIntervals.push({ start, end })
    else if (!event.time) busyIntervals.push({ start: STUDY_DAY_START, end: STUDY_DAY_END })
    const taskId = studyBlockTaskId(event)
    if (!taskId) continue
    const task = taskMap.get(taskId) || null
    const actionable = Boolean(task && isTaskActionable(task, now))
    const ended = date < today || (date === today && end !== null && end <= nowMinutes)
    if (!ended && start !== null && end !== null) plannedTaskIds.add(taskId)
    blocks.push({ event, task, actionable, ended, minutes: start !== null && end !== null ? end - start : 0,
      status: !task ? '待办已移除' : taskStatus(task, now) === 'completed' ? '待办已完成' : !actionable ? '待办已归档或取消' : ended ? '时段已结束，可继续推进' : date === today && start <= nowMinutes ? '当前时段' : '已安排' })
  }
  blocks.sort((a, b) => String(a.event.time).localeCompare(String(b.event.time)))
  const candidates = learningTasks(tasks, courses, now)
  const suggestions = isScheduleDate(date) && date >= today ? buildStudyBlockSuggestions({ date, nowMinutes, tasks: candidates, busyIntervals, plannedTaskIds }) : []
  const freeMinutes = studyFreeIntervals(busyIntervals, nowMinutes).reduce((sum, gap) => sum + Math.max(0, gap.end - gap.start), 0)
  const focusSeconds = focusSessions.filter((session) => live(session) && timestampOf(session.startedAt) > 0 && timestampOf(session.startedAt) <= now.getTime() && getAppToday(timestampOf(session.startedAt)) === date)
    .reduce((sum, session) => sum + Math.max(0, Number(session.actualFocusSeconds) || 0), 0)
  return { suggestions, blocks, candidates, busyIntervals, freeMinutes, focusSeconds,
    plannedMinutes: blocks.reduce((sum, block) => sum + block.minutes, 0) }
}

/** Revalidate the current suggestion just before saving, including double clicks and changes on another page. */
export function createLearningBlock(domain, suggestion) {
  const plan = buildLearningDay({ courses: domain.courses.value, tasks: domain.tasks.value, events: domain.events.value }, suggestion.date)
  const latest = plan.suggestions.find((item) => item.taskId === suggestion.taskId && item.startTime === suggestion.startTime && item.endTime === suggestion.endTime)
  if (!latest) throw new Error('课表或待办已更新，请按新建议安排。')
  return domain.createEvent({ title: `学习：${latest.taskTitle}`, date: latest.date, time: latest.startTime, endTime: latest.endTime,
    courseId: latest.courseId, courseName: latest.courseName, note: `为待办「${latest.taskTitle}」预留的学习时段。`,
    sourceType: 'study-block', sourceId: latest.taskId, createdFrom: 'learning-plan', sourceText: `study-block:${latest.taskId}:${latest.date}` })
}

export function ensureMilestoneReviewTask(domain, milestoneId) {
  const milestone = domain.milestones.value.find((item) => String(item.id) === String(milestoneId) && active(item))
  if (!milestone || milestone.category !== '学习' || !isScheduleDate(milestone.date) || countdownState(milestone, appNow.value).isPast) throw new Error('这条考试或重要日期已结束或移除，请查看当前记录。')
  const existing = domain.tasks.value.find((task) => live(task) && isTaskActionable(task) && task.sourceType === 'milestone-review' && String(task.sourceId) === String(milestone.id))
  if (existing) return { task: existing, created: false }
  const course = domain.courses.value.find((item) => String(item.id) === String(milestone.courseId) && live(item))
  const task = domain.createTask({ title: `复习：${milestone.name}`, kind: 'review', courseId: milestone.courseId || '', course: course?.name || milestone.courseName || '',
    dueDate: appToday.value, priority: 'high', estimateMinutes: 25, note: `复习「${milestone.name}」，可安排学习时段或开始专注。`,
    createdFrom: 'milestone-review', sourceType: 'milestone-review', sourceId: milestone.id })
  return { task, created: true }
}
