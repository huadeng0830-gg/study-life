// 回顾页四张图表的**纯计算层**：学期节奏热力图 / 完成率折线与逾期堆积 /
// 心情×专注对比 / 专注时段规律。
//
// 【为什么单独一个文件、且尽量不依赖 Vue】这四张图的形状全由数据决定，而"形状算错了"
// 在真实页面上是看不出来的（一条线歪一点、一格颜色深一点，没有报错也没有断言）。
// 所以数据口径必须能被 vitest 逐值断言 —— 这里全是纯函数，组件只负责把结果
// 画成 SVG/CSS。仓库此前**没有任何图表**（全仓搜 chart/趋势/柱状/折线零命中），
// 因此没有可复用的图表工具，本文件是第一个。
//
// 【四条硬边界，改动前先读】
//   1. 心情三键（sunny/cloudy/rain）由 `selectWeeklyMoodSummary` 产出，而
//      `weatherOfMood()` 的返回值必须继续落在三键内（HANDOVER §3.3 第 8 条：
//      返回新值会让 `counts[...] += 1` 变成 NaN）。本文件**只消费**它，不重算。
//   2. 热力图的完成数直接取 `selectWeeklyTaskSummary(data, now, { range })`，
//      不重写聚合逻辑 —— 那个选择器已经支持 range，重复实现必然随时间漂移。
//   3. `taskRatePercent` 是从 retrospective.js 三个函数里抽出来的**同一个**公式，
//      抽它是因为折线与「那天/月度/年度回顾」必须用同一个完成率定义
//      （否则同一页上两个同名数字含义不同）。既有输出由 tests/retrospective.test.js 钉住。
//   4. 时间一律走 settingsPolicy 的 policyDateKey / policyTimeKey（应用时区口径）。
//      **不要用 `new Date(x).getHours()`**：那是宿主机时区，用户在设置里选了
//      Asia/Shanghai 时会与全站其余日期显示差一整天，而"我晚上 9 点最清醒"
//      这类结论对时区误差零容忍。
//
// 唯一的非纯之处是默认参数 `now = clock.value`（响应式时钟），与仓库里其它
// 读数据的纯函数同形态；测试一律显式传 `now`，不依赖时钟。
import { selectWeeklyMoodSummary, selectWeeklyTaskSummary, weekRange } from './domain/weeklySelectors.js'
import { isActiveEntity } from './domain/state.js'
import { normalizeFocusSession } from './focusTimer.js'
import { policyDateTime, policyTimeKey, timestampOf } from './settingsPolicy.js'
import { clock } from './store/core.js'

/** 热力图默认铺 16 周（一学期量级），够看出节奏又不至于挤成一条。 */
export const RHYTHM_WEEKS = 16

const tasksOf = (data) => (Array.isArray(data?.tasks) ? data.tasks : [])
const sessionsOf = (data) => (Array.isArray(data?.focusSessions) ? data.focusSessions : [])

/**
 * 完成率（百分比，四舍五入到整数）。
 *
 * 从 retrospective.js 的 `daySnapshot` / `monthReport` / `yearReport` 三处
 * 逐字搬过来的同一个公式：分母为 0 时返回 0，而不是 NaN。
 * 抽成具名纯函数是因为它现在有第二个调用方（周度折线），两份副本迟早会不一致。
 *
 * @param {number} total 分母
 * @param {number} done 分子
 * @returns {number} 0..100 的整数
 */
export function taskRatePercent(total, done) {
  const size = Number(total)
  if (!Number.isFinite(size) || size <= 0) return 0
  const finished = Number(done)
  const safe = Number.isFinite(finished) && finished > 0 ? finished : 0
  return Math.round((safe / size) * 100)
}

/** 待办是否算"已完成"：与 retrospective.js / weeklySelectors 的口径一致。 */
function isDone(task) {
  return Boolean(task?.done) || task?.status === 'completed'
}

/** 日期键加减天数（UTC 运算，跨年/跨月由 Date 自己处理，不做字符串拼接）。 */
function shiftDateKey(key, amount) {
  const [year, month, day] = String(key || '').split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

/** 本周到期、到周末仍逾期的待办数；迟于该周末补完的仍计入截止周。 */
function validDateKey(value) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().slice(0, 10) === text
}

