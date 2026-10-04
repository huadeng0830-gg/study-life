/**
 * 「我花了多少」的三个口径块（从 LedgerView.vue 拆出）：
 * 今天 / 本周 / 本月的花费、本月的分摊摘要、以及本月 vs 上月的环比。
 *
 * 全部只读、只依赖 `expenses` 与「今天是哪天」——所以它们天然属于数据层，
 * 留在页面里只会让页面重新变成「既管状态又管口径」。口径的解释见原处的注释。
 */
import { computed } from 'vue'
import { expenses, isRefundTransaction, isValidDateKey } from '../ledger.js'
import { mySpendCents, personalSpendTotals } from '../ledgerSplit.js'
import { appToday } from '../timeContext.js'

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
function mySpendStats(list, { dateFilter = null } = {}) {
  let todayCents = 0, weekCents = 0, monthCents = 0
  let todayRefundCents = 0, weekRefundCents = 0, monthRefundCents = 0
  const today = ledgerToday()
  const monthKey = today.slice(0, 7)
  const weekKeys = weekDateKeys(today)

  for (const item of list) {
    if (!item || item.archivedAt || item.deletedAt || item.tombstone) continue
    if (!String(item.id ?? '').trim() || !isValidDateKey(item.date)) continue
    if (typeof dateFilter === 'function' && !dateFilter(item.date)) continue
    const cents = mySpendCents(item)
    if (cents === null) continue
    if (item.direction === 'income') continue
    const inMonth = String(item.date).slice(0, 7) === monthKey
    if (isRefundTransaction(item)) {
      // 退款只冲减它自己落在的那个周期，不跨周期回冲（否则上月退款会改写本月数字）。
      if (item.date === today) todayRefundCents += cents
      if (inMonth) monthRefundCents += cents
      if (weekKeys.has(item.date)) weekRefundCents += cents
      continue
    }
    if (item.date === today) todayCents += cents
    if (inMonth) monthCents += cents
    if (weekKeys.has(item.date)) weekCents += cents
  }
  return {
    today: (todayCents - todayRefundCents) / 100,
    week: (weekCents - weekRefundCents) / 100,
    month: (monthCents - monthRefundCents) / 100,
  }
}
const mySpendPeriodStats = computed(() => mySpendStats(expenses.value))

// 三块数字保持「今天花费 / 本周花费 / 本月花费」这几个用户熟悉的标签，
// 数值按「我承担」算；口径说明只在**本月确有分摊**时补一行（见模板 split-note）。
const spendStats = computed(() => [
  { key: 'today', label: '今天花费', value: mySpendPeriodStats.value.today },
  { key: 'week', label: '本周花费', value: mySpendPeriodStats.value.week },
  { key: 'month', label: '本月花费', value: mySpendPeriodStats.value.month },
])

// 本月的「我承担」摘要：同时给出口径说明需要的分摊笔数与环比用的合计。
// 合计口径与 `monthStats.total` 一致（支出 − 退款），只是每条取我的份额。
function personalMonthSummary(monthKey) {
  return personalSpendTotals(expenses.value, {
    dateFilter: (date) => String(date ?? '').slice(0, 7) === monthKey,
  })
}
const currentMonthPersonal = computed(() => personalMonthSummary(ledgerToday().slice(0, 7)))
const currentMonthHasSplit = computed(() => currentMonthPersonal.value.splitCount > 0)

// 本月 vs 上月环比：只有上月确有数据时才显示，避免拿“月没过几天”做误导比较。
// 环比同样走分摊口径：hero-stat 上的数字已经全是「我承担的份额」，
// 拿它去和上月的全额比会得出「这个月花得少多了」的假结论。
const monthCompare = computed(() => {
  const current = currentMonthPersonal.value.expenseTotal
  const [year, month] = ledgerToday().slice(0, 7).split('-').map(Number)
  const previousDate = new Date(Date.UTC(year, month - 2, 1))
  const previousKey = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`
  const previous = personalMonthSummary(previousKey).expenseTotal
  if (!previous) return null
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
  }
}
