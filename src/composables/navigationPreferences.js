import { watch } from 'vue'
import { useStoredRef } from './store/index.js'
import { desktopNavigationGroups, navigationRegistry } from '../router/navigation.js'

export const FIXED_MOBILE_NAV_ITEMS = 2 // 「快速记录」和「更多」始终保留。
export const MAX_MOBILE_NAV_ITEMS = 5
export const MAX_MOBILE_NAV_ENTRIES = MAX_MOBILE_NAV_ITEMS + FIXED_MOBILE_NAV_ITEMS
export const MAX_DESKTOP_NAV_GROUPS = 16
export const MAX_NAV_GROUP_LABEL_LENGTH = 24
export const MOBILE_NAVIGATION_KEY = 'sl_navigation_mobile'
export const DESKTOP_NAVIGATION_KEY = 'sl_navigation_desktop'

export const DEFAULT_MOBILE_NAVIGATION = Object.freeze(['today', 'tasks', 'places'])
export const DEFAULT_DESKTOP_NAVIGATION = Object.freeze(desktopNavigationGroups.map((group) => Object.freeze({
  id: group.id,
  label: group.label,
  items: Object.freeze(group.items.map((item) => item.id)),
})))

// Upgrade only the untouched built-in layout from the previous release. Any
// user-edited group names or ordering remain exactly as saved.
const LEGACY_DEFAULT_DESKTOP_NAVIGATION = Object.freeze([
  { id: 'workspace', label: '今日', items: ['today'] },
  { id: 'learning', label: '学习', items: ['schedule', 'course', 'tasks', 'exams'] },
  { id: 'schedule', label: '日程', items: ['events', 'together'] },
  { id: 'qixing', label: '齐行', items: ['projects'] },
  { id: 'records', label: '记录', items: ['lists', 'bills'] },
  { id: 'review', label: '回顾', items: ['review'] },
])
// Only migrate the exact untouched previous default. A renamed group, a
// reordered item, or an intentionally hidden destination belongs to the user.
const PREVIOUS_DESKTOP_NAVIGATION = Object.freeze([
  { id: 'workspace', label: '今日', items: ['today'] },
  { id: 'learning', label: '学习', items: ['schedule', 'course', 'tasks', 'exams'] },
  { id: 'schedule', label: '日程', items: ['events', 'together'] },
  { id: 'qixing', label: '齐行', items: ['projects'] },
  { id: 'campus', label: '校园', items: ['places'] },
  { id: 'other', label: '其他', items: ['lists', 'bills', 'review', 'feedback'] },
])

/**
 * 曾经被写进 `SYNC_DEFAULTS` 的导航默认值（见 syncKeys.js 的
 * `sl_navigation_mobile` / `sl_navigation_desktop`）。
 *
 * 【为什么必须在这里认出来】那两个值是「云快照里缺这个键时补什么」的答案，
 * 但它们与应用自己会生成的默认布局**不一致**。于是新设备首次拉取云端快照时
 * 会得到一个应用永远不会自己生成的旧布局，而上面「只升级原样未改过的内置布局」
 * 的判断认不出它，就把它当成用户自定义永久保留 —— 用户看到的是旧分组名
 * （今日/学习/齐行/其他）和错的底栏项，且刷新与重装都改不回来。
 *
 * 认出来之后统一升级为现行默认，下一次同步再把修正后的布局写回云端，自愈。
 * 由 tests/navigationPreferences.test.js 断言这两份常量与 SYNC_DEFAULTS 同步。
 */
export const SYNC_DEFAULT_MOBILE_NAVIGATION = Object.freeze(['today', 'schedule', 'events', 'projects'])
export const SYNC_DEFAULT_DESKTOP_NAVIGATION = Object.freeze([
  { id: 'workspace', label: '今日', items: ['today'] },
  { id: 'learning', label: '学习', items: ['schedule', 'course', 'tasks', 'exams'] },
  { id: 'schedule', label: '日程', items: ['events', 'together'] },
  { id: 'qixing', label: '齐行', items: ['projects'] },
  { id: 'other', label: '其他', items: ['lists', 'bills', 'places', 'review'] },
])

const LEGACY_DEFAULT_MOBILE_NAVIGATION = Object.freeze([
  Object.freeze(['today', 'tasks', 'schedule']),
  SYNC_DEFAULT_MOBILE_NAVIGATION,
])
const LEGACY_DEFAULT_DESKTOP_NAVIGATIONS = Object.freeze([
  LEGACY_DEFAULT_DESKTOP_NAVIGATION, PREVIOUS_DESKTOP_NAVIGATION, SYNC_DEFAULT_DESKTOP_NAVIGATION,
])

const registeredItems = new Map(navigationRegistry
  .filter((item) => item.available && item.pinnable)
  .map((item) => [item.id, item]))

export function navigationItem(id) {
  return registeredItems.get(id) || null
}

