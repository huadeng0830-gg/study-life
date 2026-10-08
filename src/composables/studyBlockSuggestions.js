export const STUDY_DAY_START = 8 * 60
export const STUDY_DAY_END = 22 * 60
const SLOT_STEP = 5

export function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null
}

function clockText(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
}

function taskPriority(task) {
  return ({ urgent: 0, high: 0, medium: 1, normal: 2, low: 3 })[String(task?.priority || 'normal').toLowerCase()] ?? 2
}

function estimateOf(task) {
  const raw = Number(task?.estimateMinutes)
  if (!Number.isFinite(raw) || raw <= 0) return 25
  return Math.min(180, Math.max(10, Math.ceil(raw / SLOT_STEP) * SLOT_STEP))
}

/**
 * Place up to three actionable tasks in today's free time. Busy intervals are
 * supplied by the caller so this function stays independent of app storage.
 */
export function buildStudyBlockSuggestions({
  date,
  nowMinutes,
  tasks = [],
  busyIntervals = [],
  plannedTaskIds = [],
  limit = 3,
} = {}) {
  const planned = new Set(Array.from(plannedTaskIds, (id) => String(id)))
  const busy = (Array.isArray(busyIntervals) ? busyIntervals : [])
    .map((item) => ({ start: Number(item?.start), end: Number(item?.end) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .map((item) => ({ start: Math.max(STUDY_DAY_START, item.start), end: Math.min(STUDY_DAY_END, item.end) }))
    .filter((item) => item.end > item.start)

  const candidates = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task?.id != null
      && String(task.title || '').trim()
      && !task.done
      && !task.deletedAt
      && !task.tombstone
      && !task.archivedAt
      && !['completed', 'done', 'cancelled', 'archived'].includes(String(task.status || '').toLowerCase())
      && !planned.has(String(task.id)))
    .sort((left, right) => taskPriority(left) - taskPriority(right)
      || String(left.dueDate || '9999-99-99').localeCompare(String(right.dueDate || '9999-99-99'))
      || String(left.title).localeCompare(String(right.title), 'zh-CN'))

  const current = Number(nowMinutes)
  const firstSlot = Math.max(STUDY_DAY_START, Number.isFinite(current) ? Math.ceil(current / SLOT_STEP) * SLOT_STEP : STUDY_DAY_START)
  const results = []
  for (const task of candidates) {
    if (results.length >= Math.max(0, Number(limit) || 0)) break
    const duration = estimateOf(task)
    let start = null
    for (let slot = firstSlot; slot + duration <= STUDY_DAY_END; slot += SLOT_STEP) {
      const end = slot + duration
      if (!busy.some((interval) => slot < interval.end && end > interval.start)) {
        start = slot
        break
      }
    }
    if (start === null) continue
    const end = start + duration
    busy.push({ start, end })
    results.push({
      taskId: String(task.id),
      taskTitle: String(task.title).trim(),
      date,
      startTime: clockText(start),
      endTime: clockText(end),
      minutes: duration,
      courseId: String(task.courseId || ''),
      courseName: String(task.courseName || task.course || ''),
    })
  }
  return results
}
