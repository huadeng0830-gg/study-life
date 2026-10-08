/**
 * 待办的重复规则，以及「下一期」的日期推算。
 *
 * 【为什么整层都是纯函数】生成下一期只取决于「这条待办的截止日期 + 重复规则 + 可选的重复
 * 截止日期」，与时间戳、存储、组件都无关。原来它就只是个纯函数；把规则从 1 种扩到 5 种
 * 之后这一点更关键：「1 月 31 日的每月重复」到底落到 2 月 28 日还是 3 月 3 日、「周五的
 * 工作日重复」下一条是不是周一、「结束日期过了还会不会生成」，都是能被直接断言的算术事实，
 * 不该只能靠点界面去看一次才知道。
 *
 * 【兼容旧数据的约定】
 *   - `repeat: 'weekly'` 的行为与本轮之前**逐条一致**（同一个 +7 天、同一套新 id 规则）；
 *   - `repeat` 缺失或旧值（`'none'`）一律按不重复处理；
 *   - 读到一个**不认识**的规则值（手改数据、旧版本残留）按「不重复」处理而不是猜一个，
 *     宁可少生成一条，也不要在用户没设置过的规则下凭空塞进新待办。
 */

function dateText(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 可选的重复规则。`label` 直接就是表单里的选项文案。
 * 「会生成下一期」的集合 = 去掉 `none` 的那些。
 */
export const TASK_REPEATS = Object.freeze([
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日（跳过周末）' },
  { value: 'weekly', label: '每周' },
  { value: 'biweekly', label: '每两周' },
  { value: 'monthly', label: '每月' },
])

const REPEAT_VALUES = new Set(TASK_REPEATS.map((rule) => rule.value))
const SPAWNING_REPEATS = new Set(TASK_REPEATS.filter((rule) => rule.value !== 'none').map((rule) => rule.value))
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** 写入侧的唯一出口：不认识的值一律收敛成 `none`。 */
export function normalizeTaskRepeat(value) {
  const text = String(value ?? '').trim()
  return REPEAT_VALUES.has(text) ? text : 'none'
}

export function taskRepeatLabel(value) {
  return TASK_REPEATS.find((rule) => rule.value === value)?.label ?? TASK_REPEATS[0].label
}

/** 完成后会不会生成下一条。`none` 与任何非法值都是 false。 */
export function repeatsTask(task) {
  if (!task || typeof task !== 'object') return false
  return SPAWNING_REPEATS.has(normalizeTaskRepeat(task.repeat))
}

/**
 * 截止日期解析。刻意保持和旧实现一样宽松（只用 `new Date` + NaN 判定），
 * 免得因为这里加了一层正则就让某条历史数据的重复行为变掉。
 *
 * 副作用也一并留着：原生 `Date` 会把 `2026-02-30` 滚成 3 月 2 日（`Date.UTC` 才会给 NaN），
 * 而旧实现走的正是这条路。这类脏日期在表单的 `type="date"` 下进不来，
 * 为它加校验等于悄悄改变既有行为，所以维持原样，只在这里写明。
 */
function parseDueDate(dueDate) {
  if (!dueDate) return null
  const date = new Date(`${dueDate}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * 「工作日」的下一站：先 +1 天，落在周六就再 +2 天（到周一），落在周日就再 +1 天。
 *
 * 【语义要点】跳过的是**周末这两天**，不是跳过这一周：
 * 截止日是周五时，下一条落在下周一（3 天后），而不是「因为周五不是工作日就跳到下周」。
 */
function nextWeekday(date) {
  date.setDate(date.getDate() + 1)
  const weekday = date.getDay() // 0 = 周日 … 6 = 周六
  if (weekday === 6) date.setDate(date.getDate() + 2)
  else if (weekday === 0) date.setDate(date.getDate() + 1)
  return date
}

/**
 * 按原始日号推进，并把目标月不存在的日期夹到月末（31 号 → 2 月末 → 下个月 31 号）。
 * 没有传锚点的单次调用沿用当前日号；重复待办会把 `repeatAnchorDay` 传给每一期，
 * 避免把临时夹短的 28/29/30 号当成长期新基准。
 */
function validAnchorDay(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const day = Number(value)
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null
}

function addMonthsClamped(date, requestedAnchorDay) {
  const anchorDay = validAnchorDay(requestedAnchorDay) ?? date.getDate()
  const targetMonth = date.getMonth() + 1
  const lastDayDate = new Date(date.getTime())
  lastDayDate.setDate(1)
  lastDayDate.setMonth(targetMonth + 1)
  lastDayDate.setDate(0)
  const lastDay = lastDayDate.getDate()
  date.setDate(1)
  date.setMonth(targetMonth)
  date.setDate(Math.min(anchorDay, lastDay))
  return date
}

/**
 * 重复截止日期（含当天）。格式不是 `YYYY-MM-DD` 时按「没填」处理：
 * 读侧不做猜测，写入侧（`createTask` / `updateTask`）已经把脏值挡掉了。
 */
function repeatEndKey(value) {
  const text = String(value ?? '').trim()
  return DATE_KEY.test(text) ? text : ''
}

/**
 * 下一期的截止日期；算不出来时返回空串（调用方据此「不生成」）。
 *
 * @param {string} dueDate 本期截止日期 `YYYY-MM-DD`
 * @param {string} repeat 重复规则；不认识的值按 `none` 处理并返回空串
 * @param {{ until?: string, anchorDay?: number }} [options] `until` 为重复截止日期（含当天），`anchorDay` 为每月锚点；空/非法 `until` = 一直重复
 */
export function nextRepeatDueDate(dueDate, repeat, { until = '', anchorDay } = {}) {
  const rule = normalizeTaskRepeat(repeat)
  if (rule === 'none') return ''
  const date = parseDueDate(dueDate)
  if (!date) return ''
  if (rule === 'daily') date.setDate(date.getDate() + 1)
  else if (rule === 'weekdays') nextWeekday(date)
  else if (rule === 'weekly') date.setDate(date.getDate() + 7)
  else if (rule === 'biweekly') date.setDate(date.getDate() + 14)
  else addMonthsClamped(date, anchorDay)
  const next = dateText(date)
  const end = repeatEndKey(until)
  // `YYYY-MM-DD` 的字典序与时间序一致，可以直接比字符串。
  return end && next > end ? '' : next
}

/**
 * 生成重复待办的下一条。规则不认识、缺截止日期、超过重复截止日期时都返回 null。
 */
export function createNextRepeatingTask(task, now = new Date()) {
  if (!repeatsTask(task) || !task?.dueDate) return null
  const rule = normalizeTaskRepeat(task.repeat)
  const parsedDate = parseDueDate(task.dueDate)
  const repeatAnchorDay = rule === 'monthly'
    ? validAnchorDay(task.repeatAnchorDay) ?? parsedDate?.getDate()
    : null
  const dueDate = nextRepeatDueDate(task.dueDate, rule, {
    until: task.repeatEndDate,
    anchorDay: repeatAnchorDay,
  })
  if (!dueDate) return null
  const next = {
    ...task,
    // 只用毫秒时间戳当 id 时，同一毫秒内完成的两个重复任务会拿到同一个 id，
    // 在同步合并与 tombstone 里互相覆盖。补一段随机后缀消除碰撞。
    id: `t${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    done: false,
    completedAt: null,
    repeatGeneratedAt: null,
    dueDate,
    createdAt: now.toISOString(),
  }
  if (repeatAnchorDay) next.repeatAnchorDay = repeatAnchorDay
  else delete next.repeatAnchorDay
  return next
}

/**
 * 旧导出名，保留给既有的调用方与「只认 weekly」的历史语义：
 * 传 `daily` / `monthly` 进来返回 null，而不是悄悄按新规则生成一条。
 */
export function createNextWeeklyTask(task, now = new Date()) {
  if (!task || task.repeat !== 'weekly') return null
  return createNextRepeatingTask(task, now)
}
