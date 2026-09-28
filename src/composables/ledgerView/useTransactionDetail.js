/**
 * 记录详情弹窗的**状态与动作**（从 LedgerView.vue 拆出）。
 *
 * 这里只管详情：打开/关闭、编辑态、退款、固定/隐藏名称、删除/撤销。
 * 页面持有 `detailItem`、`detailEdit`、`showRefund`、`refundItem` 等开关，
 * 但具体动作的实现（updateTransaction、refundTransaction、freqPrefs 修改）搬到这里。
 */
import { computed, ref } from 'vue'
import { expenses, isRefundTransaction, freqPrefs } from '../ledger.js'
import { amountToCents, mySpendCents } from '../ledgerSplit.js'
import { isBillPayment } from '../ledgerRelations.js'
import { moneyRow, moneyWithCurrency } from '../../utils/formatters.js'
import { appToday, ledgerNowHM } from '../timeContext.js'
import { normalizeCurrency, currencyField } from '../ledgerFx.js'

export function useTransactionDetail({ domain, notify, closeSwipe, flashTransaction, highlightTransaction, baseCurrency, ledgerToday, splitDetailNote }) {
  const detailItem = ref(null)
  const detailExpense = computed(() => detailItem.value ? expenses.value.find((e) => e.id === detailItem.value) ?? null : null)
  const detailEdit = ref(false)
  const detailAmountInput = ref('')
  const detailCategoryInput = ref('')
  const detailDateInput = ref('')
  const detailCurrencyInput = ref('')

  // 退款
  const showRefund = ref(false)
  const refundItem = ref(null)
  const refundAmountInput = ref('')
  const refundDateInput = ref('')
  const refundNoteInput = ref('')

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
    detailAmountInput.value = String(e.amount ?? '')
    detailCategoryInput.value = e.cat || ''
    detailDateInput.value = e.date || ledgerToday()
    detailCurrencyInput.value = normalizeCurrency(e.currency) || baseCurrency.value
    detailEdit.value = true
  }

  function cancelDetailEdit() {
    detailEdit.value = false
  }

  function saveDetailEdit() {
    const e = detailExpense.value
    if (!e) return
    const amount = amountToCents(detailAmountInput.value)
    if (amount === null) {
      notify('金额填写有误：不能为空，最多保留两位小数')
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
      notify(`已更新 ${updated.direction === 'income' ? '+' : '-'}${moneyRow(updated.amount)} · ${updated.name}`)
    } catch (cause) {
      notify(cause?.message || '保存失败，请检查金额和日期')
    }
  }

  function againFromDetail() {
    const e = detailExpense.value
    if (!e) return
    closeDetail()
    return { name: e.name, amount: String(e.amount), cat: e.cat, note: e.note, direction: e.direction, currency: e.currency, split: e.split }
  }

  function undoBillPaymentFromDetail() {
    const e = detailExpense.value
    if (!e) return
    const undone = domain.undoBillPayment(e.id)
    if (undone?.blocked) {
      notify(undone.reason)
      return
    }
    if (!undone) return
    closeSwipe()
    if (String(detailItem.value) === String(e.id)) closeDetail()
    notify(`已撤销本期账单支付 · ${moneyRow(undone.amount)}`)
  }

  function deleteFromDetail() {
    const e = detailExpense.value
    if (!e) return
    const snapshot = { ...e }
    const deleted = domain.deleteTransaction(e.id)
    if (deleted?.blocked) {
      notify(deleted.reason)
      return
    }
    if (!deleted) return
    closeSwipe()
    if (String(detailItem.value) === String(e.id)) closeDetail()
    notify(`已删除 ${moneyRow(snapshot.amount)} · ${snapshot.name}`, {
      actionLabel: '撤销',
      undoFn: () => domain.restoreDeletedTransaction(snapshot),
    })
  }

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
    refundDateInput.value = appToday.value
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
      notify(result.reason)
      return
    }
    if (!result) return
    closeRefund()
    closeDetail()
    flashTransaction(result.id)
    notify(`已登记退款 ${moneyRow(result.amount)} · 原支出已冲抵`)
  }

  function togglePinName() {
    const e = detailExpense.value
    if (!e) return
    const name = e.name.trim()
    const prefs = { pinned: [...(freqPrefs.value.pinned ?? [])], hidden: [...(freqPrefs.value.hidden ?? [])] }
    if (prefs.pinned.includes(name)) prefs.pinned = prefs.pinned.filter((n) => n !== name)
    else prefs.pinned.push(name)
    freqPrefs.value = prefs
    notify(prefs.pinned.includes(name) ? `已固定「${name}」到常记` : `已取消固定「${name}」`)
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
    notify(prefs.hidden.includes(name) ? `已从常记隐藏「${name}」` : `「${name}」恢复参与常记`)
  }

  const open = computed(() => !!detailItem.value)

  return {
    open,
    detailItem,
    detailExpense,
    detailEdit,
    detailAmountInput,
    detailCategoryInput,
    detailDateInput,
    detailCurrencyInput,
    openDetail,
    closeDetail,
    editFromDetail,
    cancelDetailEdit,
    saveDetailEdit,
    againFromDetail,
    undoBillPaymentFromDetail,
    deleteFromDetail,
    showRefund,
    refundItem,
    refundAmountInput,
    refundDateInput,
    refundNoteInput,
    refundRemaining,
    openRefund,
    closeRefund,
    confirmRefund,
    togglePinName,
    toggleHideName,
  }
}