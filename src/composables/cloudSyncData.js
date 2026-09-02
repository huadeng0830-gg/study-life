import { normalizeFestiveConfig } from './festive.js'
import { normalizeMoodLog } from './mood.js'
import { normalizeFocusSettings } from './focusTimer.js'

export const SYNC_DEFAULTS = {
  sl_courses: [],
  sl_course_templates: [],
  sl_timecfg: {},
  sl_semester: { start: '' },
  sl_schedule_exceptions: [],
  sl_tasks: [],
  sl_events: [],
  sl_quick_notes: [],
  sl_quick_record_settings: { clipboardHint: true, recentTypes: [] },
  sl_capture_enabled: true,
  sl_focus_sessions: [],
sl_focus_settings: { quickTimes: [15, 25, 45, 60], lastUsedMinutes: 25, recentTemporaries: [], soundEnabled: true, vibrationEnabled: true, systemNotificationEnabled: true },
  sl_course_checkins: [],
  sl_exams: [],
  sl_countdown_show_past: false,
  sl_checklists: [],
  sl_bills: [],
  sl_expenses: [],
  sl_ledger_categories: [
    { key: 'food', name: '餐饮', icon: '🍜', hidden: false },
    { key: 'transit', name: '出行', icon: '🚇', hidden: false },
    { key: 'shop', name: '购物', icon: '🛍️', hidden: false },
    { key: 'life', name: '生活', icon: '🏠', hidden: false },
    { key: 'study', name: '学习', icon: '📚', hidden: false },
    { key: 'fun', name: '娱乐', icon: '🎮', hidden: false },
    { key: 'health', name: '健康', icon: '💊', hidden: false },
    { key: 'sub', name: '订阅', icon: '📺', hidden: false },
    { key: 'other', name: '其他', icon: '📦', hidden: false },
  ],
  sl_ledger_freq: { pinned: [], hidden: [] },
  sl_food_places: [],
  sl_food_history: [],
  sl_food_filters: {},
  sl_ocr_vocabulary: { courses: [], teachers: [], rooms: [], campuses: [] },
  sl_theme: 'blue',
  sl_custom_theme_color: '#456fe8',
  sl_auto_wallpaper_color: false,
  sl_wallpaper_accent: '#456fe8',
  sl_appearance: {},
  sl_wallpaper_config: {},
  sl_performance_mode: 'auto',
  sl_festive_config: { enabled: true, birthday: '', installDate: '', anniversaries: [] },
  sl_festive_birthday_full: '',
  sl_mood_log: {},
}

export const SYNC_KEYS = Object.keys(SYNC_DEFAULTS)

