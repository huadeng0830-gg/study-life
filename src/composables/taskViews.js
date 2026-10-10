/**
 * 待办页三种视图（列表 / 看板 / 月历）共用的**纯**派生逻辑。
 *
 * 【为什么单独抽一层】这三件事——把待办分进三列、把某个月摊成 35~42 个格子、把脏的路由
 * 参数映射成合法视图——都是「输入给定的算术」，与 Vue、与存储、与时间钟都无关。放在组件里
 * 就只能靠点界面去验；放在这里可以直接断言「周五的工作日重复是不是落到周一」「本月 1 号是
 * 周日时前面是不是补了 6 个空格」「`?view=zzz` 会不会退回列表」。
 *
 * 【视图模式不进存储键】全仓的页面内状态（账本分区、日期、聚焦项）都走路由 query，
 * 见 `src/composables/routeState.js` 与 `focusNavigation.js`。这里沿用同一套约定：
 * 视图是**当前地址**的一部分，刷新与分享链接天然带得走，浏览器前进后退也一定有意义，
 * 而 `localStorage` 里一个键都不必新增。
 */
import { isArchived } from './domain/state.js'
import { moveTimeDate, taskTimeEntries } from './tasks/taskTimePlan.ts'

/** 视图模式：列表是默认值，且**不带** query 参数（保持地址栏干净）。 */
export const TASK_VIEW_MODES = Object.freeze([
  { value: 'list', label: '列表' },
  { value: 'board', label: '看板' },
  { value: 'calendar', label: '月历' },
])

const VIEW_VALUES = new Set(TASK_VIEW_MODES.map((mode) => mode.value))

/** 读侧：`?view=` 的合法化。脏值（`zzz`、空、数组）一律退回列表。 */
export function taskViewModeFromQuery(value) {
  const text = String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim()
  return VIEW_VALUES.has(text) ? text : 'list'
}

/** 看板三列。列即用户可见的状态，与 `status` / `done` 一一对应。 */
export const TASK_BOARD_COLUMNS = Object.freeze([
  { key: 'pending', label: '待办' },
  { key: 'in_progress', label: '进行中' },
  { key: 'completed', label: '已完成' },
])

/**
 * 一条待办该落在看板哪一列；不属于任何一列时返回空串。
 *
 * 【为什么不复用 `taskStatus`】那个函数会把「逾期」派生成一个额外状态，
 * 于是同一条待办在今天和明天会落到不同的列上——看板的列要稳定，否则用户按一下刷新
 * 就发现自己的活儿「换列」了。这里只用记录自身的 `status` / `done` 判定。
 * 逾期仍然要看得见，所以卡片上照旧渲染截止文案与逾期配色。
 */
export function boardColumnKeyOf(task) {
  if (!task || typeof task !== 'object') return ''
  if (isArchived(task)) return ''
  if (task.status === 'cancelled') return ''
  if (task.status === 'completed' || task.done === true) return 'completed'
  if (task.status === 'in_progress') return 'in_progress'
  return 'pending'
}

/** 把待办按看板列分组。输入顺序原样保留，排序交给调用方的 `selectTaskView`。 */
export function buildTaskBoard(tasks = []) {
  const columns = { pending: [], in_progress: [], completed: [] }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const key = boardColumnKeyOf(task)
    if (key) columns[key].push(task)
  }
  return columns
}

const MONTH_KEY = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** 读侧：`?month=YYYY-MM`（也接受完整的 `YYYY-MM-DD`）的合法化，非法时退回今天所在月。 */
export function taskMonthFromQuery(value, todayKey = '') {
  const text = String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim()
  const match = MONTH_KEY.exec(text)
  const fallback = String(todayKey || '').slice(0, 7)
  if (!match) return /^\d{4}-\d{2}$/.test(fallback) ? fallback : ''
  const month = Number(match[2])
  if (month < 1 || month > 12) return /^\d{4}-\d{2}$/.test(fallback) ? fallback : ''
  return `${match[1]}-${match[2]}`
}

/** 翻月。跨年交给原生 `Date`（`new Date(2026, 11, 1)` 正好是 2027 年 1 月），不手写年份表。 */
export function shiftTaskMonth(monthKey, delta) {
  const match = MONTH_KEY.exec(String(monthKey || ''))
  if (!match) return ''
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + (Number(delta) || 0), 1)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** 月份标签：当年只写「10月」，跨年才带年份——与账本回顾的翻月标题同一套口径。 */
export function taskMonthLabel(monthKey, todayKey = '') {
  const match = MONTH_KEY.exec(String(monthKey || ''))
  if (!match) return ''
  const month = Number(match[2])
  return String(todayKey || '').slice(0, 4) === match[1] ? `${month}月` : `${match[1]}年${month}月`
}

/** 圆点粗细：与账本回顾「月历点迹」同一套阈值（1 条 / 2~3 条 / 4 条及以上）。 */
export function taskCalendarDotClass(count) {
  const total = Number(count) || 0
  if (total >= 4) return 'l3'
  if (total >= 2) return 'l2'
  return 'l1'
}

/**
 * 把某个月摊成月历格子：前面补空位（周一起始），后面按需补空位凑满整周。
 *
 * 「一周一行」是需求里点名的形状，所以行数一定补足到 7 的倍数：
 * 不补的话最后一行可能只有 2 天，视觉上像缺了一周，读屏数「第几周」也会对不上。
 */
export function buildTaskMonthGrid(monthKey, tasks = []) {
  const match = MONTH_KEY.exec(String(monthKey || ''))
  if (!match) return { cells: [], byDate: new Map() }
  const year = Number(match[1])
  const month = Number(match[2])
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7 // 周一为一周之始

  const byDate = new Map()
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (isArchived(task) || task.status === 'cancelled') continue
    const dates = new Set()
    const firstDate = `${match[1]}-${match[2]}-01`
    const lastDate = `${match[1]}-${match[2]}-${String(daysInMonth).padStart(2, '0')}`
    for (const entry of taskTimeEntries(task)) {
      if (entry.anchor !== 'occupied') dates.add(entry.date)
      else {
        let date = entry.date > firstDate ? entry.date : firstDate
        const end = (entry.endDate || entry.date) < lastDate ? entry.endDate : lastDate
        while (date && date <= end) { dates.add(date); date = moveTimeDate(date, 1) }
      }
    }
    for (const dateKey of dates) {
      if (!DATE_KEY.test(dateKey) || dateKey < firstDate || dateKey > lastDate) continue
      const bucket = byDate.get(dateKey) ?? []
      bucket.push(task)
      byDate.set(dateKey, bucket)
    }
  }

  const cells = []
  for (let i = 0; i < lead; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    const pad = (value) => String(value).padStart(2, '0')
    const dateKey = `${match[1]}-${match[2]}-${pad(day)}`
    cells.push({ day, dateKey, tasks: byDate.get(dateKey) ?? [], count: (byDate.get(dateKey) ?? []).length })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return { cells, byDate }
}

/** 月历格子的可访问名称：格子里只有日期数字和一个圆点，光靠圆点听不出这天有几件事。 */
export function taskCalendarCellLabel(cell) {
  if (!cell) return ''
  const month = Number(String(cell.dateKey).slice(5, 7))
  const date = `${month}月${cell.day}日`
  return cell.count ? `${date}，${cell.count} 条待办安排` : `${date}，无待办安排`
}

/** 当天待办行的可访问名称。 */
export function taskCalendarRowLabel(task, dueText = '') {
  return [`打开待办「${task?.title ?? ''}」`, dueText].filter(Boolean).join('，')
}
