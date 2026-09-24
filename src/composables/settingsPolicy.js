import { computed } from 'vue'
// 只依赖 core，避免时间工具 -> 设置策略 -> store/index -> countdown 的循环依赖。
import { clock, useStoredRef } from './store/core.js'
import { currentCampusId, currentSeasonId } from './store/timeConfig.js'
import { autoSyncEnabled as boundAutoSyncEnabled } from './syncSpace.js'

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
    autoSyncEnabled: boundAutoSyncEnabled.value,
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
  // Number(null) 和 Number('') 都等于 0，会让「没填提醒时间」被当成
  // 「提前 0 分钟提醒」，等于到点才提醒。空值必须先回退到设置里的默认值。
  if (value === null || value === undefined || value === '') {
    return settingsPolicy.value.defaultReminders[type] ?? 0
  }
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

export function policyDateKey(value = clock.value, timezone = settingsPolicy.value.timezone) {
  const parts = formattedParts(value, timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function policyTimeKey(value = clock.value, timezone = settingsPolicy.value.timezone) {
  const parts = formattedParts(value, timezone)
  return `${parts.hour}:${parts.minute}`
}

/**
 * 把各种形态的时间戳统一成毫秒数。
 *
 * 历史数据里的 createdAt 既可能是 ISO 字符串（commands.js 的 stamp()），
 * 也可能是毫秒数字（scheduleRecognition.js 写过 Date.now()）。
 * 直接 `Date.parse(毫秒数字)` 会得到 NaN，于是"最近使用"加权、
 * 重复记账提醒这类依赖时间差的逻辑会静默失效（而不是报错）。
 */
export function timestampOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value ?? '').trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) {
    const numeric = Number(text)
    return Number.isFinite(numeric) ? numeric : 0
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 把 createdAt 归一到「应用时区下的日期」（YYYY-MM-DD）。
 *
 * 原来各处用 `String(createdAt).slice(0, 10)` 直接切 ISO 字符串，取到的是
 * **UTC 日期**；而业务的 `date` 字段走 policyDateKey（本地或用户配置的时区）。
 * 在 UTC+8 的 00:00–08:00 两者会差一天，月度/年度回顾会把笔记算进前一天，
 * 数字形态的 createdAt 更会直接得到空字符串。
 */
export function createdDateKey(value, timezone) {
  const stamp = timestampOf(value)
  if (!stamp) return ''
  return policyDateKey(new Date(stamp), timezone)
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
