import { reactive } from 'vue'

export const UPDATE_PREFERENCES_KEY = 'study_life_update_preferences_v1'
const DEFAULTS = Object.freeze({ autoCheck: true, showReminder: true, deferredVersion: '' })

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(UPDATE_PREFERENCES_KEY) || 'null')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULTS }
    return {
      autoCheck: typeof value.autoCheck === 'boolean' ? value.autoCheck : DEFAULTS.autoCheck,
      showReminder: typeof value.showReminder === 'boolean' ? value.showReminder : DEFAULTS.showReminder,
      deferredVersion: typeof value.deferredVersion === 'string' ? value.deferredVersion.slice(0, 120) : '',
    }
  } catch { return { ...DEFAULTS } }
}

export const updatePreferences = reactive(readPreferences())

function persist() {
  try {
    localStorage.setItem(UPDATE_PREFERENCES_KEY, JSON.stringify({
      autoCheck: updatePreferences.autoCheck,
      showReminder: updatePreferences.showReminder,
      deferredVersion: updatePreferences.deferredVersion,
    }))
    return true
  } catch { return false }
}

export function setUpdatePreference(key, value) {
  if (key === 'autoCheck' || key === 'showReminder') {
    if (typeof value !== 'boolean') return false
    updatePreferences[key] = value
  } else return false
  return persist()
}

export function deferUpdateReminder(version) {
  if (typeof version !== 'string' || !version.trim()) return false
  updatePreferences.deferredVersion = version.slice(0, 120)
  return persist()
}

export function shouldShowUpdateReminder(version) {
  return Boolean(updatePreferences.showReminder && typeof version === 'string' && version &&
    updatePreferences.deferredVersion !== version)
}
