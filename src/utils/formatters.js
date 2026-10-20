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
  // 超出安全整数范围时**照原值显示**，不要静默变成 ¥0.00：
  // `moneyHero` 用 Intl 直接格式化同一个数，能正确显示 ¥1,000,000,000,000,000.00，
  // 两者一显示 0 一显示真实值，同一屏就会给出两个互相矛盾的金额。
  // （这种量级实际只可能来自损坏数据，重点是别把「超范围」说成「零」。）
  const n = Number.isSafeInteger(cents) ? cents / 100 : (Number.isFinite(number) ? number : 0)
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
  return moneyRow(v).replace(/^¥/, currencySymbol(currency))
}

export function currencySymbol(currency = 'CNY') {
  const code = String(currency ?? '').trim().toUpperCase() || 'CNY'
  return CURRENCY_SYMBOLS[code] ?? `${code} `
}

// 相对日期标签：今天 / 昨天 / M月D日。
export function dayLabel(dateStr) {
  const today = new Date()
  if (dateStr === dateText(today)) return '今天'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === dateText(yesterday)) return '昨天'
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// ---------------------------------------------------------------------------
// 以下为「新增导出」：只**复用**上面的既有口径，既有导出的行为与签名一字未改。
// 目的：把各视图里手写的 `¥${x.toFixed(2)}`、`${pad2(h)}:${pad2(m)}`、
// `${y}-${pad2(m)}-${pad2(d)}` 收口到一处，避免同一套显示规则在仓库里各写一份。
// ---------------------------------------------------------------------------

/**
 * 以**分**为单位的金额 → 元。数值口径完全走 `moneyRow`
 * （千分位、两位小数、非法/缺失归零、超安全整数照原值显示），因此显示结果与
 * `moneyRow(cents / 100)` 一致；单独具名是为了让「调用方拿到的到底是分还是元」在
 * 调用点一眼可见——仓库里 campus 价格、学习问答汇总都是分。
 */
export function moneyCents(cents) {
  return moneyRow(Number(cents) / 100)
}

/**
 * `moneyRow` 的**数字部分**（不含 `¥`）。给需要自己决定前缀的调用方
 * （多币种代码、正负号）复用同一套数值口径，避免再手写一份 `toFixed(2)`。
 */
export function moneyDigits(v) {
  return moneyRow(v).replace(/^¥/, '')
}

/**
 * 多币种金额（入参为**分**）：基准币种沿用 `¥`，其他币种显示「代码 + 空格 + 数字」。
 *
 * 刻意不复用 `moneyWithCurrency`：后者按符号表把 USD 显示成 `$`、JPY 显示成 `JP¥`，
 * 而学习问答/上年对比这类场景既有约定是**用币种代码**（`USD 12.00`）区分币种——
 * 换成符号会改变既有输出，属于「语义本来就不同」，所以单独具名而不是硬合并。
 */
export function moneyCentsWithCode(cents, currency = 'CNY') {
  const code = String(currency ?? '').trim().toUpperCase() || 'CNY'
  return code === 'CNY' ? moneyCents(cents) : `${code} ${moneyDigits(Number(cents) / 100)}`
}

/** 数字小时/分钟 → `HH:MM`（补齐规则与 `pad2` 一致，超过两位不截断）。 */
export function hmText(hours, minutes) {
  return `${pad2(hours)}:${pad2(minutes)}`
}

/** `Date` → 本地时区 `HH:MM`。 */
export function timeText(date = new Date()) {
  return hmText(date.getHours(), date.getMinutes())
}

/** 数字年月日 → `YYYY-MM-DD`（`month` 从 1 起，与 `Date#getMonth()` 不同，调用方需自行 +1）。 */
export function dateParts(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}
