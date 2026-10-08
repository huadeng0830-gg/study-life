// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLedgerCategoryManager } from '../src/composables/ledgerView/useLedgerCategoryManager.js'
import { DEFAULT_CATEGORIES } from '../src/composables/ledgerCategories.js'
import { expenses, freqPrefs, ledgerCategories } from '../src/composables/ledger.js'

function resetLedgerState() {
  ledgerCategories.value = DEFAULT_CATEGORIES.map((category) => ({ ...category }))
  expenses.value = []
  freqPrefs.value = { pinned: [], hidden: [], categoryOverrides: [] }
}

describe('useLedgerCategoryManager', () => {
  beforeEach(resetLedgerState)
  afterEach(resetLedgerState)

  it('normalizes a new category name and keeps its direction and stable custom key', () => {
    const manager = useLedgerCategoryManager({ notify: vi.fn() })
    manager.openCategoryManager()
    manager.categoryManageScope.value = 'income'
    manager.newCatName.value = '  稿费   收入  '

    manager.addCategory()

    const added = ledgerCategories.value.find((category) => category.name === '稿费 收入')
    expect(added).toMatchObject({ scope: 'income', hidden: false, isDefault: false })
    expect(added.key).toMatch(/^custom-/)
    expect(manager.newCatName.value).toBe('')
    expect(manager.categoryManageTab.value).toBe('all')
    expect(manager.categoryFeedback.value).toMatchObject({ type: 'success' })
  })

  it('blocks deletion while history uses the category, then removes its auto rules after confirmation', () => {
    const notify = vi.fn()
    const manager = useLedgerCategoryManager({ notify })
    const custom = { key: 'custom-coffee', name: '咖啡豆', icon: '☕', scope: 'expense', hidden: false, isDefault: false }
    ledgerCategories.value = [...ledgerCategories.value, custom]
    freqPrefs.value = { ...freqPrefs.value, categoryOverrides: [{ key: custom.key, match: '咖啡' }] }
    expenses.value = [{ id: 'tx-1', cat: custom.key }]

    manager.requestDeleteCategory(custom)
    expect(manager.categoryDeleteTarget.value).toBeNull()
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('已有 1 笔历史交易'), { type: 'warning' })

    expenses.value = []
    manager.requestDeleteCategory(custom)
    expect(manager.categoryDeleteTarget.value).toMatchObject(custom)
    expect(manager.categoryDeleteMessage.value).toContain('移除关联的 1 条自动分类规则')

    manager.confirmDeleteCategory()
    expect(ledgerCategories.value.some((category) => category.key === custom.key)).toBe(false)
    expect(freqPrefs.value.categoryOverrides).toEqual([])
    expect(manager.categoryFeedback.value).toMatchObject({ type: 'success' })
  })
})
