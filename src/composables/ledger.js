// 账本模块业务层：分类、消费记录存储、自然输入解析、常记推导。
// 只新增存储键（sl_expenses / sl_ledger_categories / sl_ledger_freq），不触碰任何既有数据。
import { computed } from 'vue'
import { useStoredRef } from './store'
import { clock } from './store/core.js'
// timestampOf 放在 settingsPolicy 里（时间语义的唯一出处）。
// 依赖链 settingsPolicy → store/core + store/timeConfig + syncSpace 都不反向引用账本，
// 所以这里不会形成循环导入。
import { timestampOf } from './settingsPolicy.js'
import {
  CATEGORY_CONFIDENCE_THRESHOLD,
  COMMON_EXPENSE_CATEGORY_KEYS,
  COMMON_INCOME_CATEGORY_KEYS,
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  classifyText,
  normalizeCategoryKey,
  normalizeLedgerCategories,
} from './ledgerCategories.js'

export {
  CATEGORY_CONFIDENCE_THRESHOLD,
  COMMON_EXPENSE_CATEGORY_KEYS,
  COMMON_INCOME_CATEGORY_KEYS,
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from './ledgerCategories.js'

export const expenses = useStoredRef('sl_expenses', [], { deep: false })
export const ledgerCategories = useStoredRef('sl_ledger_categories', DEFAULT_CATEGORIES)
export const freqPrefs = useStoredRef('sl_ledger_freq', { pinned: [], hidden: [], categoryOverrides: [] })
export const ledgerCategoryById = computed(() => {
  const map = new Map(DEFAULT_CATEGORIES.map((category) => [category.key, category]))
  for (const category of ledgerCategories.value) map.set(category.key, category)
  return map
})

// 首次打开新版本时只补齐分类定义，并保留旧分类对象与所有交易的 categoryId。
// 旧的“生活”分类会被隐藏而不是删除，历史记录仍可正常查看和编辑。
const normalizedCategories = normalizeLedgerCategories(ledgerCategories.value)
if (JSON.stringify(normalizedCategories) !== JSON.stringify(ledgerCategories.value)) {
  ledgerCategories.value = normalizedCategories
}

// 账本仍以元保存，边界和汇总统一按“分”计算，避免 0.1 + 0.2 这类浮点误差。
// 一亿元已经远超个人日常记账范围，同时可以阻止科学计数法和异常大数污染数据。
export const MAX_LEDGER_AMOUNT = 1_000_000_000

export function amountToCents(value) {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    const cents = Math.round(value * 100)
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_LEDGER_AMOUNT * 100) return null
    // 允许计算机产生的极小尾差，但拒绝真正超过两位小数的金额。
    if (Math.abs(value - cents / 100) > 1e-8) return null
    // -0 会通过上面所有判据（`-0 < 0` 为 false），但 `Intl` 保留它的符号，
    // 于是界面上会出现「¥-0.00」。这里统一归一成 0，与字符串分支一致。
    return cents === 0 ? 0 : cents
  }

  let text = String(value).trim().replace(/,/g, '')
  text = text.replace(/^[¥￥]\s*/, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_LEDGER_AMOUNT * 100) return null
  return cents
}

export function normalizeAmount(value) {
  const cents = amountToCents(value)
  return cents === null ? null : cents / 100
}