/** 一个任务在给定时点是否已经逾期。完成时间晚于时点时，历史上仍算欠账。 */
function isOverdueAt(task, cutoff, timezone) {
  if (!isActiveEntity(task)) return false
  const dueDate = String(task?.dueDate ?? '')
  if (!validDateKey(dueDate)) return false
  const dueAt = policyDateTime(dueDate, task?.dueTime || '23:59', timezone)
  if (!Number.isFinite(dueAt) || dueAt >= cutoff) return false
  const completedAt = timestampOf(task?.completedAt)
  if (completedAt) return completedAt > cutoff
  // 老待办可能只有 done/status，没有完成时间；不能把它猜成迟交。
  return !isDone(task)
}

function missedInWeek(tasks, range, cutoff, timezone) {
  let count = 0
  for (const task of tasks) {
    const due = String(task?.dueDate ?? '')
    if (!due || due < range.startDate || due >= range.endDate) continue
    if (isOverdueAt(task, cutoff, timezone)) count += 1
  }
  return count
}

function backlogAt(tasks, cutoff, timezone) {
  let count = 0
  for (const task of tasks) if (isOverdueAt(task, cutoff, timezone)) count += 1
  return count
}

/** 一周在热力图里的深浅档（0..4）。颜色只用来"排序"，文字另有一份（见 label）。 */
function heatLevel(rate) {
  if (rate <= 0) return 0
  if (rate <= 25) return 1
  if (rate <= 50) return 2
  if (rate <= 75) return 3
  return 4
}

/**
 * 功能 15：16 周的待办完成率热力图数据。
 *
 * 每格的口径：**该周完成的待办数 ÷（该周完成的 + 该周到期但至今未完成的）**。
 * 分母这样取有两个理由：
 *   1. 分子必须来自 `selectWeeklyTaskSummary`（复用既有聚合，不重写）；
 *   2. 分母由分子 + 同周未完成项拼成，于是 rate 恒在 0..100，不会出现
 *      "上周到期这周补完"把完成率顶到 130% 的怪事。
 *
 * **空周必须与 0% 分开**：`total === 0` 表示这一周既没有完成、也没有到期未完成，
 * 没有任何可评价的待办。把它画成红色是在陈述一件不存在的事，所以它有独立的
 * `empty` 标记与独立类名，由组件画成虚线空格子。
 *
 * @returns {{ weeks: object[], recorded: number, emptyWeeks: number }}
 */
export function buildRhythmWeeks(data = {}, now = clock.value, options = {}) {
  const tasks = tasksOf(data)
  const requested = Number(options.weeks)
  const count = Math.max(1, Math.min(52, Number.isFinite(requested) && requested > 0 ? Math.round(requested) : RHYTHM_WEEKS))
  const weeks = []
  for (let index = 0; index < count; index += 1) {
    // 从最早一周排到本周（weekOffset 为负），所以 offset = index - (count - 1)。
    const offset = index - (count - 1)
    const range = weekRange(now, { ...options, weekOffset: offset })
    const summary = selectWeeklyTaskSummary(data, now, { ...options, range })
    const nowTimestamp = now instanceof Date ? now.getTime() : timestampOf(now)
    // 【missed 的截断点是"现在"，不是那一周的周末】
    // 口径是「本周到期、且**至今**仍未完成」：上周到期、本周才补完的那一条，
    // 补完之后就不该再算成上一周的欠账。原来越是 min(week.endAt, now)，
    // 补完动作发生在周末之后就仍然被算作逾期 —— 于是同一件事在它被完成之后
    // 还会在上一格里挂一个数字，看起来像"永远还不掉"。
    // 注意这只影响 missed；面积图的 backlogAt 仍然按周末截断，
    // 因为"周末时点的欠账存量"本来就该保留"当时还没还"的语义。
    const cutoff = nowTimestamp || range.endAt
    const missed = missedInWeek(tasks, range, cutoff, options.timezone)
    const total = summary.completed + missed
    const rate = taskRatePercent(total, summary.completed)
    weeks.push({
      index,
      offset,
      startDate: range.startDate,
      // endDate 是**下一周周一**（开区间上界），不是本周最后一天；
      // 展示时要减一天 —— 不减会让跨月的那一周显示成 9-01—9-01。
      endDate: range.endDate,
      lastDate: shiftDateKey(range.endDate, -1),
      isCurrent: offset === 0,
      completed: summary.completed,
      created: summary.created,
      focusMinutes: summary.focusMinutes,
      missed,
      total,
      rate,
      empty: total === 0,
      level: heatLevel(rate),
      label: total === 0
        ? `第 ${index + 1} 周，没有记录`
        : `第 ${index + 1} 周，完成 ${summary.completed}/${total}`,
    })
  }
  return {
    weeks,
    recorded: weeks.filter((week) => !week.empty).length,
    emptyWeeks: weeks.filter((week) => week.empty).length,
  }
}

