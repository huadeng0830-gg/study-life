// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
import { useLedgerFx } from '../src/composables/ledgerFx.js'
import { daySnapshot, dayStory, monthReport, yearReport } from '../src/composables/retrospective.js'

registerMirrorTeardown()
beforeEach(() => {
  useLedgerFx().saveFx({ base: 'CNY', rates: { USD: 7 }, updatedAt: '' })
})
afterEach(() => vi.restoreAllMocks())

const expenses = [
  { id: 'fictional-usd-split', name: '虚构分摊', amount: 20, currency: 'USD', date: '2026-10-10', split: { total: 20, mine: 5, participants: [{ label: '我', amount: 5 }, { label: '虚构同伴', amount: 15 }] } },
  { id: 'fictional-cny', name: '虚构早餐', amount: 18, date: '2026-10-10' },
  { id: 'fictional-refund', name: '虚构退款', amount: 1, currency: 'USD', direction: 'refund', date: '2026-10-10' },
  { id: 'fictional-income', name: '虚构收入', amount: 2, currency: 'USD', direction: 'income', date: '2026-10-10' },
]

describe('回顾与账本使用同一基准币种与汇率', () => {
  it('日快照按我的分摊份额换算支出、退款和收入', () => {
    const snapshot = daySnapshot('2026-10-10', { expenses })
    expect(snapshot.stats).toMatchObject({ expensesCount: 4, expensesTotal: 46, incomeTotal: 14 })
    expect(expenses[0].amount).toBe(20)
  })

  it.each([['day', dayStory, '2026-10-10'], ['month', monthReport, '2026-10'], ['year', yearReport, '2026']])(
    '%s 报告展示换算后的金额', (_label, report, date) => {
      const result = report(date, { expenses })
      const stat = result.blocks.find(block => block.type === 'stat')
      expect(stat.items.find(item => item.label.includes('支出')).value).toBe('¥46.00')
    },
  )

  it('没有汇率的异币种不作为人民币计入合计，并明确说明缺失', () => {
    const result = dayStory('2026-10-10', { expenses: [{ id: 'fictional-jpy', name: '虚构日元记录', currency: 'JPY', amount: 100, date: '2026-10-10' }] })
    const stat = result.blocks.find(block => block.type === 'stat')
    expect(stat.items.find(item => item.label === '支出').value).toBe('¥0.00')
    expect(result.blocks.filter(block => block.type === 'p').map(block => block.text).join(' ')).toContain('JPY 缺少汇率')
    expect(result.blocks.find(block => block.title === '当日消费').items[0]).toContain('JP¥100.00')
  })

  it('基准币种改变时报告合计与原币种明细都使用各自的符号', () => {
    useLedgerFx().saveFx({ base: 'USD', rates: { CNY: 0.14 } })
    const result = dayStory('2026-10-10', { expenses: [
      { id: 'fictional-base-usd', name: '虚构美元', amount: 5, date: '2026-10-10' },
      { id: 'fictional-foreign-cny', name: '虚构人民币', currency: 'CNY', amount: 10, date: '2026-10-10' },
    ] })
    expect(result.blocks.find(block => block.type === 'stat').items.find(item => item.label === '支出').value).toBe('$6.40')
    expect(result.blocks.find(block => block.title === '当日消费').items).toEqual(['虚构美元 $5.00', '虚构人民币 ¥10.00'])
  })
})
