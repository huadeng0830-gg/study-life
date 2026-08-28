// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildLedgerIndex,
  computeFrequent,
  computeFrequentFromIndex,
  ledgerPeriodStatsFromIndex,
} from '../src/composables/ledger.js'

const NOW = new Date('2026-08-28T12:00:00').getTime()

describe('ledger index', () => {
  it('保持原有的日期时间排序，并复用原记录对象', () => {
    const early = { id: 'early', name: '早餐', amount: 8, date: '2026-08-27', time: '08:00' }
    const latest = { id: 'latest', name: '午餐', amount: 18, date: '2026-08-28', time: '12:00' }
    const laterSameDay = { id: 'later', name: '晚餐', amount: 22, date: '2026-08-27', time: '19:00' }

    const index = buildLedgerIndex([early, latest, laterSameDay])

    expect(index.sortedExpenses.map((item) => item.id)).toEqual(['latest', 'later', 'early'])
    expect(index.sortedExpenses[0]).toBe(latest)
    expect(index.sortedExpenses[0]).not.toHaveProperty('showDay')
  })

  it('从同一次索引构建中读取月度、当日统计', () => {
    const index = buildLedgerIndex([
      { id: 'a', name: 'A', amount: 10, date: '2026-08-28', time: '08:00' },
      { id: 'b', name: 'B', amount: 12.5, date: '2026-08-28', time: '09:00' },
      { id: 'c', name: 'C', amount: 20, date: '2026-08-01', time: '10:00' },
      { id: 'd', name: 'D', amount: 99, date: '2026-07-31', time: '10:00' },
    ])

    expect(ledgerPeriodStatsFromIndex(index, '2026-08-28')).toEqual({
      monthTotal: 42.5,
      monthCount: 3,
      todayTotal: 22.5,
    })
  })

  it('索引版常记与原有推导的顺序和内容一致', () => {
    const records = [
      { id: 'a1', name: '咖啡', amount: 12, cat: 'food', date: '2026-08-20', time: '09:00', createdAt: '2026-08-20T09:00:00' },
      { id: 'a2', name: '咖啡', amount: 15, cat: 'food', date: '2026-08-27', time: '09:00', createdAt: '2026-08-27T09:00:00' },
      { id: 'b1', name: '地铁', amount: 3, cat: 'transit', date: '2026-08-28', time: '08:00', createdAt: '2026-08-28T08:00:00' },
      { id: 'c1', name: '打印', amount: 2, cat: 'study', date: '2026-08-21', time: '10:00', createdAt: '2026-08-21T10:00:00' },
      { id: 'c2', name: '打印', amount: 4, cat: 'study', date: '2026-08-22', time: '10:00', createdAt: '2026-08-22T10:00:00' },
    ]
    const prefs = { pinned: ['地铁'], hidden: ['打印'] }
    const index = buildLedgerIndex(records)

    const indexed = computeFrequentFromIndex(index, prefs, 6, NOW)
    expect(indexed).toEqual(computeFrequent(records, prefs, 6, NOW))
    expect(indexed.map(({ name, amount, cat, count }) => ({ name, amount, cat, count }))).toEqual([
      { name: '地铁', amount: 3, cat: 'transit', count: 1 },
      { name: '咖啡', amount: 15, cat: 'food', count: 2 },
    ])
  })
})
