import { currentTimes, periodIndex } from './store/timeConfig.js'
import { scheduleDateContext, courseInWeek, dateForWeekDay } from './store/schedule.js'
import { isActiveEntity } from './domain/state.js'

/** @typedef {{ start: number, end: number }} TimeRange */
/** @typedef {{ id: string|number, name: string, day: number, startPeriod: string, endPeriod: string, startWeek?: number, endWeek?: number, weekType?: 'all'|'odd'|'even' }} Course */
/** @typedef {{ id: string|number, title?: string, name?: string, dueDate?: string, date?: string, dueTime?: string, time?: string, endTime?: string, estimateMinutes?: number }} TaskEventItem */
/** @typedef {{ type: string, entityId: string|number, entityName: string, entityType: string, existing: Course|TaskEventItem, new: Course|TaskEventItem }} ConflictBase */
/** @typedef {ConflictBase & { type: 'course-course', week: number, day: number, timeRange: TimeRange, message: string }} CourseConflict */
/** @typedef {ConflictBase & { type: 'task-task'|'task-event'|'event-task'|'event-event', date: string, timeRange: TimeRange, message: string }} TaskEventConflict */
/** @typedef {CourseConflict|TaskEventConflict} Conflict */
/** @typedef {{ hasConflicts: boolean, count: number, byType: Record<string, number>, message: string }} ConflictSummary */

/**
 * 取某个「节次 id」对应的起止分钟数。
 *
 * 【这里原本整体是坏的】store/timeConfig.js 导出的 currentTimes / periodIndex /
 * currentCampusId 都是**普通函数**，不是 ref，原代码却当 ref 用
 * （`currentCampusId.value`、`periodIndex.value[period]`、`currentTimes.value[campusId]`）——
 * 函数没有 .value，于是 `undefined[period]` 直接抛 TypeError。
 * 而且形状也不对：currentTimes() 返回的是**按节次顺序排好的数组**
 * [{start,end}, ...]，不是 `object[campusId].periods[periodId]`。
 *
 * 之前没人发现，是因为课程冲突这一整条链路根本没有调用方（只有
 * detectTaskEventConflicts 接进了界面）。等课程编辑器真的用它时才会炸，
 * 所以这里一次性把取值方式和形状都对齐。
 *
 * @param {string} period 节次 id（如 timeConfig.periods[i].id）
 * @returns {TimeRange}
 */
function periodToMinutes(period) {
  const index = periodIndex(period)
  if (index < 0) return { start: 0, end: 0 }
  const row = currentTimes()[index]
  if (!row) return { start: 0, end: 0 }
  const toMinutes = (value) => {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return 0
    const hours = Number(match[1]); const minutes = Number(match[2])
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : 0
  }
  return { start: toMinutes(row.start), end: toMinutes(row.end) }
}

/**
 * @param {Course} course
 * @param {number} week
 * @returns {TimeRange|null}
 */
function getCourseTimeRange(course, week) {
  scheduleDateContext(dateForWeekDay(week, course.day))
  // 课程上存的是 start / end 两个节次 id，不是 startPeriod / endPeriod
  // （见 domain/commands.js 的 createCourse）。原来解构不存在的字段，
  // 就算把上面的 .value 修好也永远拿到 undefined，一次冲突都检测不出来。
  const start = periodToMinutes(course.start)
  const end = periodToMinutes(course.end)
  if (start.start === 0 && end.end === 0) return null
  return { start: start.start, end: end.end }
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
  if (!newCourse || newCourse.day === undefined || newCourse.day === null || !newCourse.start || !newCourse.end) return []
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

  const newTime = newItem.dueTime || newItem.time
  // 只有日期的任务/日程没有可比较的时间区间，不应被当作午夜的一小时。
  if (!newTime) return []
  const [newHour, newMinute] = newTime.split(':').map(Number)
  const newStart = (newHour || 0) * 60 + (newMinute || 0)
  const newEnd = newItem.endTime
    ? timeToMinutes(newItem.endTime)
    : newStart + (Number(newItem.estimateMinutes) || 60)

  const conflicts = []
  for (const item of existingItems) {
    if (!isActiveEntity(item)) continue
    if (item.id === newItem.id) continue
    const itemDate = item.dueDate || item.date
    if (itemDate !== targetDate) continue

    const itemTime = item.dueTime || item.time
    if (!itemTime) continue
    const [itemHour, itemMinute] = itemTime.split(':').map(Number)
    const itemStart = (itemHour || 0) * 60 + (itemMinute || 0)
    const itemEnd = item.endTime
      ? timeToMinutes(item.endTime)
      : itemStart + (Number(item.estimateMinutes) || 60)

    if (timeOverlap({ start: newStart, end: newEnd }, { start: itemStart, end: itemEnd })) {
      const existingType = item.dueDate ? 'task' : 'event'
      conflicts.push({
        type: `${itemType}-${existingType}`,
        entityId: item.id,
        entityName: item.title || item.name || '',
        entityType: existingType === 'task' ? 'Task' : 'Event',
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

/** @param {string} value */
function timeToMinutes(value) {
  const [hour, minute] = value.split(':').map(Number)
  return (hour || 0) * 60 + (minute || 0)
}

/**
 * @param {{ type?: string } & (Course|TaskEventItem)} newItem
 * @param {{ courses?: Course[], tasks?: TaskEventItem[], events?: TaskEventItem[], milestones?: TaskEventItem[] }} [allData={}]
 * @param {{ checkCourses?: boolean, checkTasks?: boolean, checkEvents?: boolean, week?: number, date?: string }} [options={}]
 * @returns {Conflict[]}
 */
export function detectAllConflicts(newItem, allData = {}, options = {}) {
  const { courses = [], tasks = [], events = [] } = allData
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
