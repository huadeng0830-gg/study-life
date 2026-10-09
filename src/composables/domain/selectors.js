import { TASK_PLAN_STATE, billStatus, isActiveEntity, isArchived, taskStatus } from './state.js'
import { countdownState } from '../store/countdown.js'
import { policyDateKey, policyDateTime } from '../settingsPolicy.js'
import { clock } from '../store/core.js'

function dateText(date) { return policyDateKey(date) }
function dateTime(date, time = '23:59') { return policyDateTime(date, time) }
function ref(type, item) { return `${type}:${item.id}` }

const TASK_PRIORITY_ORDER = Object.freeze({ high: 0, normal: 1, low: 2 })

function taskDueAt(task) {
  return task?.dueDate ? dateTime(task.dueDate, task.dueTime || '23:59') : Infinity
}

function planningStateFromStatus(task, status) {
  if (status === 'cancelled' || status === 'archived') return status
  if (status === 'completed') return TASK_PLAN_STATE.completed
  return task?.dueDate ? TASK_PLAN_STATE.scheduled : TASK_PLAN_STATE.unplanned
}

// 待办页一次装饰每条记录，再复用状态、截止时间和优先级，避免排序/筛选阶段重复派生。
/** @param {import('../../types/domain').Task[]} tasks */
export function selectTaskView(tasks = [], {
  now = clock.value,
  sortKey = 'due',
  filter = String(TASK_PLAN_STATE.scheduled),
  showHistory = false,
} = {}) {
  const counts = { unplanned: 0, scheduled: 0, done: 0, all: 0, archived: 0 }
  const rows = (Array.isArray(tasks) ? tasks : []).map((task) => {
    const archived = isArchived(task)
    const status = taskStatus(task, now)
    const row = {
      task,
      archived,
      status,
      planState: planningStateFromStatus(task, status),
      dueAt: taskDueAt(task),
      priorityOrder: TASK_PRIORITY_ORDER[task?.priority] ?? 1,
      createdAt: String(task?.createdAt ?? ''),
    }
    if (archived) counts.archived += 1
    else {
      counts.all += 1
      if (row.planState === TASK_PLAN_STATE.completed) counts.done += 1
      else if (row.planState === TASK_PLAN_STATE.scheduled) counts.scheduled += 1
      else if (row.planState === TASK_PLAN_STATE.unplanned) counts.unplanned += 1
    }
    return row
  })

  rows.sort((left, right) => {
    const leftCompleted = left.status === 'completed'
    const rightCompleted = right.status === 'completed'
    if (leftCompleted !== rightCompleted) return leftCompleted ? 1 : -1
    if (sortKey === 'priority') {
      const priorityDiff = left.priorityOrder - right.priorityOrder
      if (priorityDiff) return priorityDiff
      return left.dueAt - right.dueAt
    }
    if (sortKey === 'created') {
      const createdDiff = right.createdAt.localeCompare(left.createdAt)
      if (createdDiff) return createdDiff
      return left.dueAt - right.dueAt
    }
    const dueDiff = left.dueAt - right.dueAt
    if (dueDiff) return dueDiff
    return left.priorityOrder - right.priorityOrder
  })

  const current = rows.filter((row) => !row.archived)
  const visible = showHistory
    ? rows.filter((row) => row.archived)
    : filter === 'all'
      ? current
      : current.filter((row) => row.planState === filter)
  return { counts, visible: visible.map((row) => row.task) }
}

// 历史入口故意不复用“当前行动”过滤：完成、归档和已过期记录仍可被回放。
export function selectHistoricalItems(items = []) {
  return [...items].sort((a, b) => String(b.updatedAt || b.completedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.completedAt || a.createdAt || '')))
}

