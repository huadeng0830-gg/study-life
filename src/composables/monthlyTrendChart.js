const SAFE_DIVISIONS = 4

function finiteAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
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

  const step = niceStep((dataMax - dataMin) / SAFE_DIVISIONS)
  const min = Math.floor(dataMin / step) * step
  const max = Math.ceil(dataMax / step) * step
  const ticks = []
  for (let value = min; value <= max + step * 1e-9; value += step) {
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
