// @vitest-environment happy-dom
/**
 * 报销分摊（纯函数层）。
 *
 * 【本文件最重要的两条】
 *   1. 余数必须精确：100 元 3 人 → 33.34 / 33.33 / 33.33，`sum(份额) === 总额` 精确成立。
 *      这条给了判别力自证：同一个输入用浮点/`Math.round` 的朴素做法会得到 99.99 或 99.999…，
 *      断言能把它和正确实现区分开。
 *   2. 「我的实际支出」= 有 `split.mine` 时用它，否则用 `amount`；
 *      既有汇总函数（summarizeLedgerTransactions 等）**默认仍按全额**统计；
 *      要按份额统计必须显式传 `amountOf`（这条也在这里钉住，见最后一节）。
 *
 * 【产品边界（写进测试以免日后被"补全"）】不做多人账户、不做结算：
 * 只记录这笔里我实际承担多少，不管谁欠我多少。
 */
import { describe, expect, it } from 'vitest'
import {
  buildSplit,
  hasSplit,
  mySpendCents,
  mySpendYuan,
  normalizeSplit,
  personalMonthCategoryTotals,
  personalSpendTotals,
  splitCentsEvenly,
  validateSplit,
} from '../src/composables/ledgerSplit.js'
import { buildLedgerMonthReview, summarizeLedgerTransactions } from '../src/composables/ledger.js'
import { sumLedgerMonthInBase } from '../src/composables/ledgerFx.js'

const expense = (over = {}) => ({
  id: over.id || 'tx-1',
  name: '聚餐',
  amount: 100,
  cat: 'food',
  date: '2026-09-05',
  time: '19:00',
  ...over,
})

const sumCents = (values) => values.reduce((sum, value) => sum + Math.round(value * 100), 0)

describe('按「分」等分与余数分配', () => {
  it('100 元 3 人 → 33.34 / 33.33 / 33.33，合计精确等于总额', () => {
    const shares = splitCentsEvenly(10000, 3)
    expect(shares).toEqual([3334, 3333, 3333])
    expect(shares.reduce((sum, cents) => sum + cents, 0)).toBe(10000)
  })

  it('1 分钱 / 3 人也精确（一分钱不能凭空消失）', () => {
    const shares = splitCentsEvenly(1, 3)
    expect(shares).toEqual([1, 0, 0])
    expect(shares.reduce((sum, cents) => sum + cents, 0)).toBe(1)
  })

  it('判别力自证：朴素的浮点四舍五入会算丢一分钱，而正确实现不会', () => {
    const people = 3
    const totalCents = 10000
    // 天真做法①：先算元再四舍五入
    const naiveYuan = Array.from({ length: people }, () => Math.round((totalCents / 100 / people) * 100) / 100)
    expect(sumCents(naiveYuan)).toBe(9999)
    // 天真做法②：每份都 ceil 到分
    const naiveCeil = Array.from({ length: people }, () => Math.ceil(totalCents / 100 / people * 100) / 100)
    expect(sumCents(naiveCeil)).toBe(10002)
    // 正确实现：两者都不等，且精确等于总额
    const correct = splitCentsEvenly(totalCents, people).map((cents) => cents / 100)
    expect(correct).toEqual([33.34, 33.33, 33.33])
    expect(sumCents(correct)).toBe(totalCents)
    expect(sumCents(correct)).not.toBe(sumCents(naiveYuan))
    expect(sumCents(correct)).not.toBe(sumCents(naiveCeil))
  })

  it('非法入参抛中文错误', () => {
    expect(() => splitCentsEvenly(100, 0)).toThrow('参与人数至少为 1')
    expect(() => splitCentsEvenly(10.5, 3)).toThrow('总额需为不小于 0 的分值整数')
  })
})