/**
 * 功能 18：按周连成折线的完成率，外加每周末仍未清掉的逾期**存量面积**。
 * 前周欠账会带入后续周，并在完成周消退；`missed` 单独保留为本周到期且周末仍逾期数，
 * `cumulative` 是窗口内逾期事件累计，不拿它伪装当前欠账存量。当前周按调用时点截断。
 *
 * @returns {{ points: object[], recordedWeeks: number, totalMissed: number, currentBacklog: number }}
 */
export function buildCompletionTrend(data = {}, now = clock.value, options = {}) {
  const { weeks } = buildRhythmWeeks(data, now, options)
  const tasks = tasksOf(data)
  const nowTimestamp = now instanceof Date ? now.getTime() : timestampOf(now)
  let cumulative = 0
  const firstRange = weeks.length
    ? weekRange(now, { ...options, weekOffset: weeks[0].offset })
    : null
  // 窗口左边界的欠账也要进入面积：它们虽然不是近 16 周新到期的任务，
  // 但在第一周开始时仍未完成，第一周末的库存变化应以这笔存量为起点。
  let previousBacklog = firstRange ? backlogAt(tasks, firstRange.startAt, options.timezone) : 0
  const points = weeks.map((week) => {
    cumulative += week.missed
    const range = weekRange(now, { ...options, weekOffset: week.offset })
    const cutoff = Math.min(range.endAt, nowTimestamp || range.endAt)
    const backlog = backlogAt(tasks, cutoff, options.timezone)
    const priorBacklog = previousBacklog
    previousBacklog = backlog
    return {
      index: week.index,
      offset: week.offset,
      startDate: week.startDate,
      lastDate: week.lastDate,
      isCurrent: week.isCurrent,
      completed: week.completed,
      total: week.total,
      rate: week.rate,
      empty: week.empty,
      missed: week.missed,
      cumulative,
      backlog,
      previousBacklog: priorBacklog,
      label: week.total === 0
        ? `第 ${week.index + 1} 周，没有记录，周末逾期 ${backlog} 项`
        // missed 的口径已改成「本周到期且**至今未完成**」，文案必须跟着改 ——
        // 旧文案说的是「周末仍逾期」，而那其实是 backlog 的口径。
        : `第 ${week.index + 1} 周，完成率 ${week.rate}%，本周到期未完成 ${week.missed} 项，周末仍逾期 ${backlog} 项`,
    }
  })
  return {
    points,
    recordedWeeks: points.filter((point) => !point.empty).length,
    totalMissed: cumulative,
    currentBacklog: points.at(-1)?.backlog ?? 0,
  }
}

const round2 = (value) => Math.round(value * 100) / 100

/**
 * 把折线/面积的数据点换算成 viewBox 里的坐标串（手写 SVG，不引图表库）。
 *
 * 放在纯函数里而不是模板里，是因为"坐标算错了"是肉眼看不出来的缺陷：
 * 全部 rate 为 0 时 y 会叠成一条横线，折数变化时线会跑出画布，
 * 只有一个数据点时横坐标会除以 0。这三种都必须能被断言。
 *
 * @param {{ rate: number, backlog?: number, previousBacklog?: number, cumulative?: number, missed?: number }[]} points
 * @param {{ width?: number, height?: number, top?: number, bottom?: number, left?: number, right?: number }} [options]
 */
