// Deprecated data is kept only as an explicit compatibility boundary. It is
// never part of the active product or sync schema.
export const FOOD_RETIREMENT_MIGRATION = 'food-retirement-v1'
export const PACKAGE_RETIREMENT_MIGRATION = 'package-retirement-v1'

export const RETIRED_FOOD_KEYS = Object.freeze([
  'sl_food_places',
  'sl_food_history',
  'sl_food_filters',
])

export const RETIRED_PACKAGE_KEYS = Object.freeze(['sl_packages'])
// 这些键只用于启动时从本机影子副本中彻底清除已删除功能的数据。
export const RETIRED_DATA_KEYS = Object.freeze([
  'sl_quick_notes',
  'sl_courier_bookmarks',
  'sl_courier_recent_carriers',
  'sl_courier_local_meta',
])

export const RETIRED_APPEARANCE_FIELDS = Object.freeze([
  'foodPickerMode',
])

export function isRetiredFoodKey(key) {
  return RETIRED_FOOD_KEYS.includes(key)
}

export function removeRetiredAppearanceFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const next = { ...value }
  for (const field of RETIRED_APPEARANCE_FIELDS) delete next[field]
  if (next.targets && typeof next.targets === 'object' && !Array.isArray(next.targets)) {
    next.targets = { ...next.targets }
    delete next.targets.food
  }
  return next
}
