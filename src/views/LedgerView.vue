<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Modal from '../components/Modal.vue'
import PromptDialog from '../components/PromptDialog.vue'
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
import { useLedgerFeed } from '../composables/ledgerView/feed.js'
import { useLedgerSpendStats } from '../composables/ledgerView/spendStats.js'
import { useLedgerExport } from '../composables/ledgerView/export.js'
import { useLedgerBills } from '../composables/ledgerView/bills.js'
import { useLedgerReview } from '../composables/ledgerView/review.js'
import { templateToBillForm, useLedgerTemplateCommands } from '../composables/ledgerTemplates.js'
import { buildSplit, hasSplit, mySpendCents, mySpendYuan, normalizeSplit, personalMonthCategoryTotals, personalSpendTotals, splitCentsEvenly } from '../composables/ledgerSplit.js'

// 本轮新增：筛选、快速记账表单、记录详情、汇率预算页面态
// const filters = useLedgerFilters()  // 不再需要，feed.js 已包含筛选逻辑
import { useQuickEntryForm } from '../composables/ledgerView/useQuickEntryForm.js'
import { useTransactionDetail } from '../composables/ledgerView/useTransactionDetail.js'
import { useLedgerFxBudget } from '../composables/ledgerView/useLedgerFxBudget.js'

// 三个分区各自一个文件（ledger-panels/）：本文件只保留分区壳 + 共享的弹窗与交互状态。
import LedgerHomePanel from './ledger-panels/LedgerHomePanel.vue'
import BillFormModal from './ledger-panels/BillFormModal.vue'
import BillsPanel from './ledger-panels/BillsPanel.vue'
import BudgetSettingsModal from './ledger-panels/BudgetSettingsModal.vue'
import FxSettingsModal from './ledger-panels/FxSettingsModal.vue'
import ReviewPanel from './ledger-panels/ReviewPanel.vue'
// 新增的两个弹窗组件（从 LedgerView.vue 拆出）
import QuickEntryModal from './ledger-panels/QuickEntryModal.vue'
import TransactionDetailModal from './ledger-panels/TransactionDetailModal.vue'

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
const openSwipeId = ref('')
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })
function closeSwipe() {
  openSwipeId.value = ''
}
function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}
const ledgerToday = () => appToday.value

/* ================= 固定账单 ================= */
// 账单周期。`once` 此前在 domain.ts 与 commands.js 里都被接受，但下拉里没有这一项，
// 于是「一次性付款」永远选不到，`nextBillDate` 里 `cycle !== 'once'` 那条分支实际不可达。
// `monthFactor` 是「一次付款折合多少个月的固定支出」；四个周期原本都定义了却全仓无人读取，
// 所以「每月固定支出总额」这类汇总算不出来。`once` 折算为 0：它不构成每月固定开销。
const CYCLES = {
  weekly: { label: '每周', short: '周', monthFactor: 52 / 12 },
  monthly: { label: '每月', short: '月', monthFactor: 1 },
  quarterly: { label: '每季度', short: '季度', monthFactor: 1 / 3 },
  yearly: { label: '每年', short: '年', monthFactor: 1 / 12 },
  once: { label: '仅此一次', short: '单次', monthFactor: 0 },
}

/* 添加/编辑固定账单弹窗在 BillFormModal.vue：状态、校验、模板库、删除确认都在子组件里，
   页面只留唯一入口（首页与固定账单面板都 emit 到这里）。 */
const billFormEl = ref(null)
function openBillForm(prefill = {}, editing = null) {
  billFormEl.value?.open(prefill, editing)
}
function toggleBillActive(bill) {
  const target = domain.setBillActive(bill.id, bill.active === false)
  if (!target) return
  showToast(target.active ? `已恢复固定账单「${target.name}」` : `已暂停固定账单「${target.name}」`)
}

const {
  bills, billStatus, billDateLabel, billAmountText, markPaid, skipOnce,
  pendingBills, dismissPending, dueBills, laterBills, pausedBills,
} = useLedgerBills({ domain, notify: showToast, ledgerToday })
const ledgerNowHM = () => policyTimeKey(appNow.value)

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

// 读取侧：URL 决定分区。顺带把生效后的分区调和回 URL（含清掉看不懂的参数）。
// 原来这里前后挂了两个一模一样的 watcher，第一个是纯粹的冗余（第二个包含它），
// 每次 query 变化都要白跑一遍映射与收起手势。
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
const feed = useLedgerFeed({
  // 换筛选条件 ⇒ 收起滑动手势（「查看全部」由 feed 自己收起）。
  // 这个回调以前是空的，于是筛选一变，正在展开的行会留在展开态。
  onFilterChange: () => {
    closeSwipe()
  },
})
const {
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
} = feed

