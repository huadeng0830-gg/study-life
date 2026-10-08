/**
 * Desktop navigation registry.
 *
 * Keep route labels, grouping and numeric shortcuts together so new desktop
 * destinations have one deliberate place in the workspace. Shortcut numbers
 * are explicit because regrouping the sidebar must not silently change them.
 */
export const desktopNavigationGroups = Object.freeze([
  Object.freeze({
    id: 'workspace',
    label: '工作台',
    items: Object.freeze([
      Object.freeze({ path: '/', label: '今天', icon: '☀️', shortcut: 1 }),
    ]),
  }),
  Object.freeze({
    id: 'planning',
    label: '计划',
    items: Object.freeze([
      Object.freeze({ path: '/schedule', label: '课程表', icon: '📅', shortcut: 2 }),
      Object.freeze({ path: '/tasks', label: '待办', icon: '✅', shortcut: 3 }),
      Object.freeze({ path: '/events', label: '日程', icon: '🗓️', shortcut: 7 }),
      Object.freeze({ path: '/together', label: '一起约', icon: '👥' }),
      Object.freeze({ path: '/projects', label: '齐行', icon: '🧩' }),
      Object.freeze({ path: '/exams', label: '重要日期', icon: '⏳', shortcut: 4 }),
    ]),
  }),
  Object.freeze({
    id: 'records',
    label: '记录',
    items: Object.freeze([
      Object.freeze({ path: '/bills', label: '账本', icon: '📒', shortcut: 6 }),
      Object.freeze({ path: '/lists', label: '清单', icon: '☑️', shortcut: 5 }),
    ]),
  }),
  Object.freeze({
    id: 'review',
    label: '回顾',
    items: Object.freeze([
      Object.freeze({ path: '/review', label: '本周回顾', icon: '↺', shortcut: 8 }),
    ]),
  }),
])

export const desktopShortcutRoutes = Object.freeze(
  desktopNavigationGroups
    .flatMap((group) => group.items)
    .filter((item) => Number.isInteger(item.shortcut))
    .sort((a, b) => a.shortcut - b.shortcut)
    .map((item) => item.path),
)
