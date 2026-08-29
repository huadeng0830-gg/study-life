// 通用展示格式化：金额、时间与相对日期标签。
// 抽取自各视图的重复实现，统一显示规则，避免“昨天/今天”判断在多处漂移。

export function pad2(value) {
  return String(value).padStart(2, '0')
}

// 本地时区的 YYYY-MM-DD 文本（与 store/todayStr 同一套规则，但不引入依赖）。
export function dateText(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function nowHM() {
  const d = new Date()
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// 列表行金额：整数不带小数位，非整数统一两位小数。
export function moneyRow(v) {
  const n = Number(v) || 0
  return `¥${Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// 汇总大数金额：统一两位小数，避免整数与合计列小数位不一致。
export function moneyHero(v) {
  return `¥${(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// 相对日期标签：今天 / 昨天 / M月D日。
export function dayLabel(dateStr) {
  if (dateStr === dateText()) return '今天'
  if (dateStr === dateText(new Date(Date.now() - 86400000))) return '昨天'
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
