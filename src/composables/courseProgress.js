import { isActiveEntity, isArchived, taskStatus } from './domain/state.js'
import { countdownState } from './store/countdown.js'
import { clock } from './store/core.js'
import { createdDateKey, policyDateKey, policyDateTime, policyTimeKey, timestampOf } from './settingsPolicy.js'

/** @typedef {{ archivedAt?: string | null, deletedAt?: string | null, tombstone?: boolean, active?: boolean, status?: string }} Lifecycle */
/** @typedef {import('../types/domain').Course & Lifecycle} CourseRecord */
/** @typedef {import('../types/domain').Task & Lifecycle} TaskRecord */
/** @typedef {import('../types/domain').Milestone & Lifecycle & { repeat?: string, reviewProgress?: number, location?: string }} MilestoneRecord */
/** @typedef {import('../types/domain').QuickEvent & Lifecycle} EventRecord */
/** @typedef {Lifecycle & { id?: string, sessionId?: string, courseId?: string, course?: string, courseName?: string, todoId?: string | null, title?: string, startedAt?: string | number, actualFocusSeconds?: number }} FocusRecord */
/** @typedef {{ course: CourseRecord, archived: boolean, tasks: TaskRecord[], milestones: MilestoneRecord[], events: EventRecord[], sessions: FocusRecord[] }} CourseBucket */
/** @typedef {{ task: TaskRecord, status: string, dueAt: number, overdue: boolean, dueSoon: boolean }} CourseTaskRow */
/** @typedef {{ id: string, type: string, kind: string, title: string, date: string, time: string, summary: string, status: string, archived: boolean, path: string, seconds?: number }} CourseActivity */
/** @typedef {CourseActivity & { sortValue: number, days: number, reviewProgress?: number }} CourseNode */
/** @typedef {CourseBucket & { pendingTasks: CourseTaskRow[], completedCount: number, taskTotal: number, overdueCount: number, dueSoonCount: number, upcoming: CourseNode[], upcomingCount: number, recentFocusSeconds: number, focusSeconds: number, timeline: CourseActivity[] }} CourseProfile */

const DAY = 86400000
const PRIORITY = { high: 0, normal: 1, low: 2 }
const live = (item) => item && !item.deletedAt && !item.tombstone
const text = (value) => String(value ?? '').trim()
const secondsOf = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
function dateKey(value) {
  const date = text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const stamp = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? date : ''
}
const completed = (task) => Boolean(task.done) || task.status === 'completed'

function dayDifference(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}

export function courseDateLabel(date, now = clock.value) {
  if (!dateKey(date)) return '未安排日期'
  const days = dayDifference(policyDateKey(now), date)
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  if (days > 1 && days <= 6) return `${days} 天后`
  return date
}

/** @param {CourseTaskRow} row */
export function courseTaskDueLabel(row, now = clock.value) {
  if (!dateKey(row.task.dueDate)) return '未设截止日期'
  const days = dayDifference(policyDateKey(now), row.task.dueDate)
  if (row.overdue) return days < 0 ? `逾期 ${-days} 天` : '今天已逾期'
  return `${courseDateLabel(row.task.dueDate, now)}截止${row.task.dueTime ? ' · ' + row.task.dueTime : ''}`
}

/**
 * Derive a course workspace from existing records without writing or copying them.
 * Stable IDs win; name-only legacy records belong to a course only if its name is unique.
 * @param {{ courses?: CourseRecord[], tasks?: TaskRecord[], milestones?: MilestoneRecord[], events?: EventRecord[], focusSessions?: FocusRecord[] }} data
 * @returns {CourseProfile[]}
 */
