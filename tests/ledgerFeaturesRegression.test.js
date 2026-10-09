// @vitest-environment happy-dom
/**
 * 回归证据：四个新功能**没有改变任何既有行为**。
 *
 * 做法是把同一批业务记录跑两遍——一遍只有老字段，一遍在完全相同的记录上**多加**
 * `currency` / `split` 两个可选字段——然后逐项比较既有聚合/筛选/回顾函数的输出。
 * 只要有一处新字段渗进了老路径（比如 buildLedgerIndex 顺手折算了），这里就会红。
 *
 * 另外锁住 domain/commands.js 的记录**形状**：不带新字段时，生成的对象键集合与改造前
 * 逐字一致（不是"看起来差不多"），从而保证老调用方拿到的数据一个字节都没变。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLedgerIndex,
  buildLedgerMonthReview,
  filterLedgerTransactions,
  summarizeLedgerTransactions,
} from '../src/composables/ledger.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { policyDateKey } from '../src/composables/settingsPolicy.js'

const domain = useDomainCommands()

beforeEach(() => {
  domain.transactions.value = []
  domain.bills.value = []
})
afterEach(() => {
  domain.transactions.value = []
  domain.bills.value = []
})

// 一批覆盖各种分支的记录：支出/收入/退款/归档/坏日期，金额与日期刻意有重复和跨月。
const BASE_RECORDS = [
  { id: 'r1', name: '午饭', amount: 18, cat: 'food', date: '2026-09-01', time: '12:00', account: '微信', createdAt: '2026-09-01T12:00:00.000Z' },
  { id: 'r2', name: '午饭', amount: 18, cat: 'food', date: '2026-09-01', time: '12:30', account: '微信', createdAt: '2026-09-01T12:30:00.000Z' },
  { id: 'r3', name: '地铁', amount: 0.1, cat: 'transport', date: '2026-09-02', time: '08:00', createdAt: '2026-09-02T08:00:00.000Z' },
  { id: 'r4', name: '工资', amount: 500, direction: 'income', cat: 'salary', date: '2026-09-03', time: '10:00', createdAt: '2026-09-03T10:00:00.000Z' },
  { id: 'r5', name: '退款', amount: 5, direction: 'refund', refundOf: 'r1', cat: 'food', date: '2026-09-04', time: '11:00', createdAt: '2026-09-04T11:00:00.000Z' },
  { id: 'r6', name: '八月的账', amount: 999, cat: 'other', date: '2026-08-30', time: '09:00', createdAt: '2026-08-30T09:00:00.000Z' },
  { id: 'r7', name: '归档的账', amount: 77, cat: 'other', date: '2026-09-05', archivedAt: '2026-09-06T00:00:00.000Z' },
  { id: 'r8', name: '坏日期', amount: 66, cat: 'other', date: '2026-02-31' },
]

const NEW_FIELDS = {
  r1: { currency: 'USD', split: { total: 18, mine: 6, participants: [{ label: '我', amount: 6 }, { label: '成员 1', amount: 6 }, { label: '成员 2', amount: 6 }] } },
  r2: { split: { total: 18, mine: 9, participants: [{ label: '我', amount: 9 }, { label: '成员 1', amount: 9 }] } },
  r3: { currency: 'JPY' },
  r4: { currency: 'USD', split: { total: 500, mine: 250, participants: [{ label: '我', amount: 250 }, { label: '成员 1', amount: 250 }] } },
  r5: { currency: 'USD' },
  r6: { currency: 'EUR', split: { total: 999, mine: 1, participants: [{ label: '我', amount: 1 }, { label: '成员 1', amount: 998 }] } },
  r7: { currency: 'USD' },
  r8: { split: { total: 66, mine: 33, participants: [{ label: '我', amount: 33 }, { label: '成员 1', amount: 33 }] } },
}

const withNewFields = BASE_RECORDS.map((item) => ({ ...item, ...(NEW_FIELDS[item.id] ?? {}) }))
const plainRecords = BASE_RECORDS.map((item) => ({ ...item }))

/** 索引里有 Map，JSON 化会变成 {}；这里显式展平成可比较的数组。 */
function snapshotIndex(index) {
  return {
    sorted: index.sortedExpenses.map((item) => item.id),
    monthStats: [...index.monthStats.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    dayTotals: [...index.dayTotals.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    monthCategories: [...index.monthCategories.entries()]
      .map(([month, map]) => [month, [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))])
      .sort((a, b) => a[0].localeCompare(b[0])),
    frequent: index.frequentEntries.map((entry) => ({ ...entry })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

describe('既有账本聚合不因新字段而改变', () => {
  it('buildLedgerIndex：金额索引不变，常记保留最近一次的币种和账户', () => {
    const withFields = snapshotIndex(buildLedgerIndex(withNewFields))
    const plain = snapshotIndex(buildLedgerIndex(plainRecords))
    const stripRepeatContext = (snapshot) => ({ ...snapshot, frequent: snapshot.frequent.map(({ currency, account, ...entry }) => entry) })
    expect(stripRepeatContext(withFields)).toEqual(stripRepeatContext(plain))
    expect(withFields.frequent.find((entry) => entry.name === '地铁').currency).toBe('JPY')
    expect(withFields.frequent.find((entry) => entry.name === '八月的账').currency).toBe('EUR')
    // 自证：两批记录**确实**不一样，否则上面的相等是废话
    expect(JSON.stringify(withNewFields)).not.toBe(JSON.stringify(plainRecords))
  })

  it('summarizeLedgerTransactions / buildLedgerMonthReview：金额口径仍是全额', () => {
    const legacySummary = summarizeLedgerTransactions(plainRecords)
    const newSummary = summarizeLedgerTransactions(withNewFields)
    expect(newSummary.expenseTotal).toBe(legacySummary.expenseTotal)
    expect(newSummary.incomeTotal).toBe(legacySummary.incomeTotal)
    expect(newSummary.refundTotal).toBe(legacySummary.refundTotal)
    expect(newSummary.count).toBe(legacySummary.count)

    const legacyReview = buildLedgerMonthReview(plainRecords, '2026-09')
    const newReview = buildLedgerMonthReview(withNewFields, '2026-09')
    expect(newReview.total).toBe(legacyReview.total)
    expect(newReview.count).toBe(legacyReview.count)
    expect(newReview.refundTotal).toBe(legacyReview.refundTotal)
    expect(newReview.categoryTotals).toEqual(legacyReview.categoryTotals)
    expect(newReview.expenses.map((item) => item.id)).toEqual(legacyReview.expenses.map((item) => item.id))
    expect(newReview.maxSingle?.id).toBe(legacyReview.maxSingle?.id)
    expect(newReview.mostFrequent).toEqual(legacyReview.mostFrequent)
    expect([...newReview.dayTotals.entries()]).toEqual([...legacyReview.dayTotals.entries()])
    // 分摊记录仍然按全额进「最大一笔」——这正是既有语义（跨币种/分摊的修正由新选择器承担）
    // 9 月：18 + 18 + 0.1 = 36.1，减去退款 5 = 31.1（收入与归档记录都不参与）
    expect(newReview.total).toBe(31.1)
  })

  it('filterLedgerTransactions：筛选结果与顺序不受新字段影响', () => {
    const options = { query: '午饭', kind: 'all', direction: 'all' }
    expect(filterLedgerTransactions(withNewFields, options).map((item) => item.id))
      .toEqual(filterLedgerTransactions(plainRecords, options).map((item) => item.id))
    expect(filterLedgerTransactions(withNewFields, { min: '10', max: '100' }).map((item) => item.id))
      .toEqual(filterLedgerTransactions(plainRecords, { min: '10', max: '100' }).map((item) => item.id))
  })
})

describe('domain/commands.js 只新增可选字段，不改变记录形状', () => {
  it('不带新字段时，createTransaction 生成的键集合与改造前逐字一致', () => {
    const tx = domain.createTransaction({ name: '午饭', amount: 18, date: '2026-09-05' })
    expect(Object.keys(tx).sort()).toEqual([
      'account', 'amount', 'billId', 'billingPeriodKey', 'cat', 'createdAt', 'createdFrom',
      'date', 'direction', 'id', 'name', 'note', 'relationId', 'source', 'sourceId',
      'sourceType', 'time', 'updatedAt',
    ].sort())
    expect('currency' in tx).toBe(false)
    expect('split' in tx).toBe(false)
  })

  it('显式传入 currency / split 时才写入，并规范化', () => {
    const tx = domain.createTransaction({
      name: '订阅', amount: 10, date: '2026-09-05', currency: 'usd',
      split: { total: 10, mine: 5, participants: [{ label: '我', amount: 5 }, { label: '成员 1', amount: 5 }] },
    })
    expect(tx.currency).toBe('USD')
    expect(tx.split).toEqual({ total: 10, mine: 5, participants: [{ label: '我', amount: 5 }, { label: '成员 1', amount: 5 }] })
  })

  it('非法分摊直接抛中文错误，不落库', () => {
    expect(() => domain.createTransaction({
      name: '聚餐', amount: 100, date: '2026-09-05',
      split: { total: 100, mine: 10, participants: [{ label: '我', amount: 10 }] },
    })).toThrow('分摊数据不合法：各人份额之和必须等于总额')
    expect(domain.transactions.value).toHaveLength(0)
  })

  it('updateTransaction 不动没传的字段；显式传 currency:"" / split:null 才是清除', () => {
    const tx = domain.createTransaction({ name: '午饭', amount: 18, date: '2026-09-05' })
    domain.updateTransaction(tx.id, { amount: 20 })
    expect(tx.amount).toBe(20)
    expect('currency' in tx).toBe(false)
    expect('split' in tx).toBe(false)

    domain.updateTransaction(tx.id, { currency: 'usd' })
    expect(tx.currency).toBe('USD')
    domain.updateTransaction(tx.id, { amount: 21 })
    expect(tx.currency, '没传 currency 时不该被清掉').toBe('USD')

    domain.updateTransaction(tx.id, { currency: '' })
    expect(tx.currency).toBe('')
    expect(() => domain.updateTransaction(tx.id, {
      split: { total: 10, mine: 5, participants: [{ label: '我', amount: 4 }] },
    })).toThrow('分摊数据不合法')
  })

  it('createBill 同样只在传了币种时写入字段', () => {
    const legacy = domain.createBill({ name: '话费', amount: 39, nextDate: '2026-10-01' })
    expect('currency' in legacy).toBe(false)
    const foreign = domain.createBill({ name: 'ChatGPT', amount: 20, nextDate: '2026-10-01', currency: 'usd' })
    expect(foreign.currency).toBe('USD')
  })

  it('payBill 生成的交易沿用账单币种；旧账单（没有币种）生成的记录不带该字段', () => {
    const today = policyDateKey()
    const legacyBill = domain.createBill({ name: '话费', amount: 39, nextDate: today })
    const legacyPaid = domain.payBill(legacyBill.id)
    expect('currency' in legacyPaid.transaction).toBe(false)

    const usdBill = domain.createBill({ name: 'ChatGPT', amount: 20, nextDate: today, currency: 'USD' })
    const usdPaid = domain.payBill(usdBill.id)
    expect(usdPaid.transaction.currency).toBe('USD')
  })
})
