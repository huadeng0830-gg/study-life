const SAFE_DIVISIONS = 4

/**
 * @typedef {Object} MonthlyTrendRow
 * @property {string} month
 * @property {number} expense
 * @property {number} income
 * @property {number} count
 * @property {string} [base]
 * @property {string} [ratesUpdatedAt]
 * @property {boolean} [hasForeign]
 * @property {string[]} [missingRates]
 * @property {number} [excludedCount]
 */

function finiteAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

/** 日历月运算不经过本地时区，也不会触发 Date 对 0–99 年的特殊处理。 */
export function shiftTrendMonth(month, delta) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(month)) || !Number.isInteger(delta)) return ''
  const [year, number] = month.split('-').map(Number)
  const index = year * 12 + number - 1 + delta
  const nextYear = Math.floor(index / 12)
  if (nextYear < 1 || nextYear > 9999) return ''
  return `${String(nextYear).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`
}

/** 汇总已折算的月度数据，按分相加，保留退款带来的负支出与负结余。 */
export function summarizeMonthlyTrend(months) {
  let expenseCents = 0
  let incomeCents = 0
  let count = 0
  let excludedCount = 0
  for (const row of Array.isArray(months) ? months : []) {
    expenseCents += Math.round(finiteAmount(row?.expense) * 100)
    incomeCents += Math.round(finiteAmount(row?.income) * 100)
    count += Math.max(0, finiteAmount(row?.count))
    excludedCount += Math.max(0, finiteAmount(row?.excludedCount))
  }
  return {
    expense: expenseCents / 100,
    income: incomeCents / 100,
    balance: (incomeCents - expenseCents) / 100,
    count,
    excludedCount,
  }
}

function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const fraction = value / magnitude
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return niceFraction * magnitude
}

/**
 * 给月度收支图提供稳定、易读的纵轴范围与柱形几何。
 * 支出净额可能因退款冲抵变成负数，因此零线必须随数据移动；
 * 纵轴范围向外取整，避免看起来像柱子从零开始却实际截断。
 */
export function buildMonthlyTrendScale(months) {
  const rows = Array.isArray(months) ? months : []
  const values = rows.flatMap((row) => [finiteAmount(row?.expense), finiteAmount(row?.income)])
  const dataMin = Math.min(0, ...values)
  const dataMax = Math.max(0, ...values)

  if (dataMin === dataMax) {
    return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1], zeroPosition: 0 }
  }

  const step = niceStep(Math.max(dataMax, Math.abs(dataMin)) / SAFE_DIVISIONS)
  // 小额退款不应占掉一整格大额收入的刻度；至少留半格，保证负值区可读。
  const min = dataMin < 0 ? -niceStep(Math.max(Math.abs(dataMin), step / 2)) : 0
  const max = Math.ceil(dataMax / step) * step
  const ticks = [min]
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    if (value <= min + step * 1e-9) continue
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)))
  }
  const safeMax = max > min ? max : min + step
  return {
    min,
    max: safeMax,
    step,
    ticks,
    zeroPosition: ((0 - min) / (safeMax - min)) * 100,
  }
}

/** 返回 CSS bottom/height 百分比，百分比均相对于整个绘图区。 */
export function monthlyTrendBarGeometry(value, scale) {
  const amount = finiteAmount(value)
  const span = Math.max(Number.EPSILON, finiteAmount(scale?.max) - finiteAmount(scale?.min))
  const position = Math.max(0, Math.min(100, ((amount - finiteAmount(scale?.min)) / span) * 100))
  const zero = Math.max(0, Math.min(100, finiteAmount(scale?.zeroPosition)))
  return {
    bottom: Math.min(position, zero),
    height: Math.abs(position - zero),
  }
}
