/**
 * 「回顾」分区的全部派生状态（从 LedgerView.vue 拆出）：
 * 翻到哪个月、这个月的合计与分类分布、展开到哪一行、月历点迹与选中日。
 *
 * 口径与首页完全一致（\`amountOf: mySpendCents\`，行内金额是「我承担」的份额），
 * 原处的长注释解释了为什么分类分布必须给「展开其余 N 个」与可点的明细入口。
 *
 * 依赖里只有 \`tab\` 是页面级的（首页点分类要跳到回顾分区），其余都是数据。
 */
import { computed, ref } from 'vue'
import { appToday } from '../timeContext.js'
import { buildLedgerMonthReview, catInfo, expenses, filterLedgerTransactions, isValidDateKey, ledgerIndex } from '../ledger.js'
import { mySpendCents, mySpendYuan, personalSpendTotals } from '../ledgerSplit.js'
import { createLedgerBaseConverter, summarizeLedgerMonthsInBase, sumLedgerMonthInBase } from '../ledgerFx.js'
import { shiftTrendMonth } from '../monthlyTrendChart.js'

export function useLedgerReview({ ledgerToday, tab, fx }) {
  const reviewMonth = ref(ledgerToday().slice(0, 7)) // YYYY-MM
  const trendEndMonth = ref(reviewMonth.value)
  const earliestTrendMonth = computed(() => {
    let first = ledgerToday().slice(0, 7)
    for (const month of ledgerIndex.value.monthStats.keys()) {
      if (month < first) first = month
    }
    return first
  })
  function setTrendEndMonth(month) {
    const target = String(month ?? '')
    if (!shiftTrendMonth(target, 0) || target > ledgerToday().slice(0, 7)) return
    trendEndMonth.value = target
  }

  function shiftMonth(delta) {
    const target = shiftTrendMonth(reviewMonth.value, delta)
    if (!target || target > ledgerToday().slice(0, 7)) return
    reviewMonth.value = target
    selectedDay.value = null
    // 换月就收起下钻（函数声明会被提升，这里不依赖定义顺序）。
    resetReviewCategoryView()
  }
  function jumpToMonth(month) {
    const target = String(month ?? '')
    if (!shiftTrendMonth(target, 0) || target > ledgerToday().slice(0, 7)) return
    reviewMonth.value = target
    selectedDay.value = null
    resetReviewCategoryView()
  }
  const reviewLabel = computed(() => {
    const [y, m] = reviewMonth.value.split('-').map(Number)
    return y === Number(appToday.value.slice(0, 4)) ? `${m}月` : `${y}年${m}月`
  })

  // 回顾与首页同一口径：整月合计、分类分布、月历点迹、最大一笔全部按「我承担的份额」算
  // （`amountOf: mySpendCents`）。未分摊的记录逐分不变，所以没有分摊的月份与改建前完全一致。
  const monthlyReview = computed(() => {
    const convert = createLedgerBaseConverter(fx.value)
    const amountOf = (item) => convert(mySpendYuan(item), item.currency).cents
    const raw = buildLedgerMonthReview(expenses.value, reviewMonth.value, { amountOf: mySpendCents })
    const converted = buildLedgerMonthReview(expenses.value, reviewMonth.value, { amountOf })
    const summary = sumLedgerMonthInBase(expenses.value, fx.value, reviewMonth.value, { amountOf: mySpendYuan })
    const items = filterLedgerTransactions(ledgerIndex.value.sortedExpenses, { dateFilter: (date) => date.startsWith(reviewMonth.value) })
    const dayItems = new Map()
    const dayTotals = new Map()
    for (const item of items) {
      const day = Number(item.date.slice(8))
      const entries = dayItems.get(day) || []
      entries.push(item); dayItems.set(day, entries)
      const total = dayTotals.get(day) || { count: 0, totalCents: 0, excludedCount: 0 }
      total.count += 1
      const cents = amountOf(item)
      if (cents === null) total.excludedCount += 1
      else if (item.direction !== 'income') total.totalCents += item.direction === 'refund' ? -cents : cents
      dayTotals.set(day, total)
    }
    return { ...converted, expenses: raw.expenses, count: raw.count, mostFrequent: raw.mostFrequent,
      recordCount: items.length, excludedCount: summary.excludedCount, missingRates: summary.missingRates,
      hasForeignCurrency: summary.hasForeign, base: summary.base, ratesUpdatedAt: summary.ratesUpdatedAt,
      dayItems,
      dayTotals: new Map([...dayTotals].map(([day, entry]) => [day, { count: entry.count, total: entry.totalCents / 100, excludedCount: entry.excludedCount }])),
    }
  })
  const reviewTotal = computed(() => monthlyReview.value.total)
  const reviewCount = computed(() => monthlyReview.value.recordCount)
  const mostFrequent = computed(() => monthlyReview.value.mostFrequent)
  const topCategory = computed(() => {
    const top = monthlyReview.value.topCategory
    return top ? { cat: top.key, total: top.total } : null
  })
  const maxSingle = computed(() => monthlyReview.value.maxSingle)
  // 「最大一笔」的金额：卡片上的其它数字都是份额，这一笔也必须显示**我的份额**
  // （这条记录的总额仍在详情面板与导出里，信息没丢）。
  const maxSingleMine = computed(() => maxSingle.value ? createLedgerBaseConverter(fx.value)(mySpendYuan(maxSingle.value), maxSingle.value.currency).cents / 100 : null)
  /* ---------- 分类分布（回顾） ----------
   * 改造前这里有两个看不见的墙：
   *   1. `categoryTotals.slice(0, 5)` —— 第 6 名以后的分类在页面上**完全不存在**。
   *      整月合计把它们的钱算进去了，但用户永远看不到「那个分类花了多少」，
   *      只能靠「合计 − 前 5 名」反推一个说不清归属的差额。
   *   2. 每一行都是纯展示（span + 进度条）——「这个分类的钱到底花在哪几笔上」
   *      只能去下面的月历里一天天翻，或者用搜索。
   * 现在：① 整月所有分类都在列表里，多出来的用「展开其余 N 个分类」放出；
   *       ② 每一行本身就是明细入口，点一下展开该分类当月的每一笔，点某笔直接开详情。
   * 口径与整块回顾完全一致：合计、占比、行内金额全部是「我承担」的份额（personalAmount），
   * 所以这一屏不会出现「合计 40 / 分类 200」这种自相矛盾（见 tests/ledgerSplitDisplay.test.js）。
   */
  const REVIEW_CATEGORY_LIMIT = 5
  const expandedCategory = ref('') // 当前展开明细的分类 key
  const showAllReviewCats = ref(false) // 「展开其余 N 个分类」
  const reviewCategoryRows = computed(() => {
    const buckets = new Map()
    const convert = createLedgerBaseConverter(fx.value)
    const baseAmount = (item) => convert(mySpendYuan(item), item.currency).cents
    for (const item of monthlyReview.value.expenses) {
      const key = item.cat || 'other'
      const bucket = buckets.get(key) ?? { key, totalCents: 0, items: [], excludedCount: 0 }
      const cents = baseAmount(item)
      if (cents === null) bucket.excludedCount += 1
      else bucket.totalCents += cents
      bucket.items.push(item)
      buckets.set(key, bucket)
    }
    const rows = [...buckets.values()].map((bucket) => ({
      key: bucket.key,
      info: catInfo(bucket.key),
      value: bucket.totalCents / 100,
      count: bucket.items.length,
      excludedCount: bucket.excludedCount,
      // 分类内按金额倒序：点开就是想看「钱花在哪几笔上」，最大的那笔该在第一条。
      // 金额相同时按日期时间倒序，保证顺序稳定（不依赖录入顺序）。
      items: bucket.items.slice().sort((a, b) =>
        (baseAmount(b) ?? -1) - (baseAmount(a) ?? -1)
        || `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`)),
    }))
    // 占比分母取「分类合计」而不是整月净额：退款是冲抵项、不属于任何分类，
    // 用净额做分母会让这个月每一行的占比加起来超过 100%。没有退款时两者逐分相等。
    const sum = rows.reduce((total, row) => total + row.value, 0)
    return rows
      .map((row) => ({ ...row, pct: sum > 0 ? Math.round((row.value / sum) * 100) : 0 }))
      .sort((a, b) => b.value - a.value || a.info.name.localeCompare(b.info.name))
  })
  const reviewCategorySum = computed(() => reviewCategoryRows.value.reduce((total, row) => total + row.value, 0))
  const visibleCategoryRows = computed(() => {
    const rows = reviewCategoryRows.value
    if (showAllReviewCats.value || rows.length <= REVIEW_CATEGORY_LIMIT) return rows
    const head = rows.slice(0, REVIEW_CATEGORY_LIMIT)
    // 展开中的分类即使排在第 5 名之外也要留在列表里，否则「点开的内容」会跟着行一起被截掉。
    if (!expandedCategory.value || head.some((row) => row.key === expandedCategory.value)) return head
    const pinned = rows.find((row) => row.key === expandedCategory.value)
    return pinned ? [...head, pinned] : head
  })
  const hiddenCategoryCount = computed(() => Math.max(0, reviewCategoryRows.value.length - visibleCategoryRows.value.length))
  // 换月/换视图时收起下钻：上个月展开的分类在这个月可能根本没有记录。
  function resetReviewCategoryView() {
    expandedCategory.value = ''
    showAllReviewCats.value = false
  }
  function toggleReviewCategory(key) {
    expandedCategory.value = expandedCategory.value === key ? '' : key
  }
  // 只展开、不收起：给「花得最多」这类入口用（再点一次不该把刚打开的内容收掉）。
  function revealReviewCategory(key) {
    expandedCategory.value = key
  }
  // 首页「本月分类」的一行 → 回顾页该分类的明细。
  // 首页那一块永远是「本月」，而回顾页可以被翻到任意月份，所以这里必须把月份拨回本月，
  // 否则会打开另一个月里同名分类的明细（用户以为自己点的是首页看到的那个数字）。
  function openReviewCategoryFromHome(key) {
    resetReviewCategoryView()
    reviewMonth.value = ledgerToday().slice(0, 7)
    selectedDay.value = null
    expandedCategory.value = key
    tab.value = 'review'
  }
  // 口径说明：这个月有分摊时才出现，讲清「上方每个数字都是我的份额」。
  const reviewMyShare = computed(() => personalSpendTotals(expenses.value, {
    dateFilter: (date) => String(date ?? '').slice(0, 7) === reviewMonth.value,
  }))
  const reviewMyShareNote = computed(() => (reviewMyShare.value.splitCount
    ? `本月有 ${reviewMyShare.value.splitCount} 笔分摊，合计、分类、月历与最大一笔都按「我承担」的份额统计`
    : ''))

  // 最多显示 12 个月，额外取前一个月供环比使用；所有月份仍共用一次流水扫描。
  const reviewTrendMonths = computed(() => {
    const monthKeys = Array.from({ length: 13 }, (_, index) => shiftTrendMonth(trendEndMonth.value, index - 12)).filter(Boolean)
    const summaries = summarizeLedgerMonthsInBase(expenses.value, fx.value, monthKeys, { amountOf: mySpendYuan })
    return monthKeys.map((monthKey) => {
      const summary = summaries.get(monthKey)
      if (!summary) throw new Error(`趋势汇总缺少月份：${monthKey}`)
      return {
        month: monthKey,
        expense: summary.expenseTotal,
        income: summary.incomeTotal,
        count: summary.count,
        base: summary.base,
        ratesUpdatedAt: summary.ratesUpdatedAt,
        hasForeign: summary.hasForeign,
        missingRates: summary.missingRates,
        excludedCount: summary.excludedCount,
      }
    })
  })

  // 月历点迹
  const calendarCells = computed(() => {
    const [y, m] = reviewMonth.value.split('-').map(Number)
    const first = new Date(Date.UTC(y, m - 1, 1))
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const lead = (first.getUTCDay() + 6) % 7 // 周一开头
    const cells = []
    for (let i = 0; i < lead; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const day = monthlyReview.value.dayTotals.get(d)
      cells.push({ day: d, ...(day ? { count: day.count, total: day.total, excludedCount: day.excludedCount } : { count: 0, total: 0, excludedCount: 0 }) })
    }
    return cells
  })
  const selectedDay = ref(null)
  const selectedDayInfo = computed(() => {
    if (!selectedDay.value || !isValidDateKey(`${reviewMonth.value}-${String(selectedDay.value).padStart(2, '0')}`)) return null
    const day = monthlyReview.value.dayTotals.get(selectedDay.value)
    const items = monthlyReview.value.dayItems.get(selectedDay.value) ?? []
    return {
      label: `${parseInt(reviewMonth.value.slice(5), 10)}月${selectedDay.value}日`,
      count: items.length,
      total: day?.total ?? 0,
      excludedCount: day?.excludedCount ?? 0,
      items,
    }
  })

  return {
    reviewMonth,
    shiftMonth,
    jumpToMonth,
    reviewLabel,
    monthlyReview,
    reviewTotal,
    reviewCount,
    mostFrequent,
    topCategory,
    maxSingle,
    maxSingleMine,
    REVIEW_CATEGORY_LIMIT,
    expandedCategory,
    showAllReviewCats,
    reviewCategoryRows,
    reviewCategorySum,
    visibleCategoryRows,
    hiddenCategoryCount,
    resetReviewCategoryView,
    toggleReviewCategory,
    revealReviewCategory,
    openReviewCategoryFromHome,
    reviewMyShareNote,
    reviewTrendMonths,
    trendEndMonth,
    earliestTrendMonth,
    setTrendEndMonth,
    calendarCells,
    selectedDay,
    selectedDayInfo,
  }
}
