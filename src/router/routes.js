/**
 * 应用路由表（第二十五轮从 `main.js` 抽出）。
 *
 * 为什么单独成模块：**路由是数据**。渲染 DOM 级的测试（标题顺序、真实 Tab 顺序）
 * 必须针对**同一份**真实路由表断言——另抄一份必然随实现漂移，那就不是守卫了。
 * 抽出来之后 `main.js` 只负责装配，懒加载与失败兜底的行为一字未改。
 */
import { defineComponent, h, onBeforeUnmount, ref, shallowRef } from 'vue'
import { routeLoaders } from './routePreload.js'
import RouteFallback from '../components/RouteFallback.vue'
import NotFoundView from '../components/NotFoundView.vue'

/**
 * 懒加载组件的显示名。
 * 保留具名组件是为了让 Vue Devtools 与错误堆栈里能看到「是哪个页面出错了」，
 * 否则全是匿名的 LazyRouteView。
 */
export const ROUTE_COMPONENT_NAMES = Object.freeze({
  '/': 'TodayView',
  '/schedule': 'ScheduleView',
  '/course': 'CourseArchiveView',
  '/tasks': 'TasksView',
  '/exams': 'ExamsView',
  '/events': 'EventsView',
  '/lists': 'ListsView',
  '/bills': 'LedgerView',
  '/review': 'WeeklyReviewView',
  '/together': 'TogetherView',
  '/projects': 'ProjectsView',
})

const RouteLoading = { setup: () => () => h(RouteFallback, { error: false }) }
const RouteError = { setup: () => () => h(RouteFallback, { error: true }) }

/** 懒加载路由组件：加载中显示占位，加载失败显示错误态（而不是白屏）。 */
function asyncRoute(path) {
  return defineComponent({
    name: ROUTE_COMPONENT_NAMES[path] || 'LazyRouteView',
    setup() {
      const loaded = shallowRef(null)
      const failed = ref(false)
      let disposed = false
      const loader = routeLoaders[path]
      if (!loader) failed.value = true
      else {
        void loader()
          .then((module) => { if (!disposed) loaded.value = module.default })
          .catch(() => { if (!disposed) failed.value = true })
      }
      onBeforeUnmount(() => { disposed = true })
      return () => loaded.value
        ? h(loaded.value)
        : failed.value ? h(RouteError) : h(RouteLoading)
    },
  })
}

export const routes = [
  // meta.title 用于两处：标签页标题，以及路由切换时的读屏播报。
  { path: '/', name: 'today', meta: { title: '今天', navigation: { id: 'today', icon: '☀️', groupId: 'workspace', groupLabel: '今日', defaultDesktop: true, shortcut: 1 } }, component: asyncRoute('/') },
  { path: '/today', redirect: '/' },
  { path: '/schedule', name: 'schedule', meta: { title: '课程表', navigation: { id: 'schedule', icon: '📅', mobileLabel: '学习', groupId: 'learning', groupLabel: '学习', defaultDesktop: true, shortcut: 2 } }, component: asyncRoute('/schedule') },
  { path: '/course', name: 'course-archive', meta: { title: '课程进度', navigation: { id: 'course', icon: '📚', groupId: 'learning', groupLabel: '学习', defaultDesktop: true } }, component: asyncRoute('/course') },
  { path: '/tasks', name: 'tasks', meta: { title: '待办', navigation: { id: 'tasks', icon: '✅', groupId: 'learning', groupLabel: '学习', defaultDesktop: true, shortcut: 3 } }, component: asyncRoute('/tasks') },
  { path: '/exams', name: 'exams', meta: { title: '重要日期', navigation: { id: 'exams', icon: '⏳', groupId: 'learning', groupLabel: '学习', defaultDesktop: true, shortcut: 4 } }, component: asyncRoute('/exams') },
  { path: '/events', name: 'events', meta: { title: '日程', navigation: { id: 'events', icon: '🗓️', groupId: 'schedule', groupLabel: '日程', defaultDesktop: true, shortcut: 7 } }, component: asyncRoute('/events') },
  { path: '/lists', name: 'lists', meta: { title: '清单', navigation: { id: 'lists', icon: '☑️', groupId: 'other', groupLabel: '其他', defaultDesktop: true, shortcut: 5 } }, component: asyncRoute('/lists') },
  { path: '/bills', name: 'bills', meta: { title: '账本', navigation: { id: 'bills', icon: '📒', groupId: 'other', groupLabel: '其他', defaultDesktop: true, shortcut: 6 } }, component: asyncRoute('/bills') },
  { path: '/review', name: 'review', meta: { title: '回顾', navigation: { id: 'review', icon: '↺', groupId: 'other', groupLabel: '其他', defaultDesktop: true, shortcut: 8 } }, component: asyncRoute('/review') },
  // Keep old bookmarks usable after the standalone Notes page was retired.
  { path: '/notes', redirect: '/' },
  { path: '/together', name: 'together', meta: { title: '一起约', navigation: { id: 'together', icon: '👥', groupId: 'schedule', groupLabel: '日程', defaultDesktop: true } }, component: asyncRoute('/together') },
  { path: '/projects', name: 'projects', meta: { title: '齐行', navigation: { id: 'projects', icon: '🧩', groupId: 'qixing', groupLabel: '齐行', defaultDesktop: true } }, component: asyncRoute('/projects') },
  { path: '/:pathMatch(.*)*', name: 'not-found', meta: { title: '页面不存在' }, component: NotFoundView },
]
