// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildLedgerIndex,
  buildLedgerMonthReview,
  isRefundTransaction,
  summarizeLedgerTransactions,
} from '../src/composables/ledger.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'

describe('退款/冲正 · 汇总与索引', () => {
  it('汇总：退款冲抵支出而非收入', () => {
    const summary = summarizeLedgerTransactions([
      { id: 'a', name: '耳机', amount: 200, direction: 'expense', date: '2026-09-01', time: '08:00' },
      { id: 'r', name: '耳机', amount: 50, direction: 'refund', refundOf: 'a', date: '2026-09-05', time: '10:00' },
    ])
    expect(summary.expenseTotal).toBe(150)
    expect(summary.incomeTotal).toBe(0)
    expect(summary.refundTotal).toBe(50)
  })

  it('索引：本月支出扣减退款，退款不进每日支出/分类分布', () => {
    const index = buildLedgerIndex([
      { id: 'a', name: '耳机', amount: 200, direction: 'expense', date: '2026-09-01', time: '08:00', cat: 'sub' },
      { id: 'r', name: '耳机', amount: 50, direction: 'refund', refundOf: 'a', date: '2026-09-05', time: '10:00', cat: 'sub' },
    ])
    expect(index.monthStats.get('2026-09').total).toBe(150)
    expect(index.monthStats.get('2026-09').refund).toBe(50)
    expect(index.monthStats.get('2026-09').count).toBe(1)
    expect(index.dayTotals.get('2026-09-01')).toBe(200)
    expect(index.dayTotals.get('2026-09-05')).toBeUndefined()
    expect(index.monthCategories.get('2026-09').get('sub')).toBe(200)
  })

  it('月度回顾：总额扣减退款，退款不计笔数、不进分类', () => {
    const review = buildLedgerMonthReview([
      { id: 'a', name: '耳机', amount: 200, direction: 'expense', date: '2026-09-01', time: '08:00', cat: 'sub' },
      { id: 'r', name: '耳机', amount: 50, direction: 'refund', refundOf: 'a', date: '2026-09-05', time: '10:00', cat: 'sub' },
    ], '2026-09')
    expect(review.total).toBe(150)
    expect(review.refundTotal).toBe(50)
    expect(review.count).toBe(1)
    expect(review.categoryTotals).toEqual([{ key: 'sub', total: 200 }])
  })
})

describe('退款/冲正 · 领域命令', () => {
  it('正常退款并冲抵原支出，撤销退款即删除该条', () => {
    const domain = useDomainCommands()
    domain.createTransaction({ id: 'orig-rf', name: '耳机', amount: 200, direction: 'expense', date: '2026-09-01' })
    const refund = domain.refundTransaction('orig-rf', { amount: '50' })
    expect(isRefundTransaction(refund)).toBe(true)
    expect(refund.refundOf).toBe('orig-rf')
    expect(refund.direction).toBe('refund')
    expect(refund.amount).toBe(50)
    const deleted = domain.deleteTransaction(refund.id)
    expect(deleted?.id).toBe(refund.id)
  })

  it('超额退款被拦截（累计退款不能超过原金额）', () => {
    const domain = useDomainCommands()
    domain.createTransaction({ id: 'orig-rf2', name: '书', amount: 100, direction: 'expense', date: '2026-09-01' })
    domain.refundTransaction('orig-rf2', { amount: '40' })
    const blocked = domain.refundTransaction('orig-rf2', { amount: '70' })
    expect(blocked?.blocked).toBe(true)
  })

  it('找不到、收入、退款本身、账单支付均不能退款', () => {
    const domain = useDomainCommands()
    expect(domain.refundTransaction('not-exist', { amount: '10' })?.blocked).toBe(true)

    domain.createTransaction({ id: 'inc-rf', name: '工资', amount: 5000, direction: 'income', date: '2026-09-01' })
    expect(domain.refundTransaction('inc-rf', { amount: '10' })?.blocked).toBe(true)

    domain.createTransaction({ id: 'trip-rf', name: '会员', amount: 30, direction: 'expense', date: '2026-09-01', billId: 'b1', billingPeriodKey: '2026-09', source: 'bill' })
    expect(domain.refundTransaction('trip-rf', { amount: '10' })?.blocked).toBe(true)

    domain.createTransaction({ id: 'base-rf', name: '咖啡', amount: 40, direction: 'expense', date: '2026-09-02' })
    const refund = domain.refundTransaction('base-rf', { amount: '10' })
    expect(domain.refundTransaction(refund.id, { amount: '5' })?.blocked).toBe(true)
  })
})