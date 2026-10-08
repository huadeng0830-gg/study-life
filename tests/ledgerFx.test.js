// @vitest-environment happy-dom
/**
 * 多币种汇率（纯函数层）。
 *
 * 【这条文件盯住的产品语义】
 *   - `amount` 始终是「记录自己币种下的数值」，换算是记账边界之外的新能力；
 *   - 旧记录没有 `currency` = 基准币种，所以基准币种路径必须与老口径**逐分一致**；
 *   - 缺汇率的记录**不能**被当成 1:1 静默相加（那会悄悄给出一个看起来正常的错总额）。
 *
 * 最后一条给了判别力自证：断言之外还构造了「按 1:1 硬算会得到什么」，
 * 证明这些断言真的会拦住错误实现，而不是恒真。
 */
import { describe, expect, it } from 'vitest'
import {
  convertToBaseMinor,
  currencyChoices,
  fxRateFor,
  fxRateNote,
  normalizeCurrency,
  normalizeLedgerFx,
  sumLedgerMonthInBase,
  summarizeLedgerMonthsInBase,
  summarizeLedgerInBase,
  toBaseMinor,
} from '../src/composables/ledgerFx.js'
import { sumLedgerAmounts, summarizeLedgerTransactions } from '../src/composables/ledger.js'
import { moneyWithCurrency } from '../src/utils/formatters.js'

const RATE_DATE = '2026-09-01'
const FX = { base: 'CNY', rates: { USD: 7.2, JPY: 0.048 }, updatedAt: RATE_DATE }

const record = (over = {}) => ({
  id: over.id || 'tx-1',
  name: '订阅',
  amount: 100,
  cat: 'sub',
  date: '2026-09-05',
  time: '12:00',
  ...over,
})

describe('币种代码与汇率设置的规范化', () => {
  it('只认三位字母，统一大写，其余回空字符串（= 基准币种）', () => {
    expect(normalizeCurrency(' usd ')).toBe('USD')
    expect(normalizeCurrency('jpy')).toBe('JPY')
    expect(normalizeCurrency('')).toBe('')
    expect(normalizeCurrency(null)).toBe('')
    expect(normalizeCurrency(undefined)).toBe('')
    expect(normalizeCurrency('US')).toBe('')
    expect(normalizeCurrency('美元')).toBe('')
    expect(normalizeCurrency('US1')).toBe('')
  })

  it('丢掉非法与非正汇率、基准币种自身的汇率，并保留 updatedAt', () => {
    const normalized = normalizeLedgerFx({
      base: 'cny',
      updatedAt: RATE_DATE,
      rates: { USD: 7.2, JPY: '0.048', CNY: 1, EUR: 0, GBP: -1, XX: 'abc', AUD: Infinity, 'bad-code': 5 },
    })
    expect(normalized.base).toBe('CNY')
    expect(normalized.rates).toEqual({ USD: 7.2, JPY: 0.048 })
    expect(normalized.updatedAt).toBe(RATE_DATE)
  })

  it('形状不对时回落到默认基准币种，不抛错', () => {
    expect(normalizeLedgerFx(null)).toEqual({ base: 'CNY', rates: {}, updatedAt: '' })
    expect(normalizeLedgerFx('USD')).toEqual({ base: 'CNY', rates: {}, updatedAt: '' })
    expect(normalizeLedgerFx({ base: 'usd' }).base).toBe('USD')
  })

  it('币种下拉候选：基准币种永远第一，已设汇率的按字母序，额外币种也能显示', () => {
    expect(currencyChoices(FX)).toEqual(['CNY', 'JPY', 'USD'])
    expect(currencyChoices(FX, ['krw', 'USD'])).toEqual(['CNY', 'JPY', 'KRW', 'USD'])
  })
})

