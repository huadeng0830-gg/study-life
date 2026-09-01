export const FOCUS_TYPES = Object.freeze(['free', 'temporary', 'todo-linked'])

export const DEFAULT_FOCUS_SETTINGS = Object.freeze({
  quickTimes: [15, 25, 45, 60],
  lastUsedMinutes: 25,
  recentTemporaries: [],
  soundEnabled: true,
  vibrationEnabled: true,
  systemNotificationEnabled: true,
})

const QUICK_TIMES_LIMIT = 4
const MIN_FOCUS_MINUTES = 5
const MAX_FOCUS_MINUTES = 180
const MAX_RECENT_TEMPORARIES = 3

function isFocusType(value) {
  return FOCUS_TYPES.includes(value)
}

export function normalizeFocusSettings(raw) {
  const base = { ...DEFAULT_FOCUS_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) }
  let quickTimes = Array.isArray(base.quickTimes)
    ? base.quickTimes.map(Number).filter((value) => Number.isFinite(value) && value >= MIN_FOCUS_MINUTES && value <= MAX_FOCUS_MINUTES)
    : []
  quickTimes = [...new Set(quickTimes.map((value) => Math.round(value)))].slice(0, QUICK_TIMES_LIMIT)
  if (quickTimes.length !== QUICK_TIMES_LIMIT) quickTimes = [...DEFAULT_FOCUS_SETTINGS.quickTimes]

  const lastUsed = Number(base.lastUsedMinutes)
  const lastUsedMinutes = Number.isFinite(lastUsed) && lastUsed >= MIN_FOCUS_MINUTES && lastUsed <= MAX_FOCUS_MINUTES ? Math.round(lastUsed) : 25

  const recentTemporaries = Array.isArray(base.recentTemporaries)
    ? base.recentTemporaries.map(String).map((value) => value.trim()).filter(Boolean).slice(0, MAX_RECENT_TEMPORARIES)
    : []

  return {
    quickTimes,
    lastUsedMinutes,
    recentTemporaries,
    soundEnabled: base.soundEnabled !== false,
    vibrationEnabled: base.vibrationEnabled !== false,
    systemNotificationEnabled: base.systemNotificationEnabled !== false,
  }
}

export function pushRecentTemporary(settings, title) {
  const normalized = normalizeFocusSettings(settings)
  const text = String(title || '').trim()
  if (!text) return normalized
  const recentTemporaries = [text, ...normalized.recentTemporaries.filter((item) => item !== text)].slice(0, MAX_RECENT_TEMPORARIES)
  return { ...normalized, recentTemporaries }
}

