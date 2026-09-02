import { computed } from 'vue'
import { useStoredRef } from './store/index.js'
import { currentCampusId, currentSeasonId } from './store/timeConfig.js'

export const DEFAULT_SETTINGS_POLICY = Object.freeze({
  clipboardHint: true,
  recentTypes: [],
  timezone: 'local',
  defaultAccount: '',
  defaultReminders: Object.freeze({ task: 1440, event: 30, milestone: 1440 }),
})

export const TIMEZONE_OPTIONS = Object.freeze([
  { value: 'local', label: '跟随系统时区' },
  { value: 'Asia/Shanghai', label: '中国标准时间（Asia/Shanghai）' },
  { value: 'UTC', label: '协调世界时（UTC）' },
])

export const settings = useStoredRef('sl_quick_record_settings', DEFAULT_SETTINGS_POLICY)

function validTimezone(value) {
  const candidate = String(value || 'local')
  return TIMEZONE_OPTIONS.some((item) => item.value === candidate) ? candidate : 'local'
}

function positiveOrZero(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback
}

export function resolveSettingsPolicy() {
  const raw = settings.value && typeof settings.value === 'object' ? settings.value : {}
  const reminders = raw.defaultReminders && typeof raw.defaultReminders === 'object' ? raw.defaultReminders : {}
  return {
    timezone: validTimezone(raw.timezone),
    campusId: currentCampusId(),
    seasonId: currentSeasonId(),
    defaultAccount: String(raw.defaultAccount || '').trim(),
    defaultReminders: {
      task: positiveOrZero(reminders.task, DEFAULT_SETTINGS_POLICY.defaultReminders.task),
      event: positiveOrZero(reminders.event, DEFAULT_SETTINGS_POLICY.defaultReminders.event),
      milestone: positiveOrZero(reminders.milestone, DEFAULT_SETTINGS_POLICY.defaultReminders.milestone),
    },
    quickRecord: {
      clipboardHint: raw.clipboardHint !== false,
      recentTypes: Array.isArray(raw.recentTypes) ? raw.recentTypes : [],
    },
  }
}

export const settingsPolicy = computed(resolveSettingsPolicy)

export function defaultAccount(value = '') {
  return String(value || '').trim() || settingsPolicy.value.defaultAccount
}

export function defaultReminderMinutes(type, value) {
  const explicit = Number(value)
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit)
  return settingsPolicy.value.defaultReminders[type] ?? 0
}

function formatter(timezone, options) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone === 'local' ? undefined : timezone, ...options })
}

function formattedParts(value, timezone = settingsPolicy.value.timezone) {
  const parts = formatter(timezone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
}

export function policyDateKey(value = new Date(), timezone = settingsPolicy.value.timezone) {
  const parts = formattedParts(value, timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function policyTimeKey(value = new Date(), timezone = settingsPolicy.value.timezone) {
  const parts = formattedParts(value, timezone)
  return `${parts.hour}:${parts.minute}`
}

// 将“配置时区中的日期时间”转换为时间戳；local 保持浏览器原有语义。
export function policyDateTime(date, time = '23:59', timezone = settingsPolicy.value.timezone) {
  if (!date) return NaN
  if (timezone === 'local') return new Date(`${date}T${time || '23:59'}`).getTime()
  const [year, month, day] = String(date).split('-').map(Number)
  const [hour = 23, minute = 59] = String(time || '23:59').split(':').map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const parts = formattedParts(guess, timezone)
  const displayedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  return guess - (displayedAsUtc - guess)
}

export function schedulePolicy() {
  const policy = settingsPolicy.value
  return { campusId: policy.campusId, seasonId: policy.seasonId }
}
