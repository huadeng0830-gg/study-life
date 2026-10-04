/**
 * 账本首页的**筛选条件**与**信息流派生**（从 LedgerView.vue 拆出）。
 *
 * 这里是首页两个正交问题的唯一出处：
 *   1. 「用户现在在看哪些记录」——一组可写的筛选 ref + 由它们算出的 `filteredExpenses`；
 *   2. 「这些记录怎么摆上屏」——按日聚合的日期头、前 10 条截断、金额/副标题的格式化。
 * 拆出来之后 LedgerView 只持有这些 ref 并把它们绑到首页面板上，口径仍然只有一份。
 *
 * 依赖通过参数进来（`onFilterChange`）而不是把 closeSwipe 之类页面级状态耦合进来：
 * 换筛选条件时要清掉「已展开全部」并收起滑动手势，这两件事属于页面，不属于数据。
 */
import { computed, ref, watch } from 'vue'
import {
  buildLedgerFeedItems,
  catInfo,
  filterLedgerTransactions,
  isDateInLedgerRange,
  ledgerIndex,
} from '../ledger.js'
import { mySpendCents, normalizeSplit } from '../ledgerSplit.js'
import { transactionSwipeActions } from '../ledgerSwipe.js'
import { moneyWithCurrency } from '../../utils/formatters.js'
import { appToday } from '../timeContext.js'
import { useDebouncedRef } from '../useDebouncedRef.js'

const ledgerToday = () => appToday.value