describe('buildSplit：总额 / 我的份额 / 参与者明细', () => {
  it('不给我的份额时按人数等分（余数给第一位），份额之和精确等于总额', () => {
    const split = buildSplit(100, { count: 3 })
    expect(split.total).toBe(100)
    expect(split.mine).toBe(33.34)
    expect(split.participants).toEqual([
      { label: '我', amount: 33.34 },
      { label: '成员 1', amount: 33.33 },
      { label: '成员 2', amount: 33.33 },
    ])
    expect(sumCents(split.participants.map((entry) => entry.amount))).toBe(10000)
  })

  it('给了我的份额时，剩下的在其余人之间再次等分，总额仍然精确', () => {
    const split = buildSplit(100, { count: 3, mine: 20 })
    expect(split.mine).toBe(20)
    expect(split.participants.map((entry) => entry.amount)).toEqual([20, 40, 40])
    expect(sumCents(split.participants.map((entry) => entry.amount))).toBe(10000)

    // 除不尽的情形：80 元 3 人 → 26.67 / 26.67 / 26.66
    const uneven = buildSplit(100, { count: 4, mine: 20 })
    expect(uneven.participants.map((entry) => entry.amount)).toEqual([20, 26.67, 26.67, 26.66])
    expect(sumCents(uneven.participants.map((entry) => entry.amount))).toBe(10000)
  })

  it('三个人分 0.03 元：每份 0.01，精确等于总额', () => {
    const split = buildSplit(0.03, { count: 3 })
    expect(split.participants.map((entry) => entry.amount)).toEqual([0.01, 0.01, 0.01])
    expect(sumCents(split.participants.map((entry) => entry.amount))).toBe(3)
  })

  it('我的份额不能超过总额；只有一个人时份额必须等于总额', () => {
    expect(() => buildSplit(100, { count: 2, mine: 120 })).toThrow('我的份额不能超过总额')
    expect(() => buildSplit(100, { count: 1, mine: 50 })).toThrow('只有一个人时，份额必须等于总额')
    expect(buildSplit(100, { count: 1 }).participants).toEqual([{ label: '我', amount: 100 }])
  })

  it('总额、人数、份额的非法入参都抛中文错误', () => {
    expect(() => buildSplit(0, { count: 2 })).toThrow('分摊总额需为大于 0 的金额')
    expect(() => buildSplit('abc', { count: 2 })).toThrow('分摊总额需为大于 0 的金额')
    expect(() => buildSplit(100, { count: 0 })).toThrow('参与人数需为 1~99 的整数')
    expect(() => buildSplit(100, { count: 2, mine: '-1' })).toThrow('我的份额需为不小于 0 的金额')
    expect(() => buildSplit(100, { count: 2, mine: '1.234' })).toThrow('我的份额需为不小于 0 的金额')
  })
})

