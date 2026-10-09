/**
 * 「我花了多少」的三个口径块（从 LedgerView.vue 拆出）：
 * 今天 / 本周 / 本月的花费、本月的分摊摘要、以及本月 vs 上月的环比。
 *
 * 全部只读、只依赖 `expenses` 与「今天是哪天」——所以它们天然属于数据层，
 * 留在页面里只会让页面重新变成「既管状态又管口径」。口径的解释见原处的注释。
 */
import { computed } from 'vue'
import { expenses, isRefundTransaction, isValidDateKey } from '../ledger.js'
import { hasSplit, mySpendCents } from '../ledgerSplit.js'
import { appToday } from '../timeContext.js'
import { createLedgerBaseConverter, normalizeLedgerFx, useLedgerFx } from '../ledgerFx.js'

const ledgerToday = () => appToday.value

/* ---------- 分摊口径的「我花了多少」 ---------- */
// 账本页所有「我花了多少」的数字都走这一套：用 `mySpendCents` 而非 `amount`——
// 有分摊的记录取 `split.mine`，其余记录逐分不变。未分摊的账本里新旧口径**完全相等**，
// 所以既有用户的数字一个字都不会变；只有分摊记录才会让口径产生差别。
//
// 【本周窗口】这里刻意只算**日期键**（YYYY-MM-DD 字符串），不做 `Date` 比较：
//   - 旧实现拿「本月 1 号所在的那一周」当本周，周中任何一天都会算错；
//   - 旧实现还把本地午夜的 `Date` 与 UTC 午夜的边界相比，在东八区会把周一整天漏掉。
// 现在按 UTC 日历推出本周 7 个日期键（与 `ledgerWeekTotalFromIndex` 同一套推算），
// 再与记录自己的日期字符串比对，没有时区参与，也就没有时区 bug。
function weekDateKeys(date) {
  const [year, month, day] = String(date ?? '').split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return new Set()
  const cursor = new Date(Date.UTC(year, month - 1, day))
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7))
  const keys = new Set()
  for (let offset = 0; offset < 7; offset += 1) {
    keys.add(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

// 退款在任何周期里都**冲减支出**，三个口径因此完全一致：
// 今天/本周/本月都是「支出 − 退款」。这不是新口径，而是把今天/本周对齐到
// 本月已有的行为（`monthCents - monthRefundCents`）以及列表日期头的行为
// （`feed.js` 的 `expenseCents -= cents`）。此前今天/本周不减，于是同一笔退款
// 会让 hero 显示 ¥100、紧挨着的日期头显示 ¥70 —— 同屏两个互相矛盾的数字。
function previousMonthKey(monthKey) {
  const [year, month] = String(monthKey ?? '').slice(0, 7).split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return ''
  const previous = new Date(Date.UTC(year, month - 2, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * 账本首页的周/月派生数据一次遍历完成。此前日/周/月、本月收入与环比、上月环比
 * 分别扫完整份流水；记录变更时同一批数据最多重复扫描三次。账本常驻使用时，
 * 把这些合成一个索引式归约，保持金额口径不变并减掉重复工作。
 */
export function summarizeLedgerSpendPeriods(list, { today = ledgerToday(), fx = null } = {}) {
  const config = normalizeLedgerFx(fx)
  const convert = createLedgerBaseConverter(config)
  const monthKey = today.slice(0, 7)
  const lastMonthKey = previousMonthKey(monthKey)
  const weekKeys = weekDateKeys(today)
  const totals = {
    todayExpense: 0, todayRefund: 0,
    weekExpense: 0, weekRefund: 0,
    monthExpense: 0, monthRefund: 0,
    previousMonthExpense: 0, previousMonthRefund: 0,
    monthIncome: 0, monthSplitCount: 0,
  }
  const excluded = { today: 0, week: 0, month: 0, previousMonth: 0 }
  const missingRates = new Set()

  for (const item of Array.isArray(list) ? list : []) {
    if (!item || item.archivedAt || item.deletedAt || item.tombstone) continue
    if (!String(item.id ?? '').trim() || !isValidDateKey(item.date)) continue
    const personalCents = mySpendCents(item)
    if (personalCents === null) continue
    const date = String(item.date)
    const itemMonth = date.slice(0, 7)
    const inMonth = itemMonth === monthKey
    const inPreviousMonth = itemMonth === lastMonthKey
    const converted = convert(personalCents / 100, item.currency)
    if (converted.cents === null) {
      if (date === today) excluded.today += 1
      if (weekKeys.has(date)) excluded.week += 1
      if (inMonth) excluded.month += 1
      if (inPreviousMonth) excluded.previousMonth += 1
      if (inMonth || weekKeys.has(date)) missingRates.add(converted.currency)
      continue
    }
    const cents = converted.cents
    if (inMonth && hasSplit(item)) totals.monthSplitCount += 1

    if (item.direction === 'income') {
      if (inMonth) totals.monthIncome += cents
      continue
    }
    if (isRefundTransaction(item)) {
      // 退款只冲减它自己落在的那个周期，不跨周期回冲（否则上月退款会改写本月数字）。
      if (date === today) totals.todayRefund += cents
      if (inMonth) totals.monthRefund += cents
      if (inPreviousMonth) totals.previousMonthRefund += cents
      if (weekKeys.has(date)) totals.weekRefund += cents
      continue
    }
    if (date === today) totals.todayExpense += cents
    if (inMonth) totals.monthExpense += cents
    if (inPreviousMonth) totals.previousMonthExpense += cents
    if (weekKeys.has(date)) totals.weekExpense += cents
  }

  const monthExpenseTotal = (totals.monthExpense - totals.monthRefund) / 100
  const monthIncomeTotal = totals.monthIncome / 100
  return {
    spend: {
      today: (totals.todayExpense - totals.todayRefund) / 100,
      week: (totals.weekExpense - totals.weekRefund) / 100,
      month: monthExpenseTotal,
    },
    currentMonthPersonal: {
      splitCount: totals.monthSplitCount,
      expenseTotal: monthExpenseTotal,
      incomeTotal: monthIncomeTotal,
      refundTotal: totals.monthRefund / 100,
      balance: monthIncomeTotal - monthExpenseTotal,
    },
    previousMonthExpenseTotal: (totals.previousMonthExpense - totals.previousMonthRefund) / 100,
    base: config.base,
    excluded,
    missingRates: [...missingRates].sort(),
  }
}
const { fx } = useLedgerFx()
const periodSummary = computed(() => summarizeLedgerSpendPeriods(expenses.value, { today: ledgerToday(), fx: fx.value }))
const mySpendPeriodStats = computed(() => periodSummary.value.spend)

// 三块数字保持「今天花费 / 本周花费 / 本月花费」这几个用户熟悉的标签，
// 数值按「我承担」算；口径说明只在**本月确有分摊**时补一行（见模板 split-note）。
const spendStats = computed(() => [
  { key: 'today', label: '今天花费', value: mySpendPeriodStats.value.today, excludedCount: periodSummary.value.excluded.today },
  { key: 'week', label: '本周花费', value: mySpendPeriodStats.value.week, excludedCount: periodSummary.value.excluded.week },
  { key: 'month', label: '本月花费', value: mySpendPeriodStats.value.month, excludedCount: periodSummary.value.excluded.month },
])

// 本月的「我承担」摘要：同时给出口径说明需要的分摊笔数与环比用的合计。
// 合计口径与 `monthStats.total` 一致（支出 − 退款），只是每条取我的份额。
const currentMonthPersonal = computed(() => periodSummary.value.currentMonthPersonal)
const currentMonthHasSplit = computed(() => currentMonthPersonal.value.splitCount > 0)

// 本月 vs 上月环比：只有上月确有数据时才显示，避免拿“月没过几天”做误导比较。
// 环比同样走分摊口径：hero-stat 上的数字已经全是「我承担的份额」，
// 拿它去和上月的全额比会得出「这个月花得少多了」的假结论。
const monthCompare = computed(() => {
  const current = currentMonthPersonal.value.expenseTotal
  const previous = periodSummary.value.previousMonthExpenseTotal
  if (!previous || periodSummary.value.excluded.month || periodSummary.value.excluded.previousMonth) return null
  const diff = Math.round((current - previous) * 100) / 100
  return { current, previous, diff, up: diff > 0, down: diff < 0, flat: diff === 0 }
})

export function useLedgerSpendStats() {
  return {
    mySpendPeriodStats,
    spendStats,
    currentMonthPersonal,
    currentMonthHasSplit,
    monthCompare,
    spendMissingRates: computed(() => periodSummary.value.missingRates),
  }
}