// 输入控件通常给出 HH:mm，但导入历史里可能保留了 9:5 这类非补零形式。
// 统一为可排序的本地时刻；空值仍表示“当天未指定时间”。
export function normalizeLedgerTime(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function sumLedgerAmounts(items = []) {
  let cents = 0
  for (const item of items) cents += amountToCents(item?.amount) ?? 0
  return cents / 100
}

// `normalizeCurrency` 住在 ledgerFx.js，而 ledgerFx.js 本身 import 了本模块，
// 在这里 import 回去会形成循环依赖（模块求值期就会踩到 TDZ）。
// 回顾页只需要「这三个字母是不是一个合法 ISO 代码」这一个判断，本地实现即可，
// 与 ledgerFx.normalizeCurrency 的规则逐字一致。
function reviewCurrencyCode(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : ''
}

// 账本所有统计与筛选共用这个实现，避免回顾页把已删除、已归档或损坏的历史数据计入金额。
function ledgerTransactionCents(item) {
  return ledgerAmountCents(item)
}

/**
 * 统计入口「这一条算多少钱」的唯一出处。
 *
 * 默认读 `item.amount`（全额口径，与既有行为逐分一致）；显式传 `amountOf` 时改读别的金额——
 * 账本页传 `mySpendCents`，就是「这一笔里我实际承担多少」的分摊口径。
 *
 * 【为什么校验留在这里】可见性/删除/归档/墓碑、id 与日期合法性判定**始终属于本函数**：
 * 换口径只该换「金额取哪个数」，绝不能顺带放宽「哪些记录能进统计」——
 * 否则已删除的记录会借新口径重新出现在合计里。返回值同样是「分」或 null。
 */
function ledgerAmountCents(item, amountOf = null) {
  if (!item || typeof item !== 'object' || !isVisibleTransaction(item) || !String(item.id ?? '').trim() || !isValidDateKey(item.date)) return null
  if (typeof amountOf !== 'function') return amountToCents(item.amount)
  const cents = amountOf(item)
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null
}

export function summarizeLedgerTransactions(list, { dateFilter = null, amountOf = null } = {}) {
  const items = []
  let expenseCents = 0
  let incomeCents = 0
  let refundCents = 0
  for (const item of Array.isArray(list) ? list : []) {
    const cents = ledgerAmountCents(item, amountOf)
    if (cents === null || (typeof dateFilter === 'function' && !dateFilter(item.date))) continue
    items.push(item)
    if (item.direction === 'income') incomeCents += cents
    else if (isRefundTransaction(item)) refundCents += cents
    else expenseCents += cents
  }
  return {
    items,
    count: items.length,
    expenseTotal: (expenseCents - refundCents) / 100,
    incomeTotal: incomeCents / 100,
    refundTotal: refundCents / 100,
  }
}

// 首页搜索/筛选的纯选择器；保持视图只负责组合控件状态，避免筛选规则和统计规则漂移。
export function filterLedgerTransactions(list, {
  query = '',
  category = '',
  account = '',
  min = '',
  max = '',
  kind = 'all',
  direction = 'all',
  dateFilter = null,
  categoryName = null,
  amountOf = null,
} = {}) {
  const keyword = String(query ?? '').trim().toLowerCase()
  const minAmountCents = min === '' ? null : amountToCents(min)
  const maxAmountCents = max === '' ? null : amountToCents(max)
  const source = Array.isArray(list) ? list : []
  return source.filter((item) => {
    const cents = ledgerAmountCents(item, typeof amountOf === 'function' ? amountOf : null)
    if (cents === null) return false
    if (keyword) {
      const label = typeof categoryName === 'function' ? categoryName(item.cat) : item.cat
      const haystack = `${item.name ?? ''} ${item.note ?? ''} ${label ?? ''}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    if (category && item.cat !== category) return false
    if (account && String(item.account ?? '').trim() !== account) return false
    if (direction !== 'all' && (item.direction === 'refund' ? 'expense' : (item.direction || 'expense')) !== direction) return false
    if (kind === 'manual' && item.source === 'bill') return false
    if (kind === 'bill' && item.source !== 'bill') return false
    if (minAmountCents !== null && cents < minAmountCents) return false
    if (maxAmountCents !== null && cents > maxAmountCents) return false
    if (typeof dateFilter === 'function' && !dateFilter(item.date)) return false
    return true
  })
}

// Ledger-only view projection. Date headers are first-class virtual items so
// the virtualizer can account for their height instead of hiding extra pixels
// inside a transaction row.
export function buildLedgerFeedItems(list) {
  const source = Array.isArray(list) ? list : []
  const items = []
  let previousDate = ''
  for (const transaction of source) {
    const id = String(transaction?.id ?? '').trim()
    if (!id) continue
    const date = String(transaction?.date ?? '')
    if (date !== previousDate) {
      items.push({
        key: `day:${date}`,
        kind: 'day',
        date,
        first: items.length === 0,
      })
      previousDate = date
    }
    items.push({ key: id, kind: 'transaction', transaction })
  }
  return items
}

function isVisibleTransaction(item) {
  return !item?.archivedAt && !item?.deletedAt && !item?.tombstone
}

// 退款/冲正：一笔独立记录，direction='refund' 且 refundOf 指向被冲抵的原支出。
// 它冲抵支出而非收入，也不参与分类分布（是修正项，不是一笔新消费）。
export function isRefundTransaction(item) {
  return item?.direction === 'refund'
}

export function isValidDateKey(value) {
  const text = String(value || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isDateInLedgerRange(dateKey, range = 'all', { today = '', from = '', to = '' } = {}) {
  if (!isValidDateKey(dateKey)) return false
  if (range === 'all') return true
  if (!isValidDateKey(today)) return false
  if (range === 'today') return dateKey === today
  if (range === 'month') return dateKey.slice(0, 7) === today.slice(0, 7)
  if (range === 'custom') return (!from || dateKey >= from) && (!to || dateKey <= to)
  if (range !== 'week') return true

  const [year, month, day] = today.split('-').map(Number)
  const monday = new Date(Date.UTC(year, month - 1, day))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const target = new Date(`${dateKey}T00:00:00Z`)
  const end = new Date(monday)
  end.setUTCDate(end.getUTCDate() + 7)
  return target >= monday && target < end
}

export function transactionIntegrityIssues(item, { categories = [], bills = [] } = {}) {
  const issues = []
  if (!item || typeof item !== 'object' || !String(item.id || '').trim()) issues.push('id')
  if (normalizeAmount(item?.amount) === null) issues.push('amount')
  if (!String(item?.name || '').trim()) issues.push('name')
  if (!['expense', 'income', 'refund'].includes(item?.direction || 'expense')) issues.push('direction')
  if (!isValidDateKey(item?.date)) issues.push('date')
  if (item?.cat && categories.length && !categories.some((category) => category?.key === item.cat)) issues.push('category')
  if (item?.billId && bills.length && !bills.some((bill) => bill?.id === item.billId)) issues.push('bill')
  if (item?.billingPeriodKey && !item?.billId) issues.push('bill')
  return issues
}

function transactionSortKey(item) {
  return `${String(item?.date ?? '')}${normalizeLedgerTime(item?.time) ?? ''}`
}

function compareExpenseOldestFirst(a, b) {
  return transactionSortKey(a).localeCompare(transactionSortKey(b))
}

function collectFrequentEntry(map, expense, cents = amountToCents(expense?.amount)) {
  if (!expense || typeof expense !== 'object' || !isVisibleTransaction(expense) || cents === null) return
  const name = String(expense.name ?? '').trim()
  if (!name) return
  // createdAt 可能是 ISO 字符串，也可能是毫秒数字（历史数据由课表识别写入）。
  // 直接 Date.parse 遇到数字会得到 NaN，导致"常记"的最近使用加权全部归零。
  const timestamp = timestampOf(expense.createdAt) || timestampOf(`${expense.date}T${expense.time || '00:00'}`) || 0
  const previous = map.get(name)
  if (!previous) {
    map.set(name, {
      name,
      amount: cents / 100,
      cat: expense.cat,
      count: 1,
      last: timestamp,
    })
    return
  }
  previous.count += 1
  if (timestamp >= previous.last) {
    previous.last = timestamp
    previous.amount = cents / 100
    previous.cat = expense.cat
  }
}

// 账本默认页会同时用到时间排序、月/日统计和“常记”频次。
// 统一在模块级 computed 中建索引，页面卸载后缓存仍然存在；
// 账本数据未变时再次进入不会重复扫描全部记录。
export function buildLedgerIndex(list) {
  const source = Array.isArray(list) ? list : []
  const monthStats = new Map()
  const dayTotals = new Map()
  const monthCategories = new Map()
  const frequentByName = new Map()

  for (const expense of source) {
    if (!expense || typeof expense !== 'object' || !isVisibleTransaction(expense)) continue
    // 与 ledgerAmountCents 同判据：没有 id 的记录不进索引。
    // 缺这一条时 monthStats / dayTotals / monthCategories / frequentEntries 会收进
    // 一条在任何实时列表聚合里都不存在的记录，于是「索引合计」与「界面合计」对不上。
    if (!String(expense.id ?? '').trim()) continue
    const cents = amountToCents(expense.amount)
    if (cents === null) continue
    const direction = expense.direction === 'income' ? 'income' : isRefundTransaction(expense) ? 'refund' : 'expense'
    const date = String(expense.date ?? '')
    if (isValidDateKey(date)) {
      const month = date.slice(0, 7)
      const monthStat = monthStats.get(month) ?? { totalCents: 0, incomeCents: 0, refundCents: 0, count: 0 }
      // 旧记录没有 direction，默认仍是支出；原有“本月支出”统计不受影响。
      if (direction === 'income') monthStat.incomeCents += cents
      else if (direction === 'refund') monthStat.refundCents += cents
      else monthStat.totalCents += cents
      if (direction !== 'refund') monthStat.count += 1
      monthStats.set(month, monthStat)
      // 退款是冲抵项，不进入“每日支出/分类分布”，避免把修正当成新消费。
      if (direction === 'expense') {
        dayTotals.set(date, (dayTotals.get(date) ?? 0) + cents)
        const categories = monthCategories.get(month) ?? new Map()
        categories.set(expense.cat || 'other', (categories.get(expense.cat || 'other') ?? 0) + cents)
        monthCategories.set(month, categories)
      }
    }
    // 常记（repeat last）只收**支出**：收入点一下会被 quick-entry 以 expense 方向落库，
    // 凭空多出一笔支出，而「工资」甚至不在支出的分类下拉里。
    if (direction === 'expense') collectFrequentEntry(frequentByName, expense, cents)
  }

  // 排序键只计算一次（decorate-sort-undecorate），避免比较器里反复构造日期时间字符串。
  const sortedExpenses = source
    .filter(isVisibleTransaction)
    .map((item) => ({ key: transactionSortKey(item), item }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .map((entry) => entry.item)

  return {
    sortedExpenses,
    monthStats: new Map([...monthStats.entries()].map(([key, value]) => [key, {
      total: (value.totalCents - (value.refundCents ?? 0)) / 100,
      income: value.incomeCents / 100,
      refund: (value.refundCents ?? 0) / 100,
      count: value.count,
    }])),
    dayTotals: new Map([...dayTotals.entries()].map(([key, value]) => [key, value / 100])),
    monthCategories: new Map([...monthCategories.entries()].map(([month, categories]) => [month, new Map([...categories.entries()].map(([key, value]) => [key, value / 100]))])),
    frequentEntries: [...frequentByName.values()],
  }
}

export const ledgerIndex = computed(() => buildLedgerIndex(expenses.value))

// 索引读取器的统一兜底。
//
// 这些函数都是导出的纯函数，调用方可能传进一个还没构建完的、或来自旧结构的
// 索引对象。直接 `index.monthStats.get(...)` 会抛 TypeError，把整个账本视图
// 打挂 —— 而这只是一个派生统计读不到数据而已，返回空 Map 就够了。
function indexMap(index, name) {
  const value = index?.[name]
  return value instanceof Map ? value : new Map()
}

export function ledgerPeriodStatsFromIndex(index, date) {
  const month = String(date ?? '').slice(0, 7)
  const monthStat = indexMap(index, 'monthStats').get(month)
  return {
    monthTotal: monthStat?.total ?? 0,
    monthCount: monthStat?.count ?? 0,
    todayTotal: indexMap(index, 'dayTotals').get(date) ?? 0,
  }
}

export function ledgerMonthIncomeFromIndex(index, date) {
  return indexMap(index, 'monthStats').get(String(date ?? '').slice(0, 7))?.income ?? 0
}

export function ledgerWeekTotalFromIndex(index, date) {
  const [year, month, day] = String(date ?? '').split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return 0
  const current = new Date(Date.UTC(year, month - 1, day))
  const mondayOffset = (current.getUTCDay() + 6) % 7
  current.setUTCDate(current.getUTCDate() - mondayOffset)
  const dayTotals = indexMap(index, 'dayTotals')
  let totalCents = 0
  for (let offset = 0; offset < 7; offset++) {
    const key = current.toISOString().slice(0, 10)
    totalCents += Math.round((dayTotals.get(key) ?? 0) * 100)
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return totalCents / 100
}

export function ledgerMonthCategoryTotalsFromIndex(index, date) {
  return indexMap(index, 'monthCategories').get(String(date ?? '').slice(0, 7)) ?? new Map()
}

// 月度回顾把列表、总额、分类、最高单笔和日历点迹放在同一轮遍历中完成。
// 对页面只暴露一个结果对象，保证所有卡片使用完全一致的可计入记录集合。
//
// `amountOf` 与 `summarizeLedgerTransactions` 同一约定：不传 = 全额口径（既有行为不变），
// 传 `mySpendCents` = 「我承担」口径。注意「最大一笔」在分摊口径下比的是**我的份额**，
// 但返回的仍是那条记录本身（页面按自己的口径取金额显示）。
export function buildLedgerMonthReview(list, month, { amountOf = null } = {}) {
  const monthKey = String(month ?? '').slice(0, 7)
  const validMonth = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(monthKey)
  const expenses = []
  const daily = new Map()
  const categories = new Map()
  const names = new Map()
  let totalCents = 0
  let refundCents = 0
  let incomeCents = 0
  let maxSingle = null
  let maxSingleCents = -1
  // 币种集合：回顾页的大数字按记录**原值**相加（这是本模块一贯约定，见文件头），
  // 所以一个月里出现两种以上币种时那个合计是**没有意义的**——界面必须自己说清楚。
  const currencyCodes = new Set()

  for (const item of Array.isArray(list) ? list : []) {
    const cents = ledgerAmountCents(item, amountOf)
    if (cents === null || !validMonth || item.date.slice(0, 7) !== monthKey) continue
    const code = reviewCurrencyCode(item.currency)
    if (code) currencyCodes.add(code)
    // 收入此前被整个跳过，于是回顾页只看得见支出、看不见「这个月赚了多少」。
    // 它不进分类/最高单笔/最常记录（那三项回答的是「钱花在哪」），但必须给出总额。
    if (item.direction === 'income') { incomeCents += cents; continue }
    // 退款是冲抵项：单独累计并从总额中扣减，不进入分类/最高单笔/最常记录。
    if (isRefundTransaction(item)) { refundCents += cents; continue }
    const sortKey = transactionSortKey(item)
    expenses.push(item)
    totalCents += cents

    const day = Number(item.date.slice(8, 10))
    const dayEntry = daily.get(day) ?? { count: 0, totalCents: 0 }
    dayEntry.count += 1
    dayEntry.totalCents += cents
    daily.set(day, dayEntry)

    const categoryKey = item.cat || 'other'
    const categoryEntry = categories.get(categoryKey) ?? { totalCents: 0, firstSortKey: sortKey }
    categoryEntry.totalCents += cents
    if (sortKey < categoryEntry.firstSortKey) categoryEntry.firstSortKey = sortKey
    categories.set(categoryKey, categoryEntry)

    const name = String(item.name ?? '').trim()
    if (name) {
      const nameEntry = names.get(name) ?? { count: 0, firstSortKey: sortKey }
      nameEntry.count += 1
      if (sortKey < nameEntry.firstSortKey) nameEntry.firstSortKey = sortKey
      names.set(name, nameEntry)
    }

    if (cents > maxSingleCents || (cents === maxSingleCents && (!maxSingle || sortKey < transactionSortKey(maxSingle)))) {
      maxSingle = item
      maxSingleCents = cents
    }
  }

  expenses.sort(compareExpenseOldestFirst)
  const dayItems = new Map()
  for (const item of expenses) {
    const day = Number(item.date.slice(8, 10))
    const entries = dayItems.get(day) ?? []
    entries.push(item)
    dayItems.set(day, entries)
  }
  const categoryTotals = [...categories.entries()]
    .map(([key, value]) => ({ key, total: value.totalCents / 100, firstSortKey: value.firstSortKey }))
    .sort((a, b) => b.total - a.total || a.firstSortKey.localeCompare(b.firstSortKey))
    .map(({ firstSortKey, ...entry }) => entry)
  const mostFrequent = [...names.entries()]
    .map(([name, value]) => ({ name, count: value.count, firstSortKey: value.firstSortKey }))
    .sort((a, b) => b.count - a.count || a.firstSortKey.localeCompare(b.firstSortKey))[0]

  return {
    expenses,
    total: (totalCents - refundCents) / 100,
    refundTotal: refundCents / 100,
    incomeTotal: incomeCents / 100,
    // 结余 = 收入 − 支出（支出已是净额，含退款冲抵）。「赚了多少 / 剩多少」
    // 是记账最核心的两个数，此前一个都拿不到。
    balance: (incomeCents - (totalCents - refundCents)) / 100,
    // 本月出现过的非基准币种数量。>1 时上方的合计是原值直加，界面必须提示。
    currencyCount: currencyCodes.size,
    hasForeignCurrency: currencyCodes.size > 0,
    count: expenses.length,
    mostFrequent: mostFrequent ? { name: mostFrequent.name, count: mostFrequent.count } : null,
    topCategory: categoryTotals[0] ?? null,
    maxSingle,
    categoryTotals,
    dayTotals: new Map([...daily.entries()].map(([day, value]) => [day, { count: value.count, total: value.totalCents / 100 }])),
    dayItems,
  }
}

// ---------- 分类 ----------
export function categoriesForScope(scope = 'expense', { includeHidden = false } = {}) {
  return ledgerCategories.value.filter((category) => {
    if ((category.scope || 'expense') !== scope) return false
    return includeHidden || !category.hidden
  })
}

export function activeCategories(scope = 'expense') {
  return categoriesForScope(scope)
}

export function commonCategories(scope = 'expense') {
  const keys = scope === 'income' ? COMMON_INCOME_CATEGORY_KEYS : COMMON_EXPENSE_CATEGORY_KEYS
  const active = categoriesForScope(scope)
  const byKey = new Map(active.map((category) => [category.key, category]))
  const preferred = keys.map((key) => byKey.get(key)).filter(Boolean)
  const seen = new Set(preferred.map((category) => category.key))
  return [...preferred, ...active.filter((category) => !seen.has(category.key))].slice(0, 8)
}

export function catInfo(key) {
  const normalizedKey = normalizeCategoryKey(key)
  return ledgerCategoryById.value.get(normalizedKey)
    ?? { key: normalizedKey || 'other', name: '其它', icon: '⋯', scope: 'expense' }
}

export function classifyTransaction(name, { direction = 'expense', recentCategory = '', overrides } = {}) {
  const scope = direction === 'income' ? 'income' : 'expense'
  const classification = classifyText(name, {
    direction: scope,
    recentCategory: normalizeCategoryKey(recentCategory),
    overrides: overrides ?? freqPrefs.value?.categoryOverrides ?? [],
  })
  return {
    ...classification,
    categoryId: normalizeCategoryKey(classification.categoryId),
    scope,
    threshold: CATEGORY_CONFIDENCE_THRESHOLD,
  }
}

export function detectCategory(name, options = {}) {
  return classifyTransaction(name, options).categoryId
}

export function rememberCategoryOverride(term, categoryId, direction = 'expense') {
  const normalizedTerm = String(term ?? '').trim().replace(/\s+/g, ' ')
  const key = normalizeCategoryKey(categoryId)
  if (!normalizedTerm || !key) return false
  const scope = direction === 'income' ? 'income' : 'expense'
  if (!categoriesForScope(scope, { includeHidden: true }).some((category) => category.key === key)) return false
  const current = Array.isArray(freqPrefs.value?.categoryOverrides) ? freqPrefs.value.categoryOverrides : []
  const next = current.filter((item) => !(String(item?.term ?? '').trim() === normalizedTerm && (item?.direction || 'expense') === scope))
  next.unshift({ term: normalizedTerm, key, direction: scope, updatedAt: new Date().toISOString() })
  freqPrefs.value = { ...freqPrefs.value, categoryOverrides: next.slice(0, 100) }
  return true
}

export function forgetCategoryOverride(term, direction = 'expense') {
  const normalizedTerm = String(term ?? '').trim().replace(/\s+/g, ' ')
  const scope = direction === 'income' ? 'income' : 'expense'
  const next = (freqPrefs.value?.categoryOverrides ?? []).filter(
    (item) => !(String(item?.term ?? '').trim() === normalizedTerm && (item?.direction || 'expense') === scope),
  )
  freqPrefs.value = { ...freqPrefs.value, categoryOverrides: next }
}

// 固定账单分类名 → 账本分类 key；账单自身仍是周期提醒，支付后才生成 Transaction。
export function billCategoryToKey(name) {
  const map = {
    会员订阅: 'sub',
    通讯网络: 'communication',
    生活缴费: 'utilities',
    住房: 'housing',
    保险: 'other',
    其他: 'other',
  }
  return map[name] ?? detectCategory(name)
}

// ---------- 自然输入解析 ----------
// 「午饭 18」→ { name: '午饭', amount: '18' }
// 「会员 25 每月15号」→ { name: '会员', amount: '25', cycle: { kind:'monthly', day:15 } }
export function parseNatural(text) {
  let rest = String(text ?? '').trim()
  let amount = ''
  let cycle = null

  // 金额要同时接受「18」「18.5」和带千分位的「1,234.56」。
  // 原来的正则只认纯数字，遇到「午饭 1,234.56」会因为惰性前缀退到逗号之后，
  // 把名称解析成「午饭 1,」、金额解析成「234.56」。
  const mAmount = rest.match(/^(.*?)[\s　]*([¥￥]?\s*(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?))$/)
  if (mAmount && mAmount[1].trim()) {
    rest = mAmount[1].trim()
    amount = mAmount[2].replace(/[¥￥\s,]/g, '')
  }

  const mCycle = rest.match(/(每个月|每月|每星期|每周|每年)\s*(\d{1,2})?\s*[号日]?/)
  if (mCycle) {
    const word = mCycle[1]
    const kind = word.includes('周') ? 'weekly' : word.includes('年') ? 'yearly' : 'monthly'
    const day = mCycle[2] ? Math.min(31, Math.max(1, Number(mCycle[2]))) : null
    cycle = { kind, day }
    rest = rest.replace(mCycle[0], '').trim()
  }

  return { name: rest, amount, cycle }
}

// ---------- 常记推导 ----------
// 规则：出现 ≥2 次的名称自动进入；最近使用加权靠前；金额/分类沿用最近一次。
// 用户可固定（pinned）或隐藏（hidden）。
function rankFrequent(entries, prefs, limit, now) {
  const pinned = Array.isArray(prefs?.pinned) ? prefs.pinned : []
  const hidden = Array.isArray(prefs?.hidden) ? prefs.hidden : []
  const out = []
  for (const item of entries) {
    if (hidden.includes(item.name)) continue
    const isPinned = pinned.includes(item.name)
    if (item.count < 2 && !isPinned) continue
    const days = Math.max(0, (now - item.last) / 86400000)
    const score = item.count / (1 + days / 7) + (isPinned ? 1e6 : 0)
    out.push({ ...item, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function computeFrequentFromIndex(index, prefs, limit = 6, now = clock.value.getTime()) {
  return rankFrequent(Array.isArray(index?.frequentEntries) ? index.frequentEntries : [], prefs, limit, now)
}

export function computeFrequent(list, prefs, limit = 6, now = clock.value.getTime()) {
  const map = new Map()
  for (const expense of list) collectFrequentEntry(map, expense)
  return rankFrequent(map.values(), prefs, limit, now)
}
