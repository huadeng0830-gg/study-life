// 账本多币种汇率（手工维护，**不联网**）。
//
// 【与既有账本路径的分工】这个模块只提供新选择器，绝不改写老路径：
//   - `buildLedgerIndex` / `summarizeLedgerTransactions` / `buildLedgerMonthReview`
//     继续按记录里的 `amount` 原样相加（这是既有语义，跨币种相加的问题由这里承担）；
//   - `amount` 的语义不变：**它始终是「该笔记录所用币种下的数值」**；
//   - 每笔支出可以带一个可选的 `currency`（ISO 4217 三位代码）。
//     **旧记录没有这个字段 = 基准币种**，所以不做迁移、不改写历史数据。
//
// 【存储形状】`sl_ledger_fx = { base: 'CNY', rates: { USD: 7.2, JPY: 0.048 }, updatedAt: 'YYYY-MM-DD' }`
// `rates` 的读法是「1 单位该币种 = 多少基准币种」，全部由用户手工输入。
//
// 【诚实边界，必须写清楚】
//   1. 没有历史汇率：只有「当前值」，改一次数值会影响**所有**历史折算；
//   2. 没有三角换算：只做「某一币种 → 基准币种」的单跳，不会 USD→EUR 走 CNY 中转；
//   3. 缺汇率的记录**不会**被当成 1:1 静默相加（那会悄悄低估/高估总额），
//      而是被排除出合计，并在 `missingRates` / `excludedCount` 里如实暴露。
import { touchStoredRef, useStoredRef } from './store/core.js'
import { amountToCents, isRefundTransaction, isValidDateKey } from './ledger.js'
import { dateText, moneyWithCurrency } from '../utils/formatters.js'

export const LEDGER_FX_KEY = 'sl_ledger_fx'
export const DEFAULT_LEDGER_FX = { base: 'CNY', rates: {}, updatedAt: '' }

// 常见币种只是「添加币种」下拉里的候选，不代表已经有汇率；
// 真正生效的汇率永远以 sl_ledger_fx.rates 为准。
export const COMMON_LEDGER_CURRENCIES = Object.freeze([
  'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'KRW', 'AUD', 'CAD', 'SGD', 'THB', 'MYR', 'NZD', 'CHF',
])

/** 币种代码规范化：只接受三位字母，其余（含空值）一律回空字符串 = 基准币种。 */
export function normalizeCurrency(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : ''
}

/** 汇率设置规范化：丢掉非法/重复/基准币种自身的汇率，保证读侧永远拿到干净形状。 */
export function normalizeLedgerFx(value) {
  const source = value && typeof value === 'object' ? value : {}
  const base = normalizeCurrency(source.base) || DEFAULT_LEDGER_FX.base
  const rates = {}
  const rawRates = source.rates && typeof source.rates === 'object' && !Array.isArray(source.rates) ? source.rates : {}
  for (const [key, rawRate] of Object.entries(rawRates)) {
    const code = normalizeCurrency(key)
    const number = Number(rawRate)
    // 基准币种恒为 1；非法、非正、NaN 一律丢弃而不是留下一个会静默算错的 0。
    if (!code || code === base || !Number.isFinite(number) || number <= 0) continue
    // 超出安全区间的汇率直接丢弃（理由见 FX_RATE_MIN/MAX 的说明），
    // 否则它会安静地把一个真实金额换算成 0 或 Infinity。
    if (number < FX_RATE_MIN || number > FX_RATE_MAX) continue
    rates[code] = Math.round(number * 1e6) / 1e6
  }
  return {
    base,
    rates,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
  }
}

/**
 * 汇率的安全上下界。
 *
 * 【为什么必须有】`Math.round(cents * rate)` 在 rate 极端时会给出**看起来正常、
 * 实际全错**的结果，而旧代码没有任何一道关：
 *   - `rate = 1e-9`：一笔 ¥1,000 的日元支出换算成 `Math.round(100000 * 1e-9) = 0` 分，
 *     于是这笔消费在本月花费与预算基数里**静默贡献 ¥0.00**，界面上毫无痕迹
 *     （只有「缺汇率」会被 `excludedCount` 暴露，汇率太小不会）；
 *   - `rate = 1e300`：`cents * rate = Infinity`，`Math.round(Infinity)` 得到
 *     Infinity 而**不是 null**，于是这笔被计入 `expenseTotal`，整月合计变成 `Infinity`。
 * 非汇率路径本来就有这道守卫（`ledgerAmountCents` 检查 `Number.isSafeInteger`），
 * 汇率路径是唯一漏掉的一个。
 *
 * 1e-6 保留下界：1 单位该币种 = 1e-6 基准币种，任何真实存在的货币都远在此之上，
 * 而低于它必然是把小数点写错了几个数量级。上界取 1e8 —— 1 单位 = 1 亿基准币种，
 * 远大于任何真实汇率，但足以防止乘法溢出。
 */
