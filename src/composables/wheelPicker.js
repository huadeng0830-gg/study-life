/**
 * 滚轮选择器的刻度数学。
 *
 * 纯函数：只负责「第几格 ↔ 滚动位置」的换算，DOM 与手势在组件里。
 * 这样「松手后自动对齐到哪一格」可以脱离浏览器直接单测。
 */

export const WHEEL_ITEM_HEIGHT = 44
export const WHEEL_VISIBLE_ROWS = 5

/** 生成刻度数组，例如 0..23 或 0..55 每 5 分钟一格。 */
export function buildWheelValues(start, end, step = 1) {
  const from = Math.max(0, Math.trunc(Number(start) || 0))
  const to = Math.max(from, Math.trunc(Number(end) || 0))
  const gap = Math.max(1, Math.trunc(Number(step) || 1))
  const values = []
  for (let value = from; value <= to; value += gap) values.push(value)
  return values
}

/**
 * 上下留白：让首尾刻度也能滚到中间那一行。
 * 视口 5 行时，留白 = 2 行高。
 */
export function wheelPadding(itemHeight = WHEEL_ITEM_HEIGHT, visibleRows = WHEEL_VISIBLE_ROWS) {
  const height = Math.max(1, Number(itemHeight) || WHEEL_ITEM_HEIGHT)
  const rows = Math.max(1, Math.trunc(Number(visibleRows) || WHEEL_VISIBLE_ROWS))
  return Math.max(0, (rows * height - height) / 2)
}

function safeItemHeight(itemHeight) {
  return Math.max(1, Number(itemHeight) || WHEEL_ITEM_HEIGHT)
}

function safeCount(values) {
  return Math.max(1, Array.isArray(values) ? values.length : 1)
}

/** 第 index 格对应的 scrollTop（正好把它放到中间那一行）。 */
export function wheelScrollTopForIndex(index, values, itemHeight = WHEEL_ITEM_HEIGHT) {
  const count = safeCount(values)
  const safe = Math.min(Math.max(0, Math.trunc(Number(index) || 0)), count - 1)
  return safe * safeItemHeight(itemHeight)
}

/** 松手后落点最近的刻度序号；这就是「自动对齐」的目标。 */
export function wheelIndexFromScrollTop(scrollTop, values, itemHeight = WHEEL_ITEM_HEIGHT) {
  const count = safeCount(values)
  const height = safeItemHeight(itemHeight)
  const position = Number(scrollTop)
  if (!Number.isFinite(position)) return 0
  return Math.min(count - 1, Math.max(0, Math.round(position / height)))
}

export function wheelValueAtIndex(values, index) {
  if (!Array.isArray(values) || !values.length) return 0
  const safe = Math.min(values.length - 1, Math.max(0, Math.trunc(Number(index) || 0)))
  return values[safe]
}

/** 已有值对应的刻度序号；找不到精确值时取最近的（分钟不是 5 的倍数也能落到最近一格）。 */
export function wheelIndexForValue(values, value) {
  if (!Array.isArray(values) || !values.length) return 0
  const target = Number(value)
  if (!Number.isFinite(target)) return 0
  let bestIndex = 0
  let bestDistance = Infinity
  for (let index = 0; index < values.length; index += 1) {
    const distance = Math.abs(Number(values[index]) - target)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

const TIME_PATTERN = /^(\d{1,2}):(\d{1,2})$/

/** 解析 'HH:MM'；非法或空值回退到 fallback（默认 09:00）。 */
export function parseTimeValue(text, fallback = { hour: 9, minute: 0 }) {
  const match = TIME_PATTERN.exec(String(text ?? '').trim())
  if (!match) return { hour: fallback.hour, minute: fallback.minute }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return { hour: fallback.hour, minute: fallback.minute }
  return {
    hour: Math.min(23, Math.max(0, Math.trunc(hour))),
    minute: Math.min(59, Math.max(0, Math.trunc(minute))),
  }
}

export function formatTimeValue(hour, minute) {
  const h = Math.min(23, Math.max(0, Math.trunc(Number(hour) || 0)))
  const m = Math.min(59, Math.max(0, Math.trunc(Number(minute) || 0)))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}