import { normalizeFestiveConfig } from './festive.js'
import { normalizeMoodLog } from './mood.js'
import { normalizeFocusSettings } from './focusTimer.js'
import { SYNC_DEFAULTS, SYNC_KEYS, isSyncKey } from './syncKeys.js'

export { SYNC_DEFAULTS, SYNC_KEYS, isSyncKey }

/** @type {number} */
export const MAX_SYNC_PAYLOAD_BYTES = 16 * 1024 * 1024
/** @type {number} */
export const MAX_SYNC_COLLECTION_ITEMS = 100000
/** @type {number} */
export const MAX_SYNC_NESTING_DEPTH = 24

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function sameSyncValue(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameSyncValue(item, right[index]))
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameSyncValue(left[key], right[key]))
  }
  return false
}

/**
 * @param {Record<string, unknown>} [values={}]
 * @returns {boolean}
 */
export function hasMeaningfulLocalData(values = {}) {
  return SYNC_KEYS.some((key) => values[key] !== undefined && !sameSyncValue(values[key], SYNC_DEFAULTS[key]))
}

/**
 * @param {unknown} value
 * @param {number} [depth=0]
 * @returns {boolean}
 */
function hasSafeResourceShape(value, depth = 0) {
  if (depth > MAX_SYNC_NESTING_DEPTH) return false
  if (Array.isArray(value)) return value.length <= MAX_SYNC_COLLECTION_ITEMS && value.every((item) => hasSafeResourceShape(item, depth + 1))
  if (isPlainObject(value)) return Object.keys(value).length <= 500 && Object.values(value).every((item) => hasSafeResourceShape(item, depth + 1))
  return true
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function withinSyncResourceLimit(value) {
  if (!hasSafeResourceShape(value)) return false
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_SYNC_PAYLOAD_BYTES } catch { return false }
}

/**
 * @typedef {{
 *   key: string
 *   label: string
 *   keys: (keyof typeof SYNC_DEFAULTS)[]
 * }} SyncModule
 */