export function createFocusSessionId() {
  return `focus_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function normalizeActiveSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const oldTaskId = String(raw.todoId || raw.taskId || '')
  let focusType = raw.focusType
  if (!isFocusType(focusType)) {
    if (oldTaskId) focusType = 'todo-linked'
    else if (String(raw.title || raw.label || '').trim() && String(raw.label || raw.title || '').trim() !== '自由专注') focusType = 'temporary'
    else focusType = 'free'
  }
  const plannedMinutes = Math.max(1, Math.round(Number(raw.plannedMinutes) || Number(raw.durationMinutes) || 25))
  const plannedSeconds = plannedMinutes * 60
  let elapsedSeconds = Number(raw.elapsedSeconds)
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    const remaining = Number(raw.remainingSeconds)
    elapsedSeconds = Number.isFinite(remaining) && raw.pausedAt ? Math.max(0, plannedSeconds - remaining) : 0
  }
  const startedAt = raw.startedAt || new Date().toISOString()
  return {
    sessionId: String(raw.sessionId || raw.id || createFocusSessionId()),
    focusType,
    title: focusType === 'free' ? '' : String(raw.title ?? raw.label ?? '').trim(),
    todoId: oldTaskId || null,
    courseId: String(raw.courseId || ''),
    plannedMinutes,
    startedAt,
    segmentStartedAt: raw.segmentStartedAt || startedAt,
    elapsedSeconds: Math.max(0, Math.floor(elapsedSeconds)),
    pausedAt: raw.pausedAt || null,
    pausedDurationSeconds: Math.max(0, Math.floor(Number(raw.pausedDurationSeconds) || Number(raw.pausedDuration) || 0)),
    status: raw.status || (raw.pausedAt ? 'paused' : 'running'),
  }
}

export function focusActualSeconds(session, now = Date.now()) {
  const active = normalizeActiveSession(session)
  if (!active) return 0
  const accumulated = Math.max(0, Number(active.elapsedSeconds) || 0)
  if (active.pausedAt) return accumulated
  const segmentStarted = new Date(active.segmentStartedAt || active.startedAt).getTime()
  const segmentElapsed = Number.isFinite(segmentStarted)
    ? Math.max(0, Math.floor((new Date(now).getTime() - segmentStarted) / 1000))
    : 0
  return accumulated + segmentElapsed
}

export function focusPlannedSeconds(session) {
  const active = normalizeActiveSession(session)
  return active ? Math.max(1, active.plannedMinutes) * 60 : 0
}

export function focusRemainingSeconds(session, now = Date.now()) {
  return Math.max(0, focusPlannedSeconds(session) - focusActualSeconds(session, now))
}

export function focusOvertimeSeconds(session, now = Date.now()) {
  return Math.max(0, focusActualSeconds(session, now) - focusPlannedSeconds(session))
}

export function focusDisplayState(session, now = Date.now()) {
  const actual = focusActualSeconds(session, now)
  const planned = focusPlannedSeconds(session)
  const overtime = Math.max(0, actual - planned)
  return {
    actualSeconds: actual,
    plannedSeconds: planned,
    remainingSeconds: Math.max(0, planned - actual),
    overtimeSeconds: overtime,
    hasCompletedPlan: actual >= planned,
  }
}

export function buildFocusSession(active, endedAt = new Date().toISOString(), status = 'completed') {
  const normalized = normalizeActiveSession(active)
  if (!normalized) return null
  const actual = focusActualSeconds(normalized, endedAt)
  let pausedDurationSeconds = normalized.pausedDurationSeconds
  if (normalized.pausedAt) {
    const pausedStart = new Date(normalized.pausedAt).getTime()
    const end = new Date(endedAt).getTime()
    if (Number.isFinite(pausedStart) && Number.isFinite(end)) {
      pausedDurationSeconds += Math.max(0, Math.floor((end - pausedStart) / 1000))
    }
  }
  const planned = normalized.plannedMinutes * 60
  const safeStatus = Number.isFinite(Number(status)) || !status ? (actual >= planned ? 'completed' : 'stopped') : status
  return {
    id: normalized.sessionId,
    sessionId: normalized.sessionId,
    focusType: normalized.focusType,
    title: normalized.title,
    todoId: normalized.todoId,
    courseId: normalized.courseId,
    plannedMinutes: normalized.plannedMinutes,
    actualFocusSeconds: actual,
    startedAt: normalized.startedAt,
    endedAt,
    pausedDuration: pausedDurationSeconds,
    status: safeStatus,
  }
}

export function normalizeFocusSession(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.sessionId || raw.id || `focus_${Date.now()}_${index}`)
  const oldTaskId = String(raw.todoId || raw.taskId || '')
  let focusType = raw.focusType
  if (!isFocusType(focusType)) {
    if (oldTaskId) focusType = 'todo-linked'
    else if (String(raw.title || raw.label || '').trim() && String(raw.title || raw.label || '').trim() !== '自由专注') focusType = 'temporary'
    else focusType = 'free'
  }
  const plannedMinutes = Math.max(1, Math.round(Number(raw.plannedMinutes) || Number(raw.minutes) || 25))
  const actual = Number(raw.actualFocusSeconds)
  const actualFocusSeconds = Number.isFinite(actual) && actual >= 0
    ? Math.round(actual)
    : Math.max(0, Math.round((Number(raw.minutes) || 0) * 60))
  return {
    id,
    sessionId: id,
    focusType,
    title: focusType === 'free' ? '' : String(raw.title ?? raw.label ?? '').trim(),
    todoId: oldTaskId || null,
    courseId: String(raw.courseId || ''),
    plannedMinutes,
    actualFocusSeconds,
    startedAt: String(raw.startedAt || ''),
    endedAt: String(raw.endedAt || ''),
    pausedDuration: Math.max(0, Math.round(Number(raw.pausedDuration) || 0)),
    status: String(raw.status || raw.result || (actualFocusSeconds >= plannedMinutes * 60 ? 'completed' : 'stopped')),
  }
}

export function formatFocusDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes <= 0) return `${total}秒`
  return rest ? `${minutes}分${rest}秒` : `${minutes}分钟`
}
