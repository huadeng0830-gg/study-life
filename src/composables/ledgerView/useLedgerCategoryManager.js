import { computed, ref, watch } from 'vue'
import {
  categoriesForScope,
  commonCategories,
  expenses,
  freqPrefs,
  ledgerCategories,
} from '../ledger.js'

const CATEGORY_NAME_MAX_LENGTH = 32
const ICON_POOL = ['🍜', '☕', '🍪', '🚇', '🛍️', '📦', '📚', '💻', '🎮', '🧴', '✂️', '🛁', '🏠', '💡', '📱', '💊', '🏃', '🎁', '✈️', '🐾', '🔁', '💼', '💰', '🧾', '↩️', '🧧', '♻️', '⋯']

/** Owns category editing, ordering, visibility, and safe deletion for the ledger. */
export function useLedgerCategoryManager({ notify }) {
  const showCatManage = ref(false)
  const newCatName = ref('')
  const renameTarget = ref(null)
  const renameError = ref('')
  const categoryManageTab = ref('common')
  const categoryManageScope = ref('expense')
  const categoryFeedback = ref(null)
  const iconPickerCategoryKey = ref('')
  const categoryDeleteTarget = ref(null)

  function createCategoryId() {
    return `custom-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`
  }

  function normalizedCategoryName(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
  }

  function categoryNameToken(value) {
    return normalizedCategoryName(value).toLocaleLowerCase()
  }

  function categoryNameExists(name, scope, exceptKey = '') {
    const token = categoryNameToken(name)
    return ledgerCategories.value.some((category) => (
      category.key !== exceptKey
      && (category.scope || 'expense') === scope
      && categoryNameToken(category.name) === token
    ))
  }

  const managedCategories = computed(() => {
    const all = categoriesForScope(categoryManageScope.value, { includeHidden: true })
    if (categoryManageTab.value === 'hidden') return all.filter((category) => category.hidden)
    if (categoryManageTab.value === 'custom') return all.filter((category) => !category.isDefault)
    if (categoryManageTab.value === 'all') return all
    return commonCategories(categoryManageScope.value)
  })

  // Aggregate once so each rendered row reads usage in O(1), rather than rescanning the ledger.
  const categoryUsage = computed(() => {
    const usage = new Map()
    const entryFor = (key) => {
      if (!usage.has(key)) usage.set(key, { transactions: 0, rules: 0 })
      return usage.get(key)
    }
    for (const transaction of expenses.value ?? []) {
      const key = String(transaction?.cat ?? '').trim()
      if (key) entryFor(key).transactions += 1
    }
    const overrides = freqPrefs.value?.categoryOverrides
    if (Array.isArray(overrides)) {
      for (const rule of overrides) {
        const key = String(rule?.key ?? rule?.category ?? '').trim()
        if (key) entryFor(key).rules += 1
      }
    } else if (overrides && typeof overrides === 'object') {
      for (const key of Object.values(overrides)) {
        const normalizedKey = String(key ?? '').trim()
        if (normalizedKey) entryFor(normalizedKey).rules += 1
      }
    }
    return usage
  })

  function categoryUsageFor(key) {
    return categoryUsage.value.get(String(key)) ?? { transactions: 0, rules: 0 }
  }

  const categoryDeleteMessage = computed(() => {
    const category = categoryDeleteTarget.value
    if (!category) return ''
    const rules = categoryUsageFor(category.key).rules
    const ruleNote = rules
      ? `同时会移除关联的 ${rules} 条自动分类规则，之后新记录将重新使用系统分类建议。`
      : ''
    return `确定删除自定义分类“${category.name}”吗？${ruleNote}此操作不可撤销。`
  })

  function openCategoryManager() {
    categoryManageTab.value = 'common'
    categoryManageScope.value = 'expense'
    categoryFeedback.value = null
    iconPickerCategoryKey.value = ''
    showCatManage.value = true
  }

  function addCategory() {
    const name = normalizedCategoryName(newCatName.value)
    if (!name) {
      categoryFeedback.value = { type: 'error', message: '先输入分类名称。' }
      return
    }
    if (name.length > CATEGORY_NAME_MAX_LENGTH) {
      categoryFeedback.value = { type: 'error', message: `分类名称不能超过 ${CATEGORY_NAME_MAX_LENGTH} 个字符。` }
      return
    }
    if (categoryNameExists(name, categoryManageScope.value)) {
      categoryFeedback.value = { type: 'error', message: `已有同名${categoryManageScope.value === 'income' ? '收入' : '支出'}分类，请换一个名称。` }
      return
    }
    const used = new Set(ledgerCategories.value.map((category) => category.icon))
    const icon = ICON_POOL.find((item) => !used.has(item)) ?? '📦'
    ledgerCategories.value = [...ledgerCategories.value, {
      key: createCategoryId(),
      name,
      icon,
      scope: categoryManageScope.value,
      hidden: false,
      isDefault: false,
    }]
    newCatName.value = ''
    categoryManageTab.value = 'all'
    categoryFeedback.value = { type: 'success', message: `已添加“${name}”，已在全部分类中显示。` }
  }

  function renameCategory(category) {
    renameError.value = ''
    renameTarget.value = category
  }

  function applyCategoryRename(value) {
    const target = renameTarget.value
    const trimmed = normalizedCategoryName(value)
    if (!target || !trimmed) { renameTarget.value = null; return }
    const category = ledgerCategories.value.find((item) => item.key === target.key)
    if (!category) { renameTarget.value = null; return }
    if (trimmed.length > CATEGORY_NAME_MAX_LENGTH && trimmed !== category.name) {
      renameError.value = `分类名称不能超过 ${CATEGORY_NAME_MAX_LENGTH} 个字符。`
      return
    }
    if (categoryNameExists(trimmed, category.scope || 'expense', category.key)) {
      renameError.value = `已有同名${category.scope === 'income' ? '收入' : '支出'}分类，请换一个名称。`
      return
    }
    // Transactions retain this category key, so rename the label in place to preserve history links.
    category.name = trimmed
    renameTarget.value = null
    renameError.value = ''
    notify(`分类名称已更新为“${trimmed}”`, { type: 'success' })
  }

  function toggleIconPicker(category) {
    iconPickerCategoryKey.value = iconPickerCategoryKey.value === category.key ? '' : category.key
  }

  function setCategoryIcon(category, icon) {
    const target = ledgerCategories.value.find((item) => item.key === category.key)
    if (target) target.icon = icon
  }

  function canHideCategory(category) {
    return Boolean(category?.hidden) || categoriesForScope(category?.scope || 'expense').length > 1
  }

  function toggleCatHidden(category) {
    const target = ledgerCategories.value.find((item) => item.key === category.key)
    if (!target) return
    if (!canHideCategory(target)) {
      notify('至少保留一个可用分类；可以显示其他隐藏分类后再调整。', { type: 'warning' })
      return
    }
    target.hidden = !target.hidden
  }

  function moveCategory(category, delta) {
    const list = [...ledgerCategories.value]
    const index = list.findIndex((item) => item.key === category.key)
    if (index < 0) return
    const scope = category.scope || 'expense'
    const sameScope = list.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => (item.scope || 'expense') === scope)
    const position = sameScope.findIndex(({ item }) => item.key === category.key)
    const target = sameScope[position + delta]
    if (!target) return
    list[index] = target.item
    list[target.itemIndex] = category
    ledgerCategories.value = list
  }

  function canMoveCategory(category, delta) {
    const index = managedCategories.value.findIndex((item) => item.key === category.key)
    return index >= 0 && index + delta >= 0 && index + delta < managedCategories.value.length
  }

  function requestDeleteCategory(category) {
    if (!category || category.isDefault) return
    const usage = categoryUsageFor(category.key)
    if (usage.transactions > 0) {
      notify(`“${category.name}”已有 ${usage.transactions} 笔历史交易，不能删除；可隐藏以保留记录。`, { type: 'warning' })
      return
    }
    categoryDeleteTarget.value = category
  }

  function confirmDeleteCategory() {
    const target = categoryDeleteTarget.value
    if (!target) return
    const current = ledgerCategories.value.find((category) => category.key === target.key)
    if (!current || current.isDefault) {
      categoryDeleteTarget.value = null
      return
    }
    const usage = categoryUsageFor(current.key)
    if (usage.transactions > 0) {
      categoryDeleteTarget.value = null
      notify(`“${current.name}”已有历史交易，不能删除；可隐藏以保留记录。`, { type: 'warning' })
      return
    }
    if (usage.rules > 0) {
      const overrides = freqPrefs.value?.categoryOverrides
      const categoryOverrides = Array.isArray(overrides)
        ? overrides.filter((rule) => String(rule?.key ?? rule?.category ?? '').trim() !== current.key)
        : overrides && typeof overrides === 'object'
          ? Object.fromEntries(Object.entries(overrides).filter(([, key]) => String(key ?? '').trim() !== current.key))
          : overrides
      freqPrefs.value = { ...freqPrefs.value, categoryOverrides }
    }
    ledgerCategories.value = ledgerCategories.value.filter((category) => category.key !== current.key)
    categoryDeleteTarget.value = null
    categoryManageTab.value = 'all'
    categoryFeedback.value = { type: 'success', message: `已删除自定义分类“${current.name}”。` }
  }

  watch([categoryManageTab, categoryManageScope], () => {
    categoryFeedback.value = null
    iconPickerCategoryKey.value = ''
  }, { flush: 'sync' })

  return {
    showCatManage,
    newCatName,
    renameTarget,
    renameError,
    categoryManageTab,
    categoryManageScope,
    categoryFeedback,
    iconPickerCategoryKey,
    categoryDeleteTarget,
    CATEGORY_NAME_MAX_LENGTH,
    ICON_POOL,
    managedCategories,
    categoryUsageFor,
    categoryDeleteMessage,
    openCategoryManager,
    addCategory,
    renameCategory,
    applyCategoryRename,
    toggleIconPicker,
    setCategoryIcon,
    toggleCatHidden,
    canHideCategory,
    moveCategory,
    canMoveCategory,
    requestDeleteCategory,
    confirmDeleteCategory,
  }
}
