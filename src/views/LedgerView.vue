<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import VirtualList from '../components/VirtualList.vue'
import { todayStr, useStoredRef } from '../composables/store'
import { ledgerTabFromQuery } from '../composables/routeState.js'
import {
  DEFAULT_CATEGORIES,
  activeCategories,
  catInfo,
  computeFrequentFromIndex,
  detectCategory,
  expenses,
  freqPrefs,
  ledgerIndex,
  ledgerCategories,
  ledgerPeriodStatsFromIndex,
  parseNatural,
} from '../composables/ledger.js'
import { dayLabel, moneyHero, moneyRow, nowHM, pad2 } from '../utils/formatters.js'
import { useDomainCommands } from '../composables/domain/commands.js'

const bills = useStoredRef('sl_bills', [])
const domain = useDomainCommands()
const route = useRoute()

const tab = ref('ledger') // ledger | bills | review
const deleteBillTarget = ref(null)

// 允许“今天”等聚合入口精确打开固定账单或回顾，不改变默认账本入口。
watch(() => route.query.tab, (value) => {
  tab.value = ledgerTabFromQuery(value)
}, { immediate: true })

/* ================= 通用 ================= */
// 金额/时间/日期标签格式化统一走 utils/formatters.js。


/* ---------- 撤销 toast ---------- */
const toast = ref(null)
let toastTimer = 0
function showToast(text, undoFn = null, ms = 6000) {
  toast.value = { text, undo: undoFn }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = null }, ms)
}
function runUndo() {
  const fn = toast.value?.undo
  toast.value = null
  if (fn) fn()
}

/* ================= 账本首页 ================= */
const q = ref('')
const showFilters = ref(false)
const fRange = ref('all') // all | today | week | month | custom
const fFrom = ref('')
const fTo = ref('')
const fCat = ref('')
const fMin = ref('')
const fMax = ref('')
const fKind = ref('all') // all | manual | bill

function inRange(dateStr) {
  if (fRange.value === 'today') return dateStr === todayStr()
  if (fRange.value === 'week') {
    const d = new Date(dateStr + 'T00:00:00')
    const now = new Date()
    const day = now.getDay() === 0 ? 7 : now.getDay()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1))
    return d >= monday && d <= new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  }
  if (fRange.value === 'month') return dateStr.slice(0, 7) === todayStr().slice(0, 7)
  if (fRange.value === 'custom') {
    if (fFrom.value && dateStr < fFrom.value) return false
    if (fTo.value && dateStr > fTo.value) return false
    return true
  }
  return true
}

