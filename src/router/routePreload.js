// 路由组件保持懒加载；这里只保存加载函数，导入本模块本身不会下载任何页面代码。
const imports = {
  '/': () => import('../views/TodayView.vue'),
  '/schedule': () => import('../views/ScheduleView.vue'),
  '/course': () => import('../views/CourseArchiveView.vue'),
  '/tasks': () => import('../views/TasksView.vue'),
  '/notices': () => import('../views/NoticesView.vue'),
  '/exams': () => import('../views/ExamsView.vue'),
  '/events': () => import('../views/EventsView.vue'),
  '/lists': () => import('../views/ListsView.vue'),
  '/bills': () => import('../views/LedgerView.vue'),
  '/campus': () => import('../views/CampusHubView.vue'),
  '/campus/matters': () => import('../views/campus/CampusMattersView.vue'),
  '/campus/matters/:matterId': () => import('../views/campus/CampusMatterDetailView.vue'),
  '/campus/places': () => import('../views/PlacesView.vue'),
  '/campus/search': () => import('../views/campus/CampusSearchView.vue'),
  '/campus/courses': () => import('../views/campus/CampusCoursesView.vue'),
  '/campus/market': () => import('../views/campus/CampusMarketplaceView.vue'),
  '/campus/help': () => import('../views/campus/CampusHelpView.vue'),
  '/campus/shuttle': () => import('../views/campus/CampusShuttleView.vue'),
  '/campus/lost-found': () => import('../views/campus/CampusLostFoundView.vue'),
  '/campus/events': () => import('../views/campus/CampusEventsView.vue'),
  '/campus/guides': () => import('../views/campus/CampusGuidesView.vue'),
  '/campus/publish': () => import('../views/campus/CampusPublishView.vue'),
  '/campus/mine': () => import('../views/campus/CampusMySubmissionsView.vue'),
  '/campus/reports': () => import('../views/campus/CampusReportsView.vue'),
  '/feedback': () => import('../views/FeedbackView.vue'),
  '/admin/feedback': () => import('../views/AdminCenterView.vue'),
  '/campus/reviewer-application': () => import('../views/campus/CampusReviewerApplicationView.vue'),
  '/admin/campus': () => import('../views/AdminCenterView.vue'),
  '/review': () => import('../views/WeeklyReviewView.vue'),
  '/together': () => import('../views/TogetherView.vue'),
  '/projects': () => import('../views/ProjectsView.vue'),
  '/admin': () => import('../views/AdminCenterView.vue'),
  '/platform-admin': () => import('../views/AdminCenterView.vue'),
}

const resolvedRoutes = new Map()
const pendingRoutes = new Map()

// Keep modules, not mounted pages: even an evicted KeepAlive entry can reopen
// synchronously without retaining forms, watchers or large page data in memory.
export const routeLoaders = Object.freeze(Object.fromEntries(Object.entries(imports).map(([path, load]) => [path, () => {
  if (pendingRoutes.has(path)) return pendingRoutes.get(path)
  const pending = load().then(module => {
    resolvedRoutes.set(path, module.default)
    return module
  }).finally(() => { pendingRoutes.delete(path) })
  pendingRoutes.set(path, pending)
  return pending
}])))

export function resolvedRouteComponent(path) {
  return resolvedRoutes.get(path) || null
}

export function initialRoutePath(hash = globalThis.location?.hash || '') {
  let path = hash.replace(/^#/, '').split(/[?#]/)[0] || '/'
  if (path === '/places') return '/campus/places'
  if (/^\/campus\/matters\/[^/]+\/?$/.test(path)) path = '/campus/matters/:matterId'
  return Object.prototype.hasOwnProperty.call(routeLoaders, path) ? path : '/'
}

// Start downloading a link's page when the user focuses, hovers or presses it.
// This covers campus links as well as the sidebar, without fetching any data.
export function preloadRouteLink(event) {
  if (event.type === 'pointerover' && !connectionAllowsPrefetch()) return
  if (event.type === 'pointerdown' && event.button !== 0) return
  const link = event.target?.closest?.('a[href]')
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
  const url = new URL(link.href, window.location.href)
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return
  let path = url.hash.replace(/^#/, '').split(/[?#]/)[0]
  if (/^\/campus\/matters\/[^/]+\/?$/.test(path)) path = '/campus/matters/:matterId'
  if (Object.prototype.hasOwnProperty.call(routeLoaders, path)) return preloadRoute(path)
}

export function connectionAllowsPrefetch() {
  if (typeof navigator === 'undefined') return false
  if (navigator.onLine === false || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return false
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  // Network Information API 不可用时无法判断弱网；保守地跳过后台预取。
  if (!connection) return false
  if (connection.saveData) return false
  return connection.effectiveType === '4g'
}

export function preloadRoute(path, { idleOnly = false } = {}) {
  if (idleOnly && !connectionAllowsPrefetch()) return Promise.resolve(null)
  return routeLoaders[path]?.().catch(() => null) ?? Promise.resolve(null)
}

// 首次进入首页后仅预热最常用、体积较小的入口。课程表和账本保留到用户
// 明确意图时再加载，避免移动网络和低内存设备被后台下载拖慢。
export function preloadCommonRoutes() {
  if (!connectionAllowsPrefetch()) return
  void preloadRoute('/tasks', { idleOnly: true })
}
