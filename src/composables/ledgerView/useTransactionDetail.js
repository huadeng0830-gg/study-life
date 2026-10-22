/**
 * 记录详情弹窗的**状态与动作**（从 LedgerView.vue 拆出）。
 *
 * 这里只管详情：打开/关闭、编辑态、退款、固定/隐藏名称、删除/撤销。
 * 但具体动作的实现（updateTransaction、refundTransaction、freqPrefs 修改）搬到这里。
 */
import { computed, ref, watch } from 'vue'
import { expenses, isRefundTransaction, freqPrefs } from '../ledger.js'
import { mySpendCents } from '../ledgerSplit.js'
import { isBillPayment } from '../ledgerRelations.js'
import { moneyWithCurrency } from '../../utils/formatters.js'

export function useTransactionDetail({ domain, notify, closeSwipe, flashTransaction, baseCurrency, ledgerToday }) {
  const detailItem = ref(null)
  const detailExpense = computed(() => detailItem.value ? expenses.value.find((e) => String(e.id) === String(detailItem.value) && !e.archivedAt && !e.deletedAt && !e.tombstone) ?? null : null)
  // 退款
  const showRefund = ref(false)
  const refundItem = ref(null)
  const refundAmountInput = ref('')
  const refundDateInput = ref('')
  const refundNoteInput = ref('')
  const refundError = ref('')
  const linkedRefunds = computed(() => expenses.value.filter((entry) => isRefundTransaction(entry)
    && entry.refundOf === detailExpense.value?.id && !entry.archivedAt && !entry.deletedAt && !entry.tombstone))
  const refundOriginal = computed(() => isRefundTransaction(detailExpense.value)
    ? expenses.value.find((entry) => entry.id === detailExpense.value.refundOf && !entry.archivedAt && !entry.deletedAt && !entry.tombstone) : null)
  const money = (item) => moneyWithCurrency(item.amount, item.currency || baseCurrency.value)
  watch([refundAmountInput, refundDateInput, refundNoteInput], () => { refundError.value = '' })

  function openDetail(id) {
    detailItem.value = id
  }

  function closeDetail() {
    detailItem.value = null
  }

  function againFromDetail() {
    const e = detailExpense.value
    if (!e) return
    closeDetail()
    return { name: e.name, amount: String(e.amount), cat: e.cat, note: e.note, account: e.account, direction: e.direction, currency: e.currency, split: e.split }
  }

  function editFromDetail() {
    const e = detailExpense.value
    if (!e || isBillPayment(e) || isRefundTransaction(e)) return null
    closeDetail()
    return {
      id: e.id,
      name: e.name,
      amount: String(e.amount),
      cat: e.cat,
      date: e.date,
      time: e.time,
      note: e.note,
      account: e.account,
      direction: e.direction,
      currency: e.currency,
      split: e.split,
    }
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
    notify(`已撤销本期账单支付 · ${money(undone)}`)
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
    notify(`已删除 ${money(snapshot)} · ${snapshot.name}`, {
      actionLabel: '撤销',
      undoFn: () => domain.restoreDeletedTransaction(snapshot),
    })
  }

  function refundRemaining(item) {
    if (!item) return 0
    // 与 `refundTransaction` 的上限同一口径（有分摊取 mine，否则取全额），
    // 否则弹窗预填的金额会超过命令层允许的金额，用户点确认只会撞到 blocked。
    const already = expenses.value
      .filter((entry) => isRefundTransaction(entry) && entry.refundOf === item.id && !entry?.archivedAt && !entry?.deletedAt && !entry?.tombstone)
      .reduce((sum, entry) => sum + (mySpendCents(entry) ?? 0), 0)
    return Math.max(0, (mySpendCents(item) ?? 0) - already) / 100
  }

  function openRefund() {
    const e = detailExpense.value
    if (!e || isRefundTransaction(e) || isBillPayment(e) || e.direction === 'income' || refundRemaining(e) <= 0) return
    refundItem.value = e
    refundAmountInput.value = String(refundRemaining(e))
    refundDateInput.value = ledgerToday()
    refundNoteInput.value = ''
    refundError.value = ''
    showRefund.value = true
  }

  function closeRefund() {
    showRefund.value = false
    refundItem.value = null
  }

  function confirmRefund() {
    const original = refundItem.value
    if (!original) return
    let result
    try {
      result = domain.refundTransaction(original.id, {
        amount: refundAmountInput.value,
        date: refundDateInput.value,
        note: refundNoteInput.value,
      })
    } catch (cause) {
      refundError.value = cause?.message || '退款保存失败，请稍后重试'
      return
    }
    if (result?.blocked) {
      refundError.value = result.reason
      return
    }
    if (!result) return
    closeRefund()
    closeDetail()
    flashTransaction(result.id)
    notify(`已登记退款 ${money(result)} · 原支出已冲抵`, {
      actionLabel: '撤销', undoFn: () => domain.deleteTransaction(result.id), duration: 6000,
    })
  }

  function togglePinName() {
    const e = detailExpense.value
    if (!e) return
    const name = e.name.trim()
    const prefs = { ...freqPrefs.value, pinned: [...(freqPrefs.value.pinned ?? [])], hidden: [...(freqPrefs.value.hidden ?? [])] }
    if (prefs.pinned.includes(name)) prefs.pinned = prefs.pinned.filter((n) => n !== name)
    else prefs.pinned.push(name)
    freqPrefs.value = prefs
    notify(prefs.pinned.includes(name) ? `已固定「${name}」到常记` : `已取消固定「${name}」`)
  }

  function toggleHideName() {
    const e = detailExpense.value
    if (!e) return
    const name = e.name.trim()
    const prefs = { ...freqPrefs.value, pinned: [...(freqPrefs.value.pinned ?? [])], hidden: [...(freqPrefs.value.hidden ?? [])] }
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
    openDetail,
    closeDetail,
    editFromDetail,
    againFromDetail,
    undoBillPaymentFromDetail,
    deleteFromDetail,
    showRefund,
    refundItem,
    refundAmountInput,
    refundDateInput,
    refundNoteInput,
    refundError,
    linkedRefunds,
    refundOriginal,
    remainingRefund: computed(() => refundRemaining(detailExpense.value)),
    refundRemaining,
    openRefund,
    closeRefund,
    confirmRefund,
    togglePinName,
    toggleHideName,
  }
}