describe('单跳换算（外币 → 基准币种，单位：分）', () => {
  it('基准币种与「没有 currency 的旧记录」都是恒等换算', () => {
    expect(toBaseMinor('12.34', '', FX)).toBe(1234)
    expect(toBaseMinor('12.34', 'CNY', FX)).toBe(1234)
    expect(toBaseMinor(12.34, undefined, FX)).toBe(1234)
  })

  it('外币按汇率在「分」上取整', () => {
    expect(toBaseMinor(100, 'USD', FX)).toBe(72000)
    expect(toBaseMinor('100', 'USD', FX)).toBe(72000)
    expect(toBaseMinor(100, 'JPY', FX)).toBe(480)
    // 3.33 USD × 7.2 = 23.976 元 → 2398 分（四舍五入一次，避免二次误差）
    expect(toBaseMinor('3.33', 'USD', FX)).toBe(2398)
  })

  it('缺汇率与金额非法是两种不同的失败原因', () => {
    expect(convertToBaseMinor(100, 'USD', { base: 'CNY', rates: {} })).toMatchObject({ cents: null, reason: 'rate' })
    expect(convertToBaseMinor(100, 'EUR', FX)).toMatchObject({ cents: null, reason: 'rate' })
    expect(convertToBaseMinor('1.234', 'USD', FX)).toMatchObject({ cents: null, reason: 'amount' })
    expect(convertToBaseMinor('abc', 'USD', FX)).toMatchObject({ cents: null, reason: 'amount' })
    expect(convertToBaseMinor(100, 'USD', FX)).toMatchObject({ cents: 72000, reason: '' })
  })

  it('汇率查询：基准与空值是 1，缺汇率是 null', () => {
    expect(fxRateFor('', FX)).toBe(1)
    expect(fxRateFor('CNY', FX)).toBe(1)
    expect(fxRateFor('usd', FX)).toBe(7.2)
    expect(fxRateFor('EUR', FX)).toBe(null)
  })
})

describe('按基准币种折算求和（月/区间）', () => {
  const list = [
    record({ id: 'cny-1', amount: 30 }),
    record({ id: 'usd-1', amount: 10, currency: 'USD', date: '2026-09-06' }),
    record({ id: 'usd-missing', amount: 50, currency: 'EUR', date: '2026-09-07' }),
    record({ id: 'other-month', amount: 999, date: '2026-08-31' }),
    record({ id: 'income', amount: 500, direction: 'income', date: '2026-09-08' }),
    record({ id: 'archived', amount: 77, currency: 'USD', archivedAt: '2026-09-09T00:00:00Z' }),
  ]

  it('一个月内的记录先折算再求和，退款冲抵、收入分开、归档与非法日期不计入', () => {
    const summary = sumLedgerMonthInBase(list, FX, '2026-09')
    // 30 + 10×7.2 = 102 元；EUR 那笔缺汇率被排除
    expect(summary.expenseTotal).toBe(102)
    expect(summary.incomeTotal).toBe(500)
    expect(summary.count).toBe(3)
    expect(summary.base).toBe('CNY')
    expect(summary.ratesUpdatedAt).toBe(RATE_DATE)
    expect(summary.hasForeign).toBe(true)
    expect(summary.foreignCount).toBe(2)
    expect(summary.convertedForeignCount).toBe(1)
    expect(summary.missingRates).toEqual(['EUR'])
    expect(summary.excludedCount).toBe(1)
    expect(summary.excludedExpenseCount).toBe(1)
    expect(summary.excludedRefundCount).toBe(0)
    expect(summary.hasMissing).toBe(true)
  })

  it('区间过滤与月度过滤是同一套 dateFilter，边界之外不参与', () => {
    const august = summarizeLedgerInBase(list, FX, { dateFilter: (date) => date < '2026-09-01' })
    expect(august.expenseTotal).toBe(999)
    expect(august.hasForeign).toBe(false)
    const firstWeek = summarizeLedgerInBase(list, FX, { dateFilter: (date) => date >= '2026-09-01' && date <= '2026-09-06' })
    expect(firstWeek.expenseTotal).toBe(102)
  })

  it('多月一次汇总与逐月汇总逐字段一致（含退款、收入、缺汇率与自定义金额）', () => {
    const entries = [
      record({ id: 'sep-cny', amount: 30, date: '2026-09-03', personalAmount: 18 }),
      record({ id: 'sep-usd', amount: 10, currency: 'USD', date: '2026-09-04', personalAmount: 5 }),
      record({ id: 'sep-refund', amount: 2, currency: 'USD', direction: 'refund', date: '2026-09-05', personalAmount: 1 }),
      record({ id: 'sep-eur', amount: 50, currency: 'EUR', date: '2026-09-06', personalAmount: 20 }),
      record({ id: 'aug-income', amount: 500, direction: 'income', date: '2026-08-08', personalAmount: 300 }),
      record({ id: 'oct-ignored', amount: 999, date: '2026-10-01' }),
    ]
    const amountOf = (item) => item.personalAmount
    const months = ['2026-08', '2026-09', '2026-07']
    const summaries = summarizeLedgerMonthsInBase(entries, FX, months, { amountOf })

    for (const month of months) {
      expect(summaries.get(month)).toEqual(sumLedgerMonthInBase(entries, FX, month, { amountOf }))
    }
  })

  it('没有任何非基准币种记录时，折算合计与既有 summarizeLedgerTransactions 逐分相等', () => {
    const plain = [record({ id: 'a', amount: 30 }), record({ id: 'b', amount: 0.1 }), record({ id: 'c', amount: 0.2 })]
    const legacy = summarizeLedgerTransactions(plain)
    const summary = summarizeLedgerInBase(plain, FX)
    expect(summary.expenseTotal).toBe(legacy.expenseTotal)
    expect(summary.incomeTotal).toBe(legacy.incomeTotal)
    expect(summary.refundTotal).toBe(legacy.refundTotal)
    expect(summary.count).toBe(legacy.count)
    expect(summary.hasForeign).toBe(false)
  })
})

