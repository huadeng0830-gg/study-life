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
// 仅用于读取并丢弃旧版本传输/同步包中的已删除物流字段；不进入现行业务、备份或同步 schema。
export const RETIRED_COURIER_KEYS = Object.freeze([
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