function flashTransaction(id) {
  highlightedTransactionId.value = String(id)
  window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => { highlightedTransactionId.value = '' }, 2600)
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
  if (action === 'edit') {
    const target = expenses.value.find((item) => String(item.id) === String(id))
    if (target) {
      openDetail(target.id)
      detailAmountInput.value = String(target.amount ?? '')
      detailCategoryInput.value = target.cat || ''
      detailDateInput.value = target.date || ledgerToday()
      detailCurrencyInput.value = normalizeCurrency(target.currency) || baseCurrency.value
      detailEdit.value = true
      nextTick(() => document.querySelector('.detail-edit-amount')?.focus())
    }
  } else if (action === 'delete') {
    deleteTransactionById(id)
  } else if (action === 'undo-bill') {
    undoBillPaymentById(id)
  }
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
  showToast(`已删除 ${moneyRow(snapshot.amount)} · ${snapshot.name}`, {
    actionLabel: '撤销',
    undoFn: () => {
      domain.restoreDeletedTransaction(snapshot)
    },
  })
}

const highlightedTransactionId = ref('')
const detailItem = ref(null)
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
// 三个口径块（今天/本周/本月 + 分摊摘要 + 环比）整段搬进 composables/ledgerView/spendStats.js。
const { mySpendPeriodStats, spendStats, currentMonthPersonal, currentMonthHasSplit, monthCompare } = useLedgerSpendStats()

/* ================= 多币种汇率 + 预算（页面侧派生） ================= */
// 汇率与预算都是页面侧的新 computed：既有的 monthStats / spendStats 一行没改。
const { fx } = useLedgerFx()
const { budget } = useLedgerBudget()
// 基准币种口径的月度摘要：供 fxRateLine / budgetAlert / 导出共用
const baseMonthSummary = computed(() => sumLedgerMonthInBase(expenses.value, fx.value, ledgerToday().slice(0, 7), { amountOf: mySpendYuan }))

// 新增：快速记账表单 composable
const {
  showQuickRecord,
  moreOpen,
  amountInput,
  nameInput,
  catInput,
  dateInput,
  timeInput,
  noteInput,
  accountInput,
  sourceInput,
  billIdInput,
  currencyInput,
  splitCount,
  splitMine,
  splitPreview,
  dupWarn,
  forceDup,
  keepAdding,
  savingExpense,
  directionInput,
  cycleSuggest,
  suggestedCategoryInput,
  categoryInputManuallySelected,
  showAllQuickCategories,
  currencyOptions,
  quickCatChips,
  duplicateHit,
  openQuick: openQuickForm,
  closeQuick,
  // 模板里 QuickEntryModal 的这四个事件直接绑到它们身上（见下方 @save / @select-category 等），
  // 少解构任何一个，Vue 都会在渲染时警告"not defined on instance"，而点击时静默无反应——
  // 也就是「记一笔」的保存按钮彻底失灵。必须与模板里的绑定一一对应。
  saveExpense,
  openQuickRecord,
  onQuickRecordSaved,
  selectQuickCategory,
} = useQuickEntryForm({
  baseCurrency: computed(() => normalizeLedgerFx(fx.value).base),
  domain,
  notify: showToast,
  closeSwipe,
  ledgerNowHM,
})

// 父组件持有的弹窗开关
const showQuick = ref(false)
const editingId = ref(null)

// 包装 openQuick：先填表单，再打开父组件的弹窗
function openQuick(prefill = {}) {
  openQuickForm(prefill)
  showQuick.value = true
  editingId.value = prefill.id ?? null
}

// 关闭记一笔。
//
// 【为什么不能直接绑 composable 的 closeQuick】composable 里那个 closeQuick 只做
// 表单收尾（keepAdding / savingExpense 复位），弹窗开关 showQuick 是页面持有的 ref。
// 之前 `@close="closeQuick"` 绑的正是它，于是 ✕ / 点遮罩 / Esc 三条路径都只清了
// 表单状态，showQuick 一直是 true —— 表现就是「点 × 完全没反应」。
// 记一笔的开关与编辑态必须在这里一起收掉。
function closeQuickModal() {
  closeQuick()
  showQuick.value = false
  editingId.value = null
}

