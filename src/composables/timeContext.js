import { computed } from 'vue'
import { clock } from './store/core.js'
import { weekOf } from './store/schedule.js'
import { settingsPolicy, policyDateKey, policyTimeKey, policyDateTime, cachedDateFormatter } from './settingsPolicy.js'
import { formatRelativeTime } from '../utils/formatters.js'

const DAY = 24 * 60 * 60 * 1000

export function getCurrentAppTime(value = clock.value) {
  return new Date(value)
}

export function getAppToday(value = clock.value, timezone = settingsPolicy.value.timezone) {
  return policyDateKey(value, timezone)
}

export function getAppTime(value = clock.value, timezone = settingsPolicy.value.timezone) {
  return policyTimeKey(value, timezone)
}

export function appDateTime(date, time = '23:59', timezone = settingsPolicy.value.timezone) {
  return policyDateTime(date, time, timezone)
}

export function addAppDays(dateKey, amount, timezone = settingsPolicy.value.timezone) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return ''
  const timestamp = policyDateTime(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, '12:00', timezone)
  if (!Number.isFinite(timestamp)) return ''
  return getAppToday(new Date(timestamp + Number(amount || 0) * DAY), timezone)
}

export function appCalendarDaysBetween(fromDateKey, toDateKey) {
  const from = Date.parse(`${fromDateKey}T00:00:00Z`)
  const to = Date.parse(`${toDateKey}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return NaN
  return Math.round((to - from) / DAY)
}

export function formatAppDate(value, { withWeekday = true, timezone = settingsPolicy.value.timezone } = {}) {
  const source = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
    ? new Date(appDateTime(value, '12:00', timezone))
    : new Date(value)
  if (Number.isNaN(source.getTime())) return ''
  // 复用 settingsPolicy 的 formatter 缓存：Intl.DateTimeFormat 的**构造**比
  // format 本身贵一个数量级，而这里的调用点有 5 个在 v-for / 列表行里
  // （bills、EventsView、TasksView、TodayView 等）。
  return cachedDateFormatter(timezone, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {}),
  }).format(source)
}

// 所有用户可见的“现在/今天/本周”判断共享同一响应式时钟。
export const appNow = computed(() => getCurrentAppTime(clock.value))
export const appTimezone = computed(() => settingsPolicy.value.timezone)
export const appToday = computed(() => getAppToday(appNow.value, appTimezone.value))
export const todayKey = appToday
export const currentWeek = computed(() => weekOf(appToday.value))
export const currentDayIndex = computed(() => {
  const day = new Date(`${appToday.value}T00:00:00Z`).getUTCDay()
  return day === 0 ? 6 : day - 1
})
export const startOfDay = computed(() => appDateTime(appToday.value, '00:00', appTimezone.value))
export const endOfDay = computed(() => appDateTime(appToday.value, '23:59', appTimezone.value))

export function useTimeContext() {
  return { appNow, appToday, appTimezone, todayKey, currentWeek, currentDayIndex, startOfDay, endOfDay }
}

export { formatRelativeTime }
