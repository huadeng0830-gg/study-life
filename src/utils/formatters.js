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

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const moneyFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function durationParts(milliseconds) {
  const minutes = Math.max(0, Math.ceil(Math.abs(milliseconds) / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const restMinutes = minutes % 60
  return { minutes, days, hours, restMinutes }
}

function durationText(milliseconds) {
  const { minutes, days, hours, restMinutes } = durationParts(milliseconds)
  if (minutes <= 0) return '现在'
  const parts = []
  if (days) parts.push(`${days} 天`)
  if (hours) parts.push(`${hours} 小时`)
  if (restMinutes) parts.push(`${restMinutes} 分钟`)
  return parts.join(' ')
}

/**
 * 统一的相对时间展示。输入为毫秒差，函数本身不读取当前时间、时区或业务状态。
 * `calendarDays` 由调用方按应用时区计算后传入，避免把日期型事件误当成 24 小时倒计时。
 */
export function formatRelativeTime(milliseconds, {
  mode = 'duration',
  direction = 'auto',
  futurePrefix = '',
  pastPrefix = '',
  zeroText,
  calendarDays,
} = {}) {
  const diff = Number(milliseconds)
  if (!Number.isFinite(diff)) return ''
  const isFuture = direction === 'future' || direction === 'remaining' || (direction === 'auto' && diff >= 0)
  const absolute = Math.abs(diff)

  if (mode === 'date') {
    const days = Number.isFinite(calendarDays) ? Math.abs(Math.trunc(calendarDays)) : Math.ceil(absolute / DAY)
    if (days === 0) return zeroText || (isFuture ? '今天' : '今天已过')
    if (isFuture) {
      if (days === 1) return futurePrefix ? `${futurePrefix} 明天` : '明天'
      if (days === 2) return futurePrefix ? `${futurePrefix} 后天` : '后天'
      return futurePrefix ? `${futurePrefix} ${days} 天` : `还有 ${days} 天`
    }
    return pastPrefix ? `${pastPrefix} ${days} 天前` : `${days} 天前`
  }

  if (absolute === 0 || absolute < MINUTE) return zeroText || (isFuture ? '即将开始' : '刚刚')
  const text = durationText(diff)
  const prefix = isFuture ? futurePrefix : pastPrefix
  return prefix ? `${prefix} ${text}` : text
}

// 所有账本金额统一保留两位小数；内部金额由账本边界按分归一化。
export function moneyRow(v) {
  const raw = typeof v === 'string' ? v.trim().replace(/,/g, '').replace(/^[¥￥]\s*/, '') : v
  const number = Number(raw)
  const cents = Number.isFinite(number) ? Math.round(number * 100) : 0
  const n = Number.isSafeInteger(cents) ? cents / 100 : 0
  return `¥${moneyFormatter.format(n)}`
}

// 汇总大数金额：统一两位小数，避免整数与合计列小数位不一致。
export function moneyHero(v) {
  return `¥${moneyFormatter.format(Number(v) || 0)}`
}

// 多币种展示用的符号表；未收录的币种回退成「代码 + 空格」，不会假装自己是人民币。
const CURRENCY_SYMBOLS = {
  CNY: '¥', USD: '$', EUR: '€', JPY: 'JP¥', GBP: '£', HKD: 'HK$', KRW: '₩',
  AUD: 'A$', CAD: 'C$', SGD: 'S$', THB: '฿', MYR: 'RM', NZD: 'NZ$', CHF: 'CHF',
}

/**
 * 按记录自己的币种显示金额（账本多币种用）。
 *
 * 刻意**复用 `moneyRow` 的数值口径**再把符号换掉：两位小数、千分位、非法值归零、
 * 以及「¥」前缀这些既有规则一处都不重复实现，因此既有 `moneyRow` 的行为与签名
 * 完全没有变化（本仓库的账本页仍全部走 `moneyRow`）。
 * 空币种 = 基准币种（与记录侧「旧记录没有 currency」的约定一致），显示仍为 ¥。
 */
export function moneyWithCurrency(v, currency = 'CNY') {
  const code = String(currency ?? '').trim().toUpperCase() || 'CNY'
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `
  return moneyRow(v).replace(/^¥/, symbol)
}

// 相对日期标签：今天 / 昨天 / M月D日。
export function dayLabel(dateStr) {
  if (dateStr === dateText()) return '今天'
  if (dateStr === dateText(new Date(Date.now() - 86400000))) return '昨天'
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
