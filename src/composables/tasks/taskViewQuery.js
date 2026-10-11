/**
 * 待办页「列表状态」的路由 query 编解码（纯函数，不碰 Vue / 路由 / 存储）。
 *
 * 【为什么状态要进地址栏】`taskViews.js` 已经定了全仓约定：页面内状态走路由 query，
 * 而不是 `localStorage` 或组件内的 ref。视图模式（`?view=`）和月份（`?month=`）照做了，
 * 但筛选、排序、搜索、优先级、日期范围和归档开关一直留在 `TasksView` 的本地 ref 里，
 * 于是出现了「同一个页面，两半状态，一半跟地址走一半不跟」：
 *   - 刷新 / 从后台切回来 → 筛选和搜索被清空，用户得重挑一遍；
 *   - 浏览器后退 → 只退得回视图模式，退不回刚才那份筛选；
 *   - 把「未来 7 天的待办」发给别人 → 链接过去看到的是默认视图。
 * 这里把六项状态统一收敛到 query。通常省略默认值，但显式的 `f=scheduled` 必须保留：
 * 它表示用户确认过「已安排」，刷新后智能默认不能覆盖这份选择。
 *
 * 【为什么保留脏值合法化】query 是可以被手改、被旧链接、被历史记录带进来的。读侧一律按
 * 「不认识就退回默认」处理，写侧才负责产出干净的值——和 `taskViewModeFromQuery` /
 * `taskMonthFromQuery` 是同一套形状。
 *
 * 【排序方向按 key 定基准，而不是全局一个方向】三种排序的「自然顺序」本来就不同：
 * 截止时间和优先级都是从最紧要的开始（升序），创建时间是从最新的开始（降序）。
 * 所以 URL 里存的是**解析后的绝对方向**，只有和该 key 的基准不同才写出来：
 * `?sort=created` 是「最新在前」，`?sort=created&dir=asc` 才是「最早在前」。
 */
import { TASK_PLAN_STATE } from '../domain/state.js'

/** @typedef {'due' | 'priority' | 'created'} TaskSortKey */
/** @typedef {'asc' | 'desc'} SortDirection */
/** @typedef {{ filter: string, sort: TaskSortKey, dir: SortDirection, q: string, priority: string, period: string, history: boolean }} TaskListState */
/** @typedef {Partial<TaskListState>} TaskListPatch */
/** @typedef {Record<string, unknown>} TaskRouteQuery */

/** 排序项：键 + 用户可见文案。`selectTaskView` 的 `sortKey` 取这里的 `key`。 */
export const TASK_SORTS = Object.freeze(/** @type {{ key: TaskSortKey, label: string }[]} */ ([
  { key: 'due', label: '按下一步时间' },
  { key: 'priority', label: '按优先级' },
  { key: 'created', label: '按创建时间' },
]))

/** 每种排序的默认方向。`selectTaskView` 用它当基准，避免把 `created` 反着排。 */
export const SORT_DEFAULT_DIR = Object.freeze(/** @type {Record<TaskSortKey, SortDirection>} */ ({ due: 'asc', priority: 'asc', created: 'desc' }))

const SORT_KEY_SET = new Set(TASK_SORTS.map((sort) => sort.key))
const FILTER_VALUES = new Set([TASK_PLAN_STATE.unplanned, TASK_PLAN_STATE.scheduled, TASK_PLAN_STATE.completed, 'all'])
const PRIORITY_VALUES = new Set(['all', 'high', 'normal', 'low'])
const PERIOD_VALUES = new Set(['all', 'today', 'overdue', 'week', 'unplanned'])

/** 默认值。地址栏里不出现这些值的等价格式。 */
export const DEFAULT_TASK_LIST_STATE = Object.freeze({
  filter: TASK_PLAN_STATE.scheduled,
  sort: 'due',
  dir: '',
  q: '',
  priority: 'all',
  period: 'all',
  history: false,
})

/** 本模块管理的 query 键。与 `?view` / `?month` / `?focus` 等由别处管理的键互不覆盖。 */
export const TASK_LIST_QUERY_KEYS = Object.freeze(['f', 'sort', 'dir', 'q', 'prio', 'when', 'hist'])

/** 取 query 的第一个值；数组（`?q=a&q=b`）与 null 都按缺省处理。 @param {unknown} value */
function first(value) {
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim()
}

/** 把值收进白名单；不认识的一律回落到默认值。 @template {string} T @param {unknown} value @param {Set<T>} allowed @param {T} fallback @returns {T} */
function oneOf(value, allowed, fallback) {
  const text = first(value)
  return allowed.has(/** @type {T} */ (text)) ? /** @type {T} */ (text) : fallback
}