export function selectReminders({ tasks = [], bills = [], milestones = [], events = [] } = {}, now = clock.value, { limit = 8, excludeKeys = [] } = {}) {
  const today = dateText(now); const results = []
  const excludedKeys = new Set(excludeKeys)
  for (const task of tasks) {
    if (!isActiveEntity(task) || !task.dueDate) continue
    const status = taskStatus(task, now)
    if (status === 'completed' || status === 'cancelled' || status === 'archived') continue
    const dueAt = dateTime(task.dueDate, task.dueTime)
    const item = { key: ref('task', task), sourceType: 'task', sourceId: task.id, kind: status === 'overdue' ? 'overdue' : 'task', title: task.title, dueAt, priority: task.priority || 'normal', entity: task }
    if (!excludedKeys.has(item.key) && (status === 'overdue' || task.dueDate === today || dueAt - now.getTime() <= 7 * 86400000)) results.push(item)
  }
  for (const bill of bills) {
    if (!isActiveEntity(bill)) continue
    const status = billStatus(bill, now); const dueAt = bill.nextDate ? dateTime(bill.nextDate) : Infinity
    const item = { key: ref('bill', bill), sourceType: 'bill', sourceId: bill.id, kind: status, title: bill.name, dueAt, priority: status === 'overdue' || status === 'due' ? 'high' : 'normal', entity: bill }
    if (!excludedKeys.has(item.key) && ((status === 'due' || status === 'overdue') || (status === 'upcoming' && dueAt - now.getTime() <= Number(bill.remindDays ?? 3) * 86400000))) results.push(item)
  }
  for (const milestone of Array.isArray(milestones) ? milestones : []) {
    if (!isActiveEntity(milestone)) continue
    const countdown = countdownState(milestone, now)
    const item = { key: ref('milestone', milestone), sourceType: 'milestone', sourceId: milestone.id, kind: 'milestone', title: milestone.name, dueAt: countdown.sortValue, priority: countdown.cls === 'hot' ? 'high' : 'normal', entity: milestone }
    if (!excludedKeys.has(item.key) && !countdown.isPast && countdown.sortValue - now.getTime() <= 14 * 86400000) results.push(item)
  }
  for (const event of events) {
    if (!isActiveEntity(event)) continue
    const dueAt = event.date ? dateTime(event.date, event.time || '23:59') : Infinity
    const item = { key: ref('event', event), sourceType: 'event', sourceId: event.id, kind: 'event', title: event.title, dueAt, priority: 'normal', entity: event }
    if (!excludedKeys.has(item.key) && dueAt >= now.getTime() && dueAt - now.getTime() <= 7 * 86400000) results.push(item)
  }
  return results.sort((a, b) => (a.kind === 'overdue' ? -1 : b.kind === 'overdue' ? 1 : a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : a.dueAt - b.dueAt)).slice(0, limit)
}

export function selectActionCenter(data = {}, now = clock.value, { excludeKeys = [] } = {}) {
  const today = dateText(now); const reminders = selectReminders(data, now, { limit: 12, excludeKeys }); const seen = new Set()
  const take = (predicate, limit) => reminders.filter((item) => { if (seen.has(item.key) || !predicate(item)) return false; seen.add(item.key); return true }).slice(0, limit)
  return { urgent: take((item) => item.kind === 'overdue' || item.priority === 'high', 3), today: take((item) => item.entity?.dueDate === today || item.entity?.nextDate === today || item.entity?.date === today, 6), soon: take(() => true, 5) }
}

// Today 只消费这一份行动投影：风险项和普通行动共享同一组 source key，避免一件事在首页出现两次。
export function selectTodayActionPanels(data = {}, now = clock.value) {
  const center = selectActionCenter(data, now)
  const risk = center.urgent.slice(0, 3)
  const riskKeys = new Set(risk.map((item) => item.key))
  const actions = [...center.today, ...center.soon]
    .filter((item) => !riskKeys.has(item.key))
    .slice(0, 3)
  return { risk, actions }
}

export function reminderAction(item) {
  if (item?.sourceType === 'task') return { action: 'complete', targetType: 'task', targetId: item.sourceId }
  if (item?.sourceType === 'bill') return { action: 'pay', targetType: 'bill', targetId: item.sourceId }
  if (item?.sourceType === 'milestone') return { action: 'view', targetType: 'milestone', targetId: item.sourceId }
  if (item?.sourceType === 'event') return { action: 'view', targetType: 'event', targetId: item.sourceId }
  return { action: 'view', targetType: item?.sourceType || '', targetId: item?.sourceId || '' }
}