export function scaleTrendGeometry(points, options = {}) {
  const list = Array.isArray(points) ? points : []
  const width = Math.max(1, Number(options.width) || 100)
  const height = Math.max(1, Number(options.height) || 40)
  const top = Number.isFinite(Number(options.top)) ? Number(options.top) : 2
  const bottom = Number.isFinite(Number(options.bottom)) ? Number(options.bottom) : 2
  const left = Number.isFinite(Number(options.left)) ? Number(options.left) : 0
  const right = Number.isFinite(Number(options.right)) ? Number(options.right) : 0
  const innerWidth = Math.max(1, width - left - right)
  const innerHeight = Math.max(1, height - top - bottom)

  if (!list.length) {
    return { width, height, line: '', area: '', band: '', maxBacklog: 0, maxCumulative: 0, pointCount: 0 }
  }
  // 只有一个点时按 (n-1) 除会得到 Infinity —— 横坐标直接落在中点。
  const step = list.length > 1 ? innerWidth / (list.length - 1) : 0
  const backlogValue = (point) => Number.isFinite(Number(point?.backlog))
    ? Math.max(0, Number(point.backlog))
    : Math.max(0, Number(point?.cumulative) || 0)
  const previousBacklogValue = (point) => Number.isFinite(Number(point?.previousBacklog))
    ? Math.max(0, Number(point.previousBacklog))
    : Math.max(0, backlogValue(point) - (Number(point?.missed) || 0))
  const maxBacklog = Math.max(0, ...list.flatMap((point) => [backlogValue(point), previousBacklogValue(point)]))
  const backlogScale = Math.max(1, maxBacklog)
  const xAt = (index) => round2(list.length > 1 ? left + step * index : left + innerWidth / 2)
  const yRate = (rate) => round2(top + innerHeight - (Math.max(0, Math.min(100, Number(rate) || 0)) / 100) * innerHeight)
  const yBacklog = (value) => round2(top + innerHeight - (Math.max(0, Number(value) || 0) / backlogScale) * innerHeight)

  const baseline = round2(top + innerHeight)
  const line = list.map((point, index) => `${xAt(index)},${yRate(point.rate)}`).join(' ')
  // 面积：从折线高度落到基线闭合成多边形。**必须显式回到起点**，
  // 否则浏览器不会替我们闭合，而 happy-dom 更不会 —— 少一段连线肉眼看不出来。
  const area = list.length > 1
    ? `M${xAt(0)},${baseline} L${list.map((point, index) => `${xAt(index)},${yRate(point.rate)}`).join(' L')} L${xAt(list.length - 1)},${baseline} Z`
    : ''
  // 每周逾期存量与前周存量围成一层：欠账增加时向上扩，补完时向下收。
  const band = list.length > 1
    ? [
      `M${xAt(0)},${yBacklog(previousBacklogValue(list[0]))}`,
      ...list.map((point, index) => `L${xAt(index)},${yBacklog(backlogValue(point))}`),
      ...[...list].reverse().map((point, index) => `L${xAt(list.length - 1 - index)},${yBacklog(previousBacklogValue(point))}`),
      'Z',
    ].join(' ')
    : ''

  // maxCumulative 保留为兼容字段；面积与纵轴现按逾期存量（含窗口边界存量）缩放。
  return { width, height, line, area, band, maxBacklog, maxCumulative: backlogScale, pointCount: list.length }
}

/**
 * 一周内专注会话的分钟数（落桶口径：**全部会话**，不按 status 过滤）。
 *
 * 理由：`actualFocusSeconds` 记的就是实际专注秒数，与会话最终状态无关。
 * 只留 `status === 'completed'` 会把"计划 60 分钟、专注 18 分钟后停下"的记录整条
 * 丢掉，而那 18 分钟是真实投入 —— 按状态过滤等于系统性地少算用户的努力。
 * `normalizeFocusSession` 会把历史的 `minutes` 形态归一到秒，用它才能拿到同一个口径。
 *
 * `startedAt` 解析不出来的会话（脏数据 / 只有日期没有时刻）整条跳过，不进任何一格：
 * 归到"0 点"或"当前小时"都是编造。
 */
