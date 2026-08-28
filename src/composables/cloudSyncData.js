export const SYNC_DEFAULTS = {
  sl_courses: [],
  sl_course_templates: [],
  sl_timecfg: {},
  sl_semester: { start: '' },
  sl_schedule_exceptions: [],
  sl_tasks: [],
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
  sl_theme: 'blue',
  sl_custom_theme_color: '#456fe8',
  sl_auto_wallpaper_color: false,
  sl_wallpaper_accent: '#456fe8',
  sl_appearance: {},
  sl_wallpaper_config: {},
}

export const SYNC_KEYS = Object.keys(SYNC_DEFAULTS)

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
    validated[key] = cloneValue(payload[key])
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