describe('校验与规范化', () => {
  it('份额之和与总额不符会被明确指出来', () => {
    const result = validateSplit({
      total: 100,
      mine: 33.34,
      participants: [{ label: '我', amount: 33.34 }, { label: '成员 1', amount: 33.33 }, { label: '成员 2', amount: 33.32 }],
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toContain('各人份额之和必须等于总额')
    expect(normalizeSplit({
      total: 100,
      mine: 33.34,
      participants: [{ label: '我', amount: 33.34 }, { label: '成员 1', amount: 33.33 }, { label: '成员 2', amount: 33.32 }],
    })).toBe(null)
  })

  it('我的份额超过总额 / 缺少明细 / 空数据都会被拒绝', () => {
    expect(validateSplit({ total: 10, mine: 20, participants: [{ label: '我', amount: 10 }] }).issues)
      .toContain('我的份额不能超过总额')
    expect(validateSplit({ total: 10, mine: 10, participants: [] }).issues).toContain('缺少分摊明细')
    expect(validateSplit(null).ok).toBe(false)
    expect(normalizeSplit(null)).toBe(null)
    expect(normalizeSplit({})).toBe(null)
  })

  it('合法的分摊被规范化成干净形状（金额仍是两位小数）', () => {
    const normalized = normalizeSplit({ total: '100', mine: '33.34', participants: [{ amount: '33.34' }, { label: '同伴', amount: '66.66' }] })
    expect(normalized).toEqual({
      total: 100,
      mine: 33.34,
      participants: [{ label: '成员', amount: 33.34 }, { label: '同伴', amount: 66.66 }],
    })
    expect(hasSplit({ split: normalized })).toBe(true)
    expect(hasSplit({ amount: 100 })).toBe(false)
    expect(hasSplit({ split: { total: 100, mine: 200, participants: [] } })).toBe(false)
  })
})

describe('「我的实际支出」选择器与既有汇总的关系', () => {
  const splitRecord = expense({
    id: 'split-1',
    amount: 300,
    split: { total: 300, mine: 100, participants: [{ label: '我', amount: 100 }, { label: '成员 1', amount: 100 }, { label: '成员 2', amount: 100 }] },
  })
  const plainRecord = expense({ id: 'plain-1', amount: 50 })

  it('有分摊用 mine，没有分摊用 amount，坏数据回落到 amount', () => {
    expect(mySpendCents(splitRecord)).toBe(10000)
    expect(mySpendCents(plainRecord)).toBe(5000)
    expect(mySpendCents({ amount: 50, split: { total: 1, mine: 999, participants: [] } })).toBe(5000)
    expect(mySpendCents({ amount: 'abc' })).toBe(null)
  })

  it('个人口径合计：未分摊的记录金额不变，已分摊的只算 mine', () => {
    const list = [splitRecord, plainRecord]
    const personal = personalSpendTotals(list)
    expect(personal.expenseTotal).toBe(150)
    expect(personal.splitCount).toBe(1)
    expect(personal.count).toBe(2)

    // 对照：既有汇总仍按全额统计（本功能一行都没改它）
    expect(summarizeLedgerTransactions(list).expenseTotal).toBe(350)
    // 判别力：两个口径必须真的不同，否则这条断言没有意义
    expect(personal.expenseTotal).not.toBe(summarizeLedgerTransactions(list).expenseTotal)
  })

  it('全部未分摊时，个人口径与既有汇总逐分相等（回归证据）', () => {
    const list = [plainRecord, expense({ id: 'plain-2', amount: 0.1 }), expense({ id: 'plain-3', amount: 0.2 })]
    const personal = personalSpendTotals(list)
    const legacy = summarizeLedgerTransactions(list)
    expect(personal.expenseTotal).toBe(legacy.expenseTotal)
    expect(personal.incomeTotal).toBe(legacy.incomeTotal)
    expect(personal.refundTotal).toBe(legacy.refundTotal)
    expect(personal.count).toBe(legacy.count)
    expect(personal.splitCount).toBe(0)
  })

  it('退款、收入与归档记录在个人口径下与既有口径同样处理', () => {
    const list = [
      expense({ id: 'a', amount: 100 }),
      expense({ id: 'refund', amount: 30, direction: 'refund', refundOf: 'a', date: '2026-09-06' }),
      expense({ id: 'income', amount: 500, direction: 'income', date: '2026-09-06' }),
      expense({ id: 'gone', amount: 999, archivedAt: '2026-09-07T00:00:00Z' }),
      expense({ id: 'bad-date', amount: 5, date: '2026-02-31' }),
    ]
    const personal = personalSpendTotals(list)
    expect(personal.expenseTotal).toBe(70)
    expect(personal.incomeTotal).toBe(500)
    expect(personal.refundTotal).toBe(30)
    expect(personal.count).toBe(3)
  })
})

describe('口径是显式 opt-in：汇总函数默认全额，传 amountOf 才按我的份额', () => {
  const splitRecord = expense({
    id: 'split-1',
    amount: 200,
    split: { total: 200, mine: 40, participants: Array.from({ length: 5 }, (unused, index) => ({ label: index === 0 ? '我' : `成员 ${index}`, amount: 40 })) },
  })
  const plainRecord = expense({ id: 'plain-1', amount: 10, date: '2026-09-06' })

  it('mySpendYuan 是 mySpendCents 的「元」版本，非法金额仍是 null', () => {
    expect(mySpendYuan(splitRecord)).toBe(40)
    expect(mySpendYuan(plainRecord)).toBe(10)
    expect(mySpendYuan({ amount: 'abc' })).toBe(null)
  })

  it('summarizeLedgerTransactions：不传 = 全额，传了 = 我的份额', () => {
    const list = [splitRecord, plainRecord]
    expect(summarizeLedgerTransactions(list).expenseTotal).toBe(210)
    expect(summarizeLedgerTransactions(list, { amountOf: mySpendCents }).expenseTotal).toBe(50)
  })

  it('buildLedgerMonthReview：金额、分类、最大一笔一起换口径', () => {
    const list = [splitRecord, plainRecord]
    const plain = buildLedgerMonthReview(list, '2026-09')
    expect(plain.total).toBe(210)
    expect(plain.maxSingle?.id).toBe('split-1')
    expect(plain.categoryTotals).toEqual([{ key: 'food', total: 210 }])

    const personal = buildLedgerMonthReview(list, '2026-09', { amountOf: mySpendCents })
    expect(personal.total).toBe(50)
    // 「最大一笔」按份额比：40 > 10，仍然是同一笔，但金额是份额口径
    expect(personal.maxSingle?.id).toBe('split-1')
    expect(personal.categoryTotals).toEqual([{ key: 'food', total: 50 }])
    expect(personal.dayTotals.get(5)).toEqual({ count: 1, total: 40 })
  })

  it('换口径不会放宽「哪些记录能进统计」：归档/删除/墓碑/坏日期一律仍然排除', () => {
    const list = [
      splitRecord,
      expense({ id: 'archived', amount: 100, archivedAt: '2026-09-07T00:00:00Z', split: { total: 100, mine: 1, participants: [{ label: '我', amount: 1 }, { label: '成员 1', amount: 99 }] } }),
      expense({ id: 'deleted', amount: 100, deletedAt: '2026-09-07T00:00:00Z' }),
      expense({ id: 'tombstone', amount: 100, tombstone: true }),
      expense({ id: 'bad-date', amount: 100, date: '2026-02-31' }),
      expense({ id: '', amount: 100 }),
    ]
    const personal = buildLedgerMonthReview(list, '2026-09', { amountOf: mySpendCents })
    expect(personal.total).toBe(40)
    expect(personal.count).toBe(1)
  })

  it('外币 + 分摊：先取份额、再按汇率折算，缺汇率的记录仍然排除', () => {
    const fx = { base: 'CNY', rates: { USD: 7 }, updatedAt: '2026-09-01' }
    const list = [
      expense({ id: 'usd-split', amount: 20, currency: 'USD', split: { total: 20, mine: 5, participants: [{ label: '我', amount: 5 }, { label: '成员 1', amount: 15 }] } }),
      expense({ id: 'usd-plain', amount: 10, currency: 'USD' }),
      expense({ id: 'jpy-missing', amount: 1000, currency: 'JPY' }),
    ]
    // 全额口径：20×7 + 10×7 = 210（JPY 缺汇率，被排除并如实上报）
    expect(sumLedgerMonthInBase(list, fx, '2026-09').expenseTotal).toBe(210)
    const personal = sumLedgerMonthInBase(list, fx, '2026-09', { amountOf: mySpendYuan })
    expect(personal.expenseTotal).toBe(105) // 5×7 + 10×7
    expect(personal.missingRates).toEqual(['JPY'])
    expect(personal.count).toBe(2)
  })

  it('personalMonthCategoryTotals：分类合计按我的份额，收入与退款不进分类', () => {
    const list = [
      splitRecord,
      plainRecord,
      expense({ id: 'refund', amount: 5, direction: 'refund', refundOf: 'split-1', date: '2026-09-07' }),
      expense({ id: 'income', amount: 500, direction: 'income', date: '2026-09-07' }),
      expense({ id: 'other-month', amount: 99, date: '2026-08-30' }),
    ]
    expect([...personalMonthCategoryTotals(list, '2026-09').entries()]).toEqual([['food', 50]])
    expect([...personalMonthCategoryTotals(list, '2026-08').entries()]).toEqual([['food', 99]])
    expect([...personalMonthCategoryTotals(list, '2026-07').entries()]).toEqual([])
  })
})