/** @type {readonly SyncModule[]} */
export const SYNC_MODULES = Object.freeze([
  { key: 'courses', label: '课程与课表', keys: ['sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_schedule_note', 'sl_ocr_vocabulary', 'sl_course_checkins'] },
  { key: 'tasks', label: '待办与快速记录', keys: ['sl_tasks', 'sl_events', 'sl_quick_notes', 'sl_quick_record_settings', 'sl_capture_enabled'] },
  { key: 'focus', label: '专注记录', keys: ['sl_focus_sessions', 'sl_focus_settings'] },
  { key: 'countdown', label: '重要日期', keys: ['sl_exams', 'sl_countdown_show_past'] },
  { key: 'checklists', label: '清单', keys: ['sl_checklists'] },
  { key: 'ledger', label: '账本', keys: ['sl_bills', 'sl_expenses', 'sl_ledger_categories', 'sl_ledger_freq', 'sl_ledger_fx', 'sl_ledger_budget', 'sl_ledger_templates'] },
  { key: 'appearance', label: '外观与主题', keys: ['sl_theme', 'sl_custom_theme_color', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent', 'sl_appearance', 'sl_wallpaper_config', 'sl_performance_mode'] },
  { key: 'atmosphere', label: '氛围与心情', keys: ['sl_festive_config', 'sl_festive_birthday_full', 'sl_mood_log', 'sl_festive_lunar', 'sl_ui_language'] },
  { key: 'reminders', label: '提醒去重', keys: ['sl_reminder_log'] },
])

/**
 * @param {unknown} moduleKeys
 * @returns {(keyof typeof SYNC_DEFAULTS)[]}
 */
export function moduleKeysFor(moduleKeys) {
  const selected = new Set(Array.isArray(moduleKeys) ? moduleKeys.filter((key) => typeof key === 'string') : [])
  return SYNC_KEYS.filter(
    (key) => SYNC_MODULES.some((mod) => selected.has(mod.key) && mod.keys.includes(key))
  )
}

/**
 * @param {unknown} keys
 * @returns {(keyof typeof SYNC_DEFAULTS)[]}
 */
export function normalizePullKeys(keys) {
  if (keys == null) return [...SYNC_KEYS]
  const allowed = new Set(SYNC_KEYS)
  return [...new Set((Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && allowed.has(key)))]
}

/**
 * @param {Record<string, unknown>} payload
 * @param {(keyof typeof SYNC_DEFAULTS)[]} keys
 * @returns {Record<string, unknown>}
 */
export function pickSyncValues(payload, keys) {
  const source = isPlainObject(payload) ? payload : {}
  const allowed = new Set(keys)
  return Object.fromEntries(
    keys.filter((key) => allowed.has(key) && source[key] !== undefined).map((key) => [key, source[key]])
  )
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @param {unknown} expected
 * @returns {boolean}
 */
export function isCompatibleValue(value, expected) {
  if (Array.isArray(expected)) return Array.isArray(value)
  if (isPlainObject(expected)) return isPlainObject(value)
  return typeof value === typeof expected
}

/**
 * @param {keyof typeof SYNC_DEFAULTS} key
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeIncomingValue(key, value) {
  if (key === 'sl_festive_config') return normalizeFestiveConfig(value)
  if (key === 'sl_festive_birthday_full') return /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(String(value ?? '')) ? String(value) : ''
  if (key === 'sl_mood_log') return normalizeMoodLog(value)
  if (key === 'sl_focus_settings') return normalizeFocusSettings(value)
  if (key === 'sl_performance_mode') {
    if (value === 'low') return 'on'
    if (value === 'high') return 'off'
    return value
  }
  return cloneValue(value)
}

/**
 * @param {keyof typeof SYNC_DEFAULTS} key
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidKeyValue(key, value) {
  if (!isCompatibleValue(value, SYNC_DEFAULTS[key])) return false
  if (key === 'sl_timecfg') {
    const v = value
    return Array.isArray(v.campuses)
      && Array.isArray(v.seasons)
      && Array.isArray(v.periods)
      && isPlainObject(v.times)
  }
  if (key === 'sl_semester') return typeof value === 'object' && value !== null && typeof value.start === 'string'
  if (key === 'sl_appearance') {
    const v = value
    return (v.quotes === undefined || Array.isArray(v.quotes))
      && (v.homeModules === undefined || Array.isArray(v.homeModules))
  }
  if (key === 'sl_wallpaper_config') {
    const v = value
    return v.targets === undefined || isPlainObject(v.targets)
  }
  if (key === 'sl_festive_birthday_full') return typeof value === 'string'
  if (key === 'sl_focus_settings') {
    const v = value
    return isPlainObject(value)
      && (v.quickTimes === undefined || Array.isArray(v.quickTimes))
      && (v.recentTemporaries === undefined || Array.isArray(v.recentTemporaries))
  }
  if (key === 'sl_performance_mode') return ['auto', 'on', 'off', 'low', 'high'].includes(value)
  return true
}

/**
 * @typedef {{
 *   values: Record<string, unknown>
 *   invalidKeys: string[]
 * }} SanitizeResult
 */

/**
 * @param {unknown} payload
 * @returns {SanitizeResult}
 */
export function sanitizeSyncPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('云端数据格式异常，已取消拉取以保护本机数据')
  const validated = {}
  const invalidKeys = []
  for (const key of SYNC_KEYS) {
    if (payload[key] === undefined) continue
    if (!isValidKeyValue(key, payload[key]) || !withinSyncResourceLimit(payload[key])) {
      invalidKeys.push(key)
      continue
    }
    validated[key] = normalizeIncomingValue(key, payload[key])
  }
  return { values: validated, invalidKeys }
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
export function validateSyncPayload(payload) {
  const result = sanitizeSyncPayload(payload)
  if (result.invalidKeys.length) {
    throw new Error(`云端数据中的 ${result.invalidKeys.join('、')} 格式异常`)
  }
  return result.values
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
export function assertValidSyncPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('云端数据格式异常，已取消推送')
  const invalidKeys = SYNC_KEYS.filter(
    (key) => payload[key] !== undefined && (!isValidKeyValue(key, payload[key]) || !withinSyncResourceLimit(payload[key]))
  )
  if (invalidKeys.length) throw new Error(`云端数据中的 ${invalidKeys.join('、')} 格式异常`)
  return payload
}

/**
 * @typedef {{
 *   valid: boolean
 *   invalidKeys: string[]
 *   oversizedKeys: string[]
 *   totalKeys: number
 *   totalBytes: number
 *   maxBytes: number
 * }} LocalSyncValidationResult
 */

/**
 * @returns {Promise<LocalSyncValidationResult>}
 */
export async function validateLocalSyncData() {
  const { useStoredRef } = await import('./store/cloudAccess.js')
  const states = Object.fromEntries(
    SYNC_KEYS.map((key) => [key, useStoredRef(key, cloneValue(SYNC_DEFAULTS[key]))])
  )
  const localValues = Object.fromEntries(SYNC_KEYS.map((key) => [key, states[key].value]))
  const invalidKeys = SYNC_KEYS.filter(
    (key) => localValues[key] !== undefined && (!isValidKeyValue(key, localValues[key]) || !withinSyncResourceLimit(localValues[key]))
  )
  const oversizedKeys = SYNC_KEYS.filter(
    (key) => localValues[key] !== undefined && !withinSyncResourceLimit(localValues[key])
  )
  const totalBytes = new TextEncoder().encode(JSON.stringify(localValues)).byteLength
  return {
    valid: invalidKeys.length === 0,
    invalidKeys,
    oversizedKeys,
    totalKeys: SYNC_KEYS.filter((key) => localValues[key] !== undefined).length,
    totalBytes,
    maxBytes: MAX_SYNC_PAYLOAD_BYTES,
  }
}

/**
 * @param {unknown} item
 * @param {number} index
 * @returns {string}
 */
function itemKey(item, index) {
  if (item && typeof item === 'object' && item !== null && 'id' in item && item.id !== undefined) return `id:${item.id}`
  return `value:${JSON.stringify(item)}:${index}`
}

/**
 * @param {unknown} localItem
 * @param {unknown} remoteItem
 * @returns {unknown}
 */
function chooseNewer(localItem, remoteItem) {
  const localTime = Date.parse(localItem?.updatedAt ?? '')
  const remoteTime = Date.parse(remoteItem?.updatedAt ?? '')
  if (Number.isFinite(localTime) && Number.isFinite(remoteTime)) {
    return remoteTime >= localTime ? remoteItem : localItem
  }
  return remoteItem
}

/**
 * @param {unknown} local
 * @param {unknown} remote
 * @returns {unknown}
 */
export function mergeSyncValue(local, remote) {
  if (Array.isArray(local) && Array.isArray(remote)) {
    const merged = new Map()
    local.forEach((item, index) => merged.set(itemKey(item, index), cloneValue(item)))
    remote.forEach((item, index) => {
      const key = itemKey(item, index)
      const existing = merged.get(key)
      merged.set(key, existing === undefined ? cloneValue(item) : cloneValue(chooseNewer(existing, item)))
    })
    return [...merged.values()]
  }
  if (isPlainObject(local) && isPlainObject(remote)) {
    const merged = { ...cloneValue(local) }
    for (const [key, value] of Object.entries(remote)) {
      merged[key] = isPlainObject(value) && isPlainObject(local[key])
        ? mergeSyncValue(local[key], value)
        : cloneValue(value)
    }
    return merged
  }
  return cloneValue(remote)
}