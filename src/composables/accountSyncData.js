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