describe('判别力自证：缺汇率不会被当成 1:1 静默相加', () => {
  const only = [record({ id: 'usd-only', amount: 100, currency: 'USD' })]
  const noRates = { base: 'CNY', rates: {}, updatedAt: '' }

  it('缺汇率时该笔被排除并在 missingRates 里暴露，而不是按 1:1 计入', () => {
    const summary = summarizeLedgerInBase(only, noRates)
    expect(summary.expenseTotal).toBe(0)
    expect(summary.count).toBe(0)
    expect(summary.excludedCount).toBe(1)
    expect(summary.excludedExpenseCount).toBe(1)
    expect(summary.excludedRefundCount).toBe(0)
    expect(summary.missingRates).toEqual(['USD'])

    // 这条是「有牙齿」的部分：一个按 1:1 硬算的实现会得到 100（既有 sumLedgerAmounts 的结果），
    // 所以上面那个 0 只有在真的排除了缺汇率记录时才成立。
    const naiveOneToOne = sumLedgerAmounts(only)
    expect(naiveOneToOne).toBe(100)
    expect(summary.expenseTotal).not.toBe(naiveOneToOne)
  })

  it('将缺汇率退款与支出分开计数，预算可以判断净额方向是否确定', () => {
    const summary = summarizeLedgerInBase([
      record({ id: 'known-expense', amount: 10 }),
      record({ id: 'missing-refund', amount: 4, currency: 'EUR', direction: 'refund' }),
      record({ id: 'missing-expense', amount: 8, currency: 'EUR' }),
    ], noRates)
    expect(summary.expenseTotal).toBe(10)
    expect(summary.excludedCount).toBe(2)
    expect(summary.excludedExpenseCount).toBe(1)
    expect(summary.excludedRefundCount).toBe(1)
  })

  it('同一个输入，补上汇率后必须变成 720 —— 证明 0 不是「永远算成 0」', () => {
    expect(summarizeLedgerInBase(only, FX).expenseTotal).toBe(720)
    expect(summarizeLedgerInBase(only, FX).missingRates).toEqual([])
  })
})

describe('折算文案（≈ ¥xxx（按 yyyy-mm-dd 汇率））', () => {
  it('没有外币记录时不产生文案（页面上不该有这条无意义的行）', () => {
    const summary = summarizeLedgerInBase([record({ id: 'a', amount: 30 })], FX)
    expect(fxRateNote(summary)).toBe('')
  })

  it('有外币记录时给出金额与汇率日期，缺汇率的笔数如实写出来', () => {
    const note = fxRateNote(summarizeLedgerInBase([
      record({ id: 'a', amount: 30 }),
      record({ id: 'b', amount: 10, currency: 'USD' }),
    ], FX))
    expect(note).toBe(`≈ ${moneyWithCurrency(102, 'CNY')}（按 ${RATE_DATE} 汇率）`)

    const withMissing = fxRateNote(summarizeLedgerInBase([
      record({ id: 'b', amount: 10, currency: 'USD' }),
      record({ id: 'c', amount: 10, currency: 'EUR' }),
    ], FX))
    expect(withMissing).toContain('EUR 缺少汇率')
    expect(withMissing).toContain('另有 1 笔未计入')
  })

  it('没记录过汇率日期时用「未记录日期」而不是编一个日期', () => {
    const note = fxRateNote(summarizeLedgerInBase(
      [record({ id: 'b', amount: 10, currency: 'USD' })],
      { base: 'CNY', rates: { USD: 7.2 }, updatedAt: '' },
    ))
    expect(note).toContain('按 未记录日期 汇率')
  })
})
