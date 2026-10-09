/**
 * 记录详情弹窗的**状态与动作**（从 LedgerView.vue 拆出）。
 *
 * 这里只管详情：打开/关闭、编辑态、退款、固定/隐藏名称、删除/撤销。
 * 页面持有 `detailItem`、`detailEdit`、`showRefund`、`refundItem` 等开关，
 * 但具体动作的实现（updateTransaction、refundTransaction、freqPrefs 修改）搬到这里。
 */
import { computed, ref, watch } from 'vue'
import { expenses, isRefundTransaction, freqPrefs, rememberCategoryOverride } from '../ledger.js'
import { normalizeAmount } from '../ledger.js'
import { buildSplit, hasSplit, mySpendCents, normalizeSplit, splitCentsEvenly } from '../ledgerSplit.js'
import { isBillPayment } from '../ledgerRelations.js'
import { moneyWithCurrency } from '../../utils/formatters.js'
import { normalizeCurrency, currencyField, useLedgerFx } from '../ledgerFx.js'

export function useTransactionDetail({ domain, notify, closeSwipe, flashTransaction, baseCurrency, ledgerToday }) {
  const { fx } = useLedgerFx()
  const detailItem = ref(null)
  const detailExpense = computed(() => detailItem.value ? expenses.value.find((e) => String(e.id) === String(detailItem.value) && !e.archivedAt && !e.deletedAt && !e.tombstone) ?? null : null)
  const detailEdit = ref(false)
  const detailAmountInput = ref('')
  const detailCategoryInput = ref('')
  const detailDateInput = ref('')
  const detailCurrencyInput = ref('')
  const applySameNameCategory = ref(false)
  const sameNameCategoryIds = computed(() => {
    const current = detailExpense.value
    if (!current || isRefundTransaction(current) || isBillPayment(current)) return []
    const currentName = normalizeTransactionName(current.name)
    if (!currentName) return []
    const direction = current.direction === 'income' ? 'income' : 'expense'
    const category = detailCategoryInput.value || 'other'
    const entries = domain.transactions?.value || expenses.value
    return entries
      .filter((entry) => entry && String(entry.id) !== String(current.id)
        && !entry.archivedAt && !entry.deletedAt && !entry.tombstone
        && !isRefundTransaction(entry) && !isBillPayment(entry)
        && (entry.direction === 'income' ? 'income' : 'expense') === direction
        && normalizeTransactionName(entry.name) === currentName
        && (entry.cat || 'other') !== category)
      .map((entry) => entry.id)
  })

  function normalizeTransactionName(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
  }

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
    detailEdit.value = false
    applySameNameCategory.value = false
  }

  function closeDetail() {
    detailItem.value = null
    detailEdit.value = false
    applySameNameCategory.value = false
  }

  function editFromDetail() {
    const e = detailExpense.value
    if (!e) return
    detailAmountInput.value = String(e.amount ?? '')
    detailCategoryInput.value = e.cat || ''
    detailDateInput.value = e.date || ledgerToday()
    detailCurrencyInput.value = normalizeCurrency(e.currency) || baseCurrency.value
    applySameNameCategory.value = false
    detailEdit.value = true
  }

  function cancelDetailEdit() {
    detailEdit.value = false
    applySameNameCategory.value = false
  }

  function saveDetailEdit() {
    const e = detailExpense.value
    if (!e) return
    // 【单位】命令层 `updateTransaction` 收的是**元**（它内部会 normalizeAmount）。
    // 这里原先调 `amountToCents` 把「元」变成「分」再塞进去，于是
    // normalizeAmount 把 1850 当成 1850 元 —— 每一次金额编辑都放大 100 倍。
    // 正确做法与新建路径（useQuickEntryForm）一致：用 normalizeAmount 交出元。
    const amount = normalizeAmount(detailAmountInput.value)
    if (amount === null) {
      notify('金额填写有误：不能为空，最多保留两位小数')
      return
    }
    let primaryUpdated = false
    try {
      const previousCategory = e.cat || 'other'
      // 【分摊同步】总额变了而 split 停在旧值时，校验只查 Σ参与者===split.total，
      // 两者都没变所以**校验通过**，于是「我承担」永远按旧份额计入所有合计。
      // 这里按新的总额重建分摊，1 人时就是全额，不改变任何未分摊记录的语义。
      const patch = {
        amount,
        cat: detailCategoryInput.value || 'other',
        date: detailDateInput.value || ledgerToday(),
        currency: currencyField(detailCurrencyInput.value, fx.value),
      }
      if (hasSplit(e)) {
        const original = normalizeSplit(e.split)
        const count = original.participants.length
        const equalShares = splitCentsEvenly(Math.round(original.total * 100), count)
        const isEqual = original.participants.every((entry, index) => Math.round(entry.amount * 100) === equalShares[index])
          && Math.round(original.mine * 100) === equalShares[0]
        patch.split = amount === original.total ? original : buildSplit(amount, { count, mine: isEqual ? null : original.mine })
        patch.split.participants = patch.split.participants.map((entry, index) => ({ ...entry, label: original.participants[index].label }))
      }
      const updated = domain.updateTransaction(e.id, patch)
      if (!updated) return
      primaryUpdated = true
      if (updated.name && previousCategory !== updated.cat) {
        rememberCategoryOverride(updated.name, updated.cat, updated.direction)
      }
      let previousCategories = []
      if (applySameNameCategory.value && sameNameCategoryIds.value.length) {
        previousCategories = domain.updateTransactionCategories(sameNameCategoryIds.value.map((id) => ({
          id,
          categoryId: updated.cat,
        })))
      }
      detailEdit.value = false
      applySameNameCategory.value = false
      closeSwipe()
      flashTransaction(updated.id)
      const summary = `已更新 ${updated.direction === 'income' ? '+' : '-'}${money(updated)} · ${updated.name}`
      const message = previousCategories.length
        ? `${summary}，并调整另外 ${previousCategories.length} 笔同名记录`
        : summary
      notify(message, previousCategories.length ? {
        actionLabel: '撤销批量分类',
        undoFn: () => domain.updateTransactionCategories(previousCategories),
      } : undefined)
    } catch (cause) {
      const reason = cause?.message || '请检查金额和日期'
      notify(primaryUpdated ? `当前记录已保存，但同名记录批量分类失败：${reason}` : `保存失败：${reason}`)
    }
  }

  function againFromDetail() {
    const e = detailExpense.value
    if (!e) return
    closeDetail()
    return { name: e.name, amount: String(e.amount), cat: e.cat, note: e.note, account: e.account, direction: e.direction, currency: e.currency, split: e.split }
  }

  /**
   * 「完整编辑」的预填：**带 id**。
   *
   * 为什么单独一个出口而不改 `againFromDetail`：后者语义是「再记一次相同的一笔」，
   * 刻意不传 id；给它加上 id 会把「新建」悄悄变成「覆盖这一笔」。
   * 这里返回带 id 的完整预填，让 `LedgerView` 的 `openQuick` 走编辑分支，
   * 于是名称/账户/备注/时间/收支方向/分摊终于都能改
   * （`useQuickEntryForm` 的 update 分支本来就写好了，此前从未被触发）。
   */
  function fullEditFromDetail() {
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
    detailEdit,
    detailAmountInput,
    detailCategoryInput,
    detailDateInput,
    detailCurrencyInput,
    applySameNameCategory,
    sameNameCategoryCount: computed(() => sameNameCategoryIds.value.length),
    openDetail,
    closeDetail,
    editFromDetail,
    cancelDetailEdit,
    saveDetailEdit,
    againFromDetail,
    fullEditFromDetail,
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