function focusMinutesBetween(sessions, startAt, endAt) {
  let seconds = 0
  for (const raw of sessions) {
    const stamp = startedAtStamp(raw?.startedAt)
    if (!stamp || stamp < startAt || stamp >= endAt) continue
    seconds += normalizeFocusSession(raw).actualFocusSeconds
  }
  return Math.round(seconds / 60)
}

/**
 * 功能 19：每周心情分布（晴/多云/低落）与那周总专注时长并排。
 *
 * 心情三键由 `selectWeeklyMoodSummary` 原样产出，本文件不做任何再分类，
 * 以免绕开 `weatherOfMood()` 那条"必须留在三键内"的边界。
 *
 * @returns {{ weeks: object[], moodWeeks: number }}
 */
export function buildMoodFocusWeeks(data = {}, now = clock.value, options = {}) {
  const sessions = sessionsOf(data)
  const weeks = []
  for (let index = 0; index < RHYTHM_WEEKS; index += 1) {
    const offset = index - (RHYTHM_WEEKS - 1)
    const range = weekRange(now, { ...options, weekOffset: offset })
    const mood = selectWeeklyMoodSummary(data, now, { ...options, range })
    const focusMinutes = focusMinutesBetween(sessions, range.startAt, range.endAt)
    weeks.push({
      index,
      offset,
      startDate: range.startDate,
      lastDate: shiftDateKey(range.endDate, -1),
      isCurrent: offset === 0,
      sunny: mood.sunny,
      cloudy: mood.cloudy,
      rain: mood.rain,
      moodDays: mood.days,
      dominant: mood.dominant,
      focusMinutes,
      label: mood.days === 0
        ? `第 ${index + 1} 周，没有心情记录，专注 ${focusMinutes} 分钟`
        : `第 ${index + 1} 周，晴 ${mood.sunny} · 多云 ${mood.cloudy} · 低落 ${mood.rain}，专注 ${focusMinutes} 分钟`,
    })
  }
  return { weeks, moodWeeks: weeks.filter((week) => week.moodDays > 0).length }
}

const WEATHER_NAMES = { sunny: '晴朗', cloudy: '多云', rain: '低落' }

/**
 * 一句**基于数据**的客观描述。刻意不算相关系数：心情是"想起来才记"的，
 * 样本量小的时候相关系数只是噪声的另一种写法，看起来更严谨而已。
 *
 * 只有当同时有心情与专注记录的周 ≥3 周时才比较；某个天气分组只有 1 周时
 * 补一句"先当作个案看"。
 */
export function describeMoodFocus(weeks) {
  const list = Array.isArray(weeks) ? weeks : []
  const usable = list.filter((week) => week.moodDays > 0)
  if (usable.length < 3) {
    return {
      text: `只有 ${usable.length} 周同时有心情与专注记录，还看不出规律；再多记几周就能并排对比。`,
      comparable: false,
    }
  }
  const groups = new Map()
  for (const week of usable) {
    // dominant 是 weatherOfMood 产出的三键之一，直接拿来分组即可（不再分类）。
    const key = week.dominant || 'cloudy'
    groups.set(key, [...(groups.get(key) || []), week])
  }
  const parts = []
  let thin = false
  for (const key of ['sunny', 'rain', 'cloudy']) {
    const bucket = groups.get(key)
    if (!bucket?.length) continue
    const average = Math.round(bucket.reduce((sum, week) => sum + week.focusMinutes, 0) / bucket.length)
    if (bucket.length < 2) thin = true
    parts.push(`${WEATHER_NAMES[key]}周（${bucket.length} 周）平均专注 ${average} 分钟`)
  }
  if (!parts.length) {
    return { text: `有 ${usable.length} 周心情记录，但没有任何一个天气分组达到 2 周。`, comparable: false }
  }
  const caveat = thin ? '其中只有 1 周的分组先当作个案看。' : ''
  return {
    text: `${usable.length} 周里，${parts.join('；')}。${caveat}这里只是并排对比，不是因果。`,
    comparable: true,
  }
}

