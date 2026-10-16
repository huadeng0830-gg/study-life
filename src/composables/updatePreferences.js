import { reactive, ref } from 'vue'

// 键名统一用 sl_ 前缀：本机数据清空、用量统计、安全镜像与存储清单都按这个前缀识别。
// 旧键（study_life_update_preferences_v1）会在首次读取时迁移过来，用户偏好不丢。
export const UPDATE_PREFERENCES_KEY = 'sl_update_preferences_v1'
export const LEGACY_UPDATE_PREFERENCES_KEY = 'study_life_update_preferences_v1'
// 「稍后提醒」的静默期。没有它时点一次就是**永久静音该版本**，
// 用户会以为「有新版本」的提示坏了 —— 这也是「必须退出重进才知道能更新」的一部分成因。
export const DEFER_REMINDER_TTL_MS = 24 * 60 * 60 * 1000

const DEFAULTS = Object.freeze({ autoCheck: true, showReminder: true, autoApply: true, deferredVersion: '', deferredAt: 0 })
const BOOLEAN_PREFERENCES = new Set(['autoCheck', 'showReminder', 'autoApply'])

function normalize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULTS }
  const deferredAt = Number(value.deferredAt)
  return {
    autoCheck: typeof value.autoCheck === 'boolean' ? value.autoCheck : DEFAULTS.autoCheck,
    showReminder: typeof value.showReminder === 'boolean' ? value.showReminder : DEFAULTS.showReminder,
    autoApply: typeof value.autoApply === 'boolean' ? value.autoApply : DEFAULTS.autoApply,
    deferredVersion: typeof value.deferredVersion === 'string' ? value.deferredVersion.slice(0, 120) : '',
    // 旧格式没有时间戳：0 表示「静默期视为已过」，于是历史遗留的永久静音会被自动解除一次。
    deferredAt: Number.isFinite(deferredAt) && deferredAt > 0 ? deferredAt : 0,
  }
}

function readRaw(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}

function readPreferences() {
  const current = readRaw(UPDATE_PREFERENCES_KEY)
  if (current) return normalize(current)
  const legacy = readRaw(LEGACY_UPDATE_PREFERENCES_KEY)
  if (!legacy) return { ...DEFAULTS }
  const migrated = normalize(legacy)
  try { localStorage.setItem(UPDATE_PREFERENCES_KEY, JSON.stringify(migrated)) } catch {}
  return migrated
}

export const updatePreferences = reactive(readPreferences())
// Make a time-based snooze expire reactively even when the release state itself
// stays unchanged for a long-lived tab.
export const updateReminderClock = ref(Date.now())
let reminderExpiryTimer = 0

function scheduleReminderExpiry() {
  if (typeof window === 'undefined') return
  window.clearTimeout(reminderExpiryTimer)
  const deferredAt = Number(updatePreferences.deferredAt)
  if (!updatePreferences.deferredVersion || !Number.isFinite(deferredAt) || deferredAt <= 0) return
  const expiresAt = deferredAt + DEFER_REMINDER_TTL_MS
  const delay = Math.max(0, Math.min(2_147_483_647, expiresAt - Date.now() + 1))
  reminderExpiryTimer = window.setTimeout(() => {
    updateReminderClock.value = Date.now()
    if (Date.now() < expiresAt) scheduleReminderExpiry()
  }, delay)
}

function persist() {
  try {
    localStorage.setItem(UPDATE_PREFERENCES_KEY, JSON.stringify({
      autoCheck: updatePreferences.autoCheck,
      showReminder: updatePreferences.showReminder,
      autoApply: updatePreferences.autoApply,
      deferredVersion: updatePreferences.deferredVersion,
      deferredAt: updatePreferences.deferredAt,
    }))
    return true
  } catch { return false }
}

export function setUpdatePreference(key, value) {
  if (!BOOLEAN_PREFERENCES.has(key)) return false
  if (typeof value !== 'boolean') return false
  updatePreferences[key] = value
  return persist()
}

export function deferUpdateReminder(version) {
  if (typeof version !== 'string' || !version.trim()) return false
  updatePreferences.deferredVersion = version.slice(0, 120)
  updatePreferences.deferredAt = Date.now()
  updateReminderClock.value = Date.now()
  scheduleReminderExpiry()
  return persist()
}

// 静默期已过就重新提醒：用户可能只是想「这次先不更新」，
// 而不是「以后别再告诉我这个版本」。
export function shouldShowUpdateReminder(version, now) {
  if (!updatePreferences.showReminder) return false
  if (typeof version !== 'string' || !version) return false
  if (updatePreferences.deferredVersion !== version) return true
  const deferredAt = Number(updatePreferences.deferredAt)
  if (!Number.isFinite(deferredAt) || deferredAt <= 0) return true
  const currentTime = now ?? updateReminderClock.value
  return currentTime - deferredAt >= DEFER_REMINDER_TTL_MS
}

scheduleReminderExpiry()
