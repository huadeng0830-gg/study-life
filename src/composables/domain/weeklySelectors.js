import { coursesForDate } from '../store/schedule.js'
import { weatherOfMood, normalizeMoodLog } from '../mood.js'
import { policyDateKey, policyDateTime } from '../settingsPolicy.js'
import { isActiveEntity } from './state.js'

function dateFromKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function keyFromDate(date) {
  return date.toISOString().slice(0, 10)
}

function shiftDate(key, amount) {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + amount)
  return keyFromDate(date)
}

function inRange(key, range) {
  return Boolean(key) && key >= range.startDate && key < range.endDate
}

function numeric(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function round2(value) {
  return Math.round(value * 100) / 100
}

export function weekRange(now = new Date(), { weekOffset = 0, timezone } = {}) {
  const today = policyDateKey(now, timezone)
  const date = dateFromKey(today)
  const day = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1) + Number(weekOffset || 0) * 7)
  const startDate = keyFromDate(date)
  const endDate = shiftDate(startDate, 7)
  return {
    startDate,
    endDate,
    startAt: policyDateTime(startDate, '00:00', timezone),
    endAt: policyDateTime(endDate, '00:00', timezone),
  }
}

function timestampInRange(value, range) {
  const timestamp = new Date(value || '').getTime()
  return Number.isFinite(timestamp) && timestamp >= range.startAt && timestamp < range.endAt
}

export function selectWeeklyTaskSummary({ tasks = [] } = {}, now = new Date(), options = {}) {
  const range = weekRange(now, options)
  const created = tasks.filter((task) => timestampInRange(task.createdAt, range))
  const completed = tasks.filter((task) => timestampInRange(task.completedAt, range))
  const active = tasks.filter(isActiveEntity)
  return {
    created: created.length,
    completed: completed.length,
    homeworkCompleted: completed.filter((task) => task.kind === 'homework').length,
    reviewCompleted: completed.filter((task) => task.kind === 'review').length,
    pending: active.filter((task) => task.status !== 'completed' && !task.done).length,
    focusMinutes: completed.reduce((sum, task) => sum + numeric(task.estimateMinutes), 0),
  }
}

export function selectWeeklyFinanceSummary({ transactions = [], expenses = [] } = {}, now = new Date(), options = {}) {
  const range = weekRange(now, options)
  const source = transactions.length ? transactions : expenses
  const items = source.filter((item) => inRange(item.date, range))
  const income = items.filter((item) => item.direction === 'income')
  const expense = items.filter((item) => item.direction !== 'income')
  const categoryMap = new Map()
  for (const item of expense) {
    const key = item.cat || item.category || '未分类'
    categoryMap.set(key, (categoryMap.get(key) || 0) + numeric(item.amount))
  }
  return {
    count: items.length,
    income: round2(income.reduce((sum, item) => sum + numeric(item.amount), 0)),
    expense: round2(expense.reduce((sum, item) => sum + numeric(item.amount), 0)),
    categories: [...categoryMap.entries()].map(([key, amount]) => ({ key, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
  }
}

export function selectWeeklyCourseSummary({ courses = [] } = {}, now = new Date(), options = {}) {
  const range = weekRange(now, options)
  let sessions = 0
  const names = new Set()
  for (let offset = 0; offset < 7; offset++) {
    const date = shiftDate(range.startDate, offset)
    const daily = coursesForDate(courses, date)
    sessions += daily.length
    daily.forEach((course) => names.add(course.id))
  }
  return { sessions, courses: names.size }
}

export function selectWeeklyBillSummary({ bills = [], transactions = [], expenses = [] } = {}, now = new Date(), options = {}) {
  const range = weekRange(now, options)
  const source = transactions.length ? transactions : expenses
  const paid = source.filter((item) => item.source === 'bill' && inRange(item.date, range))
  const due = bills.filter((bill) => isActiveEntity(bill) && inRange(bill.nextDate, range))
  return {
    due: due.length,
    paid: new Set(paid.map((item) => item.billId || item.id)).size,
    paidAmount: round2(paid.reduce((sum, item) => sum + numeric(item.amount), 0)),
  }
}

export function selectWeeklyMoodSummary({ moodLog = {} } = {}, now = new Date(), options = {}) {
  const range = weekRange(now, options)
  const normalized = normalizeMoodLog(moodLog)
  const counts = { sunny: 0, cloudy: 0, rain: 0 }
  for (const [date, entry] of Object.entries(normalized)) {
    if (inRange(date, range)) counts[weatherOfMood(entry.mood)] += 1
  }
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return { ...counts, days: counts.sunny + counts.cloudy + counts.rain, dominant: dominant?.[1] ? dominant[0] : '' }
}

export function selectWeeklyNoteSummary({ notes = [] } = {}, now = new Date(), options = {}) {
  const range = weekRange(now, options)
  return { created: notes.filter((note) => timestampInRange(note.createdAt, range)).length }
}

function highlight(type, item, date, time = '') {
  return { key: `${type}:${item.id}`, sourceType: type, sourceId: item.id, title: item.title || item.name, date, time, entity: item }
}

export function selectNextWeekHighlights({ tasks = [], events = [], milestones = [], bills = [] } = {}, now = new Date(), { limit = 8, ...options } = {}) {
  const range = weekRange(now, { ...options, weekOffset: 1 })
  const items = []
  tasks.filter(isActiveEntity).forEach((task) => { if (inRange(task.dueDate, range)) items.push(highlight('task', task, task.dueDate, task.dueTime)) })
  events.filter(isActiveEntity).forEach((event) => { if (inRange(event.date, range)) items.push(highlight('event', event, event.date, event.time)) })
  milestones.filter(isActiveEntity).forEach((item) => { if (inRange(item.date, range)) items.push(highlight('milestone', item, item.date, item.time)) })
  bills.filter(isActiveEntity).forEach((bill) => { if (inRange(bill.nextDate, range)) items.push(highlight('bill', bill, bill.nextDate)) })
  const unique = [...new Map(items.map((item) => [item.key, item])).values()]
  return unique.sort((a, b) => `${a.date}T${a.time || '23:59'}`.localeCompare(`${b.date}T${b.time || '23:59'}`)).slice(0, limit)
}

export function selectWeeklyReview(data = {}, now = new Date(), options = {}) {
  return {
    week: weekRange(now, options),
    tasks: selectWeeklyTaskSummary(data, now, options),
    courses: selectWeeklyCourseSummary(data, now, options),
    finance: selectWeeklyFinanceSummary(data, now, options),
    bills: selectWeeklyBillSummary(data, now, options),
    mood: selectWeeklyMoodSummary(data, now, options),
    notes: selectWeeklyNoteSummary(data, now, options),
    nextWeek: selectNextWeekHighlights(data, now, options),
  }
}
