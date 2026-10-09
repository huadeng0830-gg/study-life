import { isArchived } from '../domain/state.js'
import { validEventDate, validEventTime } from './eventFields.js'

export const EVENT_FILTERS = Object.freeze([
  { key: 'upcoming', label: '即将到来' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'unplanned', label: '待安排' },
  { key: 'past', label: '已过去' },
  { key: 'archived', label: '已归档' },
])

export function shiftEventDate(date, days) {
  if (!validEventDate(date)) return ''
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function shiftEventMonth(month, amount) {
  if (!/^\d{4}-\d{2}$/.test(month)) return ''
  const value = new Date(`${month}-01T12:00:00Z`)
  if (!Number.isFinite(value.getTime())) return ''
  value.setUTCMonth(value.getUTCMonth() + amount)
  return value.toISOString().slice(0, 7)
}

export function eventWeek(today) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const start = shiftEventDate(today, -((weekday + 6) % 7))
  return { start, end: shiftEventDate(start, 6) }
}

export function eventState(event, today, time = '') {
  if (isArchived(event)) return { key: 'archived', label: '已归档' }
  if (!validEventDate(event.date)) return { key: 'unplanned', label: '待安排' }
  if (event.date < today) return { key: 'past', label: '已结束' }
  if (event.date > today) return { key: 'upcoming', label: '即将到来' }
  if (!validEventTime(event.time) || event.time > time) return { key: 'today', label: '今天' }
  if (validEventTime(event.endTime) && event.endTime > event.time) {
    return event.endTime <= time ? { key: 'past', label: '已结束' } : { key: 'ongoing', label: '进行中' }
  }
  return { key: 'started', label: '已开始' }
}

export function compareEvents(a, b, descending = false) {
  const aDate = validEventDate(a.date) ? a.date : '9999-99-99'
  const bDate = validEventDate(b.date) ? b.date : '9999-99-99'
  const dateOrder = aDate.localeCompare(bDate)
  if (dateOrder) return descending ? -dateOrder : dateOrder
  const timeOrder = String(a.time || '').localeCompare(String(b.time || ''))
  if (timeOrder) return descending ? -timeOrder : timeOrder
  return String(a.id).localeCompare(String(b.id))
}

// Counts, calendar markers and the list share one search projection.
export function selectEventPlan(events = [], { today, time = '', query = '', filter = 'upcoming' } = {}) {
  const text = query.trim().toLocaleLowerCase()
  const week = eventWeek(today)
  const counts = Object.fromEntries(EVENT_FILTERS.map((item) => [item.key, 0]))
  const matched = []
  const visible = []
  for (const event of events) {
    if (!event || event.deletedAt || event.tombstone || event.active === false) continue
    if (text && ![event.title, event.location, event.note, event.courseName, event.date].some((value) => String(value || '').toLocaleLowerCase().includes(text))) continue
    const state = eventState(event, today, time)
    const scopes = isArchived(event) ? ['archived'] : [
      ...(state.key === 'unplanned' ? ['unplanned'] : state.key === 'past' ? ['past'] : ['upcoming']),
      ...(event.date === today ? ['today'] : []),
      ...(validEventDate(event.date) && event.date >= week.start && event.date <= week.end ? ['week'] : []),
    ]
    for (const scope of scopes) counts[scope]++
    matched.push(event)
    if (scopes.includes(filter)) visible.push(event)
  }
  visible.sort((a, b) => compareEvents(a, b, filter === 'past'))
  const candidates = matched.filter((event) => !isArchived(event) && validEventDate(event.date) && eventState(event, today, time).key !== 'past')
    .sort((a, b) => compareEvents(a, b))
  const next = candidates.find((event) => eventState(event, today, time).key === 'ongoing')
    || candidates.find((event) => event.time && (event.date > today || event.time >= time))
    || candidates.find((event) => !event.time) || null
  return { counts, matched, visible, next }
}

export function eventCalendarDays(month, events = []) {
  const first = `${month}-01`
  if (!validEventDate(first)) return []
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7
  const start = shiftEventDate(first, -weekday)
  const byDate = new Map()
  for (const event of events) {
    if (!validEventDate(event.date)) continue
    if (!byDate.has(event.date)) byDate.set(event.date, [])
    byDate.get(event.date).push(event)
  }
  return Array.from({ length: 42 }, (_, index) => {
    const date = shiftEventDate(start, index)
    return { date, day: Number(date.slice(-2)), inMonth: date.startsWith(month), events: (byDate.get(date) || []).sort(compareEvents) }
  })
}

export function eventRows(events) {
  const counts = new Map()
  const dateOf = (event) => validEventDate(event.date) ? event.date : ''
  for (const event of events) counts.set(dateOf(event), (counts.get(dateOf(event)) || 0) + 1)
  return events.map((event, index) => ({ id: event.id, event, startsGroup: index === 0 || dateOf(event) !== dateOf(events[index - 1]), count: counts.get(dateOf(event)) }))
}

export function eventDuration(event) {
  if (!validEventTime(event.time) || !validEventTime(event.endTime) || event.endTime <= event.time) return ''
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  const duration = minutes(event.endTime) - minutes(event.time)
  return duration >= 60 ? `${Math.floor(duration / 60)} 小时${duration % 60 ? ` ${duration % 60} 分钟` : ''}` : `${duration} 分钟`
}
