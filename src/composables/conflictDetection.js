import { isActiveEntity } from './domain/state.js'
import { hmText } from '../utils/formatters.js'
import { taskOccupiedRanges } from './tasks/taskTimePlan'
import { policyDateTime } from './settingsPolicy.js'

// 多阶段待办只检查明确占用的区间，截止和办理窗口不会占用日程。
export function detectTimePlanConflicts(newItem, existingItems = [], itemType = 'task') {
  const rangesOf = (item) => Array.isArray(item.timeStages) ? taskOccupiedRanges(item)
    : item.date && item.time && item.endTime ? [{ start: policyDateTime(item.date, item.time), end: policyDateTime(item.date, item.endTime), label: item.title || '', stageId: '' }] : []
  const ranges = rangesOf(newItem)
  const conflicts = []
  const compare = (range, existingRange, item, internal = false) => {
    if (!(range.start < existingRange.end && existingRange.start < range.end)) return
    const existingType = item.timeStages || item.dueDate ? 'task' : 'event'
    conflicts.push({ type: `${itemType}-${existingType}`, entityId: item.id, entityName: item.title || item.name || '', entityType: existingType === 'task' ? 'Task' : 'Event', existing: item, new: newItem,
      date: newItem.timeStages?.find((stage) => stage.id === range.stageId)?.start?.date || newItem.date,
      timeRange: { start: Math.max(range.start, existingRange.start), end: Math.min(range.end, existingRange.end) },
      message: internal ? `「${range.label}」与「${existingRange.label}」的占用时间重叠` : `「${range.label}」与「${item.title || item.name}」${existingRange.label ? `的「${existingRange.label}」` : ''}时间重叠` })
  }
  ranges.forEach((range, index) => ranges.slice(index + 1).forEach((other) => compare(range, other, newItem, true)))
  for (const item of existingItems) {
    if (!isActiveEntity(item) || item.id === newItem.id || item.done || item.status === 'completed' || item.status === 'cancelled') continue
    for (const range of ranges) for (const existingRange of rangesOf(item)) compare(range, existingRange, item)
  }
  return conflicts
}

/** @typedef {{ start: number, end: number }} TimeRange */
/** @typedef {{ id: string|number, name: string, day: number, startPeriod: string, endPeriod: string, startWeek?: number, endWeek?: number, weekType?: 'all'|'odd'|'even' }} Course */
/** @typedef {{ id: string|number, title?: string, name?: string, dueDate?: string, date?: string, dueTime?: string, time?: string, endTime?: string, estimateMinutes?: number }} TaskEventItem */
/** @typedef {{ type: string, entityId: string|number, entityName: string, entityType: string, existing: Course|TaskEventItem, new: Course|TaskEventItem }} ConflictBase */
/** @typedef {ConflictBase & { type: 'course-course', week: number, day: number, timeRange: TimeRange, message: string }} CourseConflict */
/** @typedef {ConflictBase & { type: 'task-task'|'task-event'|'event-task'|'event-event', date: string, timeRange: TimeRange, message: string }} TaskEventConflict */
/** @typedef {CourseConflict|TaskEventConflict} Conflict */
/** @typedef {{ hasConflicts: boolean, count: number, byType: Record<string, number>, message: string }} ConflictSummary */

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
 * @param {TaskEventItem} newItem
 * @param {TaskEventItem[]} [existingItems=[]]
 * @param {string} date
 * @param {'task'|'event'} [itemType='task']
 * @returns {TaskEventConflict[]}
 */
export function detectTaskEventConflicts(newItem, existingItems = [], date, itemType = 'task') {
  if (itemType === 'task' || newItem?.timeStages?.length) return detectTimePlanConflicts(newItem, existingItems, itemType)
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

  const conflicts = itemType === 'event' ? detectTimePlanConflicts(newItem, existingItems.filter((item) => item.timeStages?.length), 'event') : []
  for (const item of existingItems) {
    if (!isActiveEntity(item)) continue
    if (item.id === newItem.id) continue
    if (item.timeStages?.length || item.dueDate) continue
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
        message: `与「${item.title || item.name}」时间冲突（${targetDate} ${newTime}-${hmText(Math.floor(newEnd / 60), newEnd % 60)}）`
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
    message: `发现 ${conflicts.length} 个时间冲突，请检查以下安排。`
  }
}