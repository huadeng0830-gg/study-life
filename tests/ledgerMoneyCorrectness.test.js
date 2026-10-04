// @vitest-environment happy-dom
/**
 * 账本金额正确性回归守卫（第一批：真缺陷）。
 *
 * 【为什么必须有这个文件】下面每一条都曾经是**真实缺陷**，而当时
 * `npm test` 是**全绿**的：既有用例要么绕过了出问题的代码路径
 * （测试直接给命令层传「元」，跳过详情页的单位换算），
 * 要么把有缺陷的行为**固化成了期望值**（如账单 1/31→2/28→3/28）。
 *
 * 所以本文件的判据一律写成**「具体输入 → 具体数值」**，
 * 而不是复用既有断言的措辞；每条都写明「修之前会红成什么样」，
 * 便于日后用变异实验复核它是否还有判别力。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { amountToCents, normalizeAmount, buildLedgerIndex, MAX_LEDGER_AMOUNT } from '../src/composables/ledger.js'
import { mySpendCents, buildSplit, personalSpendTotals } from '../src/composables/ledgerSplit.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { convertToBaseMinor, normalizeLedgerFx, summarizeLedgerInBase } from '../src/composables/ledgerFx.js'
import { moneyRow, moneyHero } from '../src/utils/formatters.js'

const tx = (over = {}) => ({
  id: over.id ?? 'x1', name: '午饭', amount: 18.5, cat: 'food',
  date: '2026-09-01', time: '12:00', direction: 'expense',
  createdAt: '2026-09-01T04:00:00.000Z', updatedAt: '2026-09-01T04:00:00.000Z', ...over,
})

describe('金额边界：-0 与浮点尾差', () => {
  it('-0 必须归一成 0（否则 Intl 会渲染成「¥-0.00」）', () => {
    // 修之前：amountToCents(-0) 返回 -0（因为 -0 < 0 为 false），
    // `amount === null` 守卫放行 → 可落库 → moneyRow 渲染成 ¥-0.00。
    const cents = amountToCents(-0)
    expect(cents).toBe(0)
    expect(Object.is(cents, -0)).toBe(false)
    expect(moneyRow(normalizeAmount(-0))).toBe(moneyRow(0))
  })

  it('超过两位小数的数值金额被拒绝，而不是静默四舍五入', () => {
    // 浮点陷阱本身是对的：Math.round 会把 1.005 舍成 1.00，
    // 容差守卫把它**变成拒绝**，这样比悄悄改数安全。
    expect(amountToCents(1.005)).toBeNull()
    expect(amountToCents(2.675)).toBeNull()
    expect(amountToCents(0.145)).toBeNull()
    expect(amountToCents(8.615)).toBeNull()
  })

  it('计算机尾差仍然被接受（不能把 0.1+0.2 也拒掉）', () => {
    expect(amountToCents(0.1 + 0.2)).toBe(30)
    expect(amountToCents(1.1 * 3)).toBe(330)
    expect(amountToCents(1234.56)).toBe(123456)
  })

  it('负数 / NaN / Infinity / 超上限一律拒绝', () => {
    expect(amountToCents(-1)).toBeNull()
    expect(amountToCents(NaN)).toBeNull()
    expect(amountToCents(Infinity)).toBeNull()
    expect(amountToCents(MAX_LEDGER_AMOUNT + 1)).toBeNull()
  })
})

describe('详情页编辑金额：单位必须与命令层一致（真缺陷：放大 100 倍）', () => {
  let domain
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    const mod = await import('../src/composables/domain/commands.js')
    domain = useDomainCommands(mod)
  })

  it('命令层收「元」：18.5 存进去仍是 18.5，不是 1850', () => {
    const created = domain.createTransaction({ name: '午饭', amount: 18.5, date: '2026-09-01', cat: 'food' })
    expect(created.amount).toBe(18.5)
    // 这就是详情页曾经做的事：amountToCents -> 1850 -> normalizeAmount -> 1850
    const wrong = normalizeAmount(amountToCents('18.50'))
    expect(wrong).toBe(1850)
    expect(wrong).not.toBe(18.5)
  })

  it('updateTransaction 传元、传分的结果相差 100 倍（守卫防止有人再混用）', () => {
    domain.createTransaction({ name: '午饭', amount: 18.5, date: '2026-09-01', cat: 'food' })
    const list = domain.transactions.value
    const id = list[0].id
    domain.updateTransaction(id, { amount: 20 })
    expect(domain.transactions.value[0].amount).toBe(20)
  })
})

describe('分摊：人数为 1 不是分摊', () => {
  let domain
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    const mod = await import('../src/composables/domain/commands.js')
    domain = useDomainCommands(mod)
  })

  it('buildSplit 传 count=1 时 mine 等于总额（合法，但语义上是「未分摊」）', () => {
    const s = buildSplit(18.5, { count: 1, mine: 18.5 })
    expect(s.mine).toBe(18.5)
    expect(s.participants).toHaveLength(1)
  })

  it('Σ participants === total 精确成立（含余数）', () => {
    for (const total of [100, 10, 0.01, 999.99]) {
      for (const count of [2, 3, 7, 99]) {
        const s = buildSplit(total, { count })
        const sum = s.participants.reduce((a, p) => a + Math.round(p.amount * 100), 0)
        expect(sum, `total=${total} count=${count}`).toBe(Math.round(total * 100))
      }
    }
  })
})

describe('退款：币种与分摊必须继承，上限按「我承担」算（真缺陷）', () => {
  let domain
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    const mod = await import('../src/composables/domain/commands.js')
    domain = useDomainCommands(mod)
  })

  it('外币支出的退款继承 currency（修之前会落进基准币种桶）', () => {
    const fx = { base: 'CNY', rates: { USD: 7 } }
    const created = domain.createTransaction({ name: '订阅', amount: 9.99, date: '2026-09-01', cat: 'other', currency: 'USD' })
    const refund = domain.refundTransaction(created.id, { amount: 9.99, date: '2026-09-02' })
    expect(refund.blocked).toBeUndefined()
    // 修之前：refund.currency 为 undefined → 汇总按 CNY 冲减 9.99 元
    expect(refund.currency).toBe('USD')
  })

  it('分摊支出的退款只能退「我承担」那一份', () => {
    const created = domain.createTransaction({
      name: '聚餐', amount: 100, date: '2026-09-01', cat: 'food',
      split: buildSplit(100, { count: 2, mine: 60 }),
    })
    expect(mySpendCents(created)).toBe(6000)
    // 超额：想退 100（总额），但我只承担 60
    const tooMuch = domain.refundTransaction(created.id, { amount: 100, date: '2026-09-02' })
    expect(tooMuch.blocked).toBe(true)
    // 退 60 是允许的
    const ok = domain.refundTransaction(created.id, { amount: 60, date: '2026-09-02' })
    expect(ok.blocked).toBeUndefined()
    expect(ok.amount).toBe(60)
    // 本月净支出 = 60 - 60 = 0，不能变成负数。
    // 只看这一笔相关的两条记录（模块是单例，别的用例可能往里写过数据）。
    const related = domain.transactions.value.filter(
      (item) => item.id === created.id || item.refundOf === created.id,
    )
    const totals = personalSpendTotals(related)
    expect(totals.expenseTotal).toBe(0)
  })

  it('退款继承 split，计入时与原支出口径一致', () => {
    const created = domain.createTransaction({
      name: '聚餐', amount: 100, date: '2026-09-01', cat: 'food',
      split: buildSplit(100, { count: 2, mine: 60 }),
    })
    const refund = domain.refundTransaction(created.id, { amount: 60, date: '2026-09-02' })
    expect(refund.split).toBeTruthy()
    expect(mySpendCents(refund)).toBe(6000)
  })
})

describe('索引：缺 id 的记录不进任何聚合（真缺陷）', () => {
  it('monthStats / dayTotals / monthCategories / frequentEntries 都不收它', () => {
    const index = buildLedgerIndex([tx({ id: '', amount: 100 })])
    // 修之前：monthStats 里有 100，界面合计却是 0
    expect(index.monthStats.get('2026-09')).toBeUndefined()
    expect(index.dayTotals.size).toBe(0)
    expect(index.monthCategories.size).toBe(0)
    expect(index.frequentEntries).toHaveLength(0)
  })

  it('有 id 的记录照常进索引（判别力：不能把索引整个改空）', () => {
    const index = buildLedgerIndex([tx({ id: 'ok', amount: 100 })])
    expect(index.monthStats.get('2026-09').total).toBe(100)
    expect(index.dayTotals.get('2026-09-01')).toBe(100)
    expect(index.frequentEntries).toHaveLength(1)
  })
})

describe('常记（repeat last）：不收收入记录（真缺陷）', () => {
  it('两笔「工资」收入不产生常记条目', () => {
    const index = buildLedgerIndex([
      tx({ id: 'a', name: '工资', amount: 5000, direction: 'income', cat: 'salary' }),
      tx({ id: 'b', name: '工资', amount: 5000, direction: 'income', cat: 'salary', date: '2026-09-02' }),
    ])
    // 修之前：常记里出现「工资 ¥5000」，点一下会以**支出**方向落库
    expect(index.frequentEntries).toHaveLength(0)
  })

  it('支出仍进常记（判别力）', () => {
    const index = buildLedgerIndex([
      tx({ id: 'a', name: '早餐', amount: 8, date: '2026-09-01' }),
      tx({ id: 'b', name: '早餐', amount: 8, date: '2026-09-02' }),
    ])
    expect(index.frequentEntries).toHaveLength(1)
  })
})

describe('汇率：极端值不能把金额变成 0 或 Infinity（真缺陷）', () => {
  it('极小的汇率被丢弃，转换返回 null 而不是 0', () => {
    const fx = { base: 'CNY', rates: { JPY: 1e-9 } }
    expect(normalizeLedgerFx(fx).rates.JPY).toBeUndefined()
    const r = convertToBaseMinor(1000, 'JPY', fx)
    expect(r.cents).toBeNull()
    expect(r.reason).toBe('rate')
  })

  it('极大的汇率被丢弃，不会产生 Infinity', () => {
    const fx = { base: 'CNY', rates: { USD: 1e300 } }
    expect(normalizeLedgerFx(fx).rates.USD).toBeUndefined()
    expect(convertToBaseMinor(1, 'USD', fx).cents).toBeNull()
  })

  it('正常汇率照常工作（判别力）', () => {
    // rates 的读法是「1 单位该币种 = 多少基准币种」。
    // $10 × 7.2 = ¥72 → 7200 分；¥1000 日元 × 0.048 = ¥48 → 4800 分。
    const fx = { base: 'CNY', rates: { USD: 7.2, JPY: 0.048 } }
    expect(convertToBaseMinor(10, 'USD', fx).cents).toBe(7200)
    expect(convertToBaseMinor(1000, 'JPY', fx).cents).toBe(4800)
    expect(convertToBaseMinor(10, 'CNY', fx).cents).toBe(1000)
  })

  it('缺汇率的记录被排除并如实报数，绝不按 1:1 计入', () => {
    const summary = summarizeLedgerInBase(
      [tx({ id: 'a', amount: 10, currency: 'USD' }), tx({ id: 'b', amount: 90 })],
      { base: 'CNY', rates: {} },
    )
    expect(summary.excludedCount).toBe(1)
    expect(summary.missingRates).toContain('USD')
    expect(summary.expenseTotal).toBe(90)
  })
})

describe('大数金额：moneyRow 与 moneyHero 必须一致（真缺陷）', () => {
  it('超出安全整数范围时两者不再一个显示真实值、一个显示 0', () => {
    const huge = 1e15
    expect(moneyRow(huge)).toBe(moneyHero(huge))
    // 判别力：修之前是 ¥0.00 vs ¥1,000,000,000,000,000.00
    expect(moneyRow(huge)).not.toBe('¥0.00')
  })

  it('正常金额两者一致（判别力）', () => {
    expect(moneyRow(1234.56)).toBe(moneyHero(1234.56))
  })
})
