import { isArchived, isTaskActionable, taskStatus } from './domain/state.js'
import { sortCountdowns } from './store/countdown.js'
import { appCalendarDaysBetween, getAppToday } from './timeContext.js'

function matchesQuery(values, query) {
  const words = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const text = values.filter(Boolean).join(' ').toLocaleLowerCase()
  return words.every((word) => text.includes(word))
}

/** Additional filters shared by the task list, board, and calendar. */
export function filterTaskWorkspace(tasks, { query = '', priority = 'all', period = 'all', now = new Date(), courseNames = new Map() } = {}) {
  const today = getAppToday(now)
  return tasks.filter((task) => {
    if (priority !== 'all' && (task.priority || 'normal') !== priority) return false
    if (!matchesQuery([task.title, courseNames.get(task.courseId), task.course, task.note, task.workCheckpoint?.lastStep, task.workCheckpoint?.blocker, task.workCheckpoint?.nextStep], query)) return false
    if (period === 'all') return true
    if (!isTaskActionable(task, now)) return false
    if (period === 'overdue') return taskStatus(task, now) === 'overdue'
    if (period === 'unplanned') return !task.dueDate
    const days = appCalendarDaysBetween(today, task.dueDate)
    if (period === 'today') return days === 0
    if (period === 'week') return days >= 0 && days < 7
    return true
  })
}

/** Counts describe current actionable records, independently of search filters. */
export function taskWorkspaceSummary(tasks, now = new Date()) {
  const today = getAppToday(now)
  const summary = { today: 0, overdue: 0, week: 0, unplanned: 0 }
  for (const task of tasks) {
    if (!isTaskActionable(task, now)) continue
    if (!task.dueDate) summary.unplanned += 1
    if (taskStatus(task, now) === 'overdue') summary.overdue += 1
    const days = appCalendarDaysBetween(today, task.dueDate)
    if (days === 0) summary.today += 1
    if (days >= 0 && days < 7) summary.week += 1
  }
  return summary
}

/** Use the next occurrence for annual dates, including clamped leap days. */
export function milestoneOccurrenceDate(item) {
  return item.countdown?.target ? getAppToday(item.countdown.target) : ''
}

export function selectMilestoneWorkspace(items, {
  now = new Date(), query = '', category = 'all', period = 'all', sortKey = 'date',
  showPast = false, showHistory = false, courseNames = new Map(),
} = {}) {
  const today = getAppToday(now)
  const summary = { upcoming: 0, week: 0, pinned: 0, past: 0, archived: 0 }
  const rows = sortCountdowns(items, now).map((item) => {
    const occurrenceDate = milestoneOccurrenceDate(item)
    const days = appCalendarDaysBetween(today, occurrenceDate)
    if (isArchived(item)) summary.archived += 1
    else if (item.countdown.isPast) summary.past += 1
    else {
      summary.upcoming += 1
      if (days >= 0 && days < 7) summary.week += 1
      if (item.pinned) summary.pinned += 1
    }
    return { ...item, occurrenceDate, days }
  })
  const visible = rows.filter((item) => {
    if (isArchived(item) !== showHistory) return false
    if (category !== 'all' && (item.category || '其他') !== category) return false
    if (!matchesQuery([item.name, item.location, item.courseName, courseNames.get(item.courseId)], query)) return false
    if (showHistory) return true
    if (period === 'past') return item.countdown.isPast
    if (!showPast && item.countdown.isPast) return false
    if (period === 'pinned') return Boolean(item.pinned) && !item.countdown.isPast
    if (period === 'week' || period === 'month') return !item.countdown.isPast && item.days >= 0 && item.days < (period === 'week' ? 7 : 30)
    return true
  }).sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1
    if (left.countdown.isPast !== right.countdown.isPast) return left.countdown.isPast ? 1 : -1
    if (sortKey === 'name') return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
    if (sortKey === 'created') return String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
    return left.countdown.isPast
      ? right.countdown.sortValue - left.countdown.sortValue
      : left.countdown.sortValue - right.countdown.sortValue
  })
  return { summary, visible }
}

export function isValidPlanningDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
