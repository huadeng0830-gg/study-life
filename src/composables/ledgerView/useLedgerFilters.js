/**
 * 账本首页的**筛选条件**（从 LedgerView.vue 拆出）。
 *
 * 这里只持有可写的筛选 ref + 由它们算出的 `filteredExpenses`/`filtersActive`/`clearFilters`。
 * 信息流派生已在 feed.js 里；这里只做筛选口径的集中管理，页面只需把这些 ref 绑到面板上。
 */
import { computed, ref } from 'vue'
import { filterLedgerTransactions, isDateInLedgerRange, ledgerIndex, catInfo } from '../ledger.js'
import { appToday } from '../timeContext.js'

const ledgerToday = () => appToday.value

export function useLedgerFilters() {
  const q = ref('')
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

  return {
    q,
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
  }
}