// 「模块 → 键」静态分组：选择性拉取时按模块勾选，未勾选的键完全不动。
export const SYNC_MODULES = Object.freeze([
  { key: 'courses', label: '课程与课表', keys: ['sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_ocr_vocabulary', 'sl_course_checkins'] },
  { key: 'tasks', label: '待办与快速记录', keys: ['sl_tasks', 'sl_events', 'sl_quick_notes', 'sl_quick_record_settings', 'sl_capture_enabled'] },
  { key: 'focus', label: '专注记录', keys: ['sl_focus_sessions', 'sl_focus_settings'] },
  { key: 'countdown', label: '重要日期', keys: ['sl_exams', 'sl_countdown_show_past'] },
  { key: 'checklists', label: '清单', keys: ['sl_checklists'] },
  { key: 'ledger', label: '账本', keys: ['sl_bills', 'sl_expenses', 'sl_ledger_categories', 'sl_ledger_freq'] },
  { key: 'food', label: '吃什么', keys: ['sl_food_places', 'sl_food_history', 'sl_food_filters'] },
  { key: 'appearance', label: '外观与主题', keys: ['sl_theme', 'sl_custom_theme_color', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent', 'sl_appearance', 'sl_wallpaper_config', 'sl_performance_mode'] },
  { key: 'atmosphere', label: '氛围与心情', keys: ['sl_festive_config', 'sl_festive_birthday_full', 'sl_mood_log'] },
])

// 根据勾选的模块 key 展开为待拉取的 sl_* 键（保持 SYNC_KEYS 顺序、去重）。
export function moduleKeysFor(moduleKeys) {
  const selected = new Set(Array.isArray(moduleKeys) ? moduleKeys.filter((key) => typeof key === 'string') : [])
  return SYNC_KEYS.filter(
    (key) => SYNC_MODULES.some((mod) => selected.has(mod.key) && mod.keys.includes(key))
  )
}

// 归一化拉取键子集：null/undefined → 全量（向后兼容）；否则只保留合法 sl_* 键并去重。
export function normalizePullKeys(keys) {
  if (keys == null) return [...SYNC_KEYS]
  const allowed = new Set(SYNC_KEYS)
  return [...new Set((Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && allowed.has(key)))]
}

// 从云端负载中只挑出选中键（未提供或值为 undefined 的键不进入结果）。
export function pickSyncValues(payload, keys) {
  const source = isPlainObject(payload) ? payload : {}
  const allowed = new Set(keys)
  return Object.fromEntries(
    keys.filter((key) => allowed.has(key) && source[key] !== undefined).map((key) => [key, source[key]])
  )
}

export function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isCompatibleValue(value, expected) {
  if (Array.isArray(expected)) return Array.isArray(value)
  if (isPlainObject(expected)) return isPlainObject(value)
  return typeof value === typeof expected
}

// 写入前归一化：氛围与心情两个新键语义上“读取即纠偏”，拉取时同样先纠偏再落盘。
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

function isValidKeyValue(key, value) {
  if (!isCompatibleValue(value, SYNC_DEFAULTS[key])) return false
  if (key === 'sl_timecfg') {
    return Array.isArray(value.campuses)
      && Array.isArray(value.seasons)
      && Array.isArray(value.periods)
      && isPlainObject(value.times)
  }
  if (key === 'sl_semester') return typeof value.start === 'string'
  if (key === 'sl_appearance') {
    return (value.quotes === undefined || Array.isArray(value.quotes))
      && (value.homeModules === undefined || Array.isArray(value.homeModules))
  }
  if (key === 'sl_wallpaper_config') {
    return value.targets === undefined || isPlainObject(value.targets)
  }
  if (key === 'sl_festive_birthday_full') return typeof value === 'string'
  if (key === 'sl_focus_settings') {
    return isPlainObject(value)
      && (value.quickTimes === undefined || Array.isArray(value.quickTimes))
      && (value.recentTemporaries === undefined || Array.isArray(value.recentTemporaries))
  }
  if (key === 'sl_performance_mode') return ['auto', 'on', 'off', 'low', 'high'].includes(value)
  return true
}

export function sanitizeSyncPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('云端数据格式异常，已取消拉取以保护本机数据')
  const validated = {}
  const invalidKeys = []
  for (const key of SYNC_KEYS) {
    if (payload[key] === undefined) continue
    if (!isValidKeyValue(key, payload[key])) {
      invalidKeys.push(key)
      continue
    }
    validated[key] = normalizeIncomingValue(key, payload[key])
  }
  return { values: validated, invalidKeys }
}

export function validateSyncPayload(payload) {
  const result = sanitizeSyncPayload(payload)
  if (result.invalidKeys.length) {
    throw new Error(`云端数据中的 ${result.invalidKeys.join('、')} 格式异常`)
  }
  return result.values
}

// 推送只需要验证当前内存快照，不需要再深拷贝一次整库数据。
export function assertValidSyncPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('云端数据格式异常，已取消推送')
  const invalidKeys = SYNC_KEYS.filter(
    (key) => payload[key] !== undefined && !isValidKeyValue(key, payload[key])
  )
  if (invalidKeys.length) throw new Error(`云端数据中的 ${invalidKeys.join('、')} 格式异常`)
  return payload
}

function itemKey(item, index) {
  if (item && typeof item === 'object' && item.id !== undefined) return `id:${item.id}`
  return `value:${JSON.stringify(item)}:${index}`
}

function chooseNewer(localItem, remoteItem) {
  const localTime = Date.parse(localItem?.updatedAt ?? '')
  const remoteTime = Date.parse(remoteItem?.updatedAt ?? '')
  if (Number.isFinite(localTime) && Number.isFinite(remoteTime)) {
    return remoteTime >= localTime ? remoteItem : localItem
  }
  return remoteItem
}

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
