// 路由组件保持懒加载；这里只保存加载函数，导入本模块本身不会下载任何页面代码。
export const routeLoaders = Object.freeze({
  '/': () => import('../views/TodayView.vue'),
  '/schedule': () => import('../views/ScheduleView.vue'),
  '/tasks': () => import('../views/TasksView.vue'),
  '/exams': () => import('../views/ExamsView.vue'),
  '/lists': () => import('../views/ListsView.vue'),
  '/bills': () => import('../views/LedgerView.vue'),
  '/food': () => import('../views/FoodView.vue'),
  '/review': () => import('../views/WeeklyReviewView.vue'),
})

function connectionAllowsPrefetch() {
  if (typeof navigator === 'undefined') return false
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (!connection) return true
  if (connection.saveData) return false
  return !/^(slow-2g|2g)$/i.test(connection.effectiveType || '')
}

export function preloadRoute(path, { idleOnly = false } = {}) {
  if (idleOnly && !connectionAllowsPrefetch()) return Promise.resolve(null)
  return routeLoaders[path]?.().catch(() => null) ?? Promise.resolve(null)
}

// 首次进入首页后仅预热最常用、体积较小的入口。课程表和账本保留到用户
// 明确意图时再加载，避免移动网络和低内存设备被后台下载拖慢。
export function preloadCommonRoutes() {
  if (!connectionAllowsPrefetch()) return
  for (const path of ['/tasks', '/exams', '/lists']) void preloadRoute(path, { idleOnly: true })
}
