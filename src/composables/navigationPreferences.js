import { watch } from 'vue'
import { useStoredRef } from './store/index.js'
import { desktopNavigationGroups, navigationRegistry } from '../router/navigation.js'

export const MAX_MOBILE_NAV_ENTRIES = 5
export const FIXED_MOBILE_NAV_ITEMS = 2 // 「快速记录」和「更多」始终保留。
export const MAX_MOBILE_NAV_ITEMS = MAX_MOBILE_NAV_ENTRIES - FIXED_MOBILE_NAV_ITEMS
export const MAX_DESKTOP_NAV_GROUPS = 16
export const MAX_NAV_GROUP_LABEL_LENGTH = 24
export const MOBILE_NAVIGATION_KEY = 'sl_navigation_mobile'
export const DESKTOP_NAVIGATION_KEY = 'sl_navigation_desktop'

export const DEFAULT_MOBILE_NAVIGATION = Object.freeze(['today', 'schedule', 'events'])
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

const registeredItems = new Map(navigationRegistry
  .filter((item) => item.available && item.pinnable)
  .map((item) => [item.id, item]))

export function navigationItem(id) {
  return registeredItems.get(id) || null
}

export function normalizeMobileNavigation(value) {
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
  if (Array.isArray(value) && JSON.stringify(value) === JSON.stringify(LEGACY_DEFAULT_DESKTOP_NAVIGATION)) {
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
