import { billStatus, isTaskActionable, taskStatus } from './state.js'
import { sortCountdowns } from '../store/countdown.js'

function dateText(date) { const d = new Date(date); const p = (v) => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
function dateTime(date, time = '23:59') { return new Date(`${date}T${time}`).getTime() }
function ref(type, item) { return `${type}:${item.id}` }

export function selectReminders({ tasks = [], bills = [], milestones = [], events = [] } = {}, now = new Date(), { limit = 8 } = {}) {
  const today = dateText(now); const results = []
  for (const task of tasks) {
    if (!isTaskActionable(task, now) || !task.dueDate) continue
    const dueAt = dateTime(task.dueDate, task.dueTime); const status = taskStatus(task, now)
    if (status === 'overdue' || task.dueDate === today || dueAt - now.getTime() <= 7 * 86400000) results.push({ key: ref('task', task), sourceType: 'task', sourceId: task.id, kind: status === 'overdue' ? 'overdue' : 'task', title: task.title, dueAt, priority: task.priority || 'normal', entity: task })
  }
  for (const bill of bills) {
    const status = billStatus(bill, now); const dueAt = bill.nextDate ? dateTime(bill.nextDate) : Infinity
    if ((status === 'due' || status === 'overdue') || (status === 'upcoming' && dueAt - now.getTime() <= Number(bill.remindDays ?? 3) * 86400000)) results.push({ key: ref('bill', bill), sourceType: 'bill', sourceId: bill.id, kind: status, title: bill.name, dueAt, priority: status === 'overdue' || status === 'due' ? 'high' : 'normal', entity: bill })
  }
  for (const item of sortCountdowns(milestones, now)) if (!item.countdown.isPast && item.countdown.sortValue - now.getTime() <= 14 * 86400000) results.push({ key: ref('milestone', item), sourceType: 'milestone', sourceId: item.id, kind: 'milestone', title: item.name, dueAt: item.countdown.sortValue, priority: item.countdown.cls === 'hot' ? 'high' : 'normal', entity: item })
  for (const event of events) { const dueAt = event.date ? dateTime(event.date, event.time || '23:59') : Infinity; if (dueAt >= now.getTime() && dueAt - now.getTime() <= 7 * 86400000) results.push({ key: ref('event', event), sourceType: 'event', sourceId: event.id, kind: 'event', title: event.title, dueAt, priority: 'normal', entity: event }) }
  return results.sort((a, b) => (a.kind === 'overdue' ? -1 : b.kind === 'overdue' ? 1 : a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : a.dueAt - b.dueAt)).slice(0, limit)
}

export function selectActionCenter(data = {}, now = new Date()) {
  const today = dateText(now); const reminders = selectReminders(data, now, { limit: 12 }); const seen = new Set()
  const take = (predicate, limit) => reminders.filter((item) => { if (seen.has(item.key) || !predicate(item)) return false; seen.add(item.key); return true }).slice(0, limit)
  return { urgent: take((item) => item.kind === 'overdue' || item.priority === 'high', 3), today: take((item) => item.entity?.dueDate === today || item.entity?.nextDate === today || item.entity?.date === today, 6), soon: take(() => true, 5) }
}
