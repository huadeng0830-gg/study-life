/**
 * 多币种汇率与月度预算的**页面侧派生状态**（从 LedgerView.vue 拆出）。
 *
 * 这里只管页面级 computed：基准币种、可添加币种列表、基准币种口径的月度摘要、汇率提示行、预算预警。
 * 汇率/预算的存储与命令在 ledgerFx.js / ledgerBudget.js，页面只负责把它们读出来、算成给模板用的形状。
 */
import { computed, ref } from 'vue'
import { useLedgerFx } from '../ledgerFx.js'
import { useLedgerBudget } from '../ledgerBudget.js'
import { sumLedgerMonthInBase, COMMON_LEDGER_CURRENCIES, normalizeCurrency, normalizeLedgerFx, fxRateNote } from '../ledgerFx.js'
import { mySpendYuan } from '../ledgerSplit.js'
import { budgetStatus, budgetAlertText } from '../ledgerBudget.js'
import { moneyWithCurrency } from '../../utils/formatters.js'

export function useLedgerFxBudget({ expenses, ledgerToday, baseMonthSummary }) {
  const { fx } = useLedgerFx()
  const { budget } = useLedgerBudget()

  const showFxSettings = ref(false)
  const showBudgetSettings = ref(false)

  // 表单币种 → 记录字段：基准币种一律落成空字符串（= 不写字段），
  // 与「旧记录没有 currency 就是基准币种」的约定完全一致，不给数据添无意义的字段。
  function currencyField(code) {
    const normalized = normalizeCurrency(code)
    const base = normalizeLedgerFx(fx.value).base
    return normalized === base ? '' : normalized
  }

  // 已经设了汇率的币种不再出现在「添加币种」候选里。
  const fxAddableCurrencies = computed(() => {
    const configured = new Set(Object.keys(normalizeLedgerFx(fx.value).rates))
    return COMMON_LEDGER_CURRENCIES.filter((code) => !configured.has(code) && code !== normalizeLedgerFx(fx.value).base)
  })

  const baseCurrency = computed(() => normalizeLedgerFx(fx.value).base)

  // 当月支出的「基准币种」口径：没有非基准币种记录时，它与本月花费完全相等（同一套分口径）。
  // 逐条先取「我承担的份额」再按汇率折成基准币种，所以这行折算说明与 hero 的三块数字、
  // 以及下面的预算预警永远同一个口径（外币 + 分摊同时存在时也不会各算各的）。
  const fxRateLine = computed(() => fxRateNote(baseMonthSummary.value))

  // 只做月度总额预算（见 ledgerBudget.js 的说明），落点是 hero-stat 里紧邻 hero-compare 的一行提示。
  const budgetAlert = computed(() => {
    const status = budgetStatus({ spent: baseMonthSummary.value.expenseTotal, budget: budget.value.monthly })
    if (!status.set) return null
    return {
      ...status,
      text: budgetAlertText(status, { base: baseMonthSummary.value.base, converted: baseMonthSummary.value.hasForeign }),
    }
  })

  return {
    fx,
    baseCurrency,
    currencyField,
    fxAddableCurrencies,
    baseMonthSummary,
    fxRateLine,
    budget,
    budgetAlert,
    showFxSettings,
    showBudgetSettings,
  }
}