import { coursesForDates } from '../store/schedule.js'
import { weatherOfMood, normalizeMoodLog } from '../mood.js'
import { policyDateKey, policyDateTime } from '../settingsPolicy.js'
import { isActiveEntity } from './state.js'
import { clock } from '../store/core.js'
import { mySpendCents } from '../ledgerSplit.js'
import { remainingTimeStages, taskTimeEntries } from '../tasks/taskTimePlan.ts'

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

function resolveRange(now, options = {}) {
  return options.range ?? weekRange(now, options)
}

function numeric(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function round2(value) {
  return Math.round(value * 100) / 100
}

export function weekRange(now = clock.value, { weekOffset = 0, timezone } = {}) {
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

export function selectWeeklyTaskSummary({ tasks = [] } = {}, now = clock.value, options = {}) {
  const range = resolveRange(now, options)
  const summary = { created: 0, completed: 0, homeworkCompleted: 0, reviewCompleted: 0, pending: 0, focusMinutes: 0 }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (timestampInRange(task.createdAt, range)) summary.created += 1
    if (timestampInRange(task.completedAt, range)) {
      summary.completed += 1
      if (task.kind === 'homework') summary.homeworkCompleted += 1
      if (task.kind === 'review') summary.reviewCompleted += 1
      summary.focusMinutes += numeric(task.estimateMinutes)
    }
    if (isActiveEntity(task) && task.status !== 'completed' && !task.done) summary.pending += 1
  }
  return summary
}

export function selectWeeklyFinanceSummary({ transactions = [], expenses = [] } = {}, now = clock.value, options = {}) {
  const range = resolveRange(now, options)
  const source = transactions.length ? transactions : expenses
  let count = 0
  let incomeTotal = 0
  let expenseTotal = 0
  const categoryMap = new Map()
  for (const item of Array.isArray(source) ? source : []) {
    if (!inRange(item.date, range)) continue
    // 与账本页同一口径：支出按「我实际承担」的份额算（未分摊的记录 = 记录金额）。
    // 金额非法时仍走 numeric 的旧兜底（0），不因为这个口径改动而改变容错行为。
    const spendCents = mySpendCents(item)
    const amount = spendCents === null ? numeric(item.amount) : spendCents / 100
    if (item.direction === 'income') {
      incomeTotal += amount
      count += 1
      continue
    }
    // 退款是冲抵项：冲抵支出、不计笔数、不进分类分布。
    if (item.direction === 'refund') {
      expenseTotal -= amount
      continue
    }
    expenseTotal += amount
    count += 1
    const key = item.cat || item.category || '未分类'
    categoryMap.set(key, (categoryMap.get(key) || 0) + amount)
  }
  return {
    count,
    income: round2(incomeTotal),
    expense: round2(expenseTotal),
    categories: [...categoryMap.entries()].map(([key, amount]) => ({ key, amount: round2(amount) })).sort((a, b) => b.amount - a.amount),
  }
}

export function selectWeeklyCourseSummary({ courses = [] } = {}, now = clock.value, options = {}) {
  const range = resolveRange(now, options)
  let sessions = 0
  const names = new Set()
  const dates = Array.from({ length: 7 }, (_, offset) => shiftDate(range.startDate, offset))
  const dailyCourses = coursesForDates(courses, dates)
  for (const daily of dailyCourses) {
    sessions += daily.length
    daily.forEach((course) => names.add(course.id))
  }
  return { sessions, courses: names.size }
}

export function selectWeeklyBillSummary({ bills = [], transactions = [], expenses = [] } = {}, now = clock.value, options = {}) {
  const range = resolveRange(now, options)
  const source = transactions.length ? transactions : expenses
  let paidAmount = 0
  const paidIds = new Set()
  for (const item of Array.isArray(source) ? source : []) {
    if (item.source !== 'bill' || !inRange(item.date, range)) continue
    paidIds.add(item.billId || item.id)
    paidAmount += numeric(item.amount)
  }
  let due = 0
  for (const bill of Array.isArray(bills) ? bills : []) {
    if (isActiveEntity(bill) && inRange(bill.nextDate, range)) due += 1
  }
  return {
    due,
    paid: paidIds.size,
    paidAmount: round2(paidAmount),
  }
}

export function selectWeeklyMoodSummary({ moodLog = {} } = {}, now = clock.value, options = {}) {
  const range = resolveRange(now, options)
  const normalized = normalizeMoodLog(moodLog)
  const counts = { sunny: 0, cloudy: 0, rain: 0 }
  for (const [date, entry] of Object.entries(normalized)) {
    if (inRange(date, range)) counts[weatherOfMood(entry.mood)] += 1
  }
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return { ...counts, days: counts.sunny + counts.cloudy + counts.rain, dominant: dominant?.[1] ? dominant[0] : '' }
}

function highlight(type, item, date, time = '') {
  return { key: `${type}:${item.id}`, sourceType: type, sourceId: item.id, title: item.title || item.name, date, time, entity: item }
}

export function selectNextWeekHighlights({ tasks = [], events = [], milestones = [], bills = [] } = {}, now = clock.value, { limit = 8, ...options } = {}) {
  const range = weekRange(now, { ...options, weekOffset: 1 })
  const items = []
  tasks.filter((task) => isActiveEntity(task) && !task.done && task.status !== 'completed' && task.status !== 'cancelled').forEach((task) => {
    const entry = taskTimeEntries({ ...task, timeStages: remainingTimeStages(task, now.getTime()) }).filter((item) => inRange(item.date, range) || (item.anchor === 'occupied' && item.date < range.endDate && item.endDate >= range.startDate)).sort((a, b) => a.date.localeCompare(b.date))[0]
    if (entry) items.push({ ...highlight('task', task, entry.date < range.startDate ? range.startDate : entry.date, entry.anchor === 'occupied' && entry.date < range.startDate ? '' : entry.time), stageId: entry.stageId, timeLabel: entry.anchor === 'occupied' ? `${entry.label} · ${entry.rangeText}` : `${entry.label}${entry.allDay ? ' · 全天' : !entry.time ? ' · 时刻待定' : ''}` })
  })
  events.filter(isActiveEntity).forEach((event) => { if (inRange(event.date, range)) items.push(highlight('event', event, event.date, event.time)) })
  milestones.filter(isActiveEntity).forEach((item) => { if (inRange(item.date, range)) items.push(highlight('milestone', item, item.date, item.time)) })
  bills.filter(isActiveEntity).forEach((bill) => { if (inRange(bill.nextDate, range)) items.push(highlight('bill', bill, bill.nextDate)) })
  const unique = [...new Map(items.map((item) => [item.key, item])).values()]
  return unique.sort((a, b) => `${a.date}T${a.time || '23:59'}`.localeCompare(`${b.date}T${b.time || '23:59'}`)).slice(0, limit)
}

export function selectWeeklyReview(data = {}, now = clock.value, options = {}) {
  const range = weekRange(now, options)
  const sharedOptions = { ...options, range }
  return {
    week: range,
    tasks: selectWeeklyTaskSummary(data, now, sharedOptions),
    courses: selectWeeklyCourseSummary(data, now, sharedOptions),
    finance: selectWeeklyFinanceSummary(data, now, sharedOptions),
    bills: selectWeeklyBillSummary(data, now, sharedOptions),
    mood: selectWeeklyMoodSummary(data, now, sharedOptions),
    nextWeek: selectNextWeekHighlights(data, now, sharedOptions),
  }
}
