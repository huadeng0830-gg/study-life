import { currentTimes, periodIndex, currentCampusId } from './store/timeConfig.js'
import { scheduleDateContext, courseInWeek, dateForWeekDay } from './store/schedule.js'
import { isActiveEntity } from './domain/state.js'

/** @typedef {{ start: number, end: number }} TimeRange */
/** @typedef {{ id: string|number, name: string, day: number, startPeriod: string, endPeriod: string, startWeek?: number, endWeek?: number, weekType?: 'all'|'odd'|'even' }} Course */
/** @typedef {{ id: string|number, title?: string, name?: string, dueDate?: string, date?: string, dueTime?: string, time?: string, estimatedMinutes?: number }} TaskEventItem */
/** @typedef {{ type: string, entityId: string|number, entityName: string, entityType: string, existing: Course|TaskEventItem, new: Course|TaskEventItem }} ConflictBase */
/** @typedef {ConflictBase & { type: 'course-course', week: number, day: number, timeRange: TimeRange, message: string }} CourseConflict */
/** @typedef {ConflictBase & { type: 'task-task'|'event-event', date: string, timeRange: TimeRange, message: string }} TaskEventConflict */
/** @typedef {CourseConflict|TaskEventConflict} Conflict */
/** @typedef {{ hasConflicts: boolean, count: number, byType: Record<string, number>, message: string }} ConflictSummary */

/**
 * @param {string} period
 * @param {string} [campusId]
 * @returns {TimeRange}
 */
function periodToMinutes(period, campusId = currentCampusId.value) {
  const periodInfo = periodIndex.value[period]
  if (!periodInfo) return { start: 0, end: 0 }
  const campus = currentTimes.value[campusId]?.periods?.[period]
  if (!campus) return { start: 0, end: 0 }
  return { start: campus.start, end: campus.end }
}

/**
 * @param {Course} course
 * @param {number} week
 * @returns {TimeRange|null}
 */
function getCourseTimeRange(course, week) {
  const context = scheduleDateContext(dateForWeekDay(week, course.day))
  const { startPeriod, endPeriod } = course
  const startMinutes = periodToMinutes(startPeriod).start
  const endMinutes = periodToMinutes(endPeriod).end
  if (startMinutes === 0 && endMinutes === 0) return null
  return { start: startMinutes, end: endMinutes }
}

/**
 * @param {TimeRange|null} range1
 * @param {TimeRange|null} range2
 * @returns {boolean}
 */
function timeOverlap(range1, range2) {
  if (!range1 || !range2) return false
  return range1.start < range2.end && range2.start < range1.end
}

/**
 * @param {number} courseDay
 * @param {number} targetDay
 * @returns {boolean}
 */
function dayMatches(courseDay, targetDay) {
  return courseDay === targetDay
}

/**
 * @param {Course} course
 * @param {number} week
 * @returns {boolean}
 */
function weekMatches(course, week) {
  return courseInWeek(course, week)
}

/**
 * @param {Course} newCourse
 * @param {Course[]} [existingCourses=[]]
 * @param {number|null} [targetWeek=null]
 * @returns {CourseConflict[]}
 */
export function detectCourseConflicts(newCourse, existingCourses = [], targetWeek = null) {
  if (!newCourse?.day || !newCourse?.startPeriod || !newCourse?.endPeriod) return []
  const conflicts = []
  const checkWeek = targetWeek ?? 1

  for (const course of existingCourses) {
    if (!isActiveEntity(course)) continue
    if (course.id === newCourse.id) continue
    if (!dayMatches(course.day, newCourse.day)) continue
    if (!weekMatches(course, checkWeek)) continue
    if (!weekMatches(newCourse, checkWeek)) continue

    const existingRange = getCourseTimeRange(course, checkWeek)
    const newRange = getCourseTimeRange(newCourse, checkWeek)

    if (timeOverlap(existingRange, newRange)) {
      conflicts.push({
        type: 'course-course',
        entityId: course.id,
        entityName: course.name,
        entityType: 'Course',
        existing: course,
        new: newCourse,
        week: checkWeek,
        day: course.day,
        timeRange: { start: Math.max(existingRange.start, newRange.start), end: Math.min(existingRange.end, newRange.end) },
        message: `与「${course.name}」时间冲突（第${checkWeek}周 周${'一二三四五六日'[course.day]} ${existingRange.start}-${existingRange.end}节）`
      })
    }
  }
  return conflicts
}

