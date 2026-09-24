/**
 * 「退出聚焦态」的查询参数处理（第五十四轮）。
 *
 * 【层级模型：为什么不做面包屑】
 * 路由全是一级平级（`/`、`/schedule`、`/tasks`、`/exams`、`/events`、`/lists`、
 * `/bills`、`/review`、`/notes`），**根本不存在父子关系**。真正的"深层态"是
 * `?focus=<id>`（外加账本与今天页的 `?section=`）这类**聚焦态**：从通知、搜索或
 * 跨页跳转深链进来的"某一项"，页面上会把它单独高亮出来。
 *
 * 所以这里不做假面包屑（`首页 / 账本 / 某笔账单` 那种层级是编出来的，用户点上去
 * 只会更困惑），只定义**真实存在的那一层关系：聚焦态 → 全部**——聚焦时给一条
 * 明确的返回入口，清掉聚焦参数就回到完整列表。
 *
 * 【为什么只删 focus / section】
 * `tab`（账本分区）、`date`（课表周次）是**视图状态**，不是聚焦目标。用户从聚焦项
 * 返回时应当仍在原来那一周、同一个分区里，而不是被顺带重置。
 * 「把整个 query 清空」是最省事、也最容易写错的实现——所以这条纯函数单独存在、
 * 单独被测（`tests/focusReturn.test.js` 里有一条专门守着 `tab` 不被清掉）。
 */

/** 表示"当前处在聚焦态"的查询键。 */
export const FOCUS_QUERY_KEYS = ['focus', 'section']

/** 当前是否处在聚焦态（`section` 单独出现也算，例如账本的"定位到某笔账单"）。 */
export function hasFocusQuery(query) {
  const source = query ?? {}
  return FOCUS_QUERY_KEYS.some((key) => Boolean(source[key]))
}

/** 去掉聚焦键之后的查询对象；其余键（`tab`/`date` 等）原样保留。 */
export function queryWithoutFocus(query) {
  const next = { ...(query ?? {}) }
  for (const key of FOCUS_QUERY_KEYS) delete next[key]
  return next
}