// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildSplit } from '../src/composables/ledgerSplit.js'
import { summarizeLedgerSpendPeriods } from '../src/composables/ledgerView/spendStats.js'

describe('账本首页周期汇总', () => {
  it('一次汇总中统一计算今日、本周、本月、收入结余与上月对比', () => {
    const summary = summarizeLedgerSpendPeriods([
      { id: 'split-expense', date: '2026-10-07', amount: 100, direction: 'expense', split: buildSplit(100, { count: 2, mine: 60 }) },
      { id: 'today-income', date: '2026-10-07', amount: 20, direction: 'income' },
      { id: 'current-refund', date: '2026-10-06', amount: 10, direction: 'refund' },
      { id: 'previous-expense', date: '2026-09-18', amount: 25, direction: 'expense' },
      { id: 'previous-refund', date: '2026-09-19', amount: 5, direction: 'refund' },
      { id: 'deleted', date: '2026-10-07', amount: 900, direction: 'expense', deletedAt: '2026-10-07' },
    ], { today: '2026-10-07' })

    expect(summary.spend).toEqual({ today: 60, week: 50, month: 50 })
    expect(summary.currentMonthPersonal).toEqual({
      splitCount: 1,
      expenseTotal: 50,
      incomeTotal: 20,
      refundTotal: 10,
      balance: -30,
    })
    expect(summary.previousMonthExpenseTotal).toBe(20)
  })
})
