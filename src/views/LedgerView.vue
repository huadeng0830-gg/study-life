<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PromptDialog from '../components/PromptDialog.vue'
import VirtualList from '../components/VirtualList.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import Toast from '../components/Toast.vue'
import { useStoredRef } from '../composables/store'
import { ledgerTabFromQuery } from '../composables/routeState.js'
import {
  activeCategories,
  catInfo,
  categoriesForScope,
  commonCategories,
  computeFrequentFromIndex,
  detectCategory,
  expenses,
  freqPrefs,
  ledgerIndex,
  ledgerCategories,
  amountToCents,
  buildLedgerMonthReview,
  buildLedgerFeedItems,
  filterLedgerTransactions,
  isDateInLedgerRange,
  isRefundTransaction,
  isValidDateKey,
  normalizeAmount,
  parseNatural,
  rememberCategoryOverride,
} from '../composables/ledger.js'
import { dayLabel, moneyHero, moneyRow, moneyWithCurrency, pad2 } from '../utils/formatters.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { defaultAccount, policyDateTime, policyTimeKey, timestampOf } from '../composables/settingsPolicy.js'
import QuickRecordPanel from '../components/QuickRecordPanel.vue'
import { appNow, appToday, formatAppDate } from '../composables/timeContext.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'
import { transactionSwipeActions } from '../composables/ledgerSwipe.js'
import { useTabKeys } from '../composables/tabKeys.js'
import { isBillPayment } from '../composables/ledgerRelations.js'
// 本轮新增的四个功能各自一个模块：多币种汇率 / 预算预警 / 账单模板 / 报销分摊。
// 它们都只提供纯函数与新选择器，既有汇总路径（buildLedgerIndex 等）一行都没改。
import {
  COMMON_LEDGER_CURRENCIES,
  currencyChoices,
  fxRateNote,
  normalizeCurrency,
  normalizeLedgerFx,
  sumLedgerMonthInBase,
  useLedgerFx,
} from '../composables/ledgerFx.js'
import { budgetAlertText, budgetStatus, useLedgerBudget } from '../composables/ledgerBudget.js'
import { templateToBillForm, useLedgerTemplateCommands } from '../composables/ledgerTemplates.js'
import { buildSplit, hasSplit, mySpendCents, mySpendYuan, normalizeSplit, personalMonthCategoryTotals, personalSpendTotals, splitCentsEvenly } from '../composables/ledgerSplit.js'

// 懒加载分区面板：仅在切到对应分区时才加载代码，首屏体积大幅降低
const LedgerHomePanel = defineAsyncComponent(() => import('./ledger-panels/LedgerHomePanel.vue'))
const BillsPanel = defineAsyncComponent(() => import('./ledger-panels/BillsPanel.vue'))
const ReviewPanel = defineAsyncComponent(() => import('./ledger-panels/ReviewPanel.vue'))

const bills = useStoredRef('sl_bills', [])
const domain = useDomainCommands()
const route = useRoute()
const router = useRouter()

const tab = ref('ledger') // ledger | bills | review
// 账本分区的键盘模型：←/→ 在三个分区之间移动、Home/End 直达两端（APG automatic activation）。
const { onKeydown: onLedgerTabKeydown, tabIndexFor: ledgerTabIndex } = useTabKeys({
  keys: ['ledger', 'bills', 'review'],
  active: () => tab.value,
  select: (key) => {
    tab.value = key
  },
})
const deleteBillTarget = ref(null)
const openSwipeId = ref('')
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })
function closeSwipe() {
  openSwipeId.value = ''
}
function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}
const ledgerToday = () => appToday.value
const ledgerNowHM = () => policyTimeKey(appNow.value)

// 允许“今天”等聚合入口精确打开固定账单或回顾，不改变默认账本入口。
watch(() => route.query.tab, (value) => {
  tab.value = ledgerTabFromQuery(value)
  closeSwipe()
}, { immediate: true })

// 把"实际生效的分区"写回 URL。两个方向共用它：
//   - 路由参数变了 → 由下面的 query watcher 调用；
//   - 用户点了/用键盘切了分区 → 由 tab watcher 调用。
// 只挂在 tab 上是不够的：?tab=zzz 这种脏参数会被读侧映射成 ledger，
// 于是 tab 从头到尾没变过，写回就永远不会触发，脏参数留在地址栏里骗人。
function syncTabToQuery() {
  const desired = tab.value === 'ledger' ? undefined : tab.value
  if (route.query.tab === desired) return
  const query = { ...route.query }
  if (desired === undefined) delete query.tab
  else query.tab = desired
  void router.replace({ path: route.path, query })
}

// 允许“今天”等聚合入口精确打开固定账单或回顾，不改变默认账本入口。
// 读取侧：URL 决定分区。顺带把生效后的分区调和回 URL（含清掉看不懂的参数）。
watch(() => route.query.tab, (value) => {
  tab.value = ledgerTabFromQuery(value)
  closeSwipe()
  syncTabToQuery()
}, { immediate: true })

// 写入侧：点分区 / 用方向键切分区，地址栏都要跟着变。
// 用 replace 而不是 push：切换分区属于页内状态，不该在历史里堆一层，
// 否则手机返回键要先把三个分区倒着走一遍才能真正离开账本页。
// 默认分区不带参数（保持 URL 干净）。
watch(tab, syncTabToQuery)

/* ================= 通用 ================= */
// 金额/时间/日期标签格式化统一走 utils/formatters.js.

/* ================= 账本首页 ================= */
const q = ref('')
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
    query: q.value,
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
function flashTransaction(id) {
  highlightedTransactionId.value = String(id)
  window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => { highlightedTransactionId.value = '' }, 2600)
}
function startDetailEdit(id) {
  const target = expenses.value.find((item) => String(item.id) === String(id))
  if (!target) return
  openDetail(target.id)
  detailAmountInput.value = String(target.amount ?? '')
  detailCategoryInput.value = target.cat || ''
  detailDateInput.value = target.date || ledgerToday()
  detailCurrencyInput.value = normalizeCurrency(target.currency) || baseCurrency.value
  detailEdit.value = true
  nextTick(() => document.querySelector('.detail-edit-amount')?.focus())
}
function undoBillPaymentById(id) {
  const target = expenses.value.find((item) => String(item.id) === String(id))
  if (!target) return
  const undone = domain.undoBillPayment(target.id)
  if (undone?.blocked) {
    showToast(undone.reason)
    return
  }
  if (!undone) return
  closeSwipe()
  if (String(detailItem.value) === String(target.id)) closeDetail()
  showToast(`已撤销本期账单支付 · ${moneyRow(undone.amount)}`)
}
function deleteTransactionById(id) {
  const target = expenses.value.find((item) => String(item.id) === String(id))
  if (!target) return
  const snapshot = { ...target }
  const deleted = domain.deleteTransaction(target.id)
  if (deleted?.blocked) {
    showToast(deleted.reason)
    return
  }
  if (!deleted) return
  closeSwipe()
  if (String(detailItem.value) === String(target.id)) closeDetail()
  // 注意：showToast 的第二个参数是 options 对象。
  // 这里原来直接传函数，解构后 actionLabel 落回空字符串，
  // Toast 的 v-if="actionLabel" 为假 → 「撤销」按钮根本不渲染。
  showToast(`已删除 ${moneyRow(snapshot.amount)} · ${snapshot.name}`, {
    actionLabel: '撤销',
    undoFn: () => {
      domain.restoreDeletedTransaction(snapshot)
    },
  })
}
function onTransactionSwipe(id, direction) {
  if (direction === 'left') openSwipeId.value = String(id)
}
function onSwipeOpenChange(id, open) {
  const key = String(id)
  if (open) openSwipeId.value = key
  else if (openSwipeId.value === key) closeSwipe()
}
function onTransactionSwipeAction(id, action) {
  closeSwipe()
  if (action === 'edit') startDetailEdit(id)
  else if (action === 'delete') deleteTransactionById(id)
  else if (action === 'undo-bill') undoBillPaymentById(id)
}
watch([q, fRange, fFrom, fTo, fCat, fAccount, fMin, fMax, fKind, fDirection], () => {
  showAllFeed.value = false
  closeSwipe()
})
const highlightedTransactionId = ref('')
const focusedBillId = ref('')
const focusMessage = ref('')
let highlightTimer = 0
let transactionFocusHandled = ''
let billFocusHandled = ''
async function highlightTransaction(id) {
  if (!id) return
  if (transactionFocusHandled === String(id)) return
  transactionFocusHandled = String(id)
  closeSwipe()
  flashTransaction(id)
  showAllFeed.value = true
  await nextTick()
  const element = await focusElementWhenReady(id, { scroll: false })
  if (!element) focusMessage.value = '这条交易可能已删除或已移动。'
  await clearFocusFromRoute(router, route)
}
async function focusBill() {
  const { id, section } = readFocusQuery(route)
  if (!id || section !== 'bill' || billFocusHandled === id) return
  billFocusHandled = id
  tab.value = 'bills'
  const bill = bills.value.find((item) => String(item.id) === id)
  if (!bill) {
    focusMessage.value = '这条账单可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
    return
  }
  focusedBillId.value = id
  await nextTick()
  const element = await focusElementWhenReady(id)
  if (!element) focusMessage.value = '这条账单可能已删除或已移动。'
  await clearFocusFromRoute(router, route)
}
watch(
  () => [route.query.focus, route.query.section, feedItems.value.length, bills.value.length],
  () => {
    if (route.query.section === 'bill') void focusBill()
    else if (route.query.focus) void highlightTransaction(route.query.focus)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  window.clearTimeout(highlightTimer)
  // 这里原本还 clearTimeout(toastTimer)，但本文件从未声明过它 →
  // 卸载时会抛 ReferenceError，导致下面两个 removeEventListener 永远执行不到，
  // scroll/blur 监听器跟着泄漏。Toast 自己的定时器由 Toast.vue 的
  // onBeforeUnmount(hide) 负责清理，不需要这里再管。
  window.removeEventListener('scroll', closeSwipe)
  window.removeEventListener('blur', closeSwipe)
})
onMounted(() => {
  window.addEventListener('scroll', closeSwipe, { passive: true })
  window.addEventListener('blur', closeSwipe)
})

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

