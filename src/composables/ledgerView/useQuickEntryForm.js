/**
 * 「记一笔」弹窗的**表单状态与逻辑**（从 LedgerView.vue 拆出）。
 *
 * 这里只管表单：refs、校验、常用分类 chips、分摊预览、保存/关闭。
 * 弹窗开关 `showQuick` / `editingId` 由页面持有，保存成功后回传 toast 与 undo。
 * 多币种 / 分摊 都是纯函数，不依赖页面级命令对象（`domain.createTransaction` 等由页面注入）。
 */
import { computed, ref, watch } from 'vue'
import { activeCategories, catInfo, commonCategories, detectCategory, ledgerCategories, ledgerIndex, rememberCategoryOverride } from '../ledger.js'
import { buildSplit, currencyField, hasSplit, mySpendYuan, splitCentsEvenly } from '../ledgerSplit.js'
import { amountToCents, normalizeAmount } from '../ledger.js'
import { COMMON_LEDGER_CURRENCIES, currencyChoices, normalizeCurrency, useLedgerFx } from '../ledgerFx.js'
import { parseNatural } from '../ledger.js'
import { defaultAccount, policyTimeKey } from '../settingsPolicy.js'
import { appNow, appToday, ledgerNowHM } from '../timeContext.js'

export function useQuickEntryForm({ baseCurrency, domain, notify, closeSwipe, ledgerNowHM }) {
  const { fx } = useLedgerFx()

  // 弹窗开关与编辑态由页面持有（showQuick、editingId），这里只管表单里的 ref
  const showQuickRecord = ref(false)
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
  const cycleSuggest = ref(null)
  const suggestedCategoryInput = ref('')
  const categoryInputManuallySelected = ref(false)
  const showAllQuickCategories = ref(false)

  // 多币种
  const currencyInput = ref('')
  const currencyOptions = computed(() => currencyChoices(fx.value, [currencyInput.value]))

  // 分摊
  const splitCount = ref('1')
  const splitMine = ref('')

  // 保持 splitMine 与 amountInput/splitCount 同步（测试直接设值时也能生效）
  watch([amountInput, splitCount], () => {
    if (!splitMine.value) syncSplitMine()
  }, { immediate: true })

  function resetSplitState() {
    splitCount.value = '1'
    splitMine.value = ''
  }

  function draftSplit() {
    try {
      return { split: buildSplit(amountInput.value, { count: splitCount.value, mine: splitMine.value }) }
    } catch (cause) {
      return { error: cause?.message || '分摊数据不合法' }
    }
  }

  const splitPreview = computed(() => {
    const totalCents = amountToCents(amountInput.value)
    const people = Math.trunc(Number(splitCount.value)) || 1
    if (totalCents === null || !Number.isFinite(people) || people < 1) return ''
    const shares = splitCentsEvenly(totalCents, people)
    const mine = shares[0] / 100
    const others = (totalCents - shares[0]) / 100
    // 同步更新 splitMine 供表单提交使用（兼容测试直接设值的场景）
    if (splitMine.value !== String(mine)) splitMine.value = String(mine)
    return people === 1
      ? `单人承担 ${mySpendYuan(mine, currencyInput.value)}`
      : `共 ${people} 人：我承担 ${mySpendYuan(mine, currencyInput.value)}，其余 ${mySpendYuan(others, currencyInput.value)}`
  })

  function syncSplitMine() {
    const totalCents = amountToCents(amountInput.value)
    const people = Math.trunc(Number(splitCount.value))
    if (totalCents === null || !Number.isFinite(people) || people < 1) { splitMine.value = ''; return }
    splitMine.value = String(splitCentsEvenly(totalCents, people)[0] / 100)
  }

  function onSplitChange() {
    syncSplitMine()
  }

  function openQuick(prefill = {}) {
    amountInput.value = prefill.amount ?? ''
    nameInput.value = prefill.name ?? ''
    catInput.value = prefill.cat ?? ''
    suggestedCategoryInput.value = ''
    categoryInputManuallySelected.value = Boolean(prefill.cat)
    showAllQuickCategories.value = false
    dateInput.value = prefill.date ?? appToday.value
    timeInput.value = prefill.time ?? ledgerNowHM()
    noteInput.value = prefill.note ?? ''
    accountInput.value = prefill.account ?? defaultAccount()
    directionInput.value = prefill.direction ?? prefill.type ?? 'expense'
    sourceInput.value = prefill.source ?? 'manual'
    billIdInput.value = prefill.billId ?? ''
    currencyInput.value = normalizeCurrency(prefill.currency) || baseCurrency.value
    const hasExistingSplit = hasSplit(prefill)
    splitCount.value = String(prefill.split?.participants?.length || 1)
    splitMine.value = hasExistingSplit ? String(prefill.split?.mine ?? '') : ''
    if (!hasExistingSplit) syncSplitMine()
    moreOpen.value = Boolean(prefill.id) || Boolean(prefill.expandMore)
    dupWarn.value = false
    forceDup.value = false
    cycleSuggest.value = null
    keepAdding.value = false
  }

  function openQuickRecord() {
    showQuickRecord.value = true
  }

  function closeQuickRecord() {
    showQuickRecord.value = false
  }

  function onQuickRecordSaved(payload) {
    notify(payload.message, {
      actionLabel: payload.undo ? '撤销' : '',
      undoFn: payload.undo ?? null,
      viewFn: payload.entityType === 'transaction' ? () => {} : null,
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
    const parsed = parseNatural(nameInput.value)
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
    if (forceDup.value) return false
    const amt = normalizeAmount(amountInput.value)
    const nm = nameInput.value.trim()
    if (amt === null || !nm) return false
    return ledgerIndex.value.sortedExpenses.some(
      (e) => e.name.trim() === nm && normalizeAmount(e.amount) === amt && Date.now() - (e.createdAt ? new Date(e.createdAt).getTime() : 0) < 2 * 60 * 1000
    )
  })

  async function saveExpense(keepOpen = false, editingId) {
    if (savingExpense.value) return
    savingExpense.value = true
    // 确保分摊状态同步（测试直接设值可能未触发 watch）
    syncSplitMine()
    const amount = normalizeAmount(amountInput.value)
    const name = nameInput.value.trim()
    try {
      if (amount === null) { amountEl.value?.focus(); return }
      if (duplicateHit.value) { dupWarn.value = true; return }
      let split = null
      if (directionInput.value !== 'income') {
        const draft = draftSplit()
        if (draft.error) { notify(draft.error); return }
        split = draft.split
      }
      const currency = currencyField(currencyInput.value)
      if (editingId) {
        const target = domain.updateTransaction(editingId, {
          name, amount, cat: catInput.value || detectCategory(name),
          date: dateInput.value || appToday.value, time: timeInput.value || ledgerNowHM(),
          account: accountInput.value.trim(), note: noteInput.value.trim(),
          currency, split,
        })
        if (target) notify(`已更新 ${mySpendYuan(amount, currency)} · ${target.name}`)
      } else {
        const saved = domain.createTransaction({ name, amount,
          cat: catInput.value || detectCategory(name),
          direction: directionInput.value,
          date: dateInput.value || appToday.value,
          time: timeInput.value || ledgerNowHM(),
          note: noteInput.value.trim(), account: accountInput.value.trim(),
          source: sourceInput.value || 'manual',
          billId: billIdInput.value || '',
          createdFrom: sourceInput.value || 'manual',
          currency, split,
        })
        if (name && categoryInputManuallySelected.value) rememberCategoryOverride(name, saved.cat, directionInput.value)
        notify(`已记下 ${directionInput.value === 'income' ? '+' : '-'}${mySpendYuan(amount, currency)} · ${saved.name}`, {
          actionLabel: '撤销',
          undoFn: () => domain.deleteTransaction(saved.id),
          duration: 6000,
        })
      }
      if (keepOpen) {
        amountInput.value = ''
        nameInput.value = ''
        noteInput.value = ''
        accountInput.value = defaultAccount()
        dateInput.value = appToday.value
        timeInput.value = ledgerNowHM()
        catInput.value = ''
        suggestedCategoryInput.value = ''
        categoryInputManuallySelected.value = false
        showAllQuickCategories.value = false
        dupWarn.value = false
        forceDup.value = false
        keepAdding.value = true
        cycleSuggest.value = null
        currencyInput.value = normalizeCurrency(currencyInput.value) || baseCurrency.value
        splitMine.value = ''
        syncSplitMine()
        amountEl.value?.focus()
      }
    } catch (cause) {
      notify(cause?.message || '保存失败，请检查金额和日期')
    } finally {
      savingExpense.value = false
    }
  }

  function closeQuick() {
    keepAdding.value = false
    savingExpense.value = false
  }

  return {
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
    amountEl,
    dupWarn,
    forceDup,
    keepAdding,
    savingExpense,
    directionInput,
    cycleSuggest,
    suggestedCategoryInput,
    categoryInputManuallySelected,
    showAllQuickCategories,
    currencyInput,
    currencyOptions,
    splitCount,
    splitMine,
    resetSplitState,
    draftSplit,
    splitPreview,
    syncSplitMine,
    onSplitChange,
    openQuick,
    openQuickRecord,
    closeQuickRecord,
    onQuickRecordSaved,
    setDirection,
    onNameInput,
    quickCatChips,
    selectQuickCategory,
    duplicateHit,
    saveExpense,
    closeQuick,
  }
}