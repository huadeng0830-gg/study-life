import { clock } from './core.js'
import { todayStr, dayName } from './utils.js'

function localDate(year, month, day, time = '') {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay), hour, minute, 0, 0)
}

function dayStart(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function countdownTarget(item, now = clock.value) {
  const [year, month, day] = String(item.date ?? '').split('-').map(Number)
  if (!year || !month || !day) return null
  const hasTime = Boolean(item.time)
  let target = localDate(year, month - 1, day, item.time)

  if (item.repeat === 'yearly') {
    target = localDate(now.getFullYear(), month - 1, day, item.time)
    const passed = hasTime
      ? target.getTime() < now.getTime()
      : dayStart(target).getTime() < dayStart(now).getTime()
    if (passed) target = localDate(now.getFullYear() + 1, month - 1, day, item.time)
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
    const days = Math.round((dayStart(target) - dayStart(now)) / 86400000)
    if (days > 0) {
      return { text: String(days), label: '天', cls: '', isPast: false, target, sortValue: target.getTime(), days }
    }
    if (days === 0) {
      return { text: '今天', label: '就是今天', cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
    }
    return { text: '已结束', label: `${-days} 天前`, cls: 'past', isPast: true, target, sortValue: target.getTime(), days }
  }

  const diff = target.getTime() - now.getTime()
  if (diff < 0) {
    const hoursAgo = Math.max(1, Math.ceil(-diff / 3600000))
    const label = hoursAgo < 24 ? `${hoursAgo} 小时前` : `${Math.ceil(hoursAgo / 24)} 天前`
    return { text: '已结束', label, cls: 'past', isPast: true, target, sortValue: target.getTime(), days: -1 }
  }

  const minutes = Math.max(1, Math.ceil(diff / 60000))
  if (minutes < 60) {
    return { text: String(minutes), label: '分钟', cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
  }
  const hours = Math.ceil(diff / 3600000)
  if (hours < 24) {
    return { text: String(hours), label: '小时', cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
  }
  const days = Math.ceil(diff / 86400000)
  return { text: String(days), label: '天', cls: '', isPast: false, target, sortValue: target.getTime(), days }
}

export function fmtCountdownDate(item, target = countdownTarget(item)) {
  if (!target) return ''
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][target.getDay()]
  const date = `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日 ${week}`
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