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
  const actual = Math.max(Number(task.actualMinutes) || 0, (Number(task.focusTotalSeconds) || 0) / 60)
  const remaining = raw - Math.max(0, actual)
  // An unfinished task can still need another session after its original estimate.
  return remaining > 0 ? Math.min(45, Math.max(10, Math.ceil(remaining / SLOT_STEP) * SLOT_STEP)) : 25
}

export function studyFreeIntervals(busyIntervals = [], nowMinutes = STUDY_DAY_START, bufferMinutes = 10) {
  const current = Number(nowMinutes)
  const start = Math.max(STUDY_DAY_START, Number.isFinite(current) ? Math.ceil(current / SLOT_STEP) * SLOT_STEP : STUDY_DAY_START)
  const buffer = Math.max(0, Math.min(60, Number(bufferMinutes) || 0))
  const busy = busyIntervals
    .map((item) => ({ start: Number(item?.start) - buffer, end: Number(item?.end) + buffer }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start)
  const gaps = []
  let cursor = start
  for (const interval of busy) {
    if (interval.end <= cursor || interval.start >= STUDY_DAY_END) continue
    if (interval.start > cursor) gaps.push({ start: cursor, end: Math.min(STUDY_DAY_END, interval.start) })
    cursor = Math.max(cursor, interval.end)
  }
  if (cursor < STUDY_DAY_END) gaps.push({ start: cursor, end: STUDY_DAY_END })
  return gaps
}

function deadlineRank(task, date) {
  if (task.dueDate && task.dueDate < date) return 0
  if (task.dueDate === date) return 1
  return 2
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
  bufferMinutes = 10,
} = {}) {
  const planned = new Set(Array.from(plannedTaskIds, (id) => String(id)))
  const gaps = studyFreeIntervals(Array.isArray(busyIntervals) ? busyIntervals : [], nowMinutes, bufferMinutes)

  const candidates = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task?.id != null
      && String(task.title || '').trim()
      && !task.done
      && !task.deletedAt
      && !task.tombstone
      && !task.archivedAt
      && !['completed', 'done', 'cancelled', 'archived'].includes(String(task.status || '').toLowerCase())
      && !planned.has(String(task.id)))
    .sort((left, right) => deadlineRank(left, date) - deadlineRank(right, date)
      || String(left.dueDate || '9999-99-99').localeCompare(String(right.dueDate || '9999-99-99'))
      || String(left.dueTime || '23:59').localeCompare(String(right.dueTime || '23:59'))
      || taskPriority(left) - taskPriority(right)
      || Number(right.status === 'in_progress') - Number(left.status === 'in_progress')
      || String(left.title).localeCompare(String(right.title), 'zh-CN'))

  const results = []
  for (const task of candidates) {
    if (results.length >= Math.max(0, Number(limit) || 0)) break
    const duration = estimateOf(task)
    const deadline = task.dueDate === date ? clockMinutes(task.dueTime) : null
    const current = Number(nowMinutes)
    // When the deadline has already passed, offer a recovery session instead.
    const latestEnd = deadline !== null && deadline > current ? deadline : STUDY_DAY_END
    const gap = gaps.find((item) => Math.min(item.end, latestEnd) - Math.ceil(item.start / SLOT_STEP) * SLOT_STEP >= 10)
    if (!gap) continue
    const start = Math.ceil(gap.start / SLOT_STEP) * SLOT_STEP
    const minutes = Math.min(duration, Math.floor((Math.min(gap.end, latestEnd) - start) / SLOT_STEP) * SLOT_STEP)
    const end = start + minutes
    gap.start = end + Math.max(0, Number(bufferMinutes) || 0)
    results.push({
      taskId: String(task.id),
      taskTitle: String(task.title).trim(),
      date,
      startTime: clockText(start),
      endTime: clockText(end),
      minutes,
      partial: minutes < duration || Number(task.estimateMinutes) - (Number(task.actualMinutes) || 0) > minutes,
      reason: task.dueDate < date ? '已逾期，先推进一步' : task.dueDate === date ? '今天截止' : task.status === 'in_progress' ? '接着上次的进度' : '利用课间空档',
      courseId: String(task.courseId || ''),
      courseName: String(task.courseName || task.course || ''),
    })
  }
  return results
}