const FX_RATE_MIN = 1e-6
const FX_RATE_MAX = 1e8

/**
 * 表单币种 → 记录字段：基准币种一律落成空字符串（= 不写字段），
 * 与「旧记录没有 currency 就是基准币种」的约定完全一致，不给数据添无意义的字段。
 *
 * 【为什么放在这里而不是各页面各写一份】记一笔（useQuickEntryForm）、记录详情
 * （useTransactionDetail）、固定账单（BillFormModal）三个入口都要用它，
 * 曾经各自 import 一个并不存在于本模块的 `currencyField`，结果是运行到
 * 「保存」才抛 `currencyField is not a function`，整笔记不上——而且只在真实
 * 点击时炸，纯函数测试一个都测不到。规则只有一条，必须只有一个出处。
 */
export function currencyField(code, fx) {
  const normalized = normalizeCurrency(code)
  const base = normalizeLedgerFx(fx).base
  return normalized === base ? '' : normalized
}

/** 币种下拉的候选：基准币种永远第一，其余按字母序；`extra` 用于让「记录已有的币种」也能显示。 */
export function currencyChoices(fx, extra = []) {
  const config = normalizeLedgerFx(fx)
  const codes = new Set([config.base, ...Object.keys(config.rates)])
  for (const code of Array.isArray(extra) ? extra : []) {
    const key = normalizeCurrency(code)
    if (key) codes.add(key)
  }
  const rest = [...codes].filter((code) => code !== config.base).sort((a, b) => a.localeCompare(b))
  return [config.base, ...rest]
}

/**
 * 汇率设置读写。`saveFx` 写 `updatedAt`（折算文案要显示「按哪天的汇率」）。
 * 与 courseTemplates 同一套形状：`useStoredRef` + `touchStoredRef` 显式提交。
 */
export function useLedgerFx() {
  const fx = useStoredRef(LEDGER_FX_KEY, { ...DEFAULT_LEDGER_FX })
  const commit = () => touchStoredRef(LEDGER_FX_KEY)
  function saveFx(next) {
    const normalized = normalizeLedgerFx(next)
    normalized.updatedAt = dateText()
    fx.value = normalized
    commit()
    return fx.value
  }
  return { fx, saveFx }
}