/**
 * 「记下」/「保存并继续」的统一入口。
 *
 * keepOpen（保存并继续）时保持弹窗开着继续记，这是产品要的。
 * 否则只有**确实存进去了**才收起弹窗：金额非法、重复待确认、分摊数据不合法
 * 这几种「没存」的情况必须留在原地让用户改，一关掉就把用户刚填的东西全丢了。
 */
async function handleQuickSave(keepOpen) {
  const saved = await saveExpense(keepOpen, editingId.value)
  if (saved && !keepOpen) closeQuickModal()
}

// 新增：记录详情 composable
const {
  open: detailOpen,
  detailExpense,
  detailEdit,
  detailAmountInput,
  detailCategoryInput,
  detailDateInput,
  detailCurrencyInput,
  showRefund,
  refundItem,
  refundAmountInput,
  refundDateInput,
  refundNoteInput,
  openDetail,
  closeDetail,
  editFromDetail,
  cancelDetailEdit,
  saveDetailEdit,
  againFromDetail,
  fullEditFromDetail,
  undoBillPaymentFromDetail,
  deleteFromDetail,
  openRefund,
  closeRefund,
  confirmRefund,
  togglePinName,
  toggleHideName,
} = useTransactionDetail({
  domain,
  notify: showToast,
  closeSwipe,
  flashTransaction,
  highlightTransaction,
  baseCurrency: computed(() => normalizeLedgerFx(fx.value).base),
  ledgerToday,
  splitDetailNote,
})

// 新增：汇率/预算页面态 composable
const {
  baseCurrency,
  fxRateLine,
  budgetAlert,
  budgetPaceLine,
  showFxSettings,
  showBudgetSettings,
  fxAddableCurrencies,
} = useLedgerFxBudget({
  expenses,
  ledgerToday,
  baseMonthSummary,
})