export function normalizeMobileNavigation(value) {
  if (Array.isArray(value) && LEGACY_DEFAULT_MOBILE_NAVIGATION
    .some((layout) => JSON.stringify(value) === JSON.stringify(layout))) {
    return [...DEFAULT_MOBILE_NAVIGATION]
  }
  if (!Array.isArray(value)) return [...DEFAULT_MOBILE_NAVIGATION]
  const seen = new Set()
  const result = []
  for (const id of value) {
    if (typeof id !== 'string' || !registeredItems.has(id) || seen.has(id)) continue
    seen.add(id)
    if (result.length >= MAX_MOBILE_NAV_ITEMS) break
    result.push(id)
  }
  // An explicitly empty list keeps both fixed actions available.
  // A non-empty list that becomes empty after validation is stale/corrupt data.
  return value.length && !result.length ? [...DEFAULT_MOBILE_NAVIGATION] : result
}

function normalizeGroupId(value, index) {
  if (typeof value !== 'string') return ''
  const id = value.trim()
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/i.test(id)) return ''
  return id || `group-${index + 1}`
}

export function normalizeDesktopNavigation(value) {
  if (Array.isArray(value) && LEGACY_DEFAULT_DESKTOP_NAVIGATIONS
    .some((layout) => JSON.stringify(value) === JSON.stringify(layout))) {
    return DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] }))
  }
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] }))
  const groups = []
  const seenGroups = new Set()
  const seenItems = new Set()
  const hadItems = value.some((group) => Array.isArray(group?.items) && group.items.length > 0)
  value.slice(0, MAX_DESKTOP_NAV_GROUPS).forEach((rawGroup, index) => {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) return
    const id = normalizeGroupId(rawGroup.id, index)
    if (!id || seenGroups.has(id)) return
    const label = typeof rawGroup.label === 'string' ? rawGroup.label.trim().slice(0, MAX_NAV_GROUP_LABEL_LENGTH) : ''
    if (!label) return
    seenGroups.add(id)
    const items = []
    if (Array.isArray(rawGroup.items)) {
      for (const itemId of rawGroup.items) {
        if (typeof itemId !== 'string' || !registeredItems.has(itemId) || seenItems.has(itemId)) continue
        seenItems.add(itemId)
        items.push(itemId)
      }
    }
    groups.push({ id, label, items })
  })
  const hasUsableItems = groups.some((group) => group.items.length)
  return groups.length && (!hadItems || hasUsableItems)
    ? groups
    : DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] }))
}

export function moveNavigationItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items) || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
    || fromIndex < 0 || fromIndex >= items.length) return items
  const target = Math.max(0, Math.min(items.length - 1, toIndex))
  if (fromIndex === target) return items
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(target, 0, item)
  return next
}

/** @param {unknown} ids @param {{id?: string}|null} [user] */
export function visibleNavigationItems(ids, user = null) {
  return normalizeMobileNavigation(ids).flatMap((id) => {
    const item = navigationItem(id)
    return item && (!item.requiresLogin || Boolean(user?.id)) ? [item] : []
  })
}

/** Shared by the live sidebar and editor preview; empty groups never render. */
export function visibleDesktopNavigation(groups, user = null) {
  return groups.map((group) => ({
    ...group,
    items: group.items.flatMap((id) => {
      const item = navigationItem(id)
      return item && (!item.requiresLogin || Boolean(user?.id)) ? [item] : []
    }),
  })).filter((group) => group.items.length)
}

export const mobileNavigation = useStoredRef(MOBILE_NAVIGATION_KEY, [...DEFAULT_MOBILE_NAVIGATION])
export const desktopNavigation = useStoredRef(DESKTOP_NAVIGATION_KEY,
  DEFAULT_DESKTOP_NAVIGATION.map((group) => ({ ...group, items: [...group.items] })))

const normalizedMobile = normalizeMobileNavigation(mobileNavigation.value)
if (JSON.stringify(normalizedMobile) !== JSON.stringify(mobileNavigation.value)) mobileNavigation.value = normalizedMobile
const normalizedDesktop = normalizeDesktopNavigation(desktopNavigation.value)
if (JSON.stringify(normalizedDesktop) !== JSON.stringify(desktopNavigation.value)) desktopNavigation.value = normalizedDesktop

// Restore/import and cloud sync also write through these refs. Keep their values
// valid on every input path so a stale ID can never blank either navigation.
watch(mobileNavigation, (value) => {
  const normalized = normalizeMobileNavigation(value)
  if (JSON.stringify(normalized) !== JSON.stringify(value)) mobileNavigation.value = normalized
}, { deep: true, flush: 'sync' })
watch(desktopNavigation, (value) => {
  const normalized = normalizeDesktopNavigation(value)
  if (JSON.stringify(normalized) !== JSON.stringify(value)) desktopNavigation.value = normalized
}, { deep: true, flush: 'sync' })
