/**
 * 全局搜索的命中判定与相关度排序（纯函数，不依赖 Vue、不碰任何存储）。
 *
 * 【为什么抽出来】改造前这段逻辑住在 `SearchPanel.vue` 里，是一个局部 `matches`
 * 加一句 `items.slice(0, LIMIT_PER_GROUP)`。"完全匹配 > 前缀 > 标题包含 > 内容包含"
 * 是一条**产品口径**，必须能被直接断言；藏在组件里就只能靠渲染后读 DOM 反推，
 * 于是"先截后排"这种错误会跟着一起绿 —— 而它恰恰是最容易写反的一步。
 *
 * 【口径在这里，模板只负责画】展示文字（`hit().title`）同时也是排序与高亮的依据，
 * 所以"匹配用的是 A 字段、高亮用的是 B 字段"这类漂移在结构上就不可能发生。
 */
import { formatFocusDuration } from './focusTimer.js'
import { focusLocation } from './focusNavigation.js'

/** 命中等级：数字越小越靠前。 */
export const MATCH_RANKS = Object.freeze({
  EXACT: 0,     // 标题整段就是关键词
  PREFIX: 1,    // 标题以关键词开头
  TITLE: 2,     // 关键词出现在标题中间
  CONTENT: 3,   // 只在非标题字段（备注、标签、日期…）里命中
  NONE: 4,      // 没命中
})

// 只认 ISO 开头的时间戳。`Date.parse('25')` 在 V8 里会被当成 2025 年而不是
// 解析失败，于是任何"长得像数字"的字段都会变成一个假的时间戳，
// 让"同级按更新时间倒序"这条口径悄悄失真。
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/

/** 把一个字段值归一成数组，让"内容字段"既可以传字符串也可以传数组。 */
function asList(value) {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

/**
 * 命中判定。语义与改造前 `SearchPanel.vue` 里的局部 `matches` **完全一致**：
 * 大小写不敏感的 `includes`，null / undefined 当空串。
 *
 * 相对原实现只多了一条防御：**空关键词一律判为不命中**。原面板在关键词为空时
 * 整个提前返回，这条分支永远走不到；写成"空即不命中"是为了让纯函数自洽 ——
 * 否则任何忘了提前返回的调用方都会拿到"全都命中"。
 */
export function matchesText(text, ...values) {
  const needle = String(text ?? '').toLowerCase()
  if (!needle) return false
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle))
}

/** 一条候选结果落在哪一级（见 MATCH_RANKS）。 */
export function matchRank(title, contents, text) {
  const needle = String(text ?? '').toLowerCase()
  if (!needle) return MATCH_RANKS.NONE
  // 先去首尾空白：标题里的残留空格不该把「完全匹配」降级成「包含」。
  const head = String(title ?? '').trim().toLowerCase()
  if (head === needle) return MATCH_RANKS.EXACT
  if (head.startsWith(needle)) return MATCH_RANKS.PREFIX
  if (head.includes(needle)) return MATCH_RANKS.TITLE
  if (matchesText(needle, ...asList(contents))) return MATCH_RANKS.CONTENT
  return MATCH_RANKS.NONE
}

/**
 * 更新时间（毫秒）。清单条目这类没有 `updatedAt` 的记录取 0，
 * 于是同级自然退回**原数组顺序**，而不是被一股脑排到最前面。
 */
function timeValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value ?? '')
  if (!ISO_DATE_PREFIX.test(text)) return 0
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 过滤 + 按相关度排序。**不截断**：截断交给 `pickHits`，这样"先排后截"这条
 * 不变式只有一个地方能实现。
 *
 * 排序键：命中等级 → 更新时间倒序 → 原下标。第三项是稳定性的保险：
 * 两条记录等级与时间都相同时（例如清单里同一张单的两项），
 * 结果不该随引擎的 sort 实现而抖动。
 */
export function rankCandidates(candidates, text) {
  const list = Array.isArray(candidates) ? candidates : []
  const rows = []
  for (let index = 0; index < list.length; index += 1) {
    const candidate = list[index]
    if (!candidate) continue
    const rank = matchRank(candidate.title, candidate.contents, text)
    if (rank < MATCH_RANKS.NONE) rows.push({ candidate, index, rank })
  }
  return rows
    .sort((a, b) => (a.rank - b.rank)
      || (timeValue(b.candidate.updatedAt) - timeValue(a.candidate.updatedAt))
      || (a.index - b.index))
    .map((row) => row.candidate)
}

/**
 * 排序后再截断，返回 `{ items, hitCount }`。
 *
 * `hitCount` 是**截断前**的命中数：类型筛选芯片上的计数要用它 ——
 * 否则一个类型命中 40 条时芯片会显示 6，而 6 是"我给你看了几条"而不是"有多少"。
 */
export function pickHits(candidates, text, limit) {
  const ranked = rankCandidates(candidates, text)
  const size = Number(limit) > 0 ? Math.floor(Number(limit)) : ranked.length
  return { hitCount: ranked.length, items: ranked.slice(0, size) }
}

/* ---------------- 专注记录（功能 34） ---------------- */

export const FOCUS_TYPE_LABELS = Object.freeze({
  free: '自由专注',
  temporary: '临时目标',
  'todo-linked': '关联待办',
})

/**
 * 专注记录没有详情弹窗，搜索结果行总得显示点什么。
 *
 * `free` 类型的 `session.title` 一定是空串（`focusTimer.normalizeFocusSession`
 * 就是这么定的），所以回落到类型标签 —— 顺带让"搜自由"也能找到自由专注。
 * 这个回落**必须同时进入匹配字段**：展示文字若不在匹配口径里，就会出现
 * "结果里高亮了一段并不在查询里的字"（`highlightParts` 当年正是为这个写过注释）。
 */
export function focusSearchTitle(session) {
  const label = FOCUS_TYPE_LABELS[String(session?.focusType || '')] ?? FOCUS_TYPE_LABELS.free
  return String(session?.title ?? '').trim() || label
}

/**
 * 专注记录没有 date 字段，可搜的"日期"取 `startedAt` 的日期部分。
 * 只切出 `YYYY-MM-DD`：既让"2026-10"这种前缀搜索生效，
 * 又不会把时间戳里的时分秒变成一堆谁也记不住的数字。
 */
export function focusSearchDate(session) {
  return ISO_DATE_PREFIX.exec(String(session?.startedAt || ''))?.[1] ?? ''
}

/** 结果行的副信息：日期 + 实际时长。实际时长为 0（中途放弃）时退回计划时长。 */
export function focusSearchMeta(session) {
  const seconds = Math.max(0, Number(session?.actualFocusSeconds) || 0)
  const planned = Math.max(1, Number(session?.plannedMinutes) || 0)
  const duration = seconds > 0 ? formatFocusDuration(seconds) : `${planned}分钟`
  return [focusSearchDate(session), duration].filter(Boolean).join(' · ')
}

/** O(1) 地选择专注记录的可用落点；调用方应先为任务 ID 建一个 Set。 */
export function focusSearchTarget(session, taskIds) {
  const todoId = String(session?.todoId || '')
  return todoId && taskIds?.has(todoId) ? focusLocation('/tasks', todoId) : { path: '/' }
}