/**
 * 把 `startedAt` 解析成与宿主机无关的时刻。
 *
 * 【为什么不能直接用 timestampOf】`Date.parse('2026-03-10T23:00:00')` 对**不带时区
 * 标记**的字符串按**宿主机本地时区**解释（ES 规范如此）。于是同一批数据在
 * UTC+8 的机器上和在 UTC 的机器上会落进不同的小时桶 —— 这正是"专注时段规律"
 * 这类图表最不能有的性质：在北京看到的高峰小时和在伦敦看到的不一样。
 * 实测偏差正好等于时差（9 点变 1 点）。
 *
 * 这里对缺省时区的 ISO 串一律按 **UTC** 解释：带 Z / ±hh:mm 的本来就确定，
 * 不带标记的走 UTC 后结果与宿主机无关。应用自己写出来的 `startedAt`
 * 走 commands.js 的 stamp()，带 Z，不受这个分支影响。
 */
function startedAtStamp(value) {
  const text = String(value ?? '').trim()
  if (!text) return 0
  if (/^\d+$/.test(text)) { const n = Number(text); return Number.isFinite(n) ? n : 0 }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
    const parsed = Date.parse(`${text.replace(' ', 'T')}Z`)
    if (Number.isFinite(parsed)) return parsed
  }
  return timestampOf(text)
}

/** 小时数 0..23；取不到就返回 null（调用方整条跳过，不猜）。 */
function policyHourOf(timestamp, timezone) {
  let text = ''
  try {
    text = policyTimeKey(new Date(timestamp), timezone)
  } catch {
    return null
  }
  if (!/^\d{2}:\d{2}$/.test(text)) return null
  const hour = Number(text.slice(0, 2))
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null
}

/**
 * 功能 16：按小时（0..23）分桶的专注时段规律。
 *
 * 小时一律取 `policyTimeKey`（应用时区口径）。
 *
 * 跨小时的会话**整段算在开始小时**（近似）。逐分钟切分会高估跨零点的会话
 * （23:40 起专注 40 分钟会被切成 23 点 20 分 + 0 点 20 分），而这 40 分钟里
 * 用户并不会觉得自己"一半在深夜、一半在凌晨"。宁可让某一格偏高，也不伪造精度。
 *
 * @returns {{ buckets: object[], peakHours: number[], maxMinutes: number, totalMinutes: number, totalSessions: number, skippedSessions: number }}
 */
export function buildFocusHours(data = {}, now = clock.value, options = {}) {
  const sessions = sessionsOf(data)
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, sessions: 0, seconds: 0, minutes: 0 }))
  let counted = 0
  let totalSeconds = 0
  for (const raw of sessions) {
    const stamp = startedAtStamp(raw?.startedAt)
    if (!stamp) continue
    const normalized = normalizeFocusSession(raw)
    if (normalized.actualFocusSeconds <= 0) continue
    const hour = policyHourOf(stamp, options.timezone)
    if (hour === null) continue
    buckets[hour].sessions += 1
    buckets[hour].seconds += normalized.actualFocusSeconds
    buckets[hour].minutes += Math.round(normalized.actualFocusSeconds / 60)
    counted += 1
    totalSeconds += normalized.actualFocusSeconds
  }
  const maxMinutes = Math.max(0, ...buckets.map((bucket) => bucket.minutes))
  void now
  return {
    buckets,
    peakHours: maxMinutes ? buckets.filter((bucket) => bucket.minutes === maxMinutes).map((bucket) => bucket.hour) : [],
    maxMinutes,
    totalMinutes: Math.round(totalSeconds / 60),
    totalSessions: counted,
    // 跳过的条数要能被看到：否则"图上什么都没有"和"这周真的没专注"读起来一样。
    skippedSessions: sessions.length - counted,
  }
}