export function buildCourseProgress({ courses = [], tasks = [], milestones = [], events = [], focusSessions = [] } = {}, now = clock.value) {
  const today = policyDateKey(now)
  /** @type {CourseBucket[]} */
  const profiles = courses.filter((item) => live(item) && text(item.id)).map((course) => ({
    course, archived: !isActiveEntity(course), tasks: [], milestones: [], events: [], sessions: [],
  }))
  const byId = new Map(profiles.map((profile) => [text(profile.course.id), profile]))
  /** @type {Map<string, CourseBucket | null>} */
  const byName = new Map()
  for (const profile of profiles) {
    const name = text(profile.course.name)
    if (name) byName.set(name, byName.has(name) ? null : profile)
  }
  function relatedProfile(item) {
    const id = text(item.courseId)
    return id ? byId.get(id) : byName.get(text(item.course ?? item.courseName))
  }
  for (const task of tasks.filter(live)) relatedProfile(task)?.tasks.push(task)
  for (const milestone of milestones.filter(live)) relatedProfile(milestone)?.milestones.push(milestone)
  for (const event of events.filter(live)) relatedProfile(event)?.events.push(event)
  const taskById = new Map(tasks.filter(live).map((task) => [text(task.id), task]))
  for (const session of focusSessions) {
    if (!live(session)) continue
    // Older focus records may have only a task ID. Never override an explicit course ID.
    const profile = text(session.courseId) ? relatedProfile(session)
      : relatedProfile(session) || (taskById.has(text(session.todoId)) ? relatedProfile(taskById.get(text(session.todoId))) : null)
    profile?.sessions.push(session)
  }

  return profiles.map((profile) => {
    const pendingTasks = profile.tasks.filter((task) => !isArchived(task) && !completed(task) && task.status !== 'cancelled').map((task) => {
      const status = taskStatus(dateKey(task.dueDate) ? task : { ...task, dueDate: '' }, now)
      const dueAt = dateKey(task.dueDate) ? policyDateTime(task.dueDate, task.dueTime || '23:59') : Infinity
      const days = dateKey(task.dueDate) ? dayDifference(today, task.dueDate) : NaN
      return { task, status, dueAt, overdue: status === 'overdue', dueSoon: status !== 'overdue' && days >= 0 && days <= 6 }
    }).sort((a, b) => Number(b.overdue) - Number(a.overdue)
      || a.dueAt - b.dueAt || (PRIORITY[a.task.priority] ?? 1) - (PRIORITY[b.task.priority] ?? 1)
      || Number(b.task.status === 'in_progress') - Number(a.task.status === 'in_progress')
      || text(a.task.id).localeCompare(text(b.task.id)))
    const completedCount = profile.tasks.filter((task) => !isArchived(task) && task.status !== 'cancelled' && completed(task)).length
    /** @type {CourseActivity[]} */
    const timeline = []
    /** @type {CourseNode[]} */
    const upcoming = []

    for (const task of profile.tasks) {
      timeline.push({
        id: text(task.id), type: 'task', kind: task.kind === 'homework' ? '作业' : '待办', title: task.title || '未命名待办',
        date: (completed(task) ? createdDateKey(task.completedAt) : dateKey(task.dueDate)) || createdDateKey(task.createdAt),
        time: completed(task) && timestampOf(task.completedAt) ? policyTimeKey(new Date(timestampOf(task.completedAt))) : task.dueTime || '',
        summary: task.workCheckpoint?.lastStep || task.note || '', archived: isArchived(task), path: '/tasks',
        status: completed(task) ? '已完成' : task.status === 'cancelled' ? '已取消' : task.status === 'in_progress' ? '进行中' : '待处理',
      })
    }
    for (const item of profile.milestones) {
      const row = {
        id: text(item.id), type: 'milestone', kind: item.kind === 'exam' ? '考试' : '重要日期', title: item.name || '未命名重要日期',
        date: dateKey(item.date) || createdDateKey(item.createdAt), time: item.time || '',
        summary: item.location || '', archived: isArchived(item), path: '/exams', status: '',
      }
      timeline.push(row)
      if (!isActiveEntity(item) || !dateKey(item.date)) continue
      const state = countdownState(item, now)
      if (!state.target || state.isPast || !Number.isFinite(state.sortValue)) continue
      const date = policyDateKey(state.target)
      upcoming.push({ ...row, date, sortValue: state.sortValue, days: dayDifference(today, date), reviewProgress: Math.min(100, secondsOf(item.reviewProgress)) })
    }
    for (const item of profile.events) {
      const row = {
        id: text(item.id), type: 'event', kind: '日程', title: item.title || '未命名日程',
        date: dateKey(item.date) || createdDateKey(item.createdAt), time: item.time || '',
        summary: [item.location, item.note].filter(Boolean).join(' · '), archived: isArchived(item), path: '/events', status: '',
      }
      timeline.push(row)
      if (!isActiveEntity(item) || !dateKey(item.date)) continue
      const endAt = policyDateTime(item.date, item.endTime || item.time || '23:59')
      if (endAt < now.getTime() || !Number.isFinite(endAt)) continue
      upcoming.push({ ...row, sortValue: policyDateTime(item.date, item.time || '00:00'), days: dayDifference(today, item.date) })
    }
    let recentFocusSeconds = 0
    let focusSeconds = 0
    for (const session of profile.sessions) {
      const seconds = secondsOf(session.actualFocusSeconds)
      const stamp = timestampOf(session.startedAt)
      const date = createdDateKey(session.startedAt)
      const days = date ? dayDifference(date, today) : NaN
      focusSeconds += seconds
      if (days >= 0 && days <= 6 && stamp <= now.getTime()) recentFocusSeconds += seconds
      timeline.push({
        id: text(session.sessionId || session.id), type: 'focus', kind: '专注',
        title: session.title || taskById.get(text(session.todoId))?.title || '自由专注',
        date, time: stamp ? policyTimeKey(new Date(stamp)) : '', seconds,
        summary: '', status: session.status === 'completed' ? '已完成' : '已中止', archived: false, path: '',
      })
    }
    upcoming.sort((a, b) => a.sortValue - b.sortValue || a.id.localeCompare(b.id))
    timeline.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.id.localeCompare(b.id))
    return {
      ...profile, pendingTasks, completedCount, taskTotal: pendingTasks.length + completedCount,
      overdueCount: pendingTasks.filter((row) => row.overdue).length,
      dueSoonCount: pendingTasks.filter((row) => row.dueSoon).length,
      upcoming, upcomingCount: upcoming.filter((row) => row.days >= 0 && row.days <= 6).length,
      recentFocusSeconds, focusSeconds, timeline,
    }
  }).sort((a, b) => Number(a.archived) - Number(b.archived) || b.overdueCount - a.overdueCount
    || Math.min(a.pendingTasks[0]?.dueAt ?? Infinity, a.upcoming[0]?.sortValue ?? Infinity)
      - Math.min(b.pendingTasks[0]?.dueAt ?? Infinity, b.upcoming[0]?.sortValue ?? Infinity)
    || b.pendingTasks.length - a.pendingTasks.length || text(a.course.name).localeCompare(text(b.course.name), 'zh-CN'))
}
