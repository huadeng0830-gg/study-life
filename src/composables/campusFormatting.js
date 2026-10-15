/**
 * Campus date and time formatting.
 *
 * Every campus surface renders timestamps, and each one used to carry its own
 * `Intl.DateTimeFormat` — or, in one case, a raw `String(value).slice(0, 10)`
 * that did not format anything at all. That produced eight different renderings
 * of the same value and one screen showing raw ISO text to users.
 *
 * These five shapes are the ones the UI actually needs. They are deliberately
 * the *whole* vocabulary: if a screen needs a sixth shape, add it here so the
 * choice stays visible instead of being re-invented per view.
 */

/**
 * Postgres `date` columns arrive as `YYYY-MM-DD`. `new Date('2026-03-04')`
 * parses that as UTC midnight, which renders as the *previous* day for anyone
 * west of Greenwich — the bug that made lost-and-found dates quietly wrong.
 * Date-only strings are formatted from their parts, with no timezone involved.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function dateOnlyParts(value) {
  const match = DATE_ONLY.exec(String(value).trim())
  if (!match) return null
  const [, year, month, day] = match
  return { year, month, day }
}

function partsFromDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fromNumber = new Date(value)
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const FORMATTERS = Object.freeze({
  // 「更新于 2026/03/04」
  date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
  // 举报记录需要分钟级精度，用户要核对「我什么时候提交的」。
  dateTime: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  // 列表卡片空间有限，只保留月日。
  monthDay: new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }),
  // 活动、集市需要知道「哪天的几点」，年份由页面上下文保证。
  monthDayTime: new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  weekdayDateTime: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' }),
})

function format(shape, value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback
  const only = dateOnlyParts(value)
  if (only) {
    const parsed = new Date(Number(only.year), Number(only.month) - 1, Number(only.day))
    return Number.isNaN(parsed.getTime()) ? fallback : FORMATTERS[shape].format(parsed)
  }
  const parsed = partsFromDate(value)
  return parsed ? FORMATTERS[shape].format(parsed) : fallback
}

/** 完整日期，形如 `2026/03/04`。 */
export function campusDateLabel(value, fallback = '') { return format('date', value, fallback) }

/** 完整日期与分钟，用于需要核对操作时刻的记录。 */
export function campusDateTimeLabel(value, fallback = '') { return format('dateTime', value, fallback) }

/** 月日，形如 `03/04`；用于卡片里空间有限的次要信息。 */
export function campusMonthDayLabel(value, fallback = '') { return format('monthDay', value, fallback) }

/** 月日与时分，形如 `03/04 18:30`；用于活动与班次时间。 */
export function campusMonthDayTimeLabel(value, fallback = '') { return format('monthDayTime', value, fallback) }

/** 带星期的完整时间，形如 `2026/03/04 周三 18:30`；用于校园活动。 */
export function campusWeekdayDateTimeLabel(value, fallback = '') { return format('weekdayDateTime', value, fallback) }

/** `datetime-local` 输入框需要的本地 `YYYY-MM-DDTHH:mm`，不做时区换算。 */
export function campusLocalDateTimeInput(value) {
  const date = partsFromDate(value)
  if (!date) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}