/* ---------- 账单导出（按月，人类可读） ---------- */
// 导出（CSV / xlsx）整段搬进 composables/ledgerView/export.js；月份来自回顾分区。
const { exportLedgerCsv, exportLedgerXlsx, exportAllLedgerXlsx } = useLedgerExport({
  getMonth: () => reviewMonth.value,
  personalAmount,
  baseCurrency,
  notify: showToast,
})
const allActiveCategories = computed(() => [...activeCategories('expense'), ...activeCategories('income')])
const accountOptions = computed(() => [...new Set(ledgerIndex.value.sortedExpenses
  .map((item) => String(item?.account ?? '').trim())
  .filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const categoryOverview = computed(() => {
  // 与 hero 的「本月承担」同源：分类条回答的也是「我的钱花到哪去了」，
  // 用全额分类合计会让同一屏上出现「本月承担 ¥40 / 其它 ¥200」这种自相矛盾。
  //
  // 分母必须用**分类合计之和**（毛额），不能直接用 hero 的净额：
  // `personalMonthCategoryTotals` 刻意不把退款计入分类（退款是冲抵项，不是新消费），
  // 所以分子是毛、分母若是净，有退款时 pct 会算出 >100%（回顾页早就修过这个问题，
  // 首页这条路径当时漏了）。用分类自身求和做分母，三者恒等式恒成立：
  // Σ(分类) === Σ(分类条)，且退款不再让每根条都撑满。
  const entries = [...personalMonthCategoryTotals(expenses.value, ledgerToday()).entries()]
  const grossTotal = entries.reduce((sum, [, value]) => sum + value, 0)
  const total = grossTotal || 1
  return entries
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

/* ================= 回顾 ================= */
// 回顾分区的全部派生状态搬进 composables/ledgerView/review.js。
const {
  reviewMonth, shiftMonth, reviewLabel, monthlyReview, reviewTotal, reviewCount,
  mostFrequent, topCategory, maxSingle, maxSingleMine, REVIEW_CATEGORY_LIMIT,
  expandedCategory, showAllReviewCats, reviewCategoryRows, reviewCategorySum,
  visibleCategoryRows, hiddenCategoryCount, resetReviewCategoryView,
  toggleReviewCategory, revealReviewCategory, openReviewCategoryFromHome,
  reviewMyShareNote, calendarCells, selectedDay, selectedDayInfo,
} = useLedgerReview({ personalAmount, ledgerToday, tab })

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

    <!-- 三个分区各自拆成子组件（见 script 顶部的 import）：本文件只留分区壳。
         role="tabpanel" 与 aria-labelledby **留在本文件的包裹层**——tests/tabPanelSemantics
         按「同一个文件里 tab 的 id 必须被某个面板引用到」静态核对，拆走就断了。 -->
    <!-- ================= 账本首页 ================= -->
    <div v-if="tab === 'ledger'" role="tabpanel" aria-labelledby="ledger-tab-ledger">
      <LedgerHomePanel
        :spend-stats="spendStats"
        :current-month-has-split="currentMonthHasSplit"
        :current-month-personal="currentMonthPersonal"
        :month-compare="monthCompare"
        :fx-rate-line="fxRateLine"
        :budget-alert="budgetAlert"
    :budget-pace-line="budgetPaceLine"
        :budget="budget"
        :pending-bills="pendingBills"
        :bill-amount-text="billAmountText"
        :bill-date-label="billDateLabel"
        :frequent="frequent"
        :q="q"
        :show-filters="showFilters"
        :filters-active="filtersActive"
        :f-range="fRange"
        :f-from="fFrom"
        :f-to="fTo"
        :f-cat="fCat"
        :f-account="fAccount"
        :f-min="fMin"
        :f-max="fMax"
        :f-kind="fKind"
        :f-direction="fDirection"
        :all-active-categories="allActiveCategories"
        :account-options="accountOptions"
        :can-expand-feed="canExpandFeed"
        :filtered-expenses="filteredExpenses"
        :show-all-feed="showAllFeed"
        :feed-items="feedItems"
        :feed-item-height="feedItemHeight"
        :highlighted-transaction-id="highlightedTransactionId"
        :open-swipe-id="openSwipeId"
        :feed-secondary="feedSecondary"
        :feed-amount="feedAmount"
        :category-overview="categoryOverview"
        :month-category-keys="monthCategoryKeys"
        @open-bill-form="openBillForm"
        @mark-paid="markPaid"
        @dismiss-pending="dismissPending"
        @show-all-feed-change="showAllFeed = $event"
        @open-fx-settings="showFxSettings = true"
        @open-budget-settings="showBudgetSettings = true"
        @open-quick="openQuick"
        @open-category-manager="openCategoryManager"
        @use-frequent="useFrequent"
        @toggle-filters="showFilters = !showFilters"
        @clear-filters="clearFilters"
        @update-q="q = $event"
        @update-f-range="fRange = $event"
        @update-f-from="fFrom = $event"
        @update-f-to="fTo = $event"
        @update-f-cat="fCat = $event"
        @update-f-account="fAccount = $event"
        @update-f-min="fMin = $event"
        @update-f-max="fMax = $event"
        @update-f-kind="fKind = $event"
        @update-f-direction="fDirection = $event"
        @open-detail="openDetail"
        @transaction-swipe="onTransactionSwipe"
        @swipe-action="onTransactionSwipeAction"
        @swipe-open-change="onSwipeOpenChange"
        @switch-tab="tab = $event"
        @open-review-category="openReviewCategoryFromHome"
      />
    </div>

    <!-- ================= 固定账单 ================= -->
    <div v-else-if="tab === 'bills'" role="tabpanel" aria-labelledby="ledger-tab-bills">
      <BillsPanel
        :bills="bills"
        :due-bills="dueBills"
        :later-bills="laterBills"
        :paused-bills="pausedBills"
        :focused-bill-id="focusedBillId"
        :cycles="CYCLES"
        :bill-status="billStatus"
        :bill-date-label="billDateLabel"
        :bill-amount-text="billAmountText"
        :open-bill-form="openBillForm"
        :mark-paid="markPaid"
        :dismiss-pending="dismissPending"
        :skip-once="skipOnce"
        :toggle-bill-active="toggleBillActive"
      />
    </div>

    <!-- ================= 回顾 ================= -->
    <div v-else role="tabpanel" aria-labelledby="ledger-tab-review">
      <ReviewPanel
        :review-label="reviewLabel"
        :review-month="reviewMonth"
        :today-month="ledgerToday().slice(0, 7)"
        :review-count="reviewCount"
        :review-total="reviewTotal"
        :monthly-review="monthlyReview"
        :most-frequent="mostFrequent"
        :top-category="topCategory"
        :max-single="maxSingle"
        :max-single-mine="maxSingleMine"
        :review-my-share-note="reviewMyShareNote"
        :review-category-rows="reviewCategoryRows"
        :review-category-sum="reviewCategorySum"
        :visible-category-rows="visibleCategoryRows"
        :hidden-category-count="hiddenCategoryCount"
        :expanded-category="expandedCategory"
        :show-all-review-cats="showAllReviewCats"
        :category-limit="REVIEW_CATEGORY_LIMIT"
        :calendar-cells="calendarCells"
        :selected-day="selectedDay"
        :selected-day-info="selectedDayInfo"
        :personal-amount="personalAmount"
        :shift-month="shiftMonth"
        :export-ledger-csv="exportLedgerCsv"
        :export-ledger-xlsx="exportLedgerXlsx"
        :export-all-ledger-xlsx="exportAllLedgerXlsx"
        :reveal-review-category="revealReviewCategory"
        :toggle-review-category="toggleReviewCategory"
        :open-detail="openDetail"
        @selected-day-change="selectedDay = $event"
        @update:showAllReviewCats="showAllReviewCats = $event"
      />
    </div>

    <!-- ================= 记一笔 弹窗（拆出到 QuickEntryModal.vue）============= -->
    <QuickEntryModal
      :open="showQuick"
      :editing-id="editingId"
      :keep-adding="keepAdding"
      :base-currency="baseCurrency"
      :currency-options="currencyOptions"
      :quick-cat-chips="quickCatChips"
      :show-all-quick-categories="showAllQuickCategories"
      :direction-input="directionInput"
      :amount-input="amountInput"
      :name-input="nameInput"
      :cat-input="catInput"
      :date-input="dateInput"
      :time-input="timeInput"
      :note-input="noteInput"
      :account-input="accountInput"
      :source-input="sourceInput"
      :bill-id-input="billIdInput"
      :currency-input="currencyInput"
      :split-count="splitCount"
      :split-mine="splitMine"
      :split-preview="splitPreview"
      :dup-warn="dupWarn"
      :force-dup="forceDup"
      :cycle-suggest="cycleSuggest"
      :more-open="moreOpen"
      :saving-expense="savingExpense"
      :category-input-manually-selected="categoryInputManuallySelected"
      :suggested-category-input="suggestedCategoryInput"
      :duplicate-hit="duplicateHit"
      @update:open="showQuick = $event"
      @update:editing-id="editingId = $event"
      @update:keep-adding="keepAdding = $event"
      @update:amount-input="amountInput = $event"
      @update:name-input="nameInput = $event"
      @update:cat-input="catInput = $event"
      @update:date-input="dateInput = $event"
      @update:time-input="timeInput = $event"
      @update:note-input="noteInput = $event"
      @update:account-input="accountInput = $event"
      @update:source-input="sourceInput = $event"
      @update:bill-id-input="billIdInput = $event"
      @update:currency-input="currencyInput = $event"
      @update:split-count="splitCount = $event"
      @update:split-mine="splitMine = $event"
      @update:show-all-quick-categories="showAllQuickCategories = $event"
      @update:direction-input="directionInput = $event"
      @update:more-open="moreOpen = $event"
      @update:dup-warn="dupWarn = $event"
      @update:force-dup="forceDup = $event"
      @update:cycle-suggest="cycleSuggest = $event"
      @update:category-input-manually-selected="categoryInputManuallySelected = $event"
      @update:suggested-category-input="suggestedCategoryInput = $event"
      @save="handleQuickSave"
      @close="closeQuickModal"
      @open-quick-record="openQuickRecord"
      @open-bill-form="openBillForm"
      @quick-record-saved="onQuickRecordSaved"
      @select-category="selectQuickCategory"
      :show-quick-record="showQuickRecord"
    />

    <!-- ================= 记录详情（拆出到 TransactionDetailModal.vue）=============
         关闭事件绑 closeDetail() 而不是 `detailOpen = $event`：detailOpen 是只有
         getter 的 computed，直接赋值在开发环境报 "computed value is readonly"、
         在生产环境被静默丢弃，于是 ✕ / 点遮罩 / Esc 三条关闭路径全都失灵。 -->
    <TransactionDetailModal
      :open="detailOpen"
      :detail-expense="detailExpense"
      :detail-edit="detailEdit"
      :detail-amount-input="detailAmountInput"
      :detail-category-input="detailCategoryInput"
      :detail-date-input="detailDateInput"
      :detail-currency-input="detailCurrencyInput"
      :show-refund="showRefund"
      :refund-item="refundItem"
      :refund-amount-input="refundAmountInput"
      :refund-date-input="refundDateInput"
      :refund-note-input="refundNoteInput"
      :base-currency="baseCurrency"
      :splitDetailNote="splitDetailNote"
      @update:open="closeDetail()"
      @update:detail-edit="detailEdit = $event"
      @update:detail-amount-input="detailAmountInput = $event"
      @update:detail-category-input="detailCategoryInput = $event"
      @update:detail-date-input="detailDateInput = $event"
      @update:detail-currency-input="detailCurrencyInput = $event"
      @update:show-refund="showRefund = $event"
      @update:refund-item="refundItem = $event"
      @update:refund-amount-input="refundAmountInput = $event"
      @update:refund-date-input="refundDateInput = $event"
      @update:refund-note-input="refundNoteInput = $event"
      @edit-from-detail="editFromDetail"
      @save-detail-edit="saveDetailEdit"
      @cancel-detail-edit="cancelDetailEdit"
      @again-from-detail="openQuick($event); closeDetail()"
      @full-edit-from-detail="openQuick(fullEditFromDetail())"
      @undo-bill-payment-from-detail="undoBillPaymentFromDetail"
      @delete-from-detail="deleteFromDetail"
      @open-refund="openRefund"
      @close-refund="closeRefund"
      @confirm-refund="confirmRefund"
      @toggle-pin-name="togglePinName"
      @toggle-hide-name="toggleHideName"
    />

    <!-- ================= 添加/编辑 固定账单 ================= -->
    <BillFormModal
      ref="billFormEl"
      :bills="bills"
      :base-currency="baseCurrency"
      :domain="domain"
      :notify="showToast"
    />

    <!-- ================= 多币种汇率设置（手工维护，不联网） ================= -->
    <FxSettingsModal
      :open="showFxSettings"
      :base-currency="baseCurrency"
      :addable="fxAddableCurrencies"
      @close="showFxSettings = false"
      @notify="showToast"
    />

    <!-- ================= 月度预算 ================= -->
    <BudgetSettingsModal
      :open="showBudgetSettings"
      :base-currency="baseCurrency"
      @close="showBudgetSettings = false"
      @notify="showToast"
    />

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
/* 本轮拆分：账本首页 / 固定账单 / 回顾 三个分区的选择器随模板一起搬进了
   views/ledger-panels/{LedgerHomePanel,BillsPanel,ReviewPanel}.vue 自己的 <style scoped>。
   本块只剩分区壳（.ledger-tabs / .page）与**仍然留在本文件**的弹窗、分类管理样式——
   拆之前有一批选择器指向子组件内部节点，它们在 scoped 作用域下永远匹配不到元素
   （tests/scopedChildReachability.test.js 的判据），一并删除而不是搬走。 */
/* 样式迁移记录：QuickEntryModal、TransactionDetailModal、BillFormModal、FxSettingsModal、
   BudgetSettingsModal、LedgerHomePanel、BillsPanel、ReviewPanel 的 scoped 样式已随模板迁移。 */
.page {
  gap:16px;
  flex-direction:column;
  display:flex}
.ledger-tabs {
  align-self:flex-start}
.ledger-home {
  flex-direction:column;
  gap:16px;
  display:flex}
.cat-manage {
  flex-direction:column;
  gap:6px;
  display:flex}
.category-scope-tabs,.category-view-tabs {
  background:var(--bg-tint);
  border-radius:var(--radius-9);
  gap:5px;
  padding:3px;
  display:flex;
  overflow-x:auto}
.category-scope-tabs button,.category-view-tabs button {
  color:var(--ink-soft);
  cursor:pointer;
  background:0 0;
  border:0;
  border-radius:var(--radius-7);
  flex:none;
  padding:7px 10px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-700)}
.category-scope-tabs button.on,.category-view-tabs button.on {
  color:var(--primary);
  background:var(--card);
  box-shadow:var(--shadow-sm)}
.category-empty {
  color:var(--ink-faint);
  text-align:center;
  padding:14px 8px;
  font-size:var(--fs-12)}
.cat-row {
  border-radius:var(--radius-10);
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
  border-radius:var(--radius-9);
  width:34px;
  height:34px;
  font-size:var(--fs-17)}
.cat-name {
  flex-direction:column;
  flex:1;
  min-width:0;
  display:flex}
.cat-row b {
  font-size:var(--fs-13)}
.cat-name small {
  color:var(--ink-faint);
  font-size:var(--fs-10)}
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
@media (max-width:760px) {
  .page {
  gap:14px}
}
</style>