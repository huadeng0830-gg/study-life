import { formatRelativeTime } from '../utils/formatters.js'

export function courseTiming(startAt, endAt, now = new Date()) {
  const start = Number(startAt)
  const end = Number(endAt)
  const current = now instanceof Date ? now.getTime() : Number(now)
  if (![start, end, current].every(Number.isFinite)) return { state: 'unknown', text: '' }
  if (current >= end) return { state: 'ended', text: '已结束' }
  if (current >= start) {
    const remaining = end - current
    return {
      state: 'active',
      text: remaining > 0 ? `上课中 · ${formatRelativeTime(remaining, { futurePrefix: '还剩' })}` : '上课中',
    }
  }
  return { state: 'upcoming', text: formatRelativeTime(start - current, { futurePrefix: '距开始' }) }
}