const filteredExpenses = computed(() => {
  const kw = q.value.trim().toLowerCase()
  const min = fMin.value === '' ? null : Number(fMin.value)
  const max = fMax.value === '' ? null : Number(fMax.value)
  const sorted = ledgerIndex.value.sortedExpenses
  if (
    !kw && min === null && max === null && !fCat.value
    && fKind.value === 'all' && fRange.value === 'all'
  ) return sorted
  return sorted.filter((e) => {
    if (kw) {
      const hay = `${e.name} ${e.note ?? ''} ${catInfo(e.cat).name}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    if (fCat.value && e.cat !== fCat.value) return false
    if (fKind.value === 'manual' && e.source === 'bill') return false
    if (fKind.value === 'bill' && e.source !== 'bill') return false
    if (min !== null && Number(e.amount) < min) return false
    if (max !== null && Number(e.amount) > max) return false
    if (!inRange(e.date)) return false
    return true
  })
})

const filtersActive = computed(() =>
  fRange.value !== 'all' || fCat.value || fMin.value !== '' || fMax.value !== '' || fKind.value !== 'all' || fFrom.value || fTo.value
)
function clearFilters() {
  fRange.value = 'all'; fFrom.value = ''; fTo.value = ''; fCat.value = ''; fMin.value = ''; fMax.value = ''; fKind.value = 'all'
}

// 虚拟列表直接使用排序后的原记录，日期标题只对可见项按索引判断。
// 避免进入页面时为每笔消费 `{ ...expense }` 克隆一个新对象。
const feedItems = filteredExpenses

const periodStats = computed(() => ledgerPeriodStatsFromIndex(ledgerIndex.value, todayStr()))

/* ---------- 常记 ---------- */
const frequent = computed(() => computeFrequentFromIndex(ledgerIndex.value, freqPrefs.value))

function useFrequent(item) {
  openQuick({ name: item.name, amount: String(item.amount || ''), cat: item.cat })
}

/* ---------- 记一笔（快速弹窗） ---------- */
const showQuick = ref(false)
const editingId = ref(null)
const moreOpen = ref(false)
const amountInput = ref('')
const nameInput = ref('')
const catInput = ref('')
const dateInput = ref('')
const timeInput = ref('')
const noteInput = ref('')
const sourceInput = ref('manual')
const billIdInput = ref('')
const amountEl = ref(null)
const dupWarn = ref(false)
const forceDup = ref(false)
const keepAdding = ref(false)
const cycleSuggest = ref(null) // { kind, day }

function openQuick(prefill = {}) {
  editingId.value = prefill.id ?? null
  amountInput.value = prefill.amount ?? ''
  nameInput.value = prefill.name ?? ''
  catInput.value = prefill.cat ?? ''
  dateInput.value = prefill.date ?? todayStr()
  timeInput.value = prefill.time ?? nowHM()
  noteInput.value = prefill.note ?? ''
  sourceInput.value = prefill.source ?? 'manual'
  billIdInput.value = prefill.billId ?? ''
  moreOpen.value = Boolean(prefill.id) || Boolean(prefill.expandMore)
  dupWarn.value = false
  forceDup.value = false
  cycleSuggest.value = null
  keepAdding.value = false
  showQuick.value = true
  nextTick(() => amountEl.value?.focus())
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
  if (!catInput.value && parsed.name) catInput.value = detectCategory(parsed.name || nameInput.value)
}

const quickCatChips = computed(() => {
  const actives = activeCategories()
  if (catInput.value && !actives.some((c) => c.key === catInput.value)) {
    const hidden = ledgerCategories.value.find((c) => c.key === catInput.value)
    if (hidden) return [hidden, ...actives]
  }
  return actives
})

const duplicateHit = computed(() => {
  if (forceDup.value || editingId.value) return false
  const amt = Number(amountInput.value)
  const nm = nameInput.value.trim()
  if (!amt || !nm) return false
  return expenses.value.some(
    (e) => e.name.trim() === nm && Number(e.amount) === amt && Date.now() - Date.parse(e.createdAt) < 2 * 60 * 1000
  )
})

async function saveExpense(keepOpen = false) {
  const amount = Number(amountInput.value)
  const name = nameInput.value.trim()
  if (!(amount > 0)) { amountEl.value?.focus(); return }
  if (!name) return
  if (duplicateHit.value) { dupWarn.value = true; return }
  if (editingId.value) {
    const target = domain.updateTransaction(editingId.value, {
        name, amount, cat: catInput.value || detectCategory(name),
        date: dateInput.value || todayStr(), time: timeInput.value || nowHM(),
        note: noteInput.value.trim(),
      })
    if (target) {
      showToast(`已更新 ${moneyRow(amount)} · ${name}`)
    }
  } else {
    const saved = domain.createTransaction({ name, amount,
      cat: catInput.value || detectCategory(name),
      date: dateInput.value || todayStr(),
      time: timeInput.value || nowHM(),
      note: noteInput.value.trim(),
      source: sourceInput.value || 'manual',
      billId: billIdInput.value || '',
      createdFrom: sourceInput.value || 'manual',
    })
    showToast(`已记下 ${moneyRow(amount)} · ${name}`, () => {
      expenses.value = expenses.value.filter((e) => e.id !== saved.id)
    })
  }
  if (keepOpen) {
    amountInput.value = ''
    nameInput.value = ''
    noteInput.value = ''
    dateInput.value = todayStr()
    timeInput.value = nowHM()
    catInput.value = ''
    dupWarn.value = false
    forceDup.value = false
    keepAdding.value = true
    cycleSuggest.value = null
    nextTick(() => amountEl.value?.focus())
  } else {
    showQuick.value = false
  }
}

function closeQuick() {
  showQuick.value = false
  keepAdding.value = false
}

/* ---------- 记录详情 ---------- */
const detailItem = ref(null)
const detailExpense = computed(() => detailItem.value ? expenses.value.find((e) => e.id === detailItem.value) ?? null : null)

function openDetail(id) {
  detailItem.value = id
}
function closeDetail() {
  detailItem.value = null
}
function editFromDetail() {
  const e = detailExpense.value
  if (!e) return
  openQuick({ ...e, expandMore: true })
  closeDetail()
}
function againFromDetail() {
  const e = detailExpense.value
  if (!e) return
  openQuick({ name: e.name, amount: String(e.amount), cat: e.cat, note: e.note })
  closeDetail()
}
function deleteFromDetail() {
  const e = detailExpense.value
  if (!e) return
  const snapshot = { ...e }
  expenses.value = expenses.value.filter((x) => x.id !== e.id)
  closeDetail()
  showToast(`已删除 ${moneyRow(snapshot.amount)} · ${snapshot.name}`, () => {
    expenses.value = [...expenses.value, snapshot].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  })
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

function emptyBillForm() {
  return { name: '', amount: '', cycle: 'monthly', nextDate: '', remindDays: 3, autoRenew: true, active: true, note: '' }
}
function openBillForm(prefill = {}, editing = null) {
  editingBillId.value = editing
  billForm.value = editing
    ? { ...bills.value.find((b) => b.id === editing), ...emptyBillForm(), ...pickBillFields(bills.value.find((b) => b.id === editing)) }
    : { ...emptyBillForm(), ...prefill }
  billError.value = ''
  showBillForm.value = true
}
function pickBillFields(b) {
  if (!b) return emptyBillForm()
  return {
    name: b.name ?? '', amount: b.amount ?? '', cycle: b.cycle ?? 'monthly',
    nextDate: b.nextDate ?? '', remindDays: b.remindDays ?? 3,
    autoRenew: b.autoRenew !== false, active: b.active !== false, note: b.note ?? '',
  }
}
function saveBill() {
  const f = billForm.value
  if (!f.name.trim()) { billError.value = '请填写名称'; return }
  if (f.amount === '' || Number(f.amount) < 0) { billError.value = '请填写正确金额'; return }
  if (!f.nextDate) { billError.value = '请选择下次支付日期'; return }
  const data = {
    name: f.name.trim(), amount: Number(f.amount), cycle: f.cycle,
    nextDate: f.nextDate, remindDays: Number(f.remindDays) || 0,
    autoRenew: f.autoRenew, active: f.active, note: f.note.trim(),
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
  bills.value = bills.value.filter((entry) => entry.id !== bill.id)
  deleteBillTarget.value = null
  showToast(`已删除「${bill.name}」`)
}
function toggleBillActive(bill) {
  const target = bills.value.find((b) => b.id === bill.id)
  if (!target) return
  target.active = target.active === false
  showToast(target.active ? `已恢复「${bill.name}」` : `已暂停「${bill.name}」`)
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity
  const t = new Date(dateStr + 'T00:00:00')
  const today = new Date(todayStr() + 'T00:00:00')
  return Math.round((t - today) / 86400000)
}
function billStatus(b) {
  if (b.active === false) return { cls: 'paused', text: '已暂停' }
  const d = daysUntil(b.nextDate)
  const remind = Number(b.remindDays ?? 3)
  if (d < 0) return { cls: 'over', text: `已超过 ${-d} 天` }
  if (d === 0) return { cls: 'today', text: '今天到期' }
  if (d <= remind) return { cls: 'soon', text: `还有 ${d} 天` }
  return { cls: 'ok', text: `还有 ${d} 天` }
}

function addMonths(base, count) {
  const day = base.getDate()
  const next = new Date(base.getFullYear(), base.getMonth() + count, 1)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}
function advance(b) {
  const cur = new Date(b.nextDate + 'T00:00:00')
  let next
  if (b.cycle === 'weekly') next = new Date(cur.getTime() + 7 * 86400000)
  else if (b.cycle === 'monthly') next = addMonths(cur, 1)
  else if (b.cycle === 'quarterly') next = addMonths(cur, 3)
  else if (b.cycle === 'yearly') next = addMonths(cur, 12)
  else next = cur
  const today = new Date(todayStr() + 'T00:00:00')
  while (next <= today && b.cycle !== 'once') {
    next = b.cycle === 'weekly'
      ? new Date(next.getTime() + 7 * 86400000)
      : b.cycle === 'monthly' ? addMonths(next, 1)
      : b.cycle === 'quarterly' ? addMonths(next, 3)
      : b.cycle === 'yearly' ? addMonths(next, 12)
      : new Date(today.getTime() + 86400000)
  }
  b.nextDate = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`
  b.updatedAt = new Date().toISOString()
}

// 已支付：生成账本记录 + 推进周期
function markPaid(bill) {
  const result = domain.payBill(bill.id)
  if (!result) return
  if (result.duplicate) {
    showToast(`本期「${result.bill.name}」已记入账本，未重复创建交易`)
    return
  }
  showToast(`已支付并记入账本 ${moneyRow(result.transaction.amount)} · 下一期 ${result.bill.nextDate}`)
}

// 跳过本次：只推进周期，不生成记录
function skipOnce(bill) {
  const target = bills.value.find((b) => b.id === bill.id)
  if (!target) return
  advance(target)
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
const billForecast = computed(() => {
  const active = bills.value.filter((bill) => bill.active !== false)
  const annual = active.reduce((total, bill) => total + Number(bill.amount || 0) * (CYCLES[bill.cycle]?.monthFactor ?? 1) * 12, 0)
  const next30 = active
    .filter((bill) => daysUntil(bill.nextDate) >= 0 && daysUntil(bill.nextDate) <= 30)
    .reduce((total, bill) => total + Number(bill.amount || 0), 0)
  return { active: active.length, annual, monthly: annual / 12, next30 }
})

/* ================= 回顾 ================= */
const reviewMonth = ref(todayStr().slice(0, 7)) // YYYY-MM

function shiftMonth(delta) {
  const [y, m] = reviewMonth.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  reviewMonth.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
const reviewLabel = computed(() => {
  const [y, m] = reviewMonth.value.split('-').map(Number)
  return y === new Date().getFullYear() ? `${m}月` : `${y}年${m}月`
})

const monthExpenses = computed(() =>
  expenses.value.filter((e) => e.date.slice(0, 7) === reviewMonth.value)
    .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
)
const reviewTotal = computed(() => monthExpenses.value.reduce((s, e) => s + Number(e.amount || 0), 0))
const reviewCount = computed(() => monthExpenses.value.length)
const mostFrequent = computed(() => {
  const map = new Map()
  for (const e of monthExpenses.value) {
    const name = e.name.trim()
    map.set(name, (map.get(name) ?? 0) + 1)
  }
  const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? { name: top[0], count: top[1] } : null
})
const topCategory = computed(() => {
  const map = new Map()
  for (const e of monthExpenses.value) map.set(e.cat, (map.get(e.cat) ?? 0) + Number(e.amount || 0))
  const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? { cat: top[0], total: top[1] } : null
})
const maxSingle = computed(() => {
  let max = null
  for (const e of monthExpenses.value) if (!max || Number(e.amount) > Number(max.amount)) max = e
  return max
})
const categoryBars = computed(() => {
  const map = new Map()
  for (const e of monthExpenses.value) map.set(e.cat, (map.get(e.cat) ?? 0) + Number(e.amount || 0))
  const total = [...map.values()].reduce((s, v) => s + v, 0) || 1
  return [...map.entries()]
    .map(([key, value]) => ({ key, info: catInfo(key), value, pct: Math.round((value / total) * 100) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
})

// 月历点迹
const calendarCells = computed(() => {
  const [y, m] = reviewMonth.value.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // 周一开头
  const perDay = new Map()
  for (const e of monthExpenses.value) {
    const day = Number(e.date.slice(8, 10))
    const cur = perDay.get(day) ?? { count: 0, total: 0 }
    cur.count += 1
    cur.total += Number(e.amount || 0)
    perDay.set(day, cur)
  }
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, ...(perDay.get(d) ?? { count: 0, total: 0 }) })
  return cells
})
const selectedDay = ref(null)
const selectedDayInfo = computed(() => {
  if (!selectedDay.value) return null
  const items = monthExpenses.value.filter((e) => Number(e.date.slice(8, 10)) === selectedDay.value)
  return {
    label: `${parseInt(reviewMonth.value.slice(5), 10)}月${selectedDay.value}日`,
    count: items.length,
    total: items.reduce((s, e) => s + Number(e.amount || 0), 0),
    items,
  }
})
function dotClass(cell) {
  if (!cell || !cell.count) return ''
  if (cell.count >= 4) return 'l3'
  if (cell.count >= 2) return 'l2'
  return 'l1'
}

/* ================= 类别管理（轻量） ================= */
const showCatManage = ref(false)
const newCatName = ref('')
const ICON_POOL = ['🍜', '🚇', '🛍️', '🏠', '📚', '🎮', '💊', '📺', '📦', '☕', '✈️', '💡', '🎓', '🐾', '🎁']
function addCategory() {
  const name = newCatName.value.trim()
  if (!name) return
  if (ledgerCategories.value.some((c) => c.name === name)) { newCatName.value = ''; return }
  const used = new Set(ledgerCategories.value.map((c) => c.icon))
  const icon = ICON_POOL.find((i) => !used.has(i)) ?? '📦'
  ledgerCategories.value = [...ledgerCategories.value, { key: 'c' + Date.now(), name, icon, hidden: false }]
  newCatName.value = ''
}
function renameCategory(cat) {
  const name = window.prompt('修改分类名称', cat.name)
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed) return
  const target = ledgerCategories.value.find((c) => c.key === cat.key)
  if (target) target.name = trimmed
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
  if (ledgerCategories.value.filter((c) => !c.hidden).length <= 1 && !target.hidden) return
  target.hidden = !target.hidden
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
  <div class="page" :class="{ 'has-fab': tab === 'ledger' }">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">账本</h1>
        <p class="page-desc">记下花销、别忘固定账单、偶尔回头看看。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" @click="openQuick()">＋ 记一笔</button>
      </div>
    </header>

    <div class="segmented ledger-tabs" role="tablist" aria-label="账本分区">
      <button :class="{ on: tab === 'ledger' }" @click="tab = 'ledger'">账本</button>
      <button :class="{ on: tab === 'bills' }" @click="tab = 'bills'">固定账单</button>
      <button :class="{ on: tab === 'review' }" @click="tab = 'review'">回顾</button>
    </div>

    <!-- ================= 账本首页 ================= -->
    <div v-if="tab === 'ledger'" class="ledger-home">
      <!-- 核心数据：只突出本月支出 -->
      <section class="hero-stat card">
        <span class="hero-label">这个月记录了</span>
        <b class="hero-amount">{{ moneyHero(periodStats.monthTotal) }}</b>
        <span class="hero-sub">今天 {{ moneyRow(periodStats.todayTotal) }} · 本月 {{ periodStats.monthCount }} 笔</span>
      </section>

      <!-- 待处理：固定账单临近（无则整块隐藏） -->
      <section v-if="pendingBills.length" class="pending-block">
        <h3 class="block-title">待处理</h3>
        <div class="pending-list">
          <div v-for="bill in pendingBills" :key="bill.id" class="pending-row" @click="tab = 'bills'">
            <div class="p-main">
              <b>{{ bill.name }}</b>
              <small>{{ moneyRow(bill.amount) }} · {{ bill.nextDate.slice(5).replace('-', '月') }}日 · {{ bill._s.text }}</small>
            </div>
            <button class="btn btn-sm btn-primary" @click.stop="markPaid(bill)">已支付</button>
            <button class="p-close" title="稍后处理" @click.stop="dismissPending(bill)">✕</button>
          </div>
        </div>
      </section>

      <!-- 常记（自动生成，点开后可改金额再记下） -->
      <section v-if="frequent.length" class="freq-block">
        <div class="block-head">
          <h3 class="block-title">常记</h3>
          <button class="link-btn" @click="showCatManage = true">管理分类</button>
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
          <input v-model="q" class="search-input" placeholder="搜索名称、备注或分类" />
          <button class="btn btn-sm" :class="{ 'btn-ghost': filtersActive || showFilters }" @click="showFilters = !showFilters">筛选</button>
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
            <input v-model="fFrom" type="date" /> <i>至</i> <input v-model="fTo" type="date" />
          </div>
          <div class="filter-line">
            <select v-model="fCat">
              <option value="">全部分类</option>
              <option v-for="c in activeCategories()" :key="c.key" :value="c.key">{{ c.icon }} {{ c.name }}</option>
            </select>
            <input v-model="fMin" type="number" min="0" placeholder="金额≥" />
            <input v-model="fMax" type="number" min="0" placeholder="金额≤" />
            <select v-model="fKind">
              <option value="all">全部来源</option>
              <option value="manual">普通记录</option>
              <option value="bill">固定账单生成</option>
            </select>
          </div>
        </div>
      </section>

      <!-- 最近记录：生活记录流 -->
      <section class="feed-block">
        <h3 class="block-title">最近记录</h3>
        <div v-if="feedItems.length === 0" class="feed-empty">
          <EmptyState
            class="card"
            icon="🧾"
            title="还没有记录"
            description="第一笔不用很认真，记下刚刚花的钱就可以。"
            primary-label="＋ 记一笔"
            @primary="openQuick()"
          />
        </div>
        <div v-else class="feed">
          <VirtualList :items="feedItems" item-key="id" :estimated-height="62" :gap="0" :threshold="80" fixed-height>
            <template #default="{ item: e, index }">
              <div class="feed-virtual-item">
                <h4 v-if="index === 0 || feedItems[index - 1]?.date !== e.date" class="feed-day">{{ dayLabel(e.date) }}</h4>
                <div class="feed-item" @click="openDetail(e.id)">
                  <div class="fi-main">
                    <b>{{ e.name }}</b>
                    <small>{{ e.direction === 'income' ? '收入' : catInfo(e.cat).name }} · {{ e.time }}<template v-if="e.source === 'bill'"> · 固定账单</template></small>
                  </div>
                  <span class="fi-amount" :class="{ income: e.direction === 'income' }">{{ e.direction === 'income' ? '+' : '' }}{{ moneyRow(e.amount) }}</span>
                </div>
              </div>
            </template>
          </VirtualList>
        </div>
      </section>
    </div>

    <!-- ================= 固定账单 ================= -->
    <div v-else-if="tab === 'bills'" class="bills-tab">
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
        <section class="bill-forecast card" aria-label="固定账单预算预测">
          <div><small>每月固定支出估算</small><b>{{ moneyHero(billForecast.monthly) }}</b></div>
          <div><small>未来 30 天待支付</small><b>{{ moneyRow(billForecast.next30) }}</b></div>
          <div><small>全年预计</small><b>{{ moneyRow(billForecast.annual) }}</b></div>
          <p>基于 {{ billForecast.active }} 项启用账单的当前周期估算，不包含日常手动消费。</p>
        </section>
        <section v-if="dueBills.length" class="bill-group">
          <h3 class="block-title">即将到来</h3>
          <div class="bill-list">
            <div v-for="bill in dueBills" :key="bill.id" class="card bill-row" :class="billStatus(bill).cls" @click="openBillForm({}, bill.id)">
              <div class="b-main">
                <b>{{ bill.name }}</b>
                <small>{{ bill.nextDate.slice(5).replace('-', '月') }}日 · {{ billStatus(bill).text }}<template v-if="bill.note"> · {{ bill.note }}</template></small>
              </div>
              <div class="b-amount">{{ moneyRow(bill.amount) }}<small>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</small></div>
              <div class="b-actions" @click.stop>
                <button class="btn btn-sm btn-primary" @click="markPaid(bill)">已支付</button>
                <button class="btn btn-sm" @click="dismissPending(bill); skipOnce(bill)">跳过本次</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="laterBills.length" class="bill-group">
          <h3 class="block-title">之后</h3>
          <div class="bill-list">
            <div v-for="bill in laterBills" :key="bill.id" class="card bill-row" @click="openBillForm({}, bill.id)">
              <div class="b-main">
                <b>{{ bill.name }}</b>
                <small>{{ bill.nextDate.slice(5).replace('-', '月') }}日 · {{ billStatus(bill).text }}</small>
              </div>
              <div class="b-amount">{{ moneyRow(bill.amount) }}<small>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</small></div>
              <div class="b-actions" @click.stop>
                <button class="btn btn-sm" @click="skipOnce(bill)">跳过本次</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="pausedBills.length" class="bill-group">
          <h3 class="block-title">已暂停</h3>
          <div class="bill-list">
            <div v-for="bill in pausedBills" :key="bill.id" class="card bill-row paused" @click="openBillForm({}, bill.id)">
              <div class="b-main">
                <b>{{ bill.name }}</b>
                <small>已暂停 · 下次 {{ bill.nextDate }}</small>
              </div>
              <div class="b-amount">{{ moneyRow(bill.amount) }}</div>
              <div class="b-actions" @click.stop>
                <button class="btn btn-sm" @click="toggleBillActive(bill)">恢复</button>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- ================= 回顾 ================= -->
    <div v-else class="review-tab">
      <div class="month-nav card">
        <button class="mn-btn" @click="shiftMonth(-1)">‹</button>
        <b>{{ reviewLabel }}</b>
        <button class="mn-btn" :disabled="reviewMonth >= todayStr().slice(0, 7)" @click="shiftMonth(1)">›</button>
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
            <span>记录了 {{ reviewCount }} 笔</span>
            <b>{{ moneyHero(reviewTotal) }}</b>
          </div>
          <div class="rs-facts">
            <div v-if="mostFrequent"><small>最常记录</small><b>{{ mostFrequent.name }} · {{ mostFrequent.count }}次</b></div>
            <div v-if="topCategory"><small>花得最多</small><b>{{ catInfo(topCategory.cat).name }} · {{ moneyRow(topCategory.total) }}</b></div>
            <div v-if="maxSingle"><small>最大一笔</small><b>{{ maxSingle.name }} · {{ moneyRow(maxSingle.amount) }}</b></div>
          </div>
        </section>

        <section class="review-cats card">
          <h3 class="block-title">分类分布</h3>
          <div class="cat-bars">
            <div v-for="bar in categoryBars" :key="bar.key" class="cat-bar-row">
              <span class="cb-name">{{ bar.info.icon }} {{ bar.info.name }}</span>
              <span class="cb-track"><i :style="{ width: bar.pct + '%' }"></i></span>
              <span class="cb-value">{{ moneyRow(bar.value) }}</span>
            </div>
          </div>
        </section>

        <section class="review-calendar card">
          <h3 class="block-title">月历点迹</h3>
          <div class="cal-week">
            <span v-for="w in ['一','二','三','四','五','六','日']" :key="w">{{ w }}</span>
          </div>
          <div class="cal-grid">
            <template v-for="(cell, idx) in calendarCells" :key="idx">
              <button
                v-if="cell"
                class="cal-cell"
                :class="[dotClass(cell), { selected: selectedDay === cell.day }]"
                @click="selectedDay = selectedDay === cell.day ? null : cell.day"
              >{{ cell.day }}<i v-if="cell.count"></i></button>
              <span v-else class="cal-cell blank"></span>
            </template>
          </div>
          <div v-if="selectedDayInfo" class="cal-detail">
            <b>{{ selectedDayInfo.label }}</b>
            <small>{{ selectedDayInfo.count }} 笔 · {{ moneyRow(selectedDayInfo.total) }}</small>
            <div v-for="e in selectedDayInfo.items" :key="e.id" class="cd-row" @click="openDetail(e.id)">
              <span>{{ e.name }}</span><small>{{ catInfo(e.cat).name }} · {{ e.time }}</small><b>{{ moneyRow(e.amount) }}</b>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- ================= 记一笔 弹窗 ================= -->
    <Modal v-if="showQuick" :open="showQuick" :title="editingId ? '编辑记录' : keepAdding ? '再记一笔' : '记一笔'" @close="closeQuick">
      <div class="quick-form">
        <input
          ref="amountEl"
          v-model="amountInput"
          class="amount-input"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
          @keydown.enter="saveExpense(keepAdding)"
        />
        <input
          v-model="nameInput"
          class="name-input"
          placeholder="花在什么上？（可写「午饭 18」）"
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

        <button type="button" class="more-toggle" @click="moreOpen = !moreOpen">
          {{ moreOpen ? '收起' : '更多' }} <i>{{ moreOpen ? '▴' : '▾' }}</i>
        </button>

        <div v-show="moreOpen" class="more-area">
          <div class="chip-row cat-chips">
            <button
              v-for="c in quickCatChips"
              :key="c.key"
              class="chip"
              :class="{ on: catInput === c.key }"
              @click="catInput = catInput === c.key ? '' : c.key"
            >{{ c.icon }} {{ c.name }}</button>
          </div>
          <div class="more-grid">
            <label>日期<input v-model="dateInput" type="date" /></label>
            <label>时间<input v-model="timeInput" type="time" /></label>
          </div>
          <input v-model="noteInput" placeholder="备注（选填）" />
        </div>

        <div class="quick-actions">
          <button class="btn btn-primary save-btn" @click="saveExpense(keepAdding)">{{ editingId ? '保存修改' : keepAdding ? '记下一笔' : '记下' }}</button>
          <button v-if="!editingId" class="btn btn-ghost" @click="saveExpense(true)">{{ keepAdding ? '完成' : '连续记' }}</button>
        </div>
      </div>
    </Modal>

    <!-- ================= 记录详情 ================= -->
    <Modal v-if="detailExpense" :open="Boolean(detailExpense)" :title="detailExpense?.name ?? '记录详情'" @close="closeDetail">
      <div v-if="detailExpense" class="detail-body">
        <div class="detail-amount">{{ moneyRow(detailExpense.amount) }}</div>
        <div class="detail-meta">
          <span>{{ catInfo(detailExpense.cat).icon }} {{ catInfo(detailExpense.cat).name }}</span>
          <span>{{ detailExpense.date }} {{ detailExpense.time }}</span>
          <span v-if="detailExpense.source === 'bill'">来自固定账单</span>
        </div>
        <p v-if="detailExpense.note" class="detail-note">{{ detailExpense.note }}</p>
        <div class="detail-actions">
          <button class="btn" @click="editFromDetail">编辑</button>
          <button class="btn" @click="againFromDetail">再记一次</button>
          <button class="btn" @click="togglePinName">
            {{ (freqPrefs.pinned ?? []).includes(detailExpense.name.trim()) ? '取消常记' : '设为常记' }}
          </button>
          <button class="btn" @click="toggleHideName">
            {{ (freqPrefs.hidden ?? []).includes(detailExpense.name.trim()) ? '取消隐藏' : '从常记隐藏' }}
          </button>
          <button class="btn btn-danger" @click="deleteFromDetail">删除</button>
        </div>
      </div>
    </Modal>

    <!-- ================= 添加/编辑 固定账单 ================= -->
    <Modal v-if="showBillForm" :open="showBillForm" :title="editingBillId ? '编辑固定账单' : '添加固定账单'" medium @close="showBillForm = false">
      <div class="bill-form">
        <p class="bill-form-intro">设置一次，之后会按周期提醒你。</p>
        <label class="bill-field bill-field-wide">
          <span>账单名称 <i>必填</i></span>
          <input v-model="billForm.name" autocomplete="off" placeholder="例如：ChatGPT Plus、话费" />
        </label>
        <div class="bill-form-grid">
          <label class="bill-field">
            <span>金额 <i>必填</i></span>
            <div class="bill-money-input"><b>¥</b><input v-model="billForm.amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" /></div>
          </label>
          <label class="bill-field">
            <span>重复周期</span>
            <select v-model="billForm.cycle">
              <option v-for="(c, key) in CYCLES" :key="key" :value="key">{{ c.label }}</option>
            </select>
          </label>
        </div>
        <div class="bill-form-grid">
          <label class="bill-field">
            <span>下次支付日期</span>
            <input v-model="billForm.nextDate" type="date" />
          </label>
          <label class="bill-field">
            <span>提前提醒</span>
            <select v-model="billForm.remindDays">
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
        <p v-if="billError" class="bill-error" role="alert">{{ billError }}</p>
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

    <!-- ================= 分类管理 ================= -->
    <Modal v-if="showCatManage" :open="showCatManage" title="分类管理" @close="showCatManage = false">
      <div class="cat-manage">
        <div v-for="c in ledgerCategories" :key="c.key" class="cat-row" :class="{ hidden: c.hidden }">
          <button class="cat-icon" title="换个图标" @click="cycleIcon(c)">{{ c.icon }}</button>
          <b>{{ c.name }}</b>
          <div class="cat-ops">
            <button class="link-btn" @click="renameCategory(c)">重命名</button>
            <button class="link-btn" @click="toggleCatHidden(c)">{{ c.hidden ? '显示' : '隐藏' }}</button>
          </div>
        </div>
        <div class="cat-add">
          <input v-model="newCatName" placeholder="新分类名称" @keydown.enter="addCategory" />
          <button class="btn btn-sm btn-primary" @click="addCategory">添加</button>
        </div>
        <p class="form-note">隐藏的分类不再出现在选择列表中，已有记录不受影响。</p>
      </div>
    </Modal>

    <!-- ================= 撤销 toast ================= -->
    <Transition name="toast">
      <div v-if="toast" class="undo-toast" role="status">
        <span>{{ toast.text }}</span>
        <button v-if="toast.undo" class="ut-undo" @click="runUndo">撤销</button>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--space-md, 16px); }
.ledger-tabs { align-self: flex-start; }

.block-title { margin: 0 0 8px; font-size: 13.5px; font-weight: 750; }
.block-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.block-head .block-title { margin: 0; }

/* ---------- 首页核心数据 ---------- */
.hero-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px 22px 18px;
}
.hero-label { color: var(--ink-faint); font-size: 12.5px; font-weight: 700; }
.hero-amount {
  font-size: clamp(34px, 4vw, 44px);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.hero-sub { margin-top: 2px; color: var(--ink-soft); font-size: 12.5px; font-variant-numeric: tabular-nums; }

/* ---------- 待处理 ---------- */
.pending-list { display: flex; flex-direction: column; gap: 8px; }
.pending-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  transition: border-color .15s, box-shadow .15s;
}
.pending-row:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.p-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.p-main b { overflow: hidden; font-size: 13.5px; text-overflow: ellipsis; white-space: nowrap; }
.p-main small { color: var(--ink-soft); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.p-close { width: 26px; height: 26px; color: #b6bdcb; font-size: 12px; border: none; border-radius: 7px; background: transparent; cursor: pointer; }
.p-close:hover { color: var(--ink-soft); background: var(--bg); }

/* ---------- 常记 ---------- */
.freq-row { display: flex; flex-wrap: wrap; gap: 8px; }
.freq-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  transition: border-color .15s, background .15s, transform .15s;
}
.freq-pill:hover { border-color: var(--primary); background: var(--primary-soft); transform: translateY(-1px); }
.freq-icon { font-size: 14px; }
.freq-pill b { font-size: 13px; font-weight: 700; }
.freq-pill small { color: var(--ink-soft); font-size: 11.5px; font-variant-numeric: tabular-nums; }

/* ---------- 搜索 / 筛选 ---------- */
.search-row { display: flex; align-items: center; gap: 8px; }
.search-icon { font-size: 13px; opacity: .7; }
.search-input { flex: 1; min-width: 0; }
.filter-panel { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-tint); }
.custom-range { display: flex; align-items: center; gap: 8px; }
.custom-range i { color: var(--ink-faint); font-size: 12px; font-style: normal; }
.custom-range input { width: auto; }
.filter-line { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.filter-line select, .filter-line input { width: 100%; min-width: 0; }

/* ---------- 最近记录流 ---------- */
.feed { display: flex; flex-direction: column; }
.feed-day { margin: 14px 0 6px; color: var(--ink-faint); font-size: 11.5px; font-weight: 800; letter-spacing: .04em; }
.feed-virtual-item:first-child .feed-day { margin-top: 0; }
.feed-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
  border-radius: 11px;
  transition: background .14s;
}
.feed-item:hover { background: var(--bg-tint); }
.fi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fi-main b { overflow: hidden; font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.fi-main small { color: var(--ink-faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.fi-amount { flex: 0 0 auto; color: var(--text); font-size: 14.5px; font-weight: 750; font-variant-numeric: tabular-nums; }
.fi-amount.income { color: #087a58; }
.feed-item-enter-active { transition: opacity .2s ease, transform .2s ease; }
.feed-item-enter-from { opacity: 0; transform: translateY(4px); }

/* ---------- 记一笔弹窗 ---------- */
.quick-form { display: flex; flex-direction: column; gap: 10px; }
.amount-input {
  width: 100%;
  padding: 12px 14px;
  font-size: 26px;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.name-input { width: 100%; padding: 11px 13px; font-size: 14.5px; }
.more-toggle { align-self: flex-start; padding: 4px 8px; color: var(--ink-faint); font-size: 12px; font-weight: 600; border: none; border-radius: 7px; background: transparent; cursor: pointer; }
.more-toggle:hover { color: var(--primary); background: var(--primary-soft); }
.more-toggle i { font-style: normal; font-size: 10px; margin-left: 4px; }
.more-area { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-tint); }
.cat-chips .chip { height: 32px; padding: 0 12px; font-size: 12px; }
.more-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.more-grid label { display: flex; flex-direction: column; gap: 5px; color: var(--ink-soft); font-size: 11.5px; }
.quick-actions { display: flex; gap: 8px; margin-top: 4px; }
.save-btn { flex: 1; height: 44px; font-size: 15px; }
.quick-actions .btn-ghost { height: 44px; }
.dup-warn, .cycle-suggest {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  color: #8a6845;
  font-size: 12.5px;
  border: 1px solid #f2d08c;
  border-radius: 10px;
  background: #fffaf0;
}
.cycle-suggest { color: var(--ink-soft); border-color: var(--border); background: var(--bg-tint); }
.dw-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* ---------- 记录详情 ---------- */
.detail-body { display: flex; flex-direction: column; gap: 12px; }
.detail-amount { font-size: 32px; font-weight: 900; text-align: center; font-variant-numeric: tabular-nums; }
.detail-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px; color: var(--ink-soft); font-size: 12.5px; }
.detail-note { margin: 0; padding: 10px 12px; color: var(--ink-soft); font-size: 12.5px; border-radius: 10px; background: var(--bg-tint); }
.detail-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }

/* ---------- 固定账单 ---------- */
.bill-form { display: flex; flex-direction: column; gap: 16px; }
.bill-form-intro { margin: -4px 0 1px; color: var(--ink-faint); font-size: 12.5px; line-height: 1.5; }
.bill-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.bill-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.bill-field > span { color: var(--ink-soft); font-size: 12px; font-weight: 700; }
.bill-field > span i { margin-left: 4px; color: var(--primary); font-size: 10px; font-style: normal; font-weight: 700; }
.bill-field > span em { margin-left: 4px; color: var(--ink-faint); font-size: 10px; font-style: normal; font-weight: 500; }
.bill-field input, .bill-field select { width: 100%; height: 44px; min-width: 0; }
.bill-money-input { position: relative; }
.bill-money-input b { position: absolute; top: 50%; left: 13px; color: var(--ink-faint); font-size: 14px; transform: translateY(-50%); pointer-events: none; }
.bill-money-input input { padding-left: 31px; }
.bill-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bill-switch { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 11px 12px; cursor: pointer; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-tint); }
.bill-switch > input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.bill-switch > span:last-child { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.bill-switch b { font-size: 12.5px; }
.bill-switch small { overflow: hidden; color: var(--ink-faint); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.switch-track { position: relative; width: 34px; height: 20px; flex: 0 0 34px; border-radius: 999px; background: #cbd2df; transition: background .18s; }
.switch-track i { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(30, 40, 70, .22); transition: transform .18s; }
.bill-switch > input:checked + .switch-track { background: var(--primary); }
.bill-switch > input:checked + .switch-track i { transform: translateX(14px); }
.bill-switch > input:focus-visible + .switch-track { outline: 2px solid var(--primary); outline-offset: 2px; }
.bill-error { margin: -5px 0 0; padding: 9px 11px; color: var(--danger); font-size: 12px; border-radius: 9px; background: #fff1f1; }
.bill-form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
.bill-form-actions .btn-danger { margin-right: auto; }
.tab-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tab-desc { margin: 0; color: var(--ink-faint); font-size: 12.5px; }
.bill-group + .bill-group { margin-top: 18px; }
.bill-list { display: flex; flex-direction: column; gap: 10px; }
.bill-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
}
.bill-row:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.bill-row.over { border-color: #f3c2c2; }
.b-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.b-main b { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.b-main small { color: var(--ink-soft); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.b-amount { font-size: 15.5px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
.b-amount small { margin-left: 2px; color: var(--ink-faint); font-size: 10.5px; font-weight: 600; }
.b-actions { display: flex; gap: 6px; }
.bill-row.paused { opacity: .6; }
.bill-row.today .b-main small { color: var(--danger); font-weight: 700; }
.form-note { margin: 4px 0 0; color: var(--ink-faint); font-size: 11.5px; line-height: 1.5; }
.option-row { display: flex; gap: 18px; }
.option-row label { display: flex; align-items: center; gap: 6px; color: var(--text); font-size: 13px; cursor: pointer; }

/* ---------- 回顾 ---------- */
.month-nav { display: flex; align-items: center; justify-content: center; gap: 18px; padding: 10px; }
.month-nav b { min-width: 72px; text-align: center; font-size: 15px; }
.mn-btn { width: 32px; height: 32px; color: var(--ink-soft); font-size: 16px; border: 1px solid var(--border); border-radius: 9px; background: #fff; cursor: pointer; }
.mn-btn:hover:not(:disabled) { color: var(--primary); border-color: var(--primary); }
.mn-btn:disabled { opacity: .35; cursor: not-allowed; }
.review-tab { display: flex; flex-direction: column; gap: 14px; }
.review-summary { display: flex; flex-direction: column; gap: 12px; }
.rs-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.rs-top span { color: var(--ink-soft); font-size: 13px; }
.rs-top b { font-size: 30px; font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.rs-facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; overflow: hidden; border: 1px solid var(--border); border-radius: 11px; background: var(--border); }
.rs-facts > div { display: flex; flex-direction: column; gap: 3px; padding: 10px 13px; background: var(--bg-tint); min-width: 0; }
.rs-facts small { color: var(--ink-faint); font-size: 10.5px; }
.rs-facts b { overflow: hidden; font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }

.cat-bars { display: flex; flex-direction: column; gap: 9px; }
.cat-bar-row { display: grid; grid-template-columns: 76px minmax(0,1fr) auto; align-items: center; gap: 10px; }
.cb-name { overflow: hidden; color: var(--ink-soft); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
.cb-track { height: 8px; border-radius: 999px; background: #eef1f6; overflow: hidden; }
.cb-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--brand-grad-a), var(--brand-grad-b)); }
.cb-value { color: var(--text); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }

.cal-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 4px; }
.cal-week span { color: var(--ink-faint); font-size: 10.5px; text-align: center; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cal-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  height: 44px;
  color: var(--text);
  font-size: 12px;
  border: none;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.cal-cell:hover { background: var(--bg-tint); }
.cal-cell.blank { cursor: default; }
.cal-cell i { width: 6px; height: 6px; border-radius: 50%; background: #c9d4f2; }
.cal-cell.l2 i { width: 7px; height: 7px; background: #8ea6e8; }
.cal-cell.l3 i { width: 8px; height: 8px; background: var(--primary); }
.cal-cell.selected { background: var(--primary-soft); box-shadow: inset 0 0 0 1px var(--primary); }
.cal-detail { margin-top: 12px; padding: 11px 13px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-tint); }
.cal-detail > b { font-size: 13px; }
.cal-detail > small { display: block; margin: 2px 0 6px; color: var(--ink-faint); font-size: 11px; }
.cd-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; padding: 6px 0; cursor: pointer; border-top: 1px solid var(--border); font-size: 12.5px; }
.cd-row:hover b { color: var(--primary); }
.cd-row small { color: var(--ink-faint); font-size: 11px; }
.cd-row b { font-variant-numeric: tabular-nums; }

/* ---------- 分类管理 ---------- */
.cat-manage { display: flex; flex-direction: column; gap: 6px; }
.cat-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 10px; }
.cat-row:hover { background: var(--bg-tint); }
.cat-row.hidden { opacity: .5; }
.cat-icon { width: 34px; height: 34px; font-size: 17px; border: 1px solid var(--border); border-radius: 9px; background: #fff; cursor: pointer; }
.cat-row b { flex: 1; font-size: 13px; }
.cat-ops { display: flex; gap: 4px; }
.cat-add { display: flex; gap: 8px; margin-top: 8px; }
.cat-add input { flex: 1; }

/* ---------- toast ---------- */
.undo-toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 11px 16px;
  color: var(--text);
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  box-shadow: var(--shadow-md);
  transform: translateX(-50%);
}
.ut-undo { padding: 4px 10px; color: var(--primary); font-size: 12.5px; font-weight: 800; border: none; border-radius: 8px; background: var(--primary-soft); cursor: pointer; }
.ut-undo:hover { background: #e1e9ff; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* ---------- 响应式 ---------- */
@media (max-width: 768px) {
  .page { gap: 14px; }

  .hero-stat { padding: 18px 18px 16px; }
  .hero-amount { font-size: 36px; }

  .search-row .btn-sm { padding: 8px 12px; }
  .filter-line { grid-template-columns: 1fr 1fr; }

  .freq-pill { height: 42px; }

  .feed-item { padding: 11px 8px; }

  .tab-head { align-items: flex-start; flex-direction: column; gap: 8px; }
  .bill-row { grid-template-columns: minmax(0, 1fr) auto; }
  .b-amount { order: -1; grid-column: 2; grid-row: 1; }
  .b-main { grid-column: 1; grid-row: 1; }
  .b-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .b-actions .btn { flex: 1; }

  .rs-facts { grid-template-columns: 1fr; }
  .rs-top b { font-size: 26px; }
  .cal-cell { height: 40px; }

  .undo-toast { bottom: calc(150px + env(safe-area-inset-bottom)); }
}

@media (max-width: 480px) {
  .bill-form { gap: 14px; }
  .bill-form-grid, .bill-options { grid-template-columns: 1fr; }
  .bill-switch small { white-space: normal; }
  .bill-form-actions { position: sticky; bottom: 0; margin: 0 -16px -18px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); background: rgba(255, 255, 255, .96); }
  .bill-form-actions .btn-primary { flex: 1; }
  .filter-line { grid-template-columns: 1fr; }
  .hero-amount { font-size: 32px; }
  .detail-actions .btn { flex: 1 1 40%; }
  .quick-actions { flex-direction: column-reverse; }
  .quick-actions .btn { width: 100%; }
}
</style>

<style scoped>
.bill-forecast{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}.bill-forecast>div{display:flex;flex-direction:column;gap:3px}.bill-forecast small,.bill-forecast p{color:var(--ink-soft);font-size:11.5px}.bill-forecast b{font-size:17px}.bill-forecast p{grid-column:1/-1;margin:1px 0 0}@media(max-width:620px){.bill-forecast{grid-template-columns:1fr 1fr}.bill-forecast>div:last-of-type{grid-column:1/-1}}
</style>