/** 解析方向：`?dir=` 合法就用它，否则用该排序键的基准方向。 */
/** @param {TaskSortKey} sort @param {unknown} dir @returns {SortDirection} */
export function resolveSortDir(sort, dir) {
  const base = SORT_DEFAULT_DIR[sort] || 'asc'
  const text = first(dir)
  return text === 'asc' || text === 'desc' ? text : base
}

/**
 * 读侧：把（可能很脏的）query 解析成一份完整的列表状态。
 *
 * 返回的 `dir` 永远是解析后的绝对方向，调用方不需要再判断基准。
 */
/** @param {TaskRouteQuery} [query] @returns {TaskListState} */
export function readTaskListState(query = {}) {
  const source = query && typeof query === 'object' ? query : /** @type {TaskRouteQuery} */ ({})
  const sort = oneOf(source.sort, SORT_KEY_SET, DEFAULT_TASK_LIST_STATE.sort)
  return {
    filter: oneOf(source.f, FILTER_VALUES, DEFAULT_TASK_LIST_STATE.filter),
    sort,
    dir: resolveSortDir(sort, source.dir),
    q: first(source.q).slice(0, 200),
    priority: oneOf(source.prio, PRIORITY_VALUES, DEFAULT_TASK_LIST_STATE.priority),
    period: oneOf(source.when, PERIOD_VALUES, DEFAULT_TASK_LIST_STATE.period),
    history: first(source.hist) === '1',
  }
}

/**
 * 写侧：在现有 query 上打补丁，保留显式状态组，省略其他默认值。
 *
 * 补丁里的 `dir` 允许只写方向不写排序键；没给 `sort` 时沿用读回来的基准来比较。
 * 返回新对象，不改传入的 query。
 */
/** @param {TaskRouteQuery} [query] @param {TaskListPatch} [patch] @returns {Record<string, unknown>} */
export function writeTaskListState(query = {}, patch = {}) {
  const current = readTaskListState(query)
  const next = { ...current, ...patch }
  if (Object.prototype.hasOwnProperty.call(patch, 'sort')
    && !Object.prototype.hasOwnProperty.call(patch, 'dir')
    && next.sort !== current.sort) {
    next.dir = SORT_DEFAULT_DIR[next.sort] || 'asc'
  }
  next.sort = oneOf(next.sort, SORT_KEY_SET, DEFAULT_TASK_LIST_STATE.sort)
  next.dir = resolveSortDir(next.sort, next.dir)

  /** @type {Record<string, unknown>} */
  const result = {}
  // 先原样搬走本模块不管理的键（view / month / focus / new / courseId …），
  // 免得「只改排序」顺手把深链高亮或月份抹掉。
  for (const [key, value] of Object.entries(query && typeof query === 'object' ? query : {})) {
    if (!TASK_LIST_QUERY_KEYS.includes(key)) result[key] = value
  }
  if (next.filter !== DEFAULT_TASK_LIST_STATE.filter || hasExplicitFilter(query)
    || Object.prototype.hasOwnProperty.call(patch, 'filter')) result.f = next.filter
  if (next.sort !== DEFAULT_TASK_LIST_STATE.sort) result.sort = next.sort
  if (next.dir !== SORT_DEFAULT_DIR[next.sort]) result.dir = next.dir
  if (next.q) result.q = next.q
  if (next.priority !== DEFAULT_TASK_LIST_STATE.priority) result.prio = next.priority
  if (next.period !== DEFAULT_TASK_LIST_STATE.period) result.when = next.period
  if (next.history) result.hist = '1'
  return result
}

/**
 * URL 里有没有**显式**指定筛选。
 *
 * 「已安排为空就自动落到待安排」的智能默认（见 `TasksView` 里的 counts 监听）只在用户
 * 从没选过时生效。刷新后这份默认值必须让位给地址栏里的显式选择，否则用户上次挑好的
 * 「待安排日期」会被智能默认重新顶掉一次——那正是把状态写进 URL 原本要解决的问题。
 */
/** @param {TaskRouteQuery} [query] */
export function hasExplicitFilter(query = {}) {
  const text = first(query && typeof query === 'object' ? query.f : '')
  return FILTER_VALUES.has(text)
}

/**
 * 切换排序方向：在基准方向与它的反面之间**来回**。
 *
 * 「永远返回基准的反面」是错的：那样连点两次方向不变，看起来像按钮坏了。
 * 已经是反面就回到基准，是基准就翻过去。
 */
/** @param {TaskListState} [state] @returns {SortDirection} */
export function toggledSortDir(state = DEFAULT_TASK_LIST_STATE) {
  const sort = SORT_KEY_SET.has(state?.sort) ? state.sort : DEFAULT_TASK_LIST_STATE.sort
  const base = SORT_DEFAULT_DIR[sort] || 'asc'
  const opposite = base === 'asc' ? 'desc' : 'asc'
  return resolveSortDir(sort, state?.dir) === base ? opposite : base
}
