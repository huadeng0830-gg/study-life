import { clock } from './core.js'
import { settingsPolicy, policyDateKey, policyDateTime } from '../settingsPolicy.js'
import { formatRelativeTime } from '../../utils/formatters.js'

function localDate(year, month, day, time = '', timezone = settingsPolicy.value.timezone) {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  return new Date(policyDateTime(date, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, timezone))
}

function appDayStart(date, timezone = settingsPolicy.value.timezone) {
  return policyDateTime(policyDateKey(date, timezone), '00:00', timezone)
}

export function countdownTarget(item, now = clock.value) {
  const [year, month, day] = String(item.date ?? '').split('-').map(Number)
  if (!year || !month || !day) return null
  const hasTime = Boolean(item.time)
  let target = localDate(year, month - 1, day, item.time)

  if (item.repeat === 'yearly') {
    const currentDate = policyDateKey(now)
    const currentYear = Number(currentDate.slice(0, 4))
    target = localDate(currentYear, month - 1, day, item.time)
    const passed = hasTime
      ? target.getTime() < now.getTime()
      : appDayStart(target) < appDayStart(now)
    if (passed) target = localDate(currentYear + 1, month - 1, day, item.time)
  }
  return target
}

export function countdownState(item, now = clock.value) {
  const target = countdownTarget(item, now)
  if (!target) {
    return { text: '无日期', label: '', cls: 'past', isPast: true, target: null, sortValue: Infinity }
  }

  const hasTime = Boolean(item.time)
  if (!hasTime) {
    const targetKey = policyDateKey(target)
    const nowKey = policyDateKey(now)
    const days = Math.round((appDayStart(target) - appDayStart(now)) / 86400000)
    if (days > 0) {
      return { text: String(days), label: '天', relativeText: formatRelativeTime(days * 86400000, { mode: 'date', calendarDays: days }), cls: '', isPast: false, target, sortValue: target.getTime(), days, targetKey, nowKey }
    }
    if (days === 0) {
      return { text: '今天', label: '就是今天', relativeText: '今天', cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0, targetKey, nowKey }
    }
    return { text: '已结束', label: `${-days} 天前`, relativeText: formatRelativeTime(days * 86400000, { mode: 'date', calendarDays: days }), cls: 'past', isPast: true, target, sortValue: target.getTime(), days, targetKey, nowKey }
  }

  const diff = target.getTime() - now.getTime()
  if (diff < 0) {
    return { text: '已结束', label: formatRelativeTime(diff, { pastPrefix: '' }), relativeText: formatRelativeTime(diff, { pastPrefix: '' }), cls: 'past', isPast: true, target, sortValue: target.getTime(), days: -1 }
  }

  const relativeText = formatRelativeTime(diff, { futurePrefix: '' })
  const minutes = Math.max(1, Math.ceil(diff / 60000))
  if (minutes < 60) {
    return { text: String(minutes), label: '分钟', relativeText, cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
  }
  const hours = Math.ceil(diff / 3600000)
  if (hours < 24) {
    return { text: String(hours), label: '小时', relativeText, cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
  }
  const days = Math.ceil(diff / 86400000)
  return { text: String(days), label: '天', relativeText, cls: '', isPast: false, target, sortValue: target.getTime(), days }
}

export function fmtCountdownDate(item, target = countdownTarget(item)) {
  if (!target) return ''
  const dateKey = policyDateKey(target)
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${dateKey}T00:00:00Z`).getUTCDay()]
  const date = `${Number(dateKey.slice(0, 4))}年${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日 ${week}`
  return item.time ? `${date} ${item.time}` : date
}

export function sortCountdowns(items, now = clock.value) {
  return items
    .map((item) => ({ ...item, countdown: countdownState(item, now) }))
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      if (a.countdown.isPast !== b.countdown.isPast) return a.countdown.isPast ? 1 : -1
      return a.countdown.sortValue - b.countdown.sortValue
    })
}