export function useLedgerFeed({ onFilterChange = () => {} } = {}) {
  // 搜索词与查询解耦：输入框绑 q（打字立刻有反馈），真正的整表扫描只跑在
  // debouncedQ 上。账本搜索一次要连过三遍（过滤 → 按日汇总 → 造列表项），
  // 每敲一个字就跑一遍在流水变多之后是能看见的卡顿。
  // 其余筛选都是点选而不是连续输入，所以照旧直接驱动。
  const q = ref('')
  const debouncedQ = useDebouncedRef(q, 160)
  const showFilters = ref(false)
  const fRange = ref('all') // all | today | week | month | custom
  const fFrom = ref('')
  const fTo = ref('')
  const fCat = ref('')
  const fMin = ref('')
  const fMax = ref('')
  const fAccount = ref('')
  const fKind = ref('all') // all | manual | bill
  const fDirection = ref('all') // all | expense | income

  function inRange(dateStr) {
    return isDateInLedgerRange(dateStr, fRange.value, { today: ledgerToday(), from: fFrom.value, to: fTo.value })
  }

  const filteredExpenses = computed(() => {
    return filterLedgerTransactions(ledgerIndex.value.sortedExpenses, {
      query: debouncedQ.value,
      category: fCat.value,
      account: fAccount.value,
      min: fMin.value,
      max: fMax.value,
      kind: fKind.value,
      direction: fDirection.value,
      dateFilter: inRange,
      categoryName: (key) => catInfo(key).name,
    })
  })

  const filtersActive = computed(() =>
    fRange.value !== 'all' || fCat.value || fAccount.value || fMin.value !== '' || fMax.value !== '' || fKind.value !== 'all' || fDirection.value !== 'all' || fFrom.value || fTo.value
  )
  function clearFilters() {
    fRange.value = 'all'; fFrom.value = ''; fTo.value = ''; fCat.value = ''; fAccount.value = ''; fMin.value = ''; fMax.value = ''; fKind.value = 'all'; fDirection.value = 'all'
  }

  const feedDayTotals = computed(() => {
    const map = new Map()
    for (const item of filteredExpenses.value) {
      const current = map.get(item.date) ?? { expenseCents: 0, incomeCents: 0 }
      // 与列表行同一口径：金额列显示的是「我承担的份额」，日期头的当日支出就必须同源，
      // 否则同一天会出现「行里 ¥40、日期头 ¥200」两个互相矛盾的数字。
      const cents = mySpendCents(item) ?? 0
      if (item.direction === 'income') current.incomeCents += cents
      else if (item.direction === 'refund') current.expenseCents -= cents
      else current.expenseCents += cents
      map.set(item.date, current)
    }
    return new Map([...map.entries()].map(([date, summary]) => [date, {
      expense: summary.expenseCents / 100,
      income: summary.incomeCents / 100,
    }]))
  })
  function feedDaySummary(date) { return feedDayTotals.value.get(date) ?? { expense: 0, income: 0 } }

  // 首页默认只展示最近 10 条；搜索/筛选结果完整展示，点击“查看全部”才展开全部历史。
  const showAllFeed = ref(false)
  const feedTransactions = computed(() => {
    const list = filteredExpenses.value
    const hasQuery = Boolean(q.value.trim()) || filtersActive.value
    return showAllFeed.value || hasQuery ? list : list.slice(0, 10)
  })
  // 第一行日期头是紧凑版（20px），其余 34px。
    // 这里刻意用 VirtualList 传入的绝对 index 判断，而不是构建期写死在
    // item.first 上的位置快照：feed 的 key 是 'day:日期'，不含位置信息，
    // 一旦有更近的一天插到最前面，同 key 的节点会被 Vue 复用，
    // 只有 class 变化 → 行高原地跳 14px。用 index 判定则与行高函数始终一致。
    const feedItemHeight = (item, index) => item?.kind === 'day' ? (index === 0 ? 20 : 34) : 62
  // 交易只在索引构建时做一次便宜的稳定装饰（分类对象、滑动手势动作数组），
  // 滚动重渲染时复用同一引用，避免行组件因新数组引用反复刷新；金额文案等
  // 较重的格式化仍按“可见项”惰性计算，点开“查看全部”不对整库逐条格式化。
  const feedItems = computed(() => buildLedgerFeedItems(feedTransactions.value).map((item) => {
    if (item.kind === 'day') return { ...item, summary: feedDaySummary(item.date) }
    return { ...item, actions: transactionSwipeActions(item.transaction), category: catInfo(item.transaction.cat) }
  }))
  // 分摊标记（**列表副标题**）：列表的金额列现在显示的是「我承担的份额」，
  // 所以这里反过来交代**总额与人数**——两个数字都在，用户不会以为这一笔本来就只花了 40。
  // 未分摊的记录返回空字符串，一个多余的字都不加（旧记录行为完全不变）。
  function splitNote(transaction) {
    const split = normalizeSplit(transaction?.split)
    if (!split) return ''
    return `已分摊 ${split.participants.length} 人 · 共 ${moneyWithCurrency(split.total, transaction.currency)}`
  }
  // 分摊标记（**详情面板**）：详情页顶部的大数字是这一笔的**总额**，
  // 所以这里必须把「我承担多少 + 几个人」一起说清——用户要的两个口径在这一屏上都在。
  function splitDetailNote(transaction) {
    const split = normalizeSplit(transaction?.split)
    if (!split) return ''
    const mineCents = mySpendCents(transaction)
    if (mineCents === null) return '已分摊'
    return `已分摊 ${split.participants.length} 人 · 我承担 ${moneyWithCurrency(mineCents / 100, transaction.currency)}（上方是总额）`
  }
  /**
   * 账本页「这一条显示/计入多少钱」的唯一出处：我的实际承担额
   * （有分摊取 `split.mine`，否则就是记录金额本身）。
   *
   * 首页列表、日期头、分类条、回顾页与导出都用它，保证同一屏上不会出现两个口径混用；
   * 记录自己的**总额**只出现在三处：列表副标题、记录详情、导出的「金额」列。
   */
  function personalAmount(item) {
    const cents = mySpendCents(item)
    return cents === null ? item.amount : cents / 100
  }
  const feedSecondary = (transaction, category) =>
    [
      `${transaction.direction === 'income' ? '收入' : transaction.direction === 'refund' ? '退款' : category.name} · ${transaction.time || '当天'}${transaction.source === 'bill' ? ' · 固定账单' : transaction.direction === 'refund' ? ' · 冲抵原支出' : ''}`,
      splitNote(transaction),
    ].filter(Boolean).join(' · ')
  // 金额按记录自己的币种显示；没有 currency 的旧记录（= 基准币种）输出的仍是原来的 ¥xx.xx。
  // 分摊记录显示的是**我承担的份额**（`split.mine`），不是这一笔的总额：
  // 账本首页回答的是「我花了多少」，总额由副标题的「已分摊 N 人 · 共 ¥xx」交代。
  const feedAmount = (transaction) => {
    const amount = personalAmount(transaction)
    return `${transaction.direction === 'income' || transaction.direction === 'refund' ? '+' : '-'}${moneyWithCurrency(amount, transaction.currency)}`
  }
  const canExpandFeed = computed(() => !showAllFeed.value && !q.value.trim() && !filtersActive.value && filteredExpenses.value.length > feedTransactions.value.length)

  // 换筛选条件 ⇒ 收起「查看全部」与滑动手势（原来写在页面里，随这段一起搬来）。
  //
  // 这里只能调 onFilterChange：closeSwipe 是页面级状态，本模块没有、也不该有它。
  // 之前误写成 closeSwipe()，于是用户第一次搜索或改筛选就抛 ReferenceError，
  // 被全局 errorHandler 兜成「页面遇到一个小问题 / 重新加载」，滑动菜单也永远收不起来。
  //
  // 监听 debouncedQ 而不是 q：与查询本身同一口径，否则会出现「结果还是旧的、
  // 但手势已经收起来了」这种中间态。
  watch([debouncedQ, fRange, fFrom, fTo, fCat, fAccount, fMin, fMax, fKind, fDirection], () => {
    showAllFeed.value = false
    onFilterChange()
  })

  return {
    q,
    showFilters,
    fRange,
    fFrom,
    fTo,
    fCat,
    fMin,
    fMax,
    fAccount,
    fKind,
    fDirection,
    filteredExpenses,
    filtersActive,
    clearFilters,
    showAllFeed,
    feedItems,
    feedItemHeight,
    splitDetailNote,
    personalAmount,
    feedSecondary,
    feedAmount,
    canExpandFeed,
  }
}