/**
 * @param {TaskEventItem} newItem
 * @param {TaskEventItem[]} [existingItems=[]]
 * @param {string} date
 * @param {'task'|'event'} [itemType='task']
 * @returns {TaskEventConflict[]}
 */
export function detectTaskEventConflicts(newItem, existingItems = [], date, itemType = 'task') {
  if (!newItem?.dueDate && !newItem?.date) return []
  const targetDate = newItem.dueDate || newItem.date
  if (targetDate !== date) return []

  const newTime = newItem.dueTime || newItem.time || '00:00'
  const [newHour, newMinute] = newTime.split(':').map(Number)
  const newStart = (newHour || 0) * 60 + (newMinute || 0)
  const newEnd = newStart + (newItem.estimatedMinutes || 60)

  const conflicts = []
  for (const item of existingItems) {
    if (!isActiveEntity(item)) continue
    if (item.id === newItem.id) continue
    const itemDate = item.dueDate || item.date
    if (itemDate !== targetDate) continue

    const itemTime = item.dueTime || item.time || '00:00'
    const [itemHour, itemMinute] = itemTime.split(':').map(Number)
    const itemStart = (itemHour || 0) * 60 + (itemMinute || 0)
    const itemEnd = itemStart + (item.estimatedMinutes || 60)

    if (timeOverlap({ start: newStart, end: newEnd }, { start: itemStart, end: itemEnd })) {
      conflicts.push({
        type: `${itemType}-${itemType === 'task' ? 'task' : 'event'}`,
        entityId: item.id,
        entityName: item.title || item.name || '',
        entityType: itemType === 'task' ? 'Task' : 'Event',
        existing: item,
        new: newItem,
        date: targetDate,
        timeRange: { start: Math.max(newStart, itemStart), end: Math.min(newEnd, itemEnd) },
        message: `与「${item.title || item.name}」时间冲突（${targetDate} ${newTime}-${String(Math.floor(newEnd/60)).padStart(2,'0')}:${String(newEnd%60).padStart(2,'0')}）`
      })
    }
  }
  return conflicts
}

/**
 * @param {{ type?: string } & (Course|TaskEventItem)} newItem
 * @param {{ courses?: Course[], tasks?: TaskEventItem[], events?: TaskEventItem[], milestones?: TaskEventItem[] }} [allData={}]
 * @param {{ checkCourses?: boolean, checkTasks?: boolean, checkEvents?: boolean, week?: number, date?: string }} [options={}]
 * @returns {Conflict[]}
 */
export function detectAllConflicts(newItem, allData = {}, options = {}) {
  const { courses = [], tasks = [], events = [], milestones = [] } = allData
  const conflicts = []

  if (newItem.type === 'course' || options.checkCourses) {
    conflicts.push(...detectCourseConflicts(newItem, courses, options.week))
  }

  if (newItem.type === 'task' || options.checkTasks) {
    const date = newItem.dueDate || options.date
    if (date) conflicts.push(...detectTaskEventConflicts(newItem, tasks, date, 'task'))
  }

  if (newItem.type === 'event' || options.checkEvents) {
    const date = newItem.date || options.date
    if (date) conflicts.push(...detectTaskEventConflicts(newItem, events, date, 'event'))
  }

  return conflicts
}

/**
 * @param {Conflict[]} conflicts
 * @returns {ConflictSummary}
 */
export function getConflictSummary(conflicts) {
  if (!conflicts.length) return { hasConflicts: false, count: 0, message: '' }
  const byType = {}
  for (const c of conflicts) {
    byType[c.type] = (byType[c.type] || 0) + 1
  }
  return {
    hasConflicts: true,
    count: conflicts.length,
    byType,
    message: `发现 ${conflicts.length} 个时间冲突：${Object.entries(byType).map(([t, n]) => `${n}个${t}`).join('、')}`
  }
}