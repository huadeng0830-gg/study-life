import { validClock } from './zonedTime.js'

export const INVITATION_WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** Shared by profile editing, saving and calendar expansion. Monday is 0.
 * An omitted weekday restriction means every day; [] explicitly pauses invites.
 * Legacy includeWeekends=false remains a weekday-only restriction until edited.
 */
export function normalizeAvailabilityPreferences(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const startTime = raw.startTime ?? '09:00', endTime = raw.endTime ?? '22:00'
  const start = validClock(startTime), end = validClock(endTime)
  const minimumMinutes = Number(raw.minimumMinutes ?? 30)
  const classBufferMinutes = Number(raw.classBufferMinutes ?? 0)
  const weekdays = raw.weekdays === undefined
    ? (raw.includeWeekends === false ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6])
    : raw.weekdays
  if (start === null || end === null || end <= start
      || !Number.isInteger(minimumMinutes) || minimumMinutes < 30 || minimumMinutes > 720
      || !Number.isInteger(classBufferMinutes) || classBufferMinutes < 0 || classBufferMinutes > 180
      || !Array.isArray(weekdays) || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null
  const days = [...new Set(weekdays)].sort((a, b) => a - b)
  return { startTime, endTime, minimumMinutes, classBufferMinutes, weekdays: days, includeWeekends: days.includes(5) || days.includes(6) }
}
