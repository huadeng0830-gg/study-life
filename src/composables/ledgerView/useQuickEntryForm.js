/**
 * 「记一笔」弹窗的**表单状态与逻辑**（从 LedgerView.vue 拆出）。
 *
 * 这里只管表单：refs、校验、常用分类 chips、分摊预览、保存/关闭。
 * 弹窗开关 `showQuick` / `editingId` 由页面持有，保存成功后回传 toast 与 undo。
 * 多币种 / 分摊 都是纯函数，不依赖页面级命令对象（`domain.createTransaction` 等由页面注入）。
 */
import { computed, ref, watch } from 'vue'
import { activeCategories, classifyTransaction, commonCategories, detectCategory, ledgerCategories, ledgerIndex, rememberCategoryOverride } from '../ledger.js'
import { buildSplit, hasSplit, splitCentsEvenly } from '../ledgerSplit.js'
import { moneyWithCurrency } from '../../utils/formatters.js'
import { amountToCents, normalizeAmount } from '../ledger.js'
import { COMMON_LEDGER_CURRENCIES, currencyChoices, currencyField, normalizeCurrency, useLedgerFx } from '../ledgerFx.js'
import { parseNatural } from '../ledger.js'
import { defaultAccount, policyTimeKey } from '../settingsPolicy.js'
import { appNow, appToday } from '../timeContext.js'

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

  // splitMine 是「我承担」那一半的金额。界面上它是只读的（用户不能手填），
  // 所以正常情况下它**永远**应该等于按分等分算出来的那一份。
  //
  // 但编辑一条**本来就有分摊**的记录时，它来自既有数据，不能被覆盖 ——
  // 用这个标志区分「派生值」和「外部给定的值」：
  //   - 派生：改金额/人数就跟着重算；
  //   - 外部给定：保持不动。
  // 之前没有这个区分，只能把重算塞进 splitPreview 这个 computed 里、靠渲染时
  // 写状态来「顺便」纠正 —— 等于每次重渲染都改一次表单状态。
  let splitMineIsDerived = true

  watch([amountInput, splitCount], () => {
    if (splitMineIsDerived) syncSplitMine()
  }, { immediate: true })

  function resetSplitState() {
    splitCount.value = '1'
    splitMine.value = ''
    splitMineIsDerived = true
  }

  function draftSplit() {
    try {
      return { split: buildSplit(amountInput.value, { count: splitCount.value, mine: splitMine.value }) }
    } catch (cause) {
      return { error: cause?.message || '分摊数据不合法' }
    }
  }

  // 纯展示：只算文案，不写任何状态。
  //
  // 原来这个 computed 里有一句 `splitMine.value = String(mine)`。它被模板当
  // :split-preview 传给弹窗，于是**每次 LedgerView 重渲染都会执行一次写状态**，
  // 而 splitMine 同时又作为 prop 传给同一个弹窗 —— 典型的 render 期间写状态。
  // 现在 splitMine 只由下面的 watch / syncSplitMine() 负责更新，这里保持纯函数。
  const splitPreview = computed(() => {
    const totalCents = amountToCents(amountInput.value)
    const people = Math.trunc(Number(splitCount.value)) || 1
    if (totalCents === null || !Number.isFinite(people) || people < 1) return ''
    const shares = splitCentsEvenly(totalCents, people)
    const mine = shares[0] / 100
    const others = (totalCents - shares[0]) / 100
    // 单人不是「分摊」：金额与人数都对，但没有第二个人参与，写进数据里只会让
    // 每一条记录都自称「已分摊 1 人」。故此处与 saveExpense 一样按人数分流。
    return people === 1
      ? '单人记录，无需分摊'
      : `共 ${people} 人：我承担 ${moneyWithCurrency(mine, currencyInput.value)}，其余 ${moneyWithCurrency(others, currencyInput.value)}`
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
    dateInput.value = prefill.date ?? appToday.value
    timeInput.value = prefill.time ?? ledgerNowHM()
    noteInput.value = prefill.note ?? ''
    accountInput.value = prefill.account ?? defaultAccount()
    directionInput.value = prefill.direction ?? prefill.type ?? 'expense'
    const parsedName = parseNatural(nameInput.value).name || nameInput.value.trim()
    const classification = parsedName ? classifyTransaction(parsedName, { direction: directionInput.value }) : null
    suggestedCategoryInput.value = classification?.categoryId || ''
    const learnedCategory = classification?.matchedBy === 'user' ? classification.categoryId : ''
    const editingExisting = Boolean(prefill.id)
    // 新建记录时，用户已经保存的纠正要优先于「常记」或“再记一笔”携带的旧分类。
    // 编辑原记录则仍以该条记录现有分类为准，避免历史交易被新的名称规则意外改写。
    catInput.value = editingExisting
      ? prefill.cat ?? suggestedCategoryInput.value
      : learnedCategory || prefill.cat || suggestedCategoryInput.value
    categoryInputManuallySelected.value = editingExisting
      ? Boolean(prefill.cat)
      : !learnedCategory && Boolean(prefill.cat)
    showAllQuickCategories.value = false
    sourceInput.value = prefill.source ?? 'manual'
    billIdInput.value = prefill.billId ?? ''
    currencyInput.value = normalizeCurrency(prefill.currency) || baseCurrency.value
    const hasExistingSplit = hasSplit(prefill)
    splitCount.value = String(prefill.split?.participants?.length || 1)
    splitMine.value = hasExistingSplit ? String(prefill.split?.mine ?? '') : ''
    // 编辑既有分摊记录时，「我承担」来自原数据，之后不该被按分等分重算覆盖。
    splitMineIsDerived = !hasExistingSplit
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
    suggestedCategoryInput.value = name ? classifyTransaction(name, { direction }).categoryId : ''
    catInput.value = suggestedCategoryInput.value
  }

  function onNameInput(inputValue = nameInput.value) {
    dupWarn.value = false
    forceDup.value = false
    const rawName = String(inputValue ?? '')
    const parsed = parseNatural(rawName)
    if (parsed.amount && amountInput.value === '' && parsed.name && parsed.name !== rawName) {
      nameInput.value = parsed.name
    }
    if (parsed.amount && amountInput.value === '') amountInput.value = parsed.amount
    if (parsed.cycle && !catInput.value) cycleSuggest.value = parsed.cycle
    if (!categoryInputManuallySelected.value) {
      const name = parsed.name || rawName.trim()
      const classification = name ? classifyTransaction(name, { direction: directionInput.value }) : null
      suggestedCategoryInput.value = classification?.categoryId || ''
      catInput.value = suggestedCategoryInput.value
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
    if (catInput.value === key) return
    catInput.value = key
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

  /**
   * 保存一笔。返回值是有意义的：**true = 真的存进去了，false = 没存**。
   *
   * 弹窗开关由页面持有，所以页面必须知道这次到底成没成才能决定要不要收起弹窗。
   * 之前这里所有路径都返回 undefined，页面无从判断，于是「记下」之后弹窗不消失，
   * 而金额非法/重复记账这些「没存」的分支又必须留在原地让用户改 —— 没有返回值就
   * 只能二选一，两种都不对。
   */
  async function saveExpense(keepOpen = false, editingId) {
    if (savingExpense.value) return false
    savingExpense.value = true
    // 确保分摊状态同步（测试直接设值可能未触发 watch）
    syncSplitMine()
    const amount = normalizeAmount(amountInput.value)
    const name = nameInput.value.trim()
    try {
      if (amount === null) {
        // 【金额非法必须看得见】原来这里只有 `amountEl.value?.focus()`，而这个 ref 在
        // 本页从未绑定到任何元素（LedgerView 没有解构它；弹窗里那个 ref 是同名的**另一个**
        // 局部 ref），于是焦点回跳是空操作、也没有任何提示 —— 用户点「记下」只看到
        // 按钮毫无反应，只能自己猜是漏了金额还是数字格式不对。
        amountEl.value?.focus()
        notify('请先填写有效金额，例如 12.50')
        return false
      }
      if (duplicateHit.value) { dupWarn.value = true; return false }
      let split = null
      // 【人数为 1 不是分摊】此前无条件 `draftSplit()`，于是 splitCount 默认 '1'
      // 也会写出一份「合法」的 1 人 split：结果每条支出都自称「已分摊 1 人」，
      // 列表副标题、详情、回顾、首页口径说明全部被这一条无关数据污染。
      // 收入不参与分摊；人数为 1 时不写 split 字段（= 未分摊，语义与旧记录一致）。
      const people = Math.trunc(Number(splitCount.value))
      if (directionInput.value !== 'income' && Number.isFinite(people) && people > 1) {
        const draft = draftSplit()
        if (draft.error) { notify(draft.error); return false }
        split = draft.split
      } else if (directionInput.value !== 'income' && splitCount.value !== '1' && splitCount.value !== '') {
        // 人数非法（0 / 负数 / 非数字）时必须报错，不能静默当成单人记录。
        const draft = draftSplit()
        if (draft.error) { notify(draft.error); return false }
        split = draft.split
      }
      const currency = currencyField(currencyInput.value, fx.value)
      if (editingId) {
        const previous = domain.transactions?.value?.find((entry) => entry.id === editingId)
        const previousCategory = previous?.cat || 'other'
        const target = domain.updateTransaction(editingId, {
          name, amount, cat: catInput.value || detectCategory(name, { direction: directionInput.value }),
          date: dateInput.value || appToday.value, time: timeInput.value || ledgerNowHM(),
          account: accountInput.value.trim(), note: noteInput.value.trim(),
          currency, split,
        })
        if (target) {
          if (name && previousCategory !== target.cat) rememberCategoryOverride(name, target.cat, target.direction)
          notify(`已更新 ${moneyWithCurrency(target.amount, target.currency)} · ${target.name}`)
        }
      } else {
        const saved = domain.createTransaction({ name, amount,
          cat: catInput.value || detectCategory(name, { direction: directionInput.value }),
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
        notify(`已记下 ${directionInput.value === 'income' ? '+' : '-'}${moneyWithCurrency(saved.amount, saved.currency)} · ${saved.name}`, {
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
        // 【必须连人数一起复位】原来只清了 splitMine，splitCount 被静默继承下来：
        // 上一笔按 3 人分摊，点「连续记」后下一笔只要填了金额就自动又按 3 人分摊，
        // 而界面上没有任何东西提示它被继承了。resetSplitState 就是为这件事写的，
        // 此前一直零调用。
        resetSplitState()
        amountEl.value?.focus()
      }
      return true
    } catch (cause) {
      notify(cause?.message || '保存失败，请检查金额和日期')
      return false
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