// 退款的处理刻意与**改建前的全额口径逐条对齐**，避免顺手改掉与分摊无关的行为：
//   - 今天/本周：只累加支出（旧的 `dayTotals` 本来就不含退款）；
//   - 本月：支出 − 退款（旧的 `monthStats.total` 就是这么算的）。
function mySpendStats(list, { dateFilter = null } = {}) {
  let todayCents = 0, weekCents = 0, monthCents = 0, monthRefundCents = 0
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
      if (inMonth) monthRefundCents += cents
      continue
    }
    if (item.date === today) todayCents += cents
    if (inMonth) monthCents += cents
    if (weekKeys.has(item.date)) weekCents += cents
  }
  return {
    today: todayCents / 100,
    week: weekCents / 100,
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

/* ================= 多币种汇率（手工维护，不联网） ================= */
// 汇率与预算都是页面侧的新 computed：既有的 monthStats / spendStats 一行没改。
const { fx, saveFx } = useLedgerFx()
const showFxSettings = ref(false)
const fxDraft = ref([]) // [{ code, rate }] 弹窗内的草稿；点保存才写回 sl_ledger_fx
const fxNewCode = ref('')
const fxError = ref('')
const baseCurrency = computed(() => normalizeLedgerFx(fx.value).base)
// 表单币种 → 记录字段：基准币种一律落成空字符串（= 不写字段），
// 与「旧记录没有 currency 就是基准币种」的约定完全一致，不给数据添无意义的字段。
function currencyField(code) {
  const normalized = normalizeCurrency(code)
  return normalized === baseCurrency.value ? '' : normalized
}
// 已经设了汇率的币种不再出现在「添加币种」候选里。
const fxAddableCurrencies = computed(() => {
  const configured = new Set(Object.keys(normalizeLedgerFx(fx.value).rates))
  return COMMON_LEDGER_CURRENCIES.filter((code) => !configured.has(code) && code !== baseCurrency.value)
})
// 当月支出的「基准币种」口径：没有非基准币种记录时，它与本月花费完全相等（同一套分口径）。
// 逐条先取「我承担的份额」再按汇率折成基准币种，所以这行折算说明与 hero 的三块数字、
// 以及下面的预算预警永远同一个口径（外币 + 分摊同时存在时也不会各算各的）。
const baseMonthSummary = computed(() => sumLedgerMonthInBase(expenses.value, fx.value, ledgerToday().slice(0, 7), { amountOf: mySpendYuan }))
const fxRateLine = computed(() => fxRateNote(baseMonthSummary.value))

function openFxSettings() {
  fxDraft.value = Object.entries(normalizeLedgerFx(fx.value).rates).map(([code, rate]) => ({ code, rate: String(rate) }))
  fxNewCode.value = ''
  fxError.value = ''
  showFxSettings.value = true
}
function addFxRow() {
  const code = normalizeCurrency(fxNewCode.value)
  if (!code) { fxError.value = '币种代码需为三位字母，例如 USD'; return }
  if (code === baseCurrency.value) { fxError.value = '基准币种的汇率固定为 1，不需要设置'; return }
  if (fxDraft.value.some((row) => row.code === code)) { fxError.value = `${code} 已经在列表里了`; return }
  fxDraft.value = [...fxDraft.value, { code, rate: '' }]
  fxNewCode.value = ''
  fxError.value = ''
}
function removeFxRow(code) {
  fxDraft.value = fxDraft.value.filter((row) => row.code !== code)
}
function commitFxSettings() {
  const rates = {}
  for (const row of fxDraft.value) {
    const value = Number(String(row.rate).trim())
    if (!Number.isFinite(value) || value <= 0) { fxError.value = `${row.code} 的汇率需为大于 0 的数字`; return }
    rates[row.code] = value
  }
  saveFx({ ...normalizeLedgerFx(fx.value), rates })
  showFxSettings.value = false
  showToast(`已保存 ${Object.keys(rates).length} 个币种的汇率（手工维护，不联网）`)
}

/* ================= 月度预算与超支预警 ================= */
// 只做月度总额预算（见 ledgerBudget.js 的说明），落点是 hero-stat 里紧邻 hero-compare 的一行提示。
const { budget, saveBudget, clearBudget } = useLedgerBudget()
const showBudgetSettings = ref(false)
const budgetInput = ref('')
const budgetError = ref('')
const budgetAlert = computed(() => {
  const status = budgetStatus({ spent: baseMonthSummary.value.expenseTotal, budget: budget.value.monthly })
  if (!status.set) return null
  return {
    ...status,
    text: budgetAlertText(status, { base: baseMonthSummary.value.base, converted: baseMonthSummary.value.hasForeign }),
  }
})
function openBudgetSettings() {
  budgetInput.value = budget.value.monthly === null ? '' : String(budget.value.monthly)
  budgetError.value = ''
  showBudgetSettings.value = true
}
function commitBudget() {
  try {
    saveBudget(budgetInput.value)
  } catch (cause) {
    budgetError.value = cause?.message || '预算需为大于 0 的数字'
    return
  }
  showBudgetSettings.value = false
  showToast(`月度预算已设为 ${moneyWithCurrency(budget.value.monthly, baseCurrency.value)}`)
}
function removeBudget() {
  clearBudget()
  showBudgetSettings.value = false
  showToast('已清除月度预算，首页不再显示预算提示')
}

/* ---------- 账单导出（按月，人类可读） ---------- */
// 「币种」放在「金额」后面：金额列的语义仍是记录原值（不折算、不换算），
// 但必须紧跟着单位，否则一笔 100 USD 导出成孤零零的 `100` 会被读成 100 元。
// 基准币种的记录写的也是基准币种代码，所以老数据导出后不会出现空列。
//
// 「我承担」紧挨着「金额」：导出的 CSV/Excel 里两个口径都在——
// 金额 = 这一笔的总额（记录原值），我承担 = 这一笔里我实际承担多少（无分摊时两者相等）。
// 分摊只影响「我承担」这一列，金额列与既有导出一字不差，老表格脚本不会被打断。
const EXPORT_COLUMNS = ['日期', '时间', '名称', '分类', '收支', '金额', '我承担', '币种', '账户', '备注']
function ledgerExportRows() {
  const month = reviewMonth.value
  return expenses.value
    .filter((item) => item && !item.archivedAt && !item.deletedAt && !item.tombstone && String(item.date ?? '').slice(0, 7) === month)
    .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))
    .map((item) => ({
      '日期': item.date,
      '时间': item.time || '',
      '名称': item.name,
      '分类': catInfo(item.cat).name,
      '收支': item.direction === 'income' ? '收入' : item.direction === 'refund' ? '退款' : '支出',
      '金额': item.amount,
      '我承担': personalAmount(item),
      '币种': normalizeCurrency(item.currency) || baseCurrency.value,
      '账户': item.account || '',
      '备注': item.note || '',
    }))
}
function downloadLedgerFile(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
function exportLedgerCsv() {
  const rows = ledgerExportRows()
  if (!rows.length) { showToast('该月还没有可导出的记录'); return }
  const lines = [EXPORT_COLUMNS.join(',')].concat(
    rows.map((row) => EXPORT_COLUMNS.map((col) => csvCell(row[col])).join(','))
  )
  downloadLedgerFile(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `账单-${reviewMonth.value}.csv`)
  showToast(`已导出 ${rows.length} 条账单 CSV`)
}
async function exportLedgerXlsx() {
  const rows = ledgerExportRows()
  if (!rows.length) { showToast('该月还没有可导出的记录'); return }
  const XLSX = await import('@e965/xlsx')
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '账单')
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  downloadLedgerFile(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `账单-${reviewMonth.value}.xlsx`)
  showToast(`已导出 ${rows.length} 条账单 Excel`)
}
const allActiveCategories = computed(() => [...activeCategories('expense'), ...activeCategories('income')])
const accountOptions = computed(() => [...new Set(ledgerIndex.value.sortedExpenses
  .map((item) => String(item?.account ?? '').trim())
  .filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const categoryOverview = computed(() => {
  // 与 hero 的「本月承担」同源：分类条回答的也是「我的钱花到哪去了」，
  // 用全额分类合计会让同一屏上出现「本月承担 ¥40 / 其它 ¥200」这种自相矛盾。
  const total = mySpendPeriodStats.value.month || 1
  return [...personalMonthCategoryTotals(expenses.value, ledgerToday()).entries()]
    .map(([key, value]) => ({ key, info: catInfo(key), value, pct: Math.round((value / total) * 100) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
})
// 卡片上只放前 5 名（首页要短），但「还有几个分类没显示」必须说出来，
// 否则用户会把前 5 名当成全部（旧版连这句提示都没有，第 6 名以后是隐形的）。
const monthCategoryKeys = computed(() => [...personalMonthCategoryTotals(expenses.value, ledgerToday()).keys()])

/* ---------- 常记 ---------- */
const frequent = computed(() => computeFrequentFromIndex(ledgerIndex.value, freqPrefs.value))

function useFrequent(item) {
  openQuick({ name: item.name, amount: String(item.amount || ''), cat: item.cat })
}

/* ---------- 记一笔（快速弹窗） ---------- */
const showQuick = ref(false)
const showQuickRecord = ref(false)
const editingId = ref(null)
const moreOpen = ref(false)
const amountInput = ref('')
const nameInput = ref('')
const catInput = ref('')
const dateInput = ref('')
const timeInput = ref('')
const noteInput = ref('')
const accountInput = ref('')
const sourceInput = ref('manual')
const billIdInput = ref('')
const amountEl = ref(null)
const dupWarn = ref(false)
const forceDup = ref(false)
const keepAdding = ref(false)
const savingExpense = ref(false)
const directionInput = ref('expense')
const cycleSuggest = ref(null) // { kind, day }
const suggestedCategoryInput = ref('')
const categoryInputManuallySelected = ref(false)
const showAllQuickCategories = ref(false)
// ---------- 多币种 + 报销分摊（记一笔表单） ----------
// 币种默认基准币种；旧记录没有 currency，进编辑时也回落到基准币种。
const currencyInput = ref('')
const currencyOptions = computed(() => currencyChoices(fx.value, [currencyInput.value]))
// 分摊：始终显示人数输入（默认 1 人），自动计算「我承担」= 总额 ÷ 人数（两位小数，余数归我）。
// 记账时将「我承担」写入 split.mine，汇总口径用 mySpendCents 读取（有分摊则取 mine，否则取 amount）。
const splitCount = ref('1')
const splitMine = ref('')

function resetSplitState() {
  splitCount.value = '1'
  splitMine.value = ''
}
// 返回 { split } 或 { error }：校验失败时给出可读原因，UI 直接展示。
function draftSplit() {
  try {
    return { split: buildSplit(amountInput.value, { count: splitCount.value, mine: splitMine.value }) }
  } catch (cause) {
    return { error: cause?.message || '分摊数据不合法' }
  }
}
const splitPreview = computed(() => {
  const draft = draftSplit()
  if (draft.error) return draft.error
  const people = Math.trunc(Number(splitCount.value)) || 1
  const mine = draft.split.mine
  const others = draft.split.total - mine
  return people === 1
    ? `单人承担 ${moneyWithCurrency(mine, currencyInput.value)}`
    : `共 ${people} 人：我承担 ${moneyWithCurrency(mine, currencyInput.value)}，其余 ${moneyWithCurrency(others, currencyInput.value)}`
})
// 金额/人数变化时自动把我的份额算成等分（余数归第一位 = 我），保留两位小数。
function syncSplitMine() {
  const totalCents = amountToCents(amountInput.value)
  const people = Math.trunc(Number(splitCount.value))
  if (totalCents === null || !Number.isFinite(people) || people < 1) { splitMine.value = ''; return }
  splitMine.value = String(splitCentsEvenly(totalCents, people)[0] / 100)
}
// 去掉开关：金额或人数一变就同步算「我承担」
function onSplitChange() {
  syncSplitMine()
}

function openQuick(prefill = {}) {
  editingId.value = prefill.id ?? null
  amountInput.value = prefill.amount ?? ''
  nameInput.value = prefill.name ?? ''
  catInput.value = prefill.cat ?? ''
  suggestedCategoryInput.value = ''
  categoryInputManuallySelected.value = Boolean(prefill.cat)
  showAllQuickCategories.value = false
  dateInput.value = prefill.date ?? ledgerToday()
  timeInput.value = prefill.time ?? ledgerNowHM()
  noteInput.value = prefill.note ?? ''
  accountInput.value = prefill.account ?? defaultAccount()
  directionInput.value = prefill.direction ?? prefill.type ?? 'expense'
  sourceInput.value = prefill.source ?? 'manual'
  billIdInput.value = prefill.billId ?? ''
  // 币种：编辑既有记录时沿用记录里的币种；新记录默认基准币种。
  currencyInput.value = normalizeCurrency(prefill.currency) || baseCurrency.value
  // 分摊：编辑既有记录时回填人数/我承担；新记录默认 1 人，自动算我承担。
  const hasExistingSplit = hasSplit(prefill)
  splitCount.value = String(prefill.split?.participants?.length || 1)
  splitMine.value = hasExistingSplit ? String(prefill.split?.mine ?? '') : ''
  if (!hasExistingSplit) syncSplitMine()
  moreOpen.value = Boolean(prefill.id) || Boolean(prefill.expandMore)
  dupWarn.value = false
  forceDup.value = false
  cycleSuggest.value = null
  keepAdding.value = false
  showQuick.value = true
  nextTick(() => amountEl.value?.focus())
}

function openQuickRecord() {
  showQuickRecord.value = true
}

function closeQuickRecord() {
  showQuickRecord.value = false
}

function onQuickRecordSaved(payload) {
  showToast(payload.message, {
    actionLabel: payload.undo ? '撤销' : '',
    undoFn: payload.undo ?? null,
    viewFn: payload.entityType === 'transaction' ? () => highlightTransaction(payload.entityId) : null,
    duration: 6000,
  })
  closeQuickRecord()
}

function setDirection(direction) {
  directionInput.value = direction
  const validCategory = activeCategories(direction).some((category) => category.key === catInput.value)
  if (categoryInputManuallySelected.value && validCategory) return
  categoryInputManuallySelected.value = false
  const name = parseNatural(nameInput.value).name || nameInput.value.trim()
  suggestedCategoryInput.value = name ? detectCategory(name, { direction }) : ''
  catInput.value = suggestedCategoryInput.value
}

function onNameInput() {
  dupWarn.value = false
  forceDup.value = false
  if (editingId.value) return
  const parsed = parseNatural(nameInput.value)
  // 「午饭 18」→ 金额填入 18，名称剥离数字尾巴（识别成功才改写，避免误伤普通名称）
  if (parsed.amount && amountInput.value === '' && parsed.name && parsed.name !== nameInput.value) {
    nameInput.value = parsed.name
  }
  if (parsed.amount && amountInput.value === '') amountInput.value = parsed.amount
  if (parsed.cycle && !catInput.value) cycleSuggest.value = parsed.cycle
  if (!catInput.value && parsed.name) {
    suggestedCategoryInput.value = detectCategory(parsed.name || nameInput.value, { direction: directionInput.value })
    catInput.value = suggestedCategoryInput.value
    categoryInputManuallySelected.value = false
  }
}

const quickCatChips = computed(() => {
  const scope = directionInput.value === 'income' ? 'income' : 'expense'
  const actives = activeCategories(scope)
  const recent = []
  for (const expense of ledgerIndex.value.sortedExpenses) {
    if ((expense.direction || 'expense') !== scope || recent.includes(expense.cat)) continue
    recent.push(expense.cat)
    if (recent.length >= 4) break
  }
  const preferred = showAllQuickCategories.value
    ? actives
    : [...recent.map((key) => actives.find((category) => category.key === key)).filter(Boolean), ...commonCategories(scope)]
  const unique = [...new Map(preferred.map((category) => [category.key, category])).values()]
  if (catInput.value && !unique.some((c) => c.key === catInput.value)) {
    const hidden = ledgerCategories.value.find((c) => c.key === catInput.value && (c.scope || 'expense') === scope)
    if (hidden) unique.unshift(hidden)
  }
  return showAllQuickCategories.value ? unique : unique.slice(0, 8)
})

function selectQuickCategory(key) {
  catInput.value = catInput.value === key ? '' : key
  categoryInputManuallySelected.value = true
}

const duplicateHit = computed(() => {
  if (forceDup.value || editingId.value) return false
  const amt = normalizeAmount(amountInput.value)
  const nm = nameInput.value.trim()
  if (amt === null || !nm) return false
  return expenses.value.some(
    (e) => e.name.trim() === nm && normalizeAmount(e.amount) === amt && Date.now() - timestampOf(e.createdAt) < 2 * 60 * 1000
  )
})

async function saveExpense(keepOpen = false) {
  if (savingExpense.value) return
  savingExpense.value = true
  const amount = normalizeAmount(amountInput.value)
  const name = nameInput.value.trim()
  try {
    if (amount === null) { amountEl.value?.focus(); return }
    if (duplicateHit.value) { dupWarn.value = true; return }
    // 支出始终构造 split：人数默认 1，「我承担」= 总额 ÷ 人数（两位小数，余数归我）。
    // 收入不参与分摊。
    let split = null
    if (directionInput.value !== 'income') {
      const draft = draftSplit()
      if (draft.error) { showToast(draft.error); return }
      split = draft.split
    }
    const currency = currencyField(currencyInput.value)
    if (editingId.value) {
      const target = domain.updateTransaction(editingId.value, {
          name, amount, cat: catInput.value || detectCategory(name),
          date: dateInput.value || ledgerToday(), time: timeInput.value || ledgerNowHM(),
          account: accountInput.value.trim(), note: noteInput.value.trim(),
          currency, split,
        })
      if (target) showToast(`已更新 ${moneyRow(amount)} · ${target.name}`)
    } else {
      const saved = domain.createTransaction({ name, amount,
        cat: catInput.value || detectCategory(name),
        direction: directionInput.value,
        date: dateInput.value || ledgerToday(),
        time: timeInput.value || ledgerNowHM(),
        note: noteInput.value.trim(), account: accountInput.value.trim(),
        source: sourceInput.value || 'manual',
        billId: billIdInput.value || '',
        createdFrom: sourceInput.value || 'manual',
        currency, split,
      })
      if (name && categoryInputManuallySelected.value) rememberCategoryOverride(name, saved.cat, directionInput.value)
      showToast(`已记下 ${directionInput.value === 'income' ? '+' : '-'}${moneyRow(amount)} · ${saved.name}`, {
        actionLabel: '撤销',
        undoFn: () => domain.deleteTransaction(saved.id),
        viewFn: () => highlightTransaction(saved.id),
        duration: 6000,
      })
    }
    if (keepOpen) {
      amountInput.value = ''
      nameInput.value = ''
      noteInput.value = ''
      accountInput.value = defaultAccount()
      dateInput.value = ledgerToday()
      timeInput.value = ledgerNowHM()
      catInput.value = ''
      suggestedCategoryInput.value = ''
      categoryInputManuallySelected.value = false
      showAllQuickCategories.value = false
      dupWarn.value = false
      forceDup.value = false
      keepAdding.value = true
      cycleSuggest.value = null
      // 连续记账时币种保留、人数保留，但「我承担」随新金额重新等分。
      currencyInput.value = normalizeCurrency(currencyInput.value) || baseCurrency.value
      splitMine.value = ''
      syncSplitMine()
      nextTick(() => amountEl.value?.focus())
    } else {
      showQuick.value = false
    }
  } catch (cause) {
    showToast(cause?.message || '保存失败，请检查金额和日期')
  } finally {
    savingExpense.value = false
  }
}

function closeQuick() {
  showQuick.value = false
  keepAdding.value = false
  savingExpense.value = false
}

/* ---------- 记录详情 ---------- */
const detailItem = ref(null)
const detailExpense = computed(() => detailItem.value ? expenses.value.find((e) => e.id === detailItem.value) ?? null : null)
const detailEdit = ref(false)
const detailAmountInput = ref('')
const detailCategoryInput = ref('')
const detailDateInput = ref('')
// 币种可以事后修正（例如记成 USD 才发现其实付的是人民币）。
// 分摊刻意不在这里改：它有「各人份额之和 === 总额」的不变量，编辑入口留在记一笔表单里。
const detailCurrencyInput = ref('')

function openDetail(id) {
  detailItem.value = id
  detailEdit.value = false
}
function closeDetail() {
  detailItem.value = null
  detailEdit.value = false
}
function editFromDetail() {
  const e = detailExpense.value
  if (!e) return
  startDetailEdit(e.id)
}
function cancelDetailEdit() {
  detailEdit.value = false
}
function saveDetailEdit() {
  const e = detailExpense.value
  if (!e) return
  const amount = normalizeAmount(detailAmountInput.value)
  if (amount === null) {
    showToast('金额填写有误：不能为空，最多保留两位小数')
    return
  }
  try {
    const updated = domain.updateTransaction(e.id, {
      amount,
      cat: detailCategoryInput.value || 'other',
      date: detailDateInput.value || ledgerToday(),
      currency: currencyField(detailCurrencyInput.value),
    })
    if (!updated) return
    detailEdit.value = false
    closeSwipe()
    flashTransaction(updated.id)
    showToast(`已更新 ${updated.direction === 'income' ? '+' : '-'}${moneyRow(updated.amount)} · ${updated.name}`)
  } catch (cause) {
    showToast(cause?.message || '保存失败，请检查金额和日期')
  }
}
function againFromDetail() {
  const e = detailExpense.value
  if (!e) return
  // 「再记一次」把币种与分摊一起带上：同一笔报销/同一种外币多半会重复发生。
  openQuick({ name: e.name, amount: String(e.amount), cat: e.cat, note: e.note, direction: e.direction, currency: e.currency, split: e.split })
  closeDetail()
}
function undoBillPaymentFromDetail() {
  const e = detailExpense.value
  if (!e) return
  undoBillPaymentById(e.id)
}
function deleteFromDetail() {
  const e = detailExpense.value
  if (!e) return
  deleteTransactionById(e.id)
}
/* ---------- 退款 / 冲正 ---------- */
const showRefund = ref(false)
const refundItem = ref(null)
const refundAmountInput = ref('')
const refundDateInput = ref('')
const refundNoteInput = ref('')

function refundRemaining(item) {
  if (!item) return 0
  const already = expenses.value
    .filter((entry) => isRefundTransaction(entry) && entry.refundOf === item.id && !entry?.archivedAt && !entry?.deletedAt && !entry?.tombstone)
    .reduce((sum, entry) => sum + (amountToCents(entry.amount) ?? 0), 0)
  return Math.max(0, (amountToCents(item.amount) ?? 0) - already) / 100
}
function openRefund() {
  const e = detailExpense.value
  if (!e) return
  refundItem.value = e
  refundAmountInput.value = String(refundRemaining(e))
  refundDateInput.value = ledgerToday()
  refundNoteInput.value = ''
  showRefund.value = true
}
function closeRefund() {
  showRefund.value = false
  refundItem.value = null
}
function confirmRefund() {
  const original = refundItem.value
  if (!original) return
  const result = domain.refundTransaction(original.id, {
    amount: refundAmountInput.value,
    date: refundDateInput.value,
    note: refundNoteInput.value,
  })
  if (result?.blocked) {
    showToast(result.reason)
    return
  }
  if (!result) return
  closeRefund()
  closeDetail()
  flashTransaction(result.id)
  showToast(`已登记退款 ${moneyRow(result.amount)} · 原支出已冲抵`)
}
function togglePinName() {
  const e = detailExpense.value
  if (!e) return
  const name = e.name.trim()
  const prefs = { pinned: [...(freqPrefs.value.pinned ?? [])], hidden: [...(freqPrefs.value.hidden ?? [])] }
  if (prefs.pinned.includes(name)) prefs.pinned = prefs.pinned.filter((n) => n !== name)
  else prefs.pinned.push(name)
  freqPrefs.value = prefs
  showToast(prefs.pinned.includes(name) ? `已固定「${name}」到常记` : `已取消固定「${name}」`)
}
function toggleHideName() {
  const e = detailExpense.value
  if (!e) return
  const name = e.name.trim()
  const prefs = { pinned: [...(freqPrefs.value.pinned ?? [])], hidden: [...(freqPrefs.value.hidden ?? [])] }
  if (prefs.hidden.includes(name)) prefs.hidden = prefs.hidden.filter((n) => n !== name)
  else {
    prefs.hidden.push(name)
    prefs.pinned = prefs.pinned.filter((n) => n !== name)
  }
  freqPrefs.value = prefs
  showToast(prefs.hidden.includes(name) ? `已从常记隐藏「${name}」` : `「${name}」恢复参与常记`)
}

/* ================= 固定账单 ================= */
const CYCLES = {
  weekly: { label: '每周', short: '周', monthFactor: 52 / 12 },
  monthly: { label: '每月', short: '月', monthFactor: 1 },
  quarterly: { label: '每季度', short: '季度', monthFactor: 1 / 3 },
  yearly: { label: '每年', short: '年', monthFactor: 1 / 12 },
}

const showBillForm = ref(false)
const editingBillId = ref(null)
const billForm = ref(emptyBillForm())
const billError = ref('')
// 与 noteErrorField 同一套约定：记录是哪个字段不过，用于 aria-invalid 与焦点回跳。
const billErrorField = ref('')
const billNameInput = ref(null)
const billAmountInput = ref(null)
const billNextDateInput = ref(null)
const billRemindInput = ref(null)
const billFieldRefs = {
  name: billNameInput,
  amount: billAmountInput,
  nextDate: billNextDateInput,
  remindDays: billRemindInput,
}
function setBillError(message, field = '') {
  billError.value = message
  billErrorField.value = message ? field : ''
  // 表单开着的时候输入框一定已挂载，不需要等下一帧。
  if (message && field) billFieldRefs[field]?.value?.focus()
}

function emptyBillForm() {
  return { name: '', amount: '', category: '', cycle: 'monthly', nextDate: '', remindDays: 3, autoRenew: true, active: true, note: '', account: '', currency: '' }
}
function openBillForm(prefill = {}, editing = null) {
  editingBillId.value = editing
  billForm.value = editing
    ? { ...bills.value.find((b) => b.id === editing), ...emptyBillForm(), ...pickBillFields(bills.value.find((b) => b.id === editing)) }
    : { ...emptyBillForm(), ...prefill }
  setBillError('')
  showBillForm.value = true
}
function pickBillFields(b) {
  if (!b) return emptyBillForm()
  return {
    name: b.name ?? '', amount: b.amount ?? '', category: b.category ?? detectCategory(b.name ?? ''), cycle: b.cycle ?? 'monthly',
    nextDate: b.nextDate ?? '', remindDays: b.remindDays ?? 3,
    autoRenew: b.autoRenew !== false, active: b.active !== false, note: b.note ?? '',
    account: b.account ?? '', currency: normalizeCurrency(b.currency) || baseCurrency.value,
  }
}
/* ---------- 账单预设模板（sl_ledger_templates） ---------- */
// 与课程模板同一套形状（useStoredRef + 显式提交 + 中文错误）。
// 这里只负责「套用 / 存为模板 / 删除模板」三个动作，模板内容规范化在 ledgerTemplates.js。
const { templates: billTemplates, saveTemplate: saveBillTemplate, deleteTemplate: deleteBillTemplate } = useLedgerTemplateCommands()
const billTemplateId = ref('')
// 下拉选完立刻复位：否则「先套 A、改了字段、还想再套一次 A」时浏览器不会再触发 change。
watch(billTemplateId, (id) => {
  if (!id) return
  applyBillTemplate(id)
  billTemplateId.value = ''
})
function applyBillTemplate(id) {
  const template = billTemplates.value.find((entry) => entry.id === id)
  if (!template) return
  // 只覆盖模板保存过的字段；`nextDate` 不在模板里，所以「下次支付日期」保持用户当前的值。
  billForm.value = { ...billForm.value, ...templateToBillForm(template) }
  setBillError('')
  showToast(`已套用模板「${template.name}」（下次支付日期保持不变）`)
}
function saveBillAsTemplate() {
  const f = billForm.value
  const name = String(f.name || '').trim() || '未命名账单模板'
  const existing = billTemplates.value.find((entry) => entry.name === name)
  try {
    // 同名模板按 id 覆盖（改），避免同一个账单越存越多份。
    // `nextDate` 不在模板白名单里（见 ledgerTemplates.js），传了也不会被保存。
    saveBillTemplate({ id: existing?.id, name, bill: f })
  } catch (cause) {
    setBillError(cause?.message || '存为模板失败')
    return
  }
  showToast(existing ? `已更新模板「${name}」` : `已存为模板「${name}」`)
}
function removeBillTemplate(id) {
  const removed = deleteBillTemplate(id)
  if (removed) showToast(`已删除模板「${removed.name}」`)
}
function saveBill() {
  const f = billForm.value
  const amount = normalizeAmount(f.amount)
  if (!f.name.trim()) { setBillError('请填写名称', 'name'); return }
  if (amount === null) { setBillError('金额需大于 0，且最多保留两位小数', 'amount'); return }
  if (!f.nextDate) { setBillError('请选择下次支付日期', 'nextDate'); return }
  if (!Number.isFinite(Number(f.remindDays)) || Number(f.remindDays) < 0) { setBillError('提前提醒天数不能小于 0', 'remindDays'); return }
  const data = {
    name: f.name.trim(), amount, category: f.category || detectCategory(f.name), cycle: f.cycle,
    nextDate: f.nextDate, remindDays: Number(f.remindDays) || 0,
    autoRenew: f.autoRenew, active: f.active, note: f.note.trim(),
    // 新增可选字段：账户与币种。账户留空时 createBill 仍回落到默认账户（既有行为不变）。
    account: String(f.account || '').trim(),
    currency: currencyField(f.currency),
    updatedAt: new Date().toISOString(),
  }
  if (editingBillId.value) {
    domain.updateBill(editingBillId.value, data)
    showToast(`已更新固定账单「${data.name}」（只影响之后，历史记录不变）`)
  } else {
    domain.createBill({ ...data, createdFrom: 'manual' })
    showToast(`已添加固定账单「${data.name}」`)
  }
  showBillForm.value = false
}
function deleteBill(bill) {
  deleteBillTarget.value = bill
}
function confirmDeleteBill() {
  const bill = deleteBillTarget.value
  if (!bill) return
  domain.deleteBill(bill.id)
  deleteBillTarget.value = null
  showToast(`已删除「${bill.name}」`)
}
function toggleBillActive(bill) {
  const target = domain.setBillActive(bill.id, bill.active === false)
  if (!target) return
  showToast(target.active ? `已恢复「${bill.name}」` : `已暂停「${bill.name}」`)
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity
  const target = policyDateTime(dateStr, '00:00')
  const today = policyDateTime(ledgerToday(), '00:00')
  return Number.isFinite(target) && Number.isFinite(today) ? Math.round((target - today) / 86400000) : Infinity
}
function billStatus(b) {
  if (b.active === false) return { cls: 'paused', text: '已暂停' }
  const d = daysUntil(b.nextDate)
  const remind = Number(b.remindDays ?? 3)
  if (d < 0) return { cls: 'over', text: `已逾期 ${-d} 天` }
  if (d === 0) return { cls: 'today', text: '今天到期' }
  if (d === 1) return { cls: 'soon', text: '明天到期' }
  if (d <= remind) return { cls: 'soon', text: `还有 ${d} 天` }
  return { cls: 'ok', text: `还有 ${d} 天` }
}

function billDateLabel(dateKey) {
  return formatAppDate(dateKey, { withWeekday: false })
}
// 账单金额按它自己的币种显示；旧账单没有 currency → 仍是原来的 ¥xx.xx。
function billAmountText(bill) {
  return moneyWithCurrency(bill?.amount, bill?.currency)
}

// 已支付：生成账本记录 + 推进周期
function markPaid(bill) {
  const result = domain.payBill(bill.id)
  if (!result) return
  if (result.blocked) {
    showToast(result.reason)
    return
  }
  if (result.duplicate) {
    showToast(`本期「${result.bill.name}」已记入账本，未重复创建交易`)
    return
  }
  showToast(`已支付并记入账本 ${moneyRow(result.transaction.amount)} · 下一期 ${result.bill.nextDate}`)
}

// 跳过本次：只推进周期，不生成记录
function skipOnce(bill) {
  const target = domain.skipBill(bill.id)
  if (!target) return
  if (target.blocked) {
    showToast(target.reason)
    return
  }
  showToast(`已跳过本期「${target.name}」，下一期 ${target.nextDate}`)
}

// 待处理（账本首页）
const sessionDismissed = ref([])
const pendingBills = computed(() =>
  bills.value
    .filter((b) => b.active !== false && !sessionDismissed.value.includes(b.id))
    .map((b) => ({ ...b, _d: daysUntil(b.nextDate), _s: billStatus(b) }))
    .filter((b) => b._d <= Number(b.remindDays ?? 3))
    .sort((a, b) => a._d - b._d)
    .slice(0, 3)
)
function dismissPending(bill) {
  sessionDismissed.value = [...sessionDismissed.value, bill.id]
}

const dueBills = computed(() =>
  bills.value
    .filter((b) => b.active !== false)
    .filter((b) => { const s = billStatus(b); return s.cls === 'over' || s.cls === 'today' || s.cls === 'soon' })
    .sort((a, b) => daysUntil(a.nextDate) - daysUntil(b.nextDate))
)
const laterBills = computed(() =>
  bills.value
    .filter((b) => b.active !== false)
    .filter((b) => billStatus(b).cls === 'ok')
    .sort((a, b) => daysUntil(a.nextDate) - daysUntil(b.nextDate))
)
const pausedBills = computed(() => bills.value.filter((b) => b.active === false))
/* ================= 回顾 ================= */
const reviewMonth = ref(ledgerToday().slice(0, 7)) // YYYY-MM

function shiftMonth(delta) {
  const [y, m] = reviewMonth.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  reviewMonth.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
  // 换月就收起下钻（函数声明会被提升，这里不依赖定义顺序）。
  resetReviewCategoryView()
}
const reviewLabel = computed(() => {
  const [y, m] = reviewMonth.value.split('-').map(Number)
  return y === Number(appToday.value.slice(0, 4)) ? `${m}月` : `${y}年${m}月`
})

// 回顾与首页同一口径：整月合计、分类分布、月历点迹、最大一笔全部按「我承担的份额」算
// （`amountOf: mySpendCents`）。未分摊的记录逐分不变，所以没有分摊的月份与改建前完全一致。
const monthlyReview = computed(() => buildLedgerMonthReview(expenses.value, reviewMonth.value, { amountOf: mySpendCents }))
const reviewTotal = computed(() => monthlyReview.value.total)
const reviewCount = computed(() => monthlyReview.value.count)
const mostFrequent = computed(() => monthlyReview.value.mostFrequent)
const topCategory = computed(() => {
  const top = monthlyReview.value.topCategory
  return top ? { cat: top.key, total: top.total } : null
})
const maxSingle = computed(() => monthlyReview.value.maxSingle)
// 「最大一笔」的金额：卡片上的其它数字都是份额，这一笔也必须显示**我的份额**
// （这条记录的总额仍在详情面板与导出里，信息没丢）。
const maxSingleMine = computed(() => (maxSingle.value ? personalAmount(maxSingle.value) : null))
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
  for (const item of monthlyReview.value.expenses) {
    const key = item.cat || 'other'
    const bucket = buckets.get(key) ?? { key, totalCents: 0, items: [] }
    bucket.totalCents += Math.round(personalAmount(item) * 100)
    bucket.items.push(item)
    buckets.set(key, bucket)
  }
  const rows = [...buckets.values()].map((bucket) => ({
    key: bucket.key,
    info: catInfo(bucket.key),
    value: bucket.totalCents / 100,
    count: bucket.items.length,
    // 分类内按金额倒序：点开就是想看「钱花在哪几笔上」，最大的那笔该在第一条。
    // 金额相同时按日期时间倒序，保证顺序稳定（不依赖录入顺序）。
    items: bucket.items.slice().sort((a, b) =>
      personalAmount(b) - personalAmount(a)
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

// 月历点迹
const calendarCells = computed(() => {
  const [y, m] = reviewMonth.value.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // 周一开头
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const day = monthlyReview.value.dayTotals.get(d)
    cells.push({ day: d, ...(day ? { count: day.count, total: day.total } : { count: 0, total: 0 }) })
  }
  return cells
})
const selectedDay = ref(null)
const selectedDayInfo = computed(() => {
  if (!selectedDay.value) return null
  const day = monthlyReview.value.dayTotals.get(selectedDay.value)
  const items = monthlyReview.value.dayItems.get(selectedDay.value) ?? []
  return {
    label: `${parseInt(reviewMonth.value.slice(5), 10)}月${selectedDay.value}日`,
    count: items.length,
    total: day?.total ?? 0,
    items,
  }
})
function dotClass(cell) {
  if (!cell || !cell.count) return ''
  if (cell.count >= 4) return 'l3'
  if (cell.count >= 2) return 'l2'
  return 'l1'
}

/**
 * 月历格子的可访问名称。
 * 格子里只有「日期数字 + 一个圆点」，圆点的大小才表示当天账目多少。
 * 读屏用户听到的只有「5 按钮」：既不知道这是几月，也完全听不出这天有没有账。
 * 选中态另外用 aria-pressed 暴露——严格说一组互斥的日期选择更适合选中集语义，
 * 但这里是「点一下展开当天明细、再点一下收起」的可切换按钮，
 * aria-pressed 至少让「当前选中哪天」不再只存在于视觉样式里。
 */
function cellLabel(cell) {
  const month = parseInt(reviewMonth.value.slice(5), 10)
  const date = `${month}月${cell.day}日`
  return cell.count ? `${date}，${cell.count} 笔账目，合计 ${moneyRow(cell.total)}` : `${date}，无账目`
}

/* ================= 分类管理 ================= */
const showCatManage = ref(false)
const newCatName = ref('')
// 改名目标（state + 回调，仓库惯例）：点「重命名」只记下目标，改不改由 PromptDialog 决定。
// 这里刻意**不再**调用原生 `window.prompt`——它是浏览器级对话框，既没有 Modal 的浮层栈、
// 焦点陷阱与 Escape 出口，在测试环境（happy-dom）里更是 undefined，调用直接抛 TypeError，
// 于是改名这条路径此前无法被任何用例验证。见 src/components/PromptDialog.vue 头部说明。
const renameTarget = ref(null)
const categoryManageTab = ref('common')
const categoryManageScope = ref('expense')
const ICON_POOL = ['🍜', '☕', '🍪', '🚇', '🛍️', '📦', '📚', '💻', '🎮', '🧴', '✂️', '🛁', '🏠', '💡', '📱', '💊', '🏃', '🎁', '✈️', '🐾', '🔁', '💼', '💰', '🧾', '↩️', '🧧', '♻️', '⋯']
function createCategoryId() {
  return `custom-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`
}

const managedCategories = computed(() => {
  const all = categoriesForScope(categoryManageScope.value, { includeHidden: true })
  if (categoryManageTab.value === 'hidden') return all.filter((category) => category.hidden)
  if (categoryManageTab.value === 'custom') return all.filter((category) => !category.isDefault)
  if (categoryManageTab.value === 'all') return all
  return commonCategories(categoryManageScope.value)
})

function openCategoryManager() {
  categoryManageTab.value = 'common'
  categoryManageScope.value = 'expense'
  showCatManage.value = true
}

function addCategory() {
  const name = newCatName.value.trim()
  if (!name) return
  if (ledgerCategories.value.some((c) => c.name === name && (c.scope || 'expense') === categoryManageScope.value)) { newCatName.value = ''; return }
  const used = new Set(ledgerCategories.value.map((c) => c.icon))
  const icon = ICON_POOL.find((i) => !used.has(i)) ?? '📦'
  ledgerCategories.value = [...ledgerCategories.value, { key: createCategoryId(), name, icon, scope: categoryManageScope.value, hidden: false, isDefault: false }]
  newCatName.value = ''
}
function renameCategory(cat) {
  // 只打开对话框。原来这里是 `const name = window.prompt('修改分类名称', cat.name)`。
  renameTarget.value = cat
}
/**
 * 确认改名。与原 prompt 版的判据逐字一致：
 *   - 取消（原来 `name === null`）→ 不改名（走 @close，不回到这里）；
 *   - trim 后为空 → 不改名（PromptDialog 已经先兜住空值，这里再判一次是防御）；
 *   - 非空 → 按稳定 key 找到那一条，只改 name（分类 ID 不变，历史记录照旧关联）。
 */
function applyCategoryRename(value) {
  const target = renameTarget.value
  const trimmed = String(value ?? '').trim()
  if (!target || !trimmed) { renameTarget.value = null; return }
  const category = ledgerCategories.value.find((c) => c.key === target.key)
  if (category) category.name = trimmed
  renameTarget.value = null
}
function cycleIcon(cat) {
  const target = ledgerCategories.value.find((c) => c.key === cat.key)
  if (!target) return
  const idx = ICON_POOL.indexOf(target.icon)
  target.icon = ICON_POOL[(idx + 1) % ICON_POOL.length]
}
function toggleCatHidden(cat) {
  const target = ledgerCategories.value.find((c) => c.key === cat.key)
  if (!target) return
  if (categoriesForScope(target.scope || 'expense').length <= 1 && !target.hidden) return
  target.hidden = !target.hidden
}

function moveCategory(cat, delta) {
  const list = [...ledgerCategories.value]
  const index = list.findIndex((item) => item.key === cat.key)
  if (index < 0) return
  const scope = cat.scope || 'expense'
  const sameScope = list.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => (item.scope || 'expense') === scope)
  const position = sameScope.findIndex(({ item }) => item.key === cat.key)
  const target = sameScope[position + delta]
  if (!target) return
  list[index] = target.item
  list[target.itemIndex] = cat
  ledgerCategories.value = list
}

function createBillFromSuggest() {
  const s = cycleSuggest.value
  const parsed = parseNatural(nameInput.value)
  const prefill = {
    name: parsed.name || nameInput.value.trim(),
    amount: amountInput.value || parsed.amount || '',
    cycle: s?.kind ?? 'monthly',
  }
  showQuick.value = false
  openBillForm(prefill)
}
</script>

<template>
  <div class="page" :class="{ 'has-fab': tab === 'ledger' }" @click.capture="closeSwipe">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">账本</h1>
        <p class="page-desc">看清近期花费，处理固定账单，记下刚刚发生的一笔。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" type="button" @click="openCategoryManager">分类管理</button>
      </div>
    </header>
    <p v-if="focusMessage" class="notice-success" role="status">{{ focusMessage }}</p>

    <div class="segmented ledger-tabs" role="tablist" aria-label="账本分区" @keydown="onLedgerTabKeydown">
      <button id="ledger-tab-ledger" role="tab" :tabindex="ledgerTabIndex('ledger')" :aria-selected="tab === 'ledger'" :class="{ on: tab === 'ledger' }" @click="tab = 'ledger'">账本</button>
      <button id="ledger-tab-bills" role="tab" :tabindex="ledgerTabIndex('bills')" :aria-selected="tab === 'bills'" :class="{ on: tab === 'bills' }" @click="tab = 'bills'">固定账单</button>
      <button id="ledger-tab-review" role="tab" :tabindex="ledgerTabIndex('review')" :aria-selected="tab === 'review'" :class="{ on: tab === 'review' }" @click="tab = 'review'">回顾</button>
    </div>

    <!-- ================= 账本首页 ================= -->
    <div v-if="tab === 'ledger'" class="ledger-home" role="tabpanel" aria-labelledby="ledger-tab-ledger">
      <!-- 核心数据：只回答不同时间范围内“花了多少” -->
      <section class="hero-stat card" aria-label="花费概览">
        <span class="hero-label">花费概览</span>
        <div class="spend-metrics">
          <!-- 三块数字固定用「今天花费/本周花费/本月花费」这三个用户熟悉的标签，
               数值统一走分摊口径（见 spendStats）：有分摊时就是我的份额。
               ⚠ 这里不要写 `xxx.value`：`<script setup>` 的 ref/computed 在模板中自动解包，
               写成 `mySpendPeriodStats.value` 会恒为 `undefined`（曾经的真实 bug：
               条件恒假 → 分摊再重也永远按总额显示）。 -->
          <div v-for="metric in spendStats" :key="metric.key" class="spend-metric" :class="{ current: metric.key === 'month' }">
            <small>{{ metric.label }}</small>
            <b>{{ moneyHero(metric.value) }}</b>
          </div>
        </div>
        <!-- 口径说明：本月没有分摊时三块数字与全额口径逐分相等，多写一句只会是噪声。 -->
        <p v-if="currentMonthHasSplit" class="hero-sub split-note">
          {{ currentMonthPersonal.splitCount }} 笔分摊已按「我承担」计入（支出 ÷ 人数，余数归我），列表金额同样是份额。<a class="link-btn" @click="showAllFeed = true">查看全部记录</a>
        </p>
        <span class="hero-sub">按自然周统计 · 只计算支出</span>
        <p v-if="monthCompare" class="hero-compare" :class="{ up: monthCompare.up, down: monthCompare.down }">较上月{{ monthCompare.diff > 0 ? '多' : monthCompare.diff < 0 ? '少' : '持平' }} {{ moneyRow(Math.abs(monthCompare.diff)) }}</p>
        <!-- 多币种折算行：只有真的存在非基准币种记录时才出现，缺汇率的笔数在文案里如实说明 -->
        <p v-if="fxRateLine" class="hero-sub" role="status">{{ fxRateLine }}</p>
        <!-- 预算提示：复用首页「待处理」的 .pending-block 形态，紧邻 hero-compare。
             未设预算时（budgetAlert === null）什么都不渲染，不会出现 0/0 这种假信息。 -->
        <p v-if="budgetAlert" class="pending-block" :class="{ over: budgetAlert.level === 'over' }" role="status">{{ budgetAlert.text }}</p>
        <div class="hero-sub">
          <button class="link-btn" type="button" @click="openFxSettings">汇率设置</button>
          · <button class="link-btn" type="button" @click="openBudgetSettings">{{ budget.monthly === null ? '设置预算' : '预算设置' }}</button>
        </div>
      </section>

      <section class="ledger-quick-entry" aria-label="快速记账">
        <div><b>刚刚发生了什么？</b><small>金额 + 内容就能记下，分类和账户会沿用默认值</small></div>
        <button class="btn btn-primary" type="button" @click="openQuick">＋ 记一笔</button>
      </section>

      <!-- 待处理：固定账单临近（无则整块隐藏） -->
      <section v-if="pendingBills.length" class="pending-block">
        <h2 class="block-title">待处理固定账单</h2>
        <div class="pending-list">
          <div v-for="bill in pendingBills" :key="bill.id" class="pending-row" @click="tab = 'bills'">
            <div class="p-main">
              <b>{{ bill.name }}</b>
              <small>{{ billAmountText(bill) }} · {{ billDateLabel(bill.nextDate) }} · {{ bill._s.text }}</small>
            </div>
            <div class="pending-actions">
              <button class="btn btn-sm btn-primary" @click.stop="markPaid(bill)">已支付</button>
              <button class="p-close" type="button" aria-label="暂时隐藏这条账单提醒" @click.stop="dismissPending(bill)">✕</button>
            </div>
          </div>
        </div>
      </section>

      <!-- 常记（自动生成，点开后可改金额再记下） -->
      <section v-if="frequent.length" class="freq-block">
        <div class="block-head">
          <h2 class="block-title">常记</h2>
          <button class="link-btn" @click="openCategoryManager">管理分类</button>
        </div>
        <div class="freq-row">
          <button v-for="item in frequent" :key="item.name" class="freq-pill" @click="useFrequent(item)">
            <span class="freq-icon">{{ catInfo(item.cat).icon }}</span>
            <b>{{ item.name }}</b>
            <small>{{ moneyRow(item.amount) }}</small>
          </button>
        </div>
      </section>

      <!-- 搜索 + 筛选 -->
      <section class="search-block">
        <div class="search-row">
          <span class="search-icon">🔍</span>
          <input v-model="q" class="search-input" aria-label="搜索账本记录" placeholder="搜索名称、备注或分类" />
          <button class="btn btn-sm" :class="{ 'btn-ghost': filtersActive || showFilters }" aria-label="打开账本筛选" :aria-expanded="showFilters" @click="showFilters = !showFilters">筛选</button>
          <button v-if="filtersActive" class="link-btn" @click="clearFilters">清除</button>
        </div>
        <div v-if="showFilters" class="filter-panel">
          <div class="chip-row">
            <button class="chip" :class="{ on: fRange === 'all' }" @click="fRange = 'all'">全部时间</button>
            <button class="chip" :class="{ on: fRange === 'today' }" @click="fRange = 'today'">今天</button>
            <button class="chip" :class="{ on: fRange === 'week' }" @click="fRange = 'week'">本周</button>
            <button class="chip" :class="{ on: fRange === 'month' }" @click="fRange = 'month'">本月</button>
            <button class="chip" :class="{ on: fRange === 'custom' }" @click="fRange = 'custom'">自定义</button>
          </div>
          <div v-if="fRange === 'custom'" class="custom-range">
            <input aria-label="筛选起始日期" v-model="fFrom" type="date" /> <i>至</i> <input aria-label="筛选结束日期" v-model="fTo" type="date" />
          </div>
          <div class="filter-line">
            <select aria-label="筛选分类" v-model="fCat">
              <option value="">全部分类</option>
              <option v-for="c in allActiveCategories" :key="c.key" :value="c.key">{{ c.icon }} {{ c.name }}</option>
            </select>
            <select v-model="fAccount" aria-label="筛选账户">
              <option value="">全部账户</option>
              <option v-for="account in accountOptions" :key="account" :value="account">{{ account }}</option>
            </select>
            <input aria-label="筛选最低金额" v-model="fMin" type="number" min="0" step="0.01" inputmode="decimal" placeholder="金额≥" />
            <input aria-label="筛选最高金额" v-model="fMax" type="number" min="0" step="0.01" inputmode="decimal" placeholder="金额≤" />
            <select aria-label="筛选记录来源" v-model="fKind">
              <option value="all">全部来源</option>
              <option value="manual">普通记录</option>
              <option value="bill">固定账单生成</option>
            </select>
            <select v-model="fDirection" aria-label="筛选收支类型">
              <option value="all">全部收支</option>
              <option value="expense">支出</option>
              <option value="income">收入</option>
            </select>
          </div>
        </div>
      </section>

      <!-- 最近记录：生活记录流 -->
      <section class="feed-block">
        <div class="block-head">
          <h2 class="block-title">最近记录</h2>
          <button v-if="canExpandFeed" class="link-btn" type="button" @click="showAllFeed = true">查看全部（{{ filteredExpenses.length }}）</button>
          <button v-else-if="showAllFeed" class="link-btn" type="button" @click="showAllFeed = false">收起</button>
        </div>
        <div v-if="feedItems.length === 0" class="feed-empty">
          <EmptyState
            class="card"
            icon="🧾"
            title="还没有记录"
            description="第一笔不用很认真，记下刚刚花的钱就可以。"
            primary-label="＋ 记一笔"
            @primary="openQuick"
          />
        </div>
        <div v-else class="feed">
          <VirtualList
            :items="feedItems"
            item-key="key"
            :item-height="feedItemHeight"
            :estimated-height="62"
            :gap="0"
            :overscan="12"
            :threshold="80"
            fixed-height
            reveal-behavior="auto"
            reveal-non-virtual
            :reveal-key="highlightedTransactionId"
          >
            <template #default="{ item: e, index: feedIndex }">
              <div v-if="e.kind === 'day'" class="feed-virtual-item feed-day-item" :class="{ first: feedIndex === 0 }">
                <h3 class="feed-day">
                  <span>{{ dayLabel(e.date) }}</span>
                  <small v-if="e.summary.expense">支出 {{ moneyRow(e.summary.expense) }}</small>
                  <small v-if="e.summary.income">收入 {{ moneyRow(e.summary.income) }}</small>
                </h3>
              </div>
              <SwipeActionItem
                v-else
                class="feed-virtual-item feed-transaction-item"
                :actions="e.actions"
                :open="openSwipeId === String(e.transaction.id)"
                @swipe="onTransactionSwipe(e.transaction.id, $event)"
                @action="onTransactionSwipeAction(e.transaction.id, $event)"
                @update:open="onSwipeOpenChange(e.transaction.id, $event)"
              >
                <!-- 这一行是打开交易详情的**唯一**入口，而它原本只是个带 @click 的 div：
                     键盘 Tab 走不到、读屏读不出可点、回车空格都没反应，等于账本页最常用的
                     操作对非触屏用户完全不可用（WCAG 2.1.1 键盘可达）。补 role + tabindex +
                     回车的键盘处理，DOM 结构与样式一律不动。
                     可以安全地加 role="button"：外面的 SwipeActionItem 把动作按钮渲染成本行
                     的**兄弟节点**，所以这里不会出现「按钮里套按钮」的非法嵌套。
                     只在这里给出「打开详情」这一个入口是够的——详情面板里有编辑 / 再记一次 /
                     退款 / 删除等全部后续操作，都是真按钮，键盘一路可达。
                      第四十三轮补 tap-target：粗指针设备上的 44px 最小尺寸规则只认
                      `[role='button'].tap-target`（见 style.css），而这一行只有 role 没接钩子，
                      于是手机上它拿不到 44px 兜底。它的高由所在行决定（height:100%），
                      加 min-height 只是给一个地板值，不会挤爆列表。 -->
                <div
                  class="feed-item tap-target"
                  :class="{ highlighted: highlightedTransactionId === String(e.transaction.id) }"
                  :data-focus-id="e.transaction.id"
                  role="button"
                  tabindex="0"
                  :aria-label="`查看「${e.transaction.name}」的详情`"
                  @click="openDetail(e.transaction.id)"
                  @keydown.enter.prevent="openDetail(e.transaction.id)"
                  @keydown.space.prevent="openDetail(e.transaction.id)"
                >
                  <div class="fi-main">
                    <b>{{ e.category.icon }} {{ e.transaction.name }}</b>
                    <small>{{ feedSecondary(e.transaction, e.category) }}</small>
                  </div>
                  <span class="fi-amount" :class="{ income: e.transaction.direction === 'income', refund: e.transaction.direction === 'refund' }">{{ feedAmount(e.transaction) }}</span>
                </div>
              </SwipeActionItem>
            </template>
          </VirtualList>
        </div>
      </section>

      <section v-if="categoryOverview.length" class="category-block">
        <div class="block-head">
          <h2 class="block-title">本月分类</h2>
          <button class="link-btn" type="button" @click="tab = 'review'">查看回顾</button>
        </div>
        <div class="cat-bars compact-bars">
          <!-- 首页这一块只显示前 5 名，但每一行都能点：直接跳到回顾页、
               并把对应分类的当月明细展开好，不用再自己去找。 -->
          <button
            v-for="bar in categoryOverview"
            :key="bar.key"
            type="button"
            class="cat-bar-row cat-bar-link"
            :aria-label="`${bar.info.name} 本月 ${moneyRow(bar.value)}，查看这个分类的明细`"
            @click="openReviewCategoryFromHome(bar.key)"
          >
            <span class="cb-name">{{ bar.info.icon }} {{ bar.info.name }}</span>
            <span class="cb-track"><i :style="{ width: `${Math.min(100, bar.pct)}%` }"></i></span>
            <span class="cb-value">{{ moneyRow(bar.value) }}</span>
          </button>
        </div>
        <p v-if="monthCategoryKeys.length > categoryOverview.length" class="cat-more-note">
          本月还有 {{ monthCategoryKeys.length - categoryOverview.length }} 个分类没在这里显示，点分类或「查看回顾」看全部。
        </p>
      </section>
    </div>

    <!-- ================= 固定账单 ================= -->
    <div v-else-if="tab === 'bills'" class="bills-tab" role="tabpanel" aria-labelledby="ledger-tab-bills">
      <div class="tab-head">
        <p class="tab-desc">不想忘记的周期性费用，到期前会出现在账本首页「待处理」。</p>
        <button class="btn btn-primary" @click="openBillForm()">＋ 添加固定账单</button>
      </div>

      <EmptyState
        v-if="bills.length === 0"
        class="card empty-box"
        icon="📌"
        title="还没有固定账单"
        description="如果有每月、每年重复支付的费用，可以放在这里提醒。"
        primary-label="+ 添加固定账单"
        @primary="openBillForm()"
      />

      <template v-else>
        <section v-if="dueBills.length" class="bill-group">
          <h2 class="block-title">即将到来</h2>
          <div class="bill-list">
            <!-- 同 .feed-item：点这一行是编辑该固定账单的唯一入口（右侧 .b-actions 只有
                 「已支付 / 跳过本次」，没有编辑），所以也必须能被键盘激活。 -->
            <!-- 编辑入口是**真按钮**，它只包住名称与金额；`.b-actions` 是它的**兄弟**。
                 以前这三行是 `role="button"` 的 div 包着「已支付 / 跳过本次」这两个真按钮——
                 按 ARIA 规范，button 的子节点是 presentational，于是内层按钮的语义被**抹掉**：
                 读屏既听不到它们是独立控件，行名还会被拼成「编辑固定账单「水费」 已支付 跳过本次」。
                 改成真按钮后：键盘/读屏拿到一个具名按钮，内层动作按钮语义完好。
                 行上的 `@click` 保留（点空白处也能编辑，纯鼠标便利）——这与键盘可达性判据
                 认可的「卡片 + 同动作真按钮」配对一致，所以别再往这一行加 role/tabindex。 -->
            <div
              v-for="bill in dueBills"
              :key="bill.id"
              class="card bill-row"
              :class="[billStatus(bill).cls, { 'focus-target-highlight': focusedBillId === bill.id }]"
              :data-focus-id="bill.id"
              @click="openBillForm({}, bill.id)"
            >
              <button
                type="button"
                class="bill-main"
                :aria-label="`编辑固定账单「${bill.name}」`"
                @click.stop="openBillForm({}, bill.id)"
              >
                <div class="b-main">
                  <b>{{ bill.name }}</b>
                  <small>{{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }}<template v-if="bill.note"> · {{ bill.note }}</template></small>
                </div>
                <div class="b-amount">{{ billAmountText(bill) }}<small>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</small></div>
              </button>
              <div class="b-actions" @click.stop>
                <button class="btn btn-sm btn-primary" @click="markPaid(bill)">已支付</button>
                <button class="btn btn-sm" @click="dismissPending(bill); skipOnce(bill)">跳过本次</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="laterBills.length" class="bill-group">
          <h2 class="block-title">之后</h2>
          <div class="bill-list">
            <!-- 同「待支付」：编辑入口是真按钮，`.b-actions` 在它外面 -->
            <div
              v-for="bill in laterBills"
              :key="bill.id"
              class="card bill-row"
              :class="{ 'focus-target-highlight': focusedBillId === bill.id }"
              :data-focus-id="bill.id"
              @click="openBillForm({}, bill.id)"
            >
              <button
                type="button"
                class="bill-main"
                :aria-label="`编辑固定账单「${bill.name}」`"
                @click.stop="openBillForm({}, bill.id)"
              >
                <div class="b-main">
                  <b>{{ bill.name }}</b>
                  <small>{{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }}</small>
                </div>
                <div class="b-amount">{{ billAmountText(bill) }}<small>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</small></div>
              </button>
              <div class="b-actions" @click.stop>
                <button class="btn btn-sm" @click="skipOnce(bill)">跳过本次</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="pausedBills.length" class="bill-group">
          <h2 class="block-title">已暂停</h2>
          <div class="bill-list">
            <!-- 同「待支付」：编辑入口是真按钮，`.b-actions` 在它外面 -->
            <div
              v-for="bill in pausedBills"
              :key="bill.id"
              class="card bill-row paused"
              :class="{ 'focus-target-highlight': focusedBillId === bill.id }"
              :data-focus-id="bill.id"
              @click="openBillForm({}, bill.id)"
            >
              <button
                type="button"
                class="bill-main"
                :aria-label="`编辑固定账单「${bill.name}」`"
                @click.stop="openBillForm({}, bill.id)"
              >
                <div class="b-main">
                  <b>{{ bill.name }}</b>
                  <small>已暂停 · 下次 {{ bill.nextDate }}</small>
                </div>
                <div class="b-amount">{{ billAmountText(bill) }}</div>
              </button>
              <div class="b-actions" @click.stop>
                <button class="btn btn-sm" @click="toggleBillActive(bill)">恢复</button>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- ================= 回顾 ================= -->
    <div v-else class="review-tab" role="tabpanel" aria-labelledby="ledger-tab-review">
      <div class="month-nav card">
        <!-- 两个翻月按钮内部只有「‹」「›」：读屏会直接念符号，用户听不出这是在换月份，
             所以用 aria-label 说清方向；符号本身保持可见，不需要再加 aria-hidden。
             mn-btn 只有 32×32，一并标记 tap-target，让粗指针设备把它撑到 44px 命中区；
             禁用态交给 :disabled，读屏会自己读出「不可用」，不必写进名称。 -->
        <button class="mn-btn tap-target" aria-label="上一个月" @click="shiftMonth(-1)">‹</button>
        <b>{{ reviewLabel }}</b>
        <button class="mn-btn tap-target" aria-label="下一个月" :disabled="reviewMonth >= ledgerToday().slice(0, 7)" @click="shiftMonth(1)">›</button>
        <span class="review-export" role="group" aria-label="导出账单">
          <button class="btn btn-sm" type="button" @click="exportLedgerCsv">导出 CSV</button>
          <button class="btn btn-sm" type="button" @click="exportLedgerXlsx">导出 Excel</button>
        </span>
      </div>

      <EmptyState
        v-if="reviewCount === 0"
        class="card empty-box"
        icon="🌙"
        :title="`${reviewLabel}还没有记录`"
        description="这个月还没有留下消费痕迹。"
      />

      <template v-else>
        <section class="review-summary card">
          <div class="rs-top">
            <span>记录了 {{ reviewCount }} 笔<template v-if="monthlyReview.refundTotal"> · 退款 ¥{{ monthlyReview.refundTotal.toFixed(2) }}</template></span>
            <b>{{ moneyHero(reviewTotal) }}</b>
          </div>
          <div class="rs-facts">
            <div v-if="mostFrequent"><small>最常记录</small><b>{{ mostFrequent.name }} · {{ mostFrequent.count }}次</b></div>
            <!-- 「花得最多」和「最大一笔」原本是纯展示的死数字：用户看到「餐饮 ¥320」
                 之后没有任何下一步。现在它们各自是到明细的直达入口——
                 前者展开下方分类分布里那个分类，后者直接打开那一笔的详情。 -->
            <button
              v-if="topCategory"
              type="button"
              class="rs-fact-link"
              :aria-label="`花得最多：${catInfo(topCategory.cat).name} ${moneyRow(topCategory.total)}，点开看明细`"
              @click="revealReviewCategory(topCategory.cat)"
            >
              <small>花得最多</small><b>{{ catInfo(topCategory.cat).name }} · {{ moneyRow(topCategory.total) }}</b>
            </button>
            <button
              v-if="maxSingle"
              type="button"
              class="rs-fact-link"
              :aria-label="`最大一笔：${maxSingle.name} ${moneyRow(maxSingleMine)}，查看详情`"
              @click="openDetail(maxSingle.id)"
            >
              <small>最大一笔</small><b>{{ maxSingle.name }} · {{ moneyRow(maxSingleMine) }}</b>
            </button>
          </div>
          <p v-if="reviewMyShareNote" class="form-note">{{ reviewMyShareNote }}</p>
        </section>

        <section class="review-cats card">
          <div class="rc-head">
            <h2 class="block-title">分类分布</h2>
            <span class="rc-sum">共 {{ reviewCategoryRows.length }} 类 · {{ moneyRow(reviewCategorySum) }}</span>
          </div>
          <!-- 每一行都是明细入口：点一下展开这个分类当月的每一笔，
               金额仍是「我承担」口径（与上方合计、下方月历同源，见 reviewCategoryRows）。 -->
          <p class="form-note">点分类可展开当月每一笔，看清钱具体花在哪里。</p>
          <div class="cat-bars">
            <div v-for="row in visibleCategoryRows" :key="row.key" class="rc-item">
              <button
                type="button"
                class="cat-bar-row rc-bar"
                :class="{ open: expandedCategory === row.key }"
                :aria-expanded="expandedCategory === row.key"
                :aria-label="`${row.info.name} ${moneyRow(row.value)}，${row.count} 笔，占 ${row.pct}%，${expandedCategory === row.key ? '已展开明细' : '点开看明细'}`"
                @click="toggleReviewCategory(row.key)"
              >
                <span class="cb-name">
                  <span class="cb-label">{{ row.info.icon }} {{ row.info.name }}</span>
                  <small class="cb-meta">{{ row.pct }}% · {{ row.count }} 笔</small>
                </span>
                <span class="cb-track"><i :style="{ width: `${Math.max(2, row.pct)}%` }"></i></span>
                <span class="cb-value">{{ moneyRow(row.value) }}</span>
                <span class="cb-caret" aria-hidden="true">{{ expandedCategory === row.key ? '▴' : '▾' }}</span>
              </button>
              <div v-if="expandedCategory === row.key" class="rc-detail">
                <button
                  v-for="e in row.items"
                  :key="e.id"
                  type="button"
                  class="rc-detail-row"
                  :aria-label="`查看「${e.name}」的详情`"
                  @click="openDetail(e.id)"
                >
                  <span class="rd-name">{{ e.name }}</span>
                  <small>{{ e.date.slice(5).replace('-', '/') }}{{ e.time ? ` ${e.time}` : '' }}</small>
                  <b>{{ moneyRow(personalAmount(e)) }}</b>
                </button>
                <p class="rc-detail-foot">共 {{ row.count }} 笔 · 我承担 {{ moneyRow(row.value) }}</p>
              </div>
            </div>
          </div>
          <button v-if="hiddenCategoryCount" type="button" class="link-btn rc-toggle" @click="showAllReviewCats = true">展开其余 {{ hiddenCategoryCount }} 个分类</button>
          <button v-else-if="showAllReviewCats" type="button" class="link-btn rc-toggle" @click="showAllReviewCats = false">只显示前 {{ REVIEW_CATEGORY_LIMIT }} 个</button>
        </section>

        <section class="review-calendar card">
          <h2 class="block-title">月历点迹</h2>
          <div class="cal-week">
            <span v-for="w in ['一','二','三','四','五','六','日']" :key="w">{{ w }}</span>
          </div>
          <div class="cal-grid">
            <template v-for="(cell, idx) in calendarCells" :key="idx">
              <button
                v-if="cell"
                class="cal-cell"
                :class="[dotClass(cell), { selected: selectedDay === cell.day }]"
                :aria-label="cellLabel(cell)"
                :aria-pressed="selectedDay === cell.day"
                @click="selectedDay = selectedDay === cell.day ? null : cell.day"
              >{{ cell.day }}<i v-if="cell.count"></i></button>
              <span v-else class="cal-cell blank"></span>
            </template>
          </div>
          <div v-if="selectedDayInfo" class="cal-detail">
            <b>{{ selectedDayInfo.label }}</b>
            <small>{{ selectedDayInfo.count }} 笔 · {{ moneyRow(selectedDayInfo.total) }}</small>
            <!-- 同 .feed-item：日历里的当日明细行也是打开详情的唯一入口，
                 原本同样只有 @click，键盘与读屏都够不到。
                   第四十三轮补 tap-target：这一行是全仓唯一「有 role="button"、却既没有
                   btn/tap-target 也没有任何 min-height」的，实测声明高度只有 padding 6+6
                   加一行文字（约 32px），手机上明显偏小。它有别于课表网格格子的地方在于
                   它是普通列表行（没有固定高度的网格轨道），加 44px 地板值不会造成溢出。 -->
            <div
              v-for="e in selectedDayInfo.items"
              :key="e.id"
              class="cd-row tap-target"
              role="button"
              tabindex="0"
              :aria-label="`查看「${e.name}」的详情`"
              @click="openDetail(e.id)"
              @keydown.enter.prevent="openDetail(e.id)"
              @keydown.space.prevent="openDetail(e.id)"
            >
              <span>{{ e.name }}</span><small>{{ catInfo(e.cat).name }} · {{ e.time }}</small><b>{{ moneyRow(personalAmount(e)) }}</b>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- ================= 记一笔 弹窗 ================= -->
    <QuickRecordPanel
      v-if="showQuickRecord"
      :open="showQuickRecord"
      :context="{ preferredType: 'expense' }"
      @saved="onQuickRecordSaved"
      @close="closeQuickRecord"
    />

    <Modal v-if="showQuick" :open="showQuick" :title="editingId ? '编辑记录' : keepAdding ? '再记一笔' : '记一笔'" @close="closeQuick">
      <div class="quick-form">
        <button v-if="!editingId" class="natural-entry-link" type="button" @click="showQuick = false; openQuickRecord()">⚡ 用一句话记</button>
        <input
          ref="amountEl"
          v-model="amountInput"
          class="amount-input"
          type="text"
          inputmode="decimal"
          placeholder="0.00"
          autocomplete="off"
          aria-label="金额"
          @keydown.enter="saveExpense(keepAdding)"
        />
        <div v-if="!editingId" class="direction-toggle" role="group" aria-label="选择收支类型">
           <button type="button" :class="{ on: directionInput === 'expense' }" @click="setDirection('expense')">支出</button>
           <button type="button" :class="{ on: directionInput === 'income' }" @click="setDirection('income')">收入</button>
        </div>
        <input
          v-model="nameInput"
          class="name-input"
          aria-label="备注或用途"
          placeholder="买了什么？可不填"
          @input="onNameInput"
          @keydown.enter="saveExpense(keepAdding)"
        />

        <div v-if="dupWarn" class="dup-warn">
          <span>这笔可能和刚才的一样。</span>
          <div class="dw-actions">
            <button class="btn btn-sm" @click="dupWarn = false; nameInput = ''">取消</button>
            <button class="btn btn-sm btn-primary" @click="forceDup = true; saveExpense(keepAdding)">仍然记录</button>
          </div>
        </div>

        <div v-if="cycleSuggest" class="cycle-suggest">
          <span>检测到周期描述（{{ cycleSuggest.kind === 'weekly' ? '每周' : cycleSuggest.kind === 'yearly' ? '每年' : '每月' }}{{ cycleSuggest.day ? ` ${cycleSuggest.day} 日` : '' }}），是否同时创建固定账单？</span>
          <div class="dw-actions">
            <button class="btn btn-sm" @click="cycleSuggest = null">只记录一次</button>
            <button class="btn btn-sm btn-ghost" @click="createBillFromSuggest">创建固定账单</button>
          </div>
        </div>

        <button type="button" class="more-toggle" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
          {{ moreOpen ? '收起' : '更多' }} <i>{{ moreOpen ? '▴' : '▾' }}</i>
        </button>

        <div v-show="moreOpen" class="more-area">
          <div class="chip-row cat-chips">
            <button
              v-for="c in quickCatChips"
              :key="c.key"
              class="chip"
              :class="{ on: catInput === c.key }"
               @click="selectQuickCategory(c.key)"
             >{{ c.icon }} {{ c.name }}</button>
           </div>
           <button v-if="activeCategories(directionInput).length > quickCatChips.length" type="button" class="category-more-toggle" :aria-expanded="showAllQuickCategories" @click="showAllQuickCategories = !showAllQuickCategories">
             {{ showAllQuickCategories ? '只显示常用' : '全部分类' }}
           </button>
          <div class="more-grid">
            <label>日期<input v-model="dateInput" type="date" /></label>
            <label>时间<input v-model="timeInput" type="time" /></label>
            <label>账户<input v-model="accountInput" placeholder="可不填，默认账户" /></label>
            <!-- 币种下拉：默认基准币种，只列「基准 + 已设汇率」的币种；
                 记录的币种即使汇率后来被删掉也仍然能显示，不会被静默改成基准。 -->
            <label>币种
              <select v-model="currencyInput" aria-label="这笔记录使用的币种">
                <option v-for="code in currencyOptions" :key="code" :value="code">{{ code === baseCurrency ? `${code}（基准）` : code }}</option>
              </select>
            </label>
          </div>
          <input v-model="noteInput" aria-label="备注" placeholder="买了什么？可不填" />
          <!-- 分摊：始终显示人数（默认 1），自动算「我承担」= 总额 ÷ 人数，余数归我 -->
          <div class="more-grid">
            <label>参与人数<input v-model="splitCount" type="number" min="1" max="99" step="1" inputmode="numeric" @input="onSplitChange" /></label>
            <label>我承担<input v-model="splitMine" type="text" inputmode="decimal" aria-label="我在这一笔里承担的份额（自动计算，可手改）" readonly /></label>
          </div>
          <p v-if="splitPreview" class="form-note">{{ splitPreview }}</p>
        </div>

        <div class="quick-actions">
          <button class="btn btn-primary save-btn" :disabled="savingExpense" @click="saveExpense(keepAdding)">{{ editingId ? '保存修改' : keepAdding ? '记下一笔' : '记下' }}</button>
          <button v-if="!editingId" class="btn btn-ghost" :disabled="savingExpense" @click="saveExpense(true)">{{ keepAdding ? '完成' : '连续记' }}</button>
        </div>
      </div>
    </Modal>

    <!-- ================= 记录详情 ================= -->
    <Modal v-if="detailExpense" :open="Boolean(detailExpense)" :title="detailExpense?.name ?? '记录详情'" @close="closeDetail">
      <div v-if="detailExpense" class="detail-body">
        <template v-if="detailEdit">
          <div class="detail-edit-grid">
            <label>金额<input ref="detailAmountEl" v-model="detailAmountInput" class="detail-edit-amount" type="text" inputmode="decimal" aria-label="修改金额" /></label>
            <label>分类<select v-model="detailCategoryInput" aria-label="修改分类"><option v-for="category in activeCategories(detailExpense.direction === 'income' ? 'income' : 'expense')" :key="category.key" :value="category.key">{{ category.icon }} {{ category.name }}</option></select></label>
            <label>日期<input v-model="detailDateInput" type="date" aria-label="修改日期" /></label>
            <label>币种<select v-model="detailCurrencyInput" aria-label="修改币种"><option v-for="code in currencyChoices(fx, [detailCurrencyInput])" :key="code" :value="code">{{ code }}</option></select></label>
          </div>
          <div class="detail-actions detail-edit-actions">
            <button class="btn" type="button" @click="cancelDetailEdit">取消</button>
            <button class="btn btn-primary" type="button" @click="saveDetailEdit">保存修改</button>
          </div>
        </template>
        <template v-else>
          <div class="detail-amount" :class="{ income: detailExpense.direction === 'income', refund: detailExpense.direction === 'refund' }">{{ detailExpense.direction === 'income' || detailExpense.direction === 'refund' ? '+' : '-' }}{{ moneyRow(detailExpense.amount) }}</div>
          <div class="detail-meta">
            <span>{{ catInfo(detailExpense.cat).icon }} {{ catInfo(detailExpense.cat).name }}</span>
            <span>{{ detailExpense.date }} {{ detailExpense.time }}</span>
            <span v-if="detailExpense.account">{{ detailExpense.account }}</span>
            <span v-if="isBillPayment(detailExpense)">来自固定账单</span>
            <span v-if="detailExpense.direction === 'refund'">退款 · 冲抵原支出</span>
            <span v-if="splitDetailNote(detailExpense)">{{ splitDetailNote(detailExpense) }}</span>
          </div>
          <p v-if="detailExpense.note" class="detail-note">{{ detailExpense.note }}</p>
          <div class="detail-actions">
            <button v-if="!isBillPayment(detailExpense) && !isRefundTransaction(detailExpense)" class="btn" type="button" @click="editFromDetail">编辑</button>
            <button v-if="!isRefundTransaction(detailExpense)" class="btn" type="button" @click="againFromDetail">再记一次</button>
            <button v-if="!isRefundTransaction(detailExpense)" class="btn" type="button" @click="togglePinName">
              {{ (freqPrefs.pinned ?? []).includes(detailExpense.name.trim()) ? '取消常记' : '设为常记' }}
            </button>
            <button v-if="!isRefundTransaction(detailExpense)" class="btn" type="button" @click="toggleHideName">
              {{ (freqPrefs.hidden ?? []).includes(detailExpense.name.trim()) ? '取消隐藏' : '从常记隐藏' }}
            </button>
            <button v-if="!isBillPayment(detailExpense) && !isRefundTransaction(detailExpense) && detailExpense.direction !== 'income'" class="btn" type="button" @click="openRefund">退款</button>
            <button v-if="isBillPayment(detailExpense)" class="btn btn-danger" type="button" @click="undoBillPaymentFromDetail">撤销支付</button>
            <button v-else-if="isRefundTransaction(detailExpense)" class="btn btn-danger" type="button" @click="deleteFromDetail">撤销退款</button>
            <button v-else class="btn btn-danger" type="button" @click="deleteFromDetail">删除</button>
          </div>
          <p v-if="isBillPayment(detailExpense)" class="form-note">这是固定账单的支付记录。撤销后，本期会重新回到待支付。</p>
        </template>
      </div>
    </Modal>

    <!-- ================= 退款 / 冲正 ================= -->
    <Modal v-if="showRefund" :open="showRefund" title="登记退款" medium @close="closeRefund">
      <div class="refund-form">
        <p class="refund-hint">把「{{ refundItem?.name }}」的支出按退款冲抵，本月的支出统计会相应减少。</p>
        <label class="bill-field">退款金额 <input v-model="refundAmountInput" type="number" min="0" step="0.01" inputmode="decimal" aria-label="退款金额" /></label>
        <label class="bill-field">退款日期 <input v-model="refundDateInput" type="date" aria-label="退款日期" /></label>
        <label class="bill-field">备注 <input v-model="refundNoteInput" maxlength="80" placeholder="可选，例如：平台退款到账" /></label>
        <div class="detail-actions"><button class="btn" type="button" @click="closeRefund">取消</button><button class="btn btn-primary" type="button" @click="confirmRefund">确认退款</button></div>
      </div>
    </Modal>

    <!-- ================= 添加/编辑 固定账单 ================= -->
    <Modal v-if="showBillForm" :open="showBillForm" :title="editingBillId ? '编辑固定账单' : '添加固定账单'" medium @close="showBillForm = false">
      <div class="bill-form">
        <p class="bill-form-intro">设置一次，之后会按周期提醒你。</p>
        <!-- 预设模板：下拉套用（不改「下次支付日期」），下面的 ✕ 删除，「存为模板」把当前表单存下来 -->
        <label class="bill-field bill-field-wide">
          <span>从模板套用 <em>可选</em></span>
          <select v-model="billTemplateId" aria-label="从模板套用">
            <option value="">选择模板…</option>
            <option v-for="template in billTemplates" :key="template.id" :value="template.id">{{ template.name }}</option>
          </select>
        </label>
        <template v-if="billTemplates.length">
          <div class="chip-row">
            <template v-for="template in billTemplates" :key="template.id">
              <small class="form-note">{{ template.name }}</small>
              <button type="button" class="p-close" :aria-label="`删除账单模板「${template.name}」`" @click="removeBillTemplate(template.id)">✕</button>
            </template>
          </div>
        </template>
        <small v-else class="form-note">还没有模板。填好下面的表单后点「存为模板」。</small>
        <button class="btn btn-sm" type="button" @click="saveBillAsTemplate">存为模板</button>
        <small class="form-note">模板只保存名称、金额、分类、周期、提醒天数、账户与币种，不保存「下次支付日期」。</small>
        <label class="bill-field bill-field-wide">
          <span>账单名称 <i>必填</i></span>
          <input
            ref="billNameInput"
            v-model="billForm.name"
            autocomplete="off"
            placeholder="例如：ChatGPT Plus、话费"
            :aria-invalid="billErrorField === 'name' || undefined"
            :aria-describedby="billError ? 'bill-form-error' : undefined"
          />
        </label>
        <div class="bill-form-grid">
          <label class="bill-field">
            <span>金额 <i>必填</i></span>
            <div class="bill-money-input"><b>¥</b><input
              ref="billAmountInput"
              v-model="billForm.amount"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
              aria-label="固定账单金额"
              :aria-invalid="billErrorField === 'amount' || undefined"
              :aria-describedby="billError ? 'bill-form-error' : undefined"
            /></div>
          </label>
          <label class="bill-field">
            <span>重复周期</span>
            <select v-model="billForm.cycle">
              <option v-for="(c, key) in CYCLES" :key="key" :value="key">{{ c.label }}</option>
            </select>
          </label>
        </div>
        <label class="bill-field bill-field-wide">
          <span>支付分类 <em>支付后生成交易时使用</em></span>
          <select v-model="billForm.category">
            <option value="">按名称自动识别</option>
            <option v-for="category in activeCategories('expense')" :key="category.key" :value="category.key">{{ category.icon }} {{ category.name }}</option>
          </select>
        </label>
        <div class="bill-form-grid">
          <label class="bill-field">
            <span>下次支付日期</span>
            <input
              ref="billNextDateInput"
              v-model="billForm.nextDate"
              type="date"
              :aria-invalid="billErrorField === 'nextDate' || undefined"
              :aria-describedby="billError ? 'bill-form-error' : undefined"
            />
          </label>
          <label class="bill-field">
            <span>提前提醒</span>
            <select
              ref="billRemindInput"
              v-model="billForm.remindDays"
              :aria-invalid="billErrorField === 'remindDays' || undefined"
              :aria-describedby="billError ? 'bill-form-error' : undefined"
            >
              <option :value="0">当天</option>
              <option :value="1">1 天</option>
              <option :value="3">3 天</option>
              <option :value="7">7 天</option>
            </select>
          </label>
        </div>
        <label class="bill-field bill-field-wide">
          <span>备注 <em>选填</em></span>
          <input v-model="billForm.note" placeholder="补充套餐、用途等信息" />
        </label>
        <div class="bill-form-grid">
          <label class="bill-field">
            <span>账户 <em>选填</em></span>
            <input v-model="billForm.account" placeholder="留空则用默认账户" />
          </label>
          <!-- 账单币种：支付后生成的交易会沿用同一个币种（payBill 里透传） -->
          <label class="bill-field">
            <span>币种 <em>手工维护汇率</em></span>
            <select v-model="billForm.currency" aria-label="固定账单使用的币种">
              <option v-for="code in currencyChoices(fx, [billForm.currency])" :key="code" :value="code">{{ code === baseCurrency ? `${code}（基准）` : code }}</option>
            </select>
          </label>
        </div>
        <div class="bill-options">
          <label class="bill-switch">
            <input v-model="billForm.autoRenew" type="checkbox" />
            <span class="switch-track" aria-hidden="true"><i></i></span>
            <span><b>自动续费</b><small>到期后自动推进到下一周期</small></span>
          </label>
          <label class="bill-switch">
            <input v-model="billForm.active" type="checkbox" />
            <span class="switch-track" aria-hidden="true"><i></i></span>
            <span><b>使用中</b><small>关闭后暂停提醒</small></span>
          </label>
        </div>
        <p v-if="editingBillId" class="form-note">修改只影响之后的周期，不会改动已经生成的历史记录；需要改本期请直接修改「什么时候」的日期。</p>
        <p v-if="billError" id="bill-form-error" class="bill-error" role="alert">{{ billError }}</p>
        <div class="bill-form-actions">
          <button v-if="editingBillId" class="btn btn-danger" @click="; (() => { const b = bills.find(x => x.id === editingBillId); if (b) deleteBill(b); showBillForm = false })()">删除</button>
          <button class="btn" @click="showBillForm = false">取消</button>
          <button class="btn btn-primary" @click="saveBill">保存</button>
        </div>
      </div>
    </Modal>

    <ConfirmDialog
      :open="Boolean(deleteBillTarget)"
      title="删除固定账单"
      :message="`确定删除固定账单“${deleteBillTarget?.name || ''}”吗？不会删除已经生成的历史记录。`"
      confirm-label="删除"
      @close="deleteBillTarget = null"
      @confirm="confirmDeleteBill"
    />

    <!-- ================= 多币种汇率设置（手工维护，不联网） ================= -->
    <Modal v-if="showFxSettings" :open="showFxSettings" title="汇率设置" medium @close="showFxSettings = false">
      <div class="bill-form">
        <p class="bill-form-intro">全部手工输入：1 单位外币 = 多少 {{ baseCurrency }}。应用不会联网获取汇率。</p>
        <p class="form-note">没有历史汇率——改一次数值会影响所有历史折算；这里只做「外币 → 基准币种」的单跳换算，不做三角换算。缺汇率的记录不会被计入折算合计，而是单独标出笔数。</p>
        <div v-for="row in fxDraft" :key="row.code" class="bill-form-grid">
          <label class="bill-field">
            <span>{{ row.code }} → {{ baseCurrency }}</span>
            <input v-model="row.rate" type="text" inputmode="decimal" placeholder="例如 7.2" :aria-label="`1 ${row.code} 等于多少 ${baseCurrency}`" />
          </label>
          <div class="bill-field">
            <span>操作</span>
            <button class="btn" type="button" @click="removeFxRow(row.code)">删除 {{ row.code }}</button>
          </div>
        </div>
        <p v-if="!fxDraft.length" class="form-note">还没有设置任何外币汇率。</p>
        <div class="bill-form-grid">
          <label class="bill-field">
            <span>添加币种 <em>三位字母</em></span>
            <input v-model="fxNewCode" maxlength="3" list="ledger-fx-currency-options" placeholder="USD" aria-label="要添加的币种代码" />
          </label>
          <div class="bill-field">
            <span>操作</span>
            <button class="btn" type="button" @click="addFxRow">添加到列表</button>
          </div>
        </div>
        <datalist id="ledger-fx-currency-options">
          <option v-for="code in fxAddableCurrencies" :key="code" :value="code" />
        </datalist>
        <p v-if="fxError" class="bill-error" role="alert">{{ fxError }}</p>
        <div class="bill-form-actions">
          <button class="btn" type="button" @click="showFxSettings = false">取消</button>
          <button class="btn btn-primary" type="button" @click="commitFxSettings">保存汇率</button>
        </div>
      </div>
    </Modal>

    <!-- ================= 月度预算 ================= -->
    <Modal v-if="showBudgetSettings" :open="showBudgetSettings" title="月度预算" medium @close="showBudgetSettings = false">
      <div class="bill-form">
        <p class="bill-form-intro">设一个月度总额上限（{{ baseCurrency }}），花超或接近上限时在账本首页提醒。未设置时首页不显示任何预算提示。</p>
        <label class="bill-field bill-field-wide">
          <span>月度预算 <em>单位：元</em></span>
          <input v-model="budgetInput" type="text" inputmode="decimal" placeholder="例如 2000" :aria-label="`月度预算金额（${baseCurrency}）`" />
        </label>
        <p class="form-note">只做月度总额预算，不做分分类预算；达到 80% 时提醒「接近预算」，超出后提醒「已超预算」。存在外币记录时按手工汇率折算后再比较。</p>
        <p v-if="budgetError" class="bill-error" role="alert">{{ budgetError }}</p>
        <div class="bill-form-actions">
          <button v-if="budget.monthly !== null" class="btn btn-danger" type="button" @click="removeBudget">清除预算</button>
          <button class="btn" type="button" @click="showBudgetSettings = false">取消</button>
          <button class="btn btn-primary" type="button" @click="commitBudget">保存预算</button>
        </div>
      </div>
    </Modal>

    <!-- ================= 分类管理 ================= -->
    <Modal v-if="showCatManage" :open="showCatManage" title="分类管理" @close="showCatManage = false">
      <div class="cat-manage">
        <div class="category-scope-tabs" role="group" aria-label="分类方向">
          <button type="button" :aria-pressed="categoryManageScope === 'expense'" :class="{ on: categoryManageScope === 'expense' }" @click="categoryManageScope = 'expense'">支出分类</button>
          <button type="button" :aria-pressed="categoryManageScope === 'income'" :class="{ on: categoryManageScope === 'income' }" @click="categoryManageScope = 'income'">收入分类</button>
        </div>
        <div class="category-view-tabs" role="group" aria-label="分类视图">
          <button type="button" :aria-pressed="categoryManageTab === 'common'" :class="{ on: categoryManageTab === 'common' }" @click="categoryManageTab = 'common'">常用分类</button>
          <button type="button" :aria-pressed="categoryManageTab === 'all'" :class="{ on: categoryManageTab === 'all' }" @click="categoryManageTab = 'all'">全部分类</button>
          <button type="button" :aria-pressed="categoryManageTab === 'hidden'" :class="{ on: categoryManageTab === 'hidden' }" @click="categoryManageTab = 'hidden'">隐藏分类</button>
          <button type="button" :aria-pressed="categoryManageTab === 'custom'" :class="{ on: categoryManageTab === 'custom' }" @click="categoryManageTab = 'custom'">自定义</button>
        </div>
        <div v-if="managedCategories.length === 0" class="category-empty">这里还没有符合条件的分类。</div>
        <div v-for="c in managedCategories" :key="c.key" class="cat-row" :class="{ hidden: c.hidden }">
          <button class="cat-icon" aria-label="更换分类图标" title="换个图标" @click="cycleIcon(c)">{{ c.icon }}</button>
          <div class="cat-name"><b>{{ c.name }}</b><small v-if="c.legacy">历史兼容分类</small></div>
          <div class="cat-ops">
            <button class="link-btn" title="上移" @click="moveCategory(c, -1)">↑</button>
            <button class="link-btn" title="下移" @click="moveCategory(c, 1)">↓</button>
            <button class="link-btn" @click="renameCategory(c)">重命名</button>
            <button class="link-btn" @click="toggleCatHidden(c)">{{ c.hidden ? '显示' : '隐藏' }}</button>
          </div>
        </div>
        <div class="cat-add">
          <input aria-label="新增分类名称" v-model="newCatName" :placeholder="categoryManageScope === 'income' ? '新增收入分类' : '新增支出分类'" @keydown.enter="addCategory" />
          <button class="btn btn-sm btn-primary" @click="addCategory">添加</button>
        </div>
        <p class="form-note">分类改名会保留稳定 ID；有历史记录的分类只能隐藏，不能直接删除。历史交易不会因新增规则而重分类。</p>
      </div>
    </Modal>

    <!-- 分类改名：原来的原生 prompt 走这里。`v-if` 是必需的（见 PromptDialog 头部说明）：
         不加的话它会排在分类管理浮层**前面**，body 里每个 .overlay 的 z-index 都是 100，
         于是对话框被分类管理盖住（读屏与 Escape 却以为它在最上层）。 -->
    <PromptDialog
      v-if="renameTarget"
      :open="Boolean(renameTarget)"
      title="修改分类名称"
      label="分类名称"
      :initial-value="renameTarget?.name || ''"
      @close="renameTarget = null"
      @confirm="applyCategoryRename"
    />

    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :view-fn="toast.viewFn" :duration="toast.duration" @action="() => {}" @close="toast.open = false" />

  </div>
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
.page {
  gap:var(--space-md,16px);
  flex-direction:column;
  display:flex}
.ledger-tabs {
  align-self:flex-start}
.block-title {
  margin:0 0 8px;
  font-size:13.5px;
  font-weight:750}
.block-head {
  justify-content:space-between;
  align-items:center;
  margin-bottom:8px;
  display:flex}
.block-head .block-title {
  margin:0}
.ledger-home {
  flex-direction:column;
  gap:16px;
  display:flex}
.ledger-home>.hero-stat {
  order:1}
.ledger-home>.ledger-quick-entry {
  order:2}
.ledger-home>.search-block {
  order:3}
.ledger-home>.feed-block {
  order:4}
.ledger-home>.pending-block {
  order:5}
.ledger-home>.freq-block {
  order:6}
.ledger-home>.category-block {
  order:7}
.hero-stat {
  flex-direction:column;
  gap:10px;
  padding:16px 18px 14px;
  display:flex}
.hero-label {
  color:var(--ink-faint);
  font-size:12.5px;
  font-weight:700}
.spend-metrics {
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;
  display:grid}
.spend-metric {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:11px;
  flex-direction:column;
  gap:5px;
  min-width:0;
  padding:11px 12px;
  display:flex}
.spend-metric small {
  color:var(--ink-soft);
  font-size:11px;
  font-weight:700}
.spend-metric b {
  letter-spacing:-.02em;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-variant-numeric:tabular-nums;
  font-size:max(16px,min(2.3vw,23px));
  font-weight:900;
  line-height:1.1;
  overflow:hidden}
.spend-metric.current {
  border-color:var(--primary);
  background:var(--primary-soft)}
.spend-metric.current small {
  color:var(--primary)}
.hero-sub {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:11.5px}
.hero-compare {
  color:var(--ink-soft);
  background:var(--bg-tint);
  font-variant-numeric:tabular-nums;
  border-radius:999px;
  align-self:flex-start;
  margin:0;
  padding:3px 9px;
  font-size:11.5px;
  font-weight:700}
.hero-compare.up {
  color:var(--warning);
  background:color-mix(in srgb, var(--warning) 10%, var(--card))}
.hero-compare.down {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card))}
/* 预算提示：刻意复用首页「待处理」区块的 .pending-block 形态（不新增类名），
   但它嵌在 hero-stat 卡片里、只是紧邻 .hero-compare 的一行字，
   所以这里只补内层需要的排版；超支（.over）比「接近预算」多一层警示配色。
   未设预算时模板不渲染这个元素，因此这里的规则不会凭空出现在页面上。 */
.hero-stat>.pending-block {
  border:1px solid var(--border);
  background:var(--bg-tint);
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  border-radius:10px;
  margin:0;
  padding:6px 10px;
  font-size:11.5px;
  font-weight:700}
.hero-stat>.pending-block.over {
  border-color:var(--warning);
  background:color-mix(in srgb, var(--warning) 10%, var(--card));
  color:var(--warning)}
.ledger-quick-entry {
  border:1px solid var(--border-strong);
  background:var(--card);
  border-radius:12px;
  justify-content:space-between;
  align-items:center;
  gap:14px;
  padding:12px 14px;
  display:flex}
.ledger-quick-entry div {
  flex-direction:column;
  gap:2px;
  min-width:0;
  display:flex}
.ledger-quick-entry b {
  font-size:13px}
.ledger-quick-entry small {
  color:var(--ink-soft);
  font-size:11px}
.ledger-quick-entry .btn {
  flex:none;
  min-height:42px}
.pending-list {
  flex-direction:column;
  gap:8px;
  display:flex}
/* 这是**可点击**的行（点了切到"账单"页签，见模板里的 @click="tab = 'bills'"），不是普通展示行，
   所以有 cursor:pointer 与 hover 反馈。没有给它 role/tabindex：它只是切页签的**快捷方式**，
   同一个功能键盘用户走页签栏即可到达，所以不构成"只有鼠标能用"。
   第三十七轮的死类清理名单里曾把它当成无用行，这里是"故意保留"。 */
.pending-row {
  cursor:pointer;
  border:1px solid var(--border);
  background:var(--card);
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
  border-radius:12px;
  align-items:center;
  gap:10px;
  padding:11px 14px;
  display:flex}
.pending-row:hover {
  border-color:var(--border-strong);
  box-shadow:var(--shadow-sm)}
.p-main {
  flex-direction:column;
  flex:1;
  gap:2px;
  min-width:0;
  display:flex}
.p-main b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:13.5px;
  overflow:hidden}
.p-main small {
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  font-size:11.5px}
.p-close {
  color:#b6bdcb;
  cursor:pointer;
  background:0 0;
  border:none;
  border-radius:7px;
  width:26px;
  height:26px;
  font-size:12px}
.p-close:hover {
  color:var(--ink-soft);
  background:var(--bg)}
.pending-actions {
  align-items:center;
  gap:4px;
  display:inline-flex}
.freq-row {
  flex-wrap:wrap;
  gap:8px;
  display:flex}
.freq-pill {
  border:1px solid var(--border-strong);
  background:var(--card);
  cursor:pointer;
  height:40px;
  transition:border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
  border-radius:12px;
  align-items:center;
  gap:7px;
  padding:0 14px;
  display:inline-flex}
.freq-pill:hover {
  border-color:var(--primary);
  background:var(--primary-soft);
  transform:translateY(-1px)}
.freq-icon {
  font-size:14px}
.freq-pill b {
  font-size:13px;
  font-weight:700}
.freq-pill small {
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  font-size:11.5px}
.search-row {
  align-items:center;
  gap:8px;
  display:flex}
.search-icon {
  opacity:.7;
  font-size:13px}
.search-input {
  flex:1;
  min-width:0}
.filter-panel {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:12px;
  flex-direction:column;
  gap:10px;
  margin-top:10px;
  padding:12px;
  display:flex}
.custom-range {
  align-items:center;
  gap:8px;
  display:flex}
.custom-range i {
  color:var(--ink-faint);
  font-size:12px;
  font-style:normal}
.custom-range input {
  width:auto}
.filter-line {
  grid-template-columns:repeat(5,1fr);
  gap:8px;
  display:grid}
.filter-line select,.filter-line input {
  width:100%;
  min-width:0}
.feed {
  flex-direction:column;
  display:flex}
.feed-virtual-item {
  flex:none}
.feed-day-item {
  box-sizing:border-box;
  height:34px}
.feed-day-item.first {
  height:20px}
.feed-day {
  box-sizing:border-box;
  height:100%;
  color:var(--ink-faint);
  letter-spacing:.04em;
  align-items:baseline;
  gap:8px;
  margin:0;
  padding-top:14px;
  font-size:11.5px;
  font-weight:800;
  display:flex}
.feed-day-item.first .feed-day {
  padding-top:0}
.feed-day small {
  color:var(--ink-soft);
  letter-spacing:0;
  font-size:10.5px;
  font-weight:600}
.feed-transaction-item {
  height:62px}
.feed-item {
  box-sizing:border-box;
  cursor:pointer;
  height:100%;
  transition:background var(--dur-fast) var(--ease-standard);
  border-radius:11px;
  align-items:center;
  gap:12px;
  padding:10px 12px;
  display:flex}
.feed-item:hover {
  background:var(--bg-tint)}
.feed-item.highlighted {
  background:var(--primary-soft);
  box-shadow:inset 3px 0 var(--primary)}
.fi-main {
  flex-direction:column;
  flex:1;
  gap:2px;
  min-width:0;
  display:flex}
.fi-main b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:14px;
  font-weight:650;
  overflow:hidden}
.fi-main small {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:11.5px}
.fi-amount {
  color:var(--text);
  font-variant-numeric:tabular-nums;
  flex:none;
  font-size:14.5px;
  font-weight:750}
.fi-amount.income,.fi-amount.refund {
  color:var(--success)}
.quick-form {
  flex-direction:column;
  gap:10px;
  display:flex}
.natural-entry-link {
  color:var(--primary);
  cursor:pointer;
  background:0 0;
  border:0;
  align-self:flex-end;
  padding:3px 6px;
  font-size:12px;
  font-weight:700}
.natural-entry-link:hover {
  background:var(--primary-soft);
  border-radius:6px}
.amount-input {
  text-align:center;
  letter-spacing:.02em;
  font-variant-numeric:tabular-nums;
  width:100%;
  padding:12px 14px;
  font-size:26px;
  font-weight:800}
.direction-toggle {
  background:var(--bg-tint);
  border-radius:10px;
  grid-template-columns:1fr 1fr;
  gap:4px;
  padding:3px;
  display:grid}
.direction-toggle button {
  min-height:36px;
  color:var(--ink-soft);
  cursor:pointer;
  background:0 0;
  border:0;
  border-radius:8px;
  font-size:13px;
  font-weight:750}
.direction-toggle button.on {
  color:var(--primary);
  background:var(--card);
  box-shadow:var(--shadow-sm)}
.name-input {
  width:100%;
  padding:11px 13px;
  font-size:14.5px}
.more-toggle {
  color:var(--ink-faint);
  cursor:pointer;
  background:0 0;
  border:none;
  border-radius:7px;
  align-self:flex-start;
  padding:4px 8px;
  font-size:12px;
  font-weight:600}
.more-toggle:hover {
  color:var(--primary);
  background:var(--primary-soft)}
.more-toggle i {
  margin-left:4px;
  font-size:10px;
  font-style:normal}
.more-area {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:12px;
  flex-direction:column;
  gap:10px;
  padding:12px;
  display:flex}
.cat-chips .chip {
  height:32px;
  padding:0 12px;
  font-size:12px}
.more-grid {
  grid-template-columns:1fr 1fr;
  gap:10px;
  display:grid}
.category-more-toggle {
  color:var(--primary);
  cursor:pointer;
  background:0 0;
  border:0;
  align-self:flex-start;
  padding:2px 5px;
  font-size:11.5px}
.more-grid label {
  color:var(--ink-soft);
  flex-direction:column;
  gap:5px;
  font-size:11.5px;
  display:flex}
.quick-actions {
  gap:8px;
  margin-top:4px;
  display:flex}
.save-btn {
  flex:1;
  height:44px;
  font-size:15px}
.quick-actions .btn-ghost {
  height:44px}
.dup-warn,.cycle-suggest {
  color:var(--warning);
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:var(--bg-tint);
  border-radius:10px;
  flex-direction:column;
  gap:8px;
  padding:10px 12px;
  font-size:12.5px;
  display:flex}
.cycle-suggest {
  color:var(--ink-soft);
  border-color:var(--border);
  background:var(--bg-tint)}
.dw-actions {
  justify-content:flex-end;
  gap:8px;
  display:flex}
.detail-body {
  flex-direction:column;
  gap:12px;
  display:flex}
.detail-amount {
  text-align:center;
  font-variant-numeric:tabular-nums;
  font-size:32px;
  font-weight:900}
.detail-amount.income,.detail-amount.refund {
  color:var(--success)}
.detail-meta {
  color:var(--ink-soft);
  flex-wrap:wrap;
  justify-content:center;
  gap:6px 14px;
  font-size:12.5px;
  display:flex}
.detail-note {
  color:var(--ink-soft);
  background:var(--bg-tint);
  border-radius:10px;
  margin:0;
  padding:10px 12px;
  font-size:12.5px}
.detail-actions {
  flex-wrap:wrap;
  justify-content:center;
  gap:8px;
  display:flex}
.detail-edit-grid {
  grid-template-columns:1fr 1fr;
  gap:10px;
  display:grid}
.detail-edit-grid label {
  color:var(--ink-soft);
  flex-direction:column;
  gap:5px;
  font-size:11.5px;
  font-weight:700;
  display:flex}
.detail-edit-grid label:last-child {
  grid-column:1/-1}
.detail-edit-grid input,.detail-edit-grid select {
  width:100%;
  min-height:42px}
.detail-edit-actions {
  justify-content:flex-end}
.bill-form {
  flex-direction:column;
  gap:16px;
  display:flex}
.bill-form-intro {
  color:var(--ink-faint);
  margin:-4px 0 1px;
  font-size:12.5px;
  line-height:1.5}
.bill-form-grid {
  grid-template-columns:1fr 1fr;
  gap:12px;
  display:grid}
.bill-field {
  flex-direction:column;
  gap:7px;
  min-width:0;
  display:flex}
.refund-form {
  flex-direction:column;
  gap:14px;
  display:flex}
.refund-hint {
  color:var(--ink-soft);
  margin:0;
  font-size:12.5px;
  line-height:1.6}
.bill-field>span {
  color:var(--ink-soft);
  font-size:12px;
  font-weight:700}
.bill-field>span i {
  color:var(--primary);
  margin-left:4px;
  font-size:10px;
  font-style:normal;
  font-weight:700}
.bill-field>span em {
  color:var(--ink-faint);
  margin-left:4px;
  font-size:10px;
  font-style:normal;
  font-weight:500}
.bill-field input,.bill-field select {
  width:100%;
  min-width:0;
  height:44px}
.bill-money-input {
  position:relative}
.bill-money-input b {
  color:var(--ink-faint);
  pointer-events:none;
  font-size:14px;
  position:absolute;
  top:50%;
  left:13px;
  transform:translateY(-50%)}
.bill-money-input input {
  padding-left:31px}
.bill-options {
  grid-template-columns:1fr 1fr;
  gap:10px;
  display:grid}
.bill-switch {
  cursor:pointer;
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:12px;
  align-items:center;
  gap:10px;
  min-width:0;
  padding:11px 12px;
  display:flex}
.bill-switch>input {
  opacity:0;
  pointer-events:none;
  width:1px;
  height:1px;
  position:absolute}
.bill-switch>span:last-child {
  flex-direction:column;
  gap:1px;
  min-width:0;
  display:flex}
.bill-switch b {
  font-size:12.5px}
.bill-switch small {
  color:var(--ink-faint);
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:10px;
  overflow:hidden}
.switch-track {
  width:34px;
  height:20px;
  transition:background var(--dur-base) var(--ease-standard);
  background:#cbd2df;
  border-radius:999px;
  flex:0 0 34px;
  position:relative}
.switch-track i {
  width:14px;
  height:14px;
  transition:transform var(--dur-base) var(--ease-standard);
  background:#fff;
  border-radius:50%;
  position:absolute;
  top:3px;
  left:3px;
  box-shadow:0 1px 3px #1e284638}
.bill-switch>input:checked+.switch-track {
  background:var(--primary)}
.bill-switch>input:checked+.switch-track i {
  transform:translate(14px)}
.bill-switch>input:focus-visible+.switch-track {
  outline:2px solid var(--primary);
  outline-offset:2px}
.bill-error {
  color:var(--danger);
  background:var(--bg-tint);
  border-radius:9px;
  margin:-5px 0 0;
  padding:9px 11px;
  font-size:12px}
.bill-form-actions {
  justify-content:flex-end;
  gap:8px;
  padding-top:2px;
  display:flex}
.bill-form-actions .btn-danger {
  margin-right:auto}
.tab-head {
  justify-content:space-between;
  align-items:center;
  gap:12px;
  display:flex}
.tab-desc {
  color:var(--ink-faint);
  margin:0;
  font-size:12.5px}
.bill-group+.bill-group {
  margin-top:18px}
.bill-list {
  flex-direction:column;
  gap:10px;
  display:flex}
.bill-row {
  cursor:pointer;
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
  grid-template-columns:minmax(0,1fr) auto;
  align-items:center;
  gap:12px;
  padding:13px 16px;
  display:grid}
.bill-main {
  min-width:0;
  color:inherit;
  font:inherit;
  text-align:left;
  cursor:pointer;
  background:0 0;
  border:0;
  grid-template-columns:minmax(0,1fr) auto;
  align-items:center;
  gap:12px;
  padding:0;
  display:grid}
.bill-row:hover {
  border-color:var(--border-strong);
  box-shadow:var(--shadow-sm)}
.bill-row.over {
  border-color:#f3c2c2}
.b-main {
  flex-direction:column;
  gap:2px;
  min-width:0;
  display:flex}
.b-main b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:14px;
  overflow:hidden}
.b-main small {
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  font-size:11.5px}
.b-amount {
  white-space:nowrap;
  font-variant-numeric:tabular-nums;
  font-size:15.5px;
  font-weight:800}
.b-amount small {
  color:var(--ink-faint);
  margin-left:2px;
  font-size:10.5px;
  font-weight:600}
.b-actions {
  gap:6px;
  display:flex}
.bill-row.paused {
  opacity:.6}
.bill-row.today .b-main small {
  color:var(--danger);
  font-weight:700}
.form-note {
  color:var(--ink-faint);
  margin:4px 0 0;
  font-size:11.5px;
  line-height:1.5}


.month-nav {
  justify-content:center;
  align-items:center;
  gap:18px;
  padding:10px;
  display:flex}
.month-nav b {
  text-align:center;
  min-width:72px;
  font-size:15px}
.mn-btn {
  width:32px;
  height:32px;
  color:var(--ink-soft);
  border:1px solid var(--border);
  background:var(--card);
  cursor:pointer;
  border-radius:9px;
  font-size:16px}
.mn-btn:hover:not(:disabled) {
  color:var(--primary);
  border-color:var(--primary)}
.mn-btn:disabled {
  opacity:.35;
  cursor:not-allowed}
.review-export {
  gap:6px;
  margin-left:auto;
  display:flex}
.review-export .btn {
  min-height:30px;
  padding:4px 10px;
  font-size:11.5px}
.review-tab {
  flex-direction:column;
  gap:14px;
  display:flex}
.review-summary {
  flex-direction:column;
  gap:12px;
  display:flex}
.rs-top {
  justify-content:space-between;
  align-items:baseline;
  gap:10px;
  display:flex}
.rs-top span {
  color:var(--ink-soft);
  font-size:13px}
.rs-top b {
  font-variant-numeric:tabular-nums;
  letter-spacing:-.01em;
  font-size:30px;
  font-weight:900}
.rs-facts {
  border:1px solid var(--border);
  background:var(--border);
  border-radius:11px;
  grid-template-columns:repeat(3,1fr);
  gap:1px;
  display:grid;
  overflow:hidden}
.rs-facts>div {
  background:var(--bg-tint);
  flex-direction:column;
  gap:3px;
  min-width:0;
  padding:10px 13px;
  display:flex}
.rs-facts small {
  color:var(--ink-faint);
  font-size:10.5px}
.rs-facts b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:12.5px;
  overflow:hidden}
.cat-bars {
  flex-direction:column;
  gap:9px;
  display:flex}
.cat-bar-row {
  grid-template-columns:76px minmax(0,1fr) auto;
  align-items:center;
  gap:10px;
  display:grid}
/* 首页「本月分类」的一行：从纯展示改成按钮（点一下去回顾页看这个分类的明细）。
   按钮默认样式（背景、边框、字体、内边距）在这里全部归零，视觉与改造前的 div 完全一致。 */
.cat-bar-row.cat-bar-link {
  width:100%;
  color:var(--text);
  cursor:pointer;
  text-align:left;
  font:inherit;
  background:0 0;
  border:0;
  border-radius:9px;
  padding:3px 4px}
.cat-bar-row.cat-bar-link:hover {
  background:var(--bg-tint)}
.cat-bar-row.cat-bar-link:hover .cb-value {
  color:var(--primary)}
.cat-more-note {
  color:var(--ink-faint);
  margin:8px 0 0;
  font-size:11.5px;
  line-height:1.5}
/* ---------- 回顾「分类分布」 ----------
   .rc-bar 是 .cat-bar-row 的四列版本（名称 / 进度条 / 金额 / 展开箭头）；
   整行是可点开的按钮，所以按钮原生样式同样归零。 */
.rc-head {
  justify-content:space-between;
  align-items:baseline;
  gap:10px;
  display:flex}
.rc-sum {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:11.5px}
.rc-item {
  flex-direction:column;
  display:flex}
.cat-bar-row.rc-bar {
  width:100%;
  color:var(--text);
  cursor:pointer;
  text-align:left;
  font:inherit;
  background:0 0;
  border:0;
  border-radius:9px;
  grid-template-columns:minmax(0,92px) minmax(0,1fr) auto 12px;
  padding:5px 6px}
.cat-bar-row.rc-bar:hover {
  background:var(--bg-tint)}
.cat-bar-row.rc-bar.open {
  background:var(--primary-soft)}
.rc-bar .cb-name {
  flex-direction:column;
  gap:1px;
  display:flex}
.cb-label {
  text-overflow:ellipsis;
  white-space:nowrap;
  overflow:hidden}
.rc-bar .cb-meta {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:10px}
.cb-caret {
  color:var(--ink-faint);
  text-align:right;
  font-size:9px}
.rc-detail {
  border-left:2px solid var(--primary-soft);
  flex-direction:column;
  margin:0 0 4px 12px;
  padding:2px 0 2px 10px;
  display:flex}
.rc-detail-row {
  color:var(--text);
  cursor:pointer;
  text-align:left;
  font:inherit;
  background:0 0;
  border:0;
  border-radius:7px;
  grid-template-columns:minmax(0,1fr) auto auto;
  align-items:center;
  gap:10px;
  padding:6px 5px;
  font-size:12.5px;
  display:grid}
.rc-detail-row:hover {
  background:var(--bg-tint)}
.rc-detail-row:hover b {
  color:var(--primary)}
.rc-detail-row small {
  color:var(--ink-faint);
  font-size:11px}
.rc-detail-row b {
  font-variant-numeric:tabular-nums}
.rd-name {
  text-overflow:ellipsis;
  white-space:nowrap;
  overflow:hidden}
.rc-detail-foot {
  color:var(--ink-faint);
  margin:4px 0 0;
  font-size:11px}
.rc-toggle {
  align-self:flex-start;
  margin-top:10px}
/* 概览卡里「花得最多 / 最大一笔」两个直达入口：外观与相邻的静态格子完全一致，
   只有悬停时金额变色，暗示它可以点。 */
.rs-facts>button.rs-fact-link {
  background:var(--bg-tint);
  cursor:pointer;
  text-align:left;
  color:inherit;
  font:inherit;
  border:0;
  flex-direction:column;
  gap:3px;
  min-width:0;
  padding:10px 13px;
  display:flex}
.rs-facts>button.rs-fact-link:hover b {
  color:var(--primary)}
.cb-name {
  color:var(--ink-soft);
  white-space:nowrap;
  text-overflow:ellipsis;
  font-size:12px;
  overflow:hidden}
.cb-track {
  background:var(--border);
  border-radius:999px;
  height:8px;
  overflow:hidden}
.cb-track i {
  border-radius:inherit;
  background:linear-gradient(90deg, var(--brand-grad-a), var(--brand-grad-b));
  height:100%;
  display:block}
.cb-value {
  color:var(--text);
  font-variant-numeric:tabular-nums;
  font-size:12px;
  font-weight:700}
.cal-week {
  grid-template-columns:repeat(7,1fr);
  gap:4px;
  margin-bottom:4px;
  display:grid}
.cal-week span {
  color:var(--ink-faint);
  text-align:center;
  font-size:10.5px}
.cal-grid {
  grid-template-columns:repeat(7,1fr);
  gap:4px;
  display:grid}
.cal-cell {
  height:44px;
  color:var(--text);
  cursor:pointer;
  font-variant-numeric:tabular-nums;
  background:0 0;
  border:none;
  border-radius:9px;
  flex-direction:column;
  align-items:center;
  gap:3px;
  font-size:12px;
  display:flex;
  position:relative}
.cal-cell:hover {
  background:var(--bg-tint)}
.cal-cell.blank {
  cursor:default}
.cal-cell i {
  background:#c9d4f2;
  border-radius:50%;
  width:6px;
  height:6px}
.cal-cell.l2 i {
  background:#8ea6e8;
  width:7px;
  height:7px}
.cal-cell.l3 i {
  background:var(--primary);
  width:8px;
  height:8px}
.cal-cell.selected {
  background:var(--primary-soft);
  box-shadow:inset 0 0 0 1px var(--primary)}
.cal-detail {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:11px;
  margin-top:12px;
  padding:11px 13px}
.cal-detail>b {
  font-size:13px}
.cal-detail>small {
  color:var(--ink-faint);
  margin:2px 0 6px;
  font-size:11px;
  display:block}
.cd-row {
  cursor:pointer;
  border-top:1px solid var(--border);
  grid-template-columns:1fr auto auto;
  align-items:center;
  gap:10px;
  padding:6px 0;
  font-size:12.5px;
  display:grid}
.cd-row:hover b {
  color:var(--primary)}
.cd-row small {
  color:var(--ink-faint);
  font-size:11px}
.cd-row b {
  font-variant-numeric:tabular-nums}
.category-block {
  padding-top:2px}
.compact-bars {
  gap:8px}
.cat-manage {
  flex-direction:column;
  gap:6px;
  display:flex}
.category-scope-tabs,.category-view-tabs {
  background:var(--bg-tint);
  border-radius:9px;
  gap:5px;
  padding:3px;
  display:flex;
  overflow-x:auto}
.category-scope-tabs button,.category-view-tabs button {
  color:var(--ink-soft);
  cursor:pointer;
  background:0 0;
  border:0;
  border-radius:7px;
  flex:none;
  padding:7px 10px;
  font-size:11.5px;
  font-weight:700}
.category-scope-tabs button.on,.category-view-tabs button.on {
  color:var(--primary);
  background:var(--card);
  box-shadow:var(--shadow-sm)}
.category-empty {
  color:var(--ink-faint);
  text-align:center;
  padding:14px 8px;
  font-size:12px}
.cat-row {
  border-radius:10px;
  align-items:center;
  gap:10px;
  padding:7px 10px;
  display:flex}
.cat-row:hover {
  background:var(--bg-tint)}
.cat-row.hidden {
  opacity:.5}
.cat-icon {
  border:1px solid var(--border);
  background:var(--card);
  cursor:pointer;
  border-radius:9px;
  width:34px;
  height:34px;
  font-size:17px}
.cat-name {
  flex-direction:column;
  flex:1;
  min-width:0;
  display:flex}
.cat-row b {
  font-size:13px}
.cat-name small {
  color:var(--ink-faint);
  font-size:10px}
.cat-ops {
  gap:4px;
  display:flex}
.cat-ops .link-btn {
  padding:3px 4px}
.cat-add {
  gap:8px;
  margin-top:8px;
  display:flex}
.cat-add input {
  flex:1}
@media (max-width:768px) {
  .page {
  gap:14px}
.hero-stat {
  padding:18px 18px 16px}
.ledger-quick-entry {
  flex-direction:column;
  align-items:flex-start;
  gap:9px}
.ledger-quick-entry .btn {
  width:100%}
.search-row .btn-sm {
  padding:8px 12px}
.filter-line {
  grid-template-columns:1fr 1fr}
.freq-pill {
  height:42px}
.feed-item {
  padding:11px 8px}
.tab-head {
  flex-direction:column;
  align-items:flex-start;
  gap:8px}
.bill-row {
  grid-template-columns:minmax(0,1fr)}
.bill-main {
  grid-template-columns:minmax(0,1fr) auto}
.b-amount {
  order:-1;
  grid-area:1/2}
.b-main {
  grid-area:1/1}
.b-actions {
  grid-column:1/-1;
  justify-content:flex-start}
.b-actions .btn {
  flex:1}
.rs-facts {
  grid-template-columns:1fr}
.rs-top b {
  font-size:26px}
.cal-cell {
  height:40px}
.cat-bar-row.rc-bar {
  grid-template-columns:minmax(0,76px) minmax(0,1fr) auto 10px;
  gap:8px}

}
@media (max-width:480px) {
  .bill-form {
  gap:14px}
.bill-form-grid,.bill-options {
  grid-template-columns:1fr}
.bill-switch small {
  white-space:normal}
.bill-form-actions {
  padding:12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top:1px solid var(--border);
  background:var(--card);
  margin:0 -16px -18px;
  position:sticky;
  bottom:0}
.bill-form-actions .btn-primary {
  flex:1}
.filter-line {
  grid-template-columns:1fr}
.spend-metrics {
  gap:6px}
.spend-metric {
  padding:9px 8px}
.spend-metric b {
  font-size:15px}
.detail-actions .btn {
  flex:40%}
.detail-edit-grid {
  grid-template-columns:1fr}
.detail-edit-grid label:last-child {
  grid-column:auto}
.detail-edit-actions {
  justify-content:stretch}
.detail-edit-actions .btn {
  flex:1}
.quick-actions {
  flex-direction:column-reverse}
.quick-actions .btn {
  width:100%}
}

</style>