/** 某一币种兑基准币种的汇率；基准币种（含空值）恒为 1，缺汇率返回 null。 */
export function fxRateFor(currency, fx) {
  const config = normalizeLedgerFx(fx)
  const code = normalizeCurrency(currency)
  if (!code || code === config.base) return 1
  const rate = config.rates[code]
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

/**
 * 金额（该币种下的「元」）→ 基准币种「分」。
 *
 * 返回 `{ cents, currency, rate, reason }`：
 *   - `reason === ''` 换算成功；
 *   - `reason === 'amount'` 金额本身非法（沿用 amountToCents 的边界）；
 *   - `reason === 'rate'` 缺该币种汇率 —— 调用方必须**排除**它，不能按 1:1 硬算。
 * 换算在「分」上做乘法再取整，避免浮点尾差；这一步对基准币种是恒等（rate=1）。
 */
export function convertToBaseMinor(amountYuan, currency, fx) {
  const config = normalizeLedgerFx(fx)
  const code = normalizeCurrency(currency)
  const cents = amountToCents(amountYuan)
  if (cents === null) return { cents: null, currency: code || config.base, rate: null, reason: 'amount' }
  const rate = fxRateFor(code, config)
  if (rate === null) return { cents: null, currency: code, rate: null, reason: 'rate' }
  // 换算后必须仍然是「非负的安全整数分」，否则宁可返回 null 让调用方排除它，
  // 也不能把 Infinity / 超精度整数当成一个金额累加进合计。
  const converted = Math.round(cents * rate)
  if (!Number.isSafeInteger(converted) || converted < 0) {
    return { cents: null, currency: code, rate, reason: 'rate' }
  }
  return { cents: converted, currency: code || config.base, rate, reason: '' }
}

/** 简版换算：成功返回基准币种「分」，失败（金额非法或缺汇率）返回 null。 */
export function toBaseMinor(amountYuan, currency, fx) {
  return convertToBaseMinor(amountYuan, currency, fx).cents
}

/** 月度过滤器的唯一出处：`dateFilter` 的入参形状与 ledger.js 既有选择器一致。 */
export function ledgerMonthFilter(month) {
  const key = String(month ?? '').slice(0, 7)
  return (date) => String(date ?? '').slice(0, 7) === key
}

/**
 * 把一批记录**按基准币种折算后**求和（可传月度/自定义区间过滤器）。
 *
 * 与 `summarizeLedgerTransactions` 的三条口径保持一致：
 *   - 只看未归档/未删除/未墓碑、有 id、日期合法的记录（与 `ledgerTransactionCents` 同判据）；
 *   - 退款 `direction === 'refund'` 从支出里冲抵，不计入收入；
 *   - `expenseTotal = 支出 - 退款`。
 *
 * 与老函数的唯一区别：每条金额先按自己的 `currency` 折成基准币种。
 * **缺汇率的记录被排除**，并通过 `missingRates`（币种列表）与 `excludedCount`（笔数）暴露，
 * 绝不参与合计。
 *
 * `amountOf`（可选）替换「这一条折多少钱」，入参是**元**（与 `item.amount` 同单位）：
 * 账本页传 `mySpendYuan` 即「我承担」口径——折算与分摊口径互不干扰，先按份额、再按汇率。
 * 可见性/删除/归档、id 与日期校验始终留在本函数，换口径不会放宽「哪些记录能进合计」。
 */
export function summarizeLedgerInBase(list, fx, { dateFilter = null, amountOf = null } = {}) {
  const config = normalizeLedgerFx(fx)
  let expenseCents = 0
  let incomeCents = 0
  let refundCents = 0
  let count = 0
  let foreignCount = 0
  let convertedForeignCount = 0
  let excludedCount = 0
  const missingRates = new Set()

  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue
    if (item.archivedAt || item.deletedAt || item.tombstone) continue
    if (!String(item.id ?? '').trim() || !isValidDateKey(item.date)) continue
    if (typeof dateFilter === 'function' && !dateFilter(item.date)) continue
    const code = normalizeCurrency(item.currency)
    const isForeign = Boolean(code) && code !== config.base
    if (isForeign) foreignCount += 1
    const amount = typeof amountOf === 'function' ? amountOf(item) : item.amount
    const converted = convertToBaseMinor(amount, code, config)
    if (converted.cents === null) {
      if (converted.reason === 'rate') {
        excludedCount += 1
        missingRates.add(code || '未知币种')
      }
      continue
    }
    if (isForeign) convertedForeignCount += 1
    count += 1
    if (item.direction === 'income') incomeCents += converted.cents
    else if (isRefundTransaction(item)) refundCents += converted.cents
    else expenseCents += converted.cents
  }

  return {
    base: config.base,
    ratesUpdatedAt: config.updatedAt,
    count,
    expenseTotal: (expenseCents - refundCents) / 100,
    incomeTotal: incomeCents / 100,
    refundTotal: refundCents / 100,
    foreignCount,
    convertedForeignCount,
    excludedCount,
    missingRates: [...missingRates].sort((a, b) => a.localeCompare(b)),
    hasForeign: foreignCount > 0,
    hasMissing: excludedCount > 0,
  }
}

/** 一个月的折算合计（`summarizeLedgerInBase` 的月度便捷入口）。 */
export function sumLedgerMonthInBase(list, fx, month, { amountOf = null } = {}) {
  return summarizeLedgerInBase(list, fx, { dateFilter: ledgerMonthFilter(month), amountOf })
}

/**
 * 「≈ ¥xxx（按 yyyy-mm-dd 汇率）」这一行的唯一出处。
 * 没有任何非基准币种记录时返回空字符串 —— 页面上不该出现一条无意义的折算行。
 */
export function fxRateNote(summary) {
  if (!summary || !summary.hasForeign) return ''
  const date = summary.ratesUpdatedAt || '未记录日期'
  const missing = summary.hasMissing
    ? `；${summary.missingRates.join('、')} 缺少汇率，另有 ${summary.excludedCount} 笔未计入`
    : ''
  return `≈ ${moneyWithCurrency(summary.expenseTotal, summary.base)}（按 ${date} 汇率${missing}）`
}