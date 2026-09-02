import { billStatus, isActiveEntity, isTaskActionable, taskStatus } from './state.js'
import { sortCountdowns } from '../store/countdown.js'
import { policyDateKey, policyDateTime } from '../settingsPolicy.js'

function dateText(date) { return policyDateKey(date) }
function dateTime(date, time = '23:59') { return policyDateTime(date, time) }
function ref(type, item) { return `${type}:${item.id}` }

// 历史入口故意不复用“当前行动”过滤：完成、归档和已过期记录仍可被回放。
export function selectHistoricalItems(items = []) {
  return [...items].sort((a, b) => String(b.updatedAt || b.completedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.completedAt || a.createdAt || '')))
}

export function selectReminders({ tasks = [], bills = [], milestones = [], events = [] } = {}, now = new Date(), { limit = 8, excludeKeys = [] } = {}) {
  const today = dateText(now); const results = []
  const excludedKeys = new Set(excludeKeys)
  for (const task of tasks) {
    if (!isActiveEntity(task) || !isTaskActionable(task, now) || !task.dueDate) continue
    const dueAt = dateTime(task.dueDate, task.dueTime); const status = taskStatus(task, now)
    const item = { key: ref('task', task), sourceType: 'task', sourceId: task.id, kind: status === 'overdue' ? 'overdue' : 'task', title: task.title, dueAt, priority: task.priority || 'normal', entity: task }
    if (!excludedKeys.has(item.key) && (status === 'overdue' || task.dueDate === today || dueAt - now.getTime() <= 7 * 86400000)) results.push(item)
  }
  for (const bill of bills) {
    if (!isActiveEntity(bill)) continue
    const status = billStatus(bill, now); const dueAt = bill.nextDate ? dateTime(bill.nextDate) : Infinity
    const item = { key: ref('bill', bill), sourceType: 'bill', sourceId: bill.id, kind: status, title: bill.name, dueAt, priority: status === 'overdue' || status === 'due' ? 'high' : 'normal', entity: bill }
    if (!excludedKeys.has(item.key) && ((status === 'due' || status === 'overdue') || (status === 'upcoming' && dueAt - now.getTime() <= Number(bill.remindDays ?? 3) * 86400000))) results.push(item)
  }
  for (const milestone of sortCountdowns(milestones.filter(isActiveEntity), now)) {
    const item = { key: ref('milestone', milestone), sourceType: 'milestone', sourceId: milestone.id, kind: 'milestone', title: milestone.name, dueAt: milestone.countdown.sortValue, priority: milestone.countdown.cls === 'hot' ? 'high' : 'normal', entity: milestone }
    if (!excludedKeys.has(item.key) && !milestone.countdown.isPast && milestone.countdown.sortValue - now.getTime() <= 14 * 86400000) results.push(item)
  }
  for (const event of events) {
    if (!isActiveEntity(event)) continue
    const dueAt = event.date ? dateTime(event.date, event.time || '23:59') : Infinity
    const item = { key: ref('event', event), sourceType: 'event', sourceId: event.id, kind: 'event', title: event.title, dueAt, priority: 'normal', entity: event }
    if (!excludedKeys.has(item.key) && dueAt >= now.getTime() && dueAt - now.getTime() <= 7 * 86400000) results.push(item)
  }
  return results.sort((a, b) => (a.kind === 'overdue' ? -1 : b.kind === 'overdue' ? 1 : a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : a.dueAt - b.dueAt)).slice(0, limit)
}

export function selectActionCenter(data = {}, now = new Date(), { excludeKeys = [] } = {}) {
  const today = dateText(now); const reminders = selectReminders(data, now, { limit: 12, excludeKeys }); const seen = new Set()
  const take = (predicate, limit) => reminders.filter((item) => { if (seen.has(item.key) || !predicate(item)) return false; seen.add(item.key); return true }).slice(0, limit)
  return { urgent: take((item) => item.kind === 'overdue' || item.priority === 'high', 3), today: take((item) => item.entity?.dueDate === today || item.entity?.nextDate === today || item.entity?.date === today, 6), soon: take(() => true, 5) }
}

// Today 只消费这一份行动投影：风险项和普通行动共享同一组 source key，避免一件事在首页出现两次。
export function selectTodayActionPanels(data = {}, now = new Date()) {
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

// 首页的“今日行动清单”同样只是一层投影：课程、待办、日程、节点和账单仍由各自模块拥有。
export function selectDayAgenda({ courses = [], tasks = [], bills = [], milestones = [], events = [] } = {}, now = new Date(), { limit = 8, excludeTypes = [], excludeKeys = [] } = {}) {
  const today = dateText(now)
  const results = []
  const excludedTypes = new Set(excludeTypes)
  const excludedKeys = new Set(excludeKeys)
  const add = (item) => {
    if (!excludedTypes.has(item.sourceType) && !excludedKeys.has(item.key)) results.push(item)
  }
  for (const course of courses) {
    if (!isActiveEntity(course)) continue
    add({ key: ref('course', course), sourceType: 'course', sourceId: course.id, kind: 'course', title: course.name, time: course.time || '', meta: course.room || '', dueAt: dateTime(today, course.time || '23:59'), entity: course })
  }
  for (const task of tasks) {
    if (!isActiveEntity(task) || !isTaskActionable(task, now) || !task.dueDate) continue
    const status = taskStatus(task, now)
    if (status === 'overdue' || task.dueDate === today) add({ key: ref('task', task), sourceType: 'task', sourceId: task.id, kind: status, title: task.title, time: task.dueTime || '', meta: task.course || '', dueAt: dateTime(task.dueDate, task.dueTime), entity: task })
  }
  for (const event of events) {
    if (!isActiveEntity(event)) continue
    if (event.date === today) add({ key: ref('event', event), sourceType: 'event', sourceId: event.id, kind: 'event', title: event.title, time: event.time || '', meta: event.courseName || '', dueAt: dateTime(today, event.time || '23:59'), entity: event })
  }
  for (const milestone of milestones) {
    if (!isActiveEntity(milestone)) continue
    if (milestone.date === today) add({ key: ref('milestone', milestone), sourceType: 'milestone', sourceId: milestone.id, kind: 'milestone', title: milestone.name, time: '', meta: '今天到期', dueAt: dateTime(today), entity: milestone })
  }
  for (const bill of bills) {
    if (!isActiveEntity(bill)) continue
    const status = billStatus(bill, now)
    if (status === 'due' || status === 'overdue') add({ key: ref('bill', bill), sourceType: 'bill', sourceId: bill.id, kind: status, title: bill.name, time: '', meta: `¥${Number(bill.amount || 0).toFixed(2)}`, dueAt: dateTime(bill.nextDate || today), entity: bill })
  }
  return results.sort((a, b) => (a.kind === 'overdue' ? -1 : b.kind === 'overdue' ? 1 : a.dueAt - b.dueAt || a.title.localeCompare(b.title, 'zh-CN'))).slice(0, limit)
}
