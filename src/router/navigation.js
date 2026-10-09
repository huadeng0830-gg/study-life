/**
 * Single source for user-facing route navigation metadata.
 * Route existence and page titles come from routes.js; this module only
 * projects the registered destinations into the existing desktop defaults.
 */
import { routes } from './routes.js'

export const navigationRegistry = Object.freeze(routes
  .filter((route) => route.meta?.navigation?.id)
  .map((route) => Object.freeze({
    id: route.meta.navigation.id,
    path: route.path,
    label: route.meta.title,
    mobileLabel: route.meta.navigation.mobileLabel || route.meta.title,
    icon: route.meta.navigation.icon,
    groupId: route.meta.navigation.groupId,
    groupLabel: route.meta.navigation.groupLabel,
    defaultDesktop: Boolean(route.meta.navigation.defaultDesktop),
    shortcut: route.meta.navigation.shortcut,
    pinnable: route.meta.navigation.pinnable !== false,
    available: route.meta.navigation.available !== false,
    requiresLogin: Boolean(route.meta.navigation.requiresLogin),
  })))

export const navigationItemById = new Map(navigationRegistry.map((item) => [item.id, item]))

/** @param {{id?: string}|null} [user] */
export function availableNavigationItems(user = null) {
  return navigationRegistry.filter((item) => item.available && item.pinnable
    && (!item.requiresLogin || Boolean(user?.id)))
}

const DEFAULT_DESKTOP_GROUPS = Object.freeze([
  Object.freeze({ id: 'workspace', label: '今日' }),
  Object.freeze({ id: 'learning', label: '学习' }),
  Object.freeze({ id: 'schedule', label: '日程' }),
  Object.freeze({ id: 'qixing', label: '齐行' }),
  Object.freeze({ id: 'other', label: '其他' }),
])

export const desktopNavigationGroups = Object.freeze(DEFAULT_DESKTOP_GROUPS.map((group) => Object.freeze({
  id: group.id,
  label: group.label,
  items: Object.freeze(navigationRegistry
    .filter((item) => item.defaultDesktop && item.groupId === group.id)
    .map((item) => Object.freeze({
      id: item.id,
      path: item.path,
      label: item.label,
      mobileLabel: item.mobileLabel,
      icon: item.icon,
      shortcut: item.shortcut,
    }))),
})))

export const desktopShortcutRoutes = Object.freeze(
  navigationRegistry
    .filter((item) => item.defaultDesktop && Number.isInteger(item.shortcut))
    .sort((a, b) => a.shortcut - b.shortcut)
    .map((item) => item.path),
)
