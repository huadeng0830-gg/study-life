// @vitest-environment happy-dom
/**
 * 预算与超支预警（纯函数层 + 存储读写）。
 *
 * 【判据】未设预算 → `set:false` 且文案为空（页面上不该出现 0/0）；
 * 设了预算 → `over` / `near`（≥80%）/ `ok` 三档必须在**阈值上**分部准确，
 * 且超支与接近预算是两句不同的话。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  BUDGET_NEAR_RATIO,
  LEDGER_BUDGET_KEY,
  budgetAlertText,
  budgetStatus,
  normalizeLedgerBudget,
  normalizeMonthlyBudget,
  useLedgerBudget,
} from '../src/composables/ledgerBudget.js'
import { flushStoredWrites } from '../src/composables/store/core.js'

describe('月度预算金额的规范化', () => {
  it('接受大于 0、最多两位小数的数值（含带符号/千分位的文本）', () => {
    expect(normalizeMonthlyBudget(2000)).toBe(2000)
    expect(normalizeMonthlyBudget('2000')).toBe(2000)
    expect(normalizeMonthlyBudget(' 2,000 ')).toBe(2000)
    expect(normalizeMonthlyBudget('¥2000')).toBe(2000)
    expect(normalizeMonthlyBudget(0.1 + 0.2)).toBe(0.3)
  })

  it('0 / 负数 / 空值 / 非数字 / 三位小数 / 超上限一律视为未设置', () => {
    expect(normalizeMonthlyBudget(0)).toBe(null)
    expect(normalizeMonthlyBudget(-100)).toBe(null)
    expect(normalizeMonthlyBudget('')).toBe(null)
    expect(normalizeMonthlyBudget(null)).toBe(null)
    expect(normalizeMonthlyBudget(undefined)).toBe(null)
    expect(normalizeMonthlyBudget('abc')).toBe(null)
    expect(normalizeMonthlyBudget(Infinity)).toBe(null)
    expect(normalizeMonthlyBudget(NaN)).toBe(null)
    expect(normalizeMonthlyBudget(1.005)).toBe(null)
    expect(normalizeMonthlyBudget(2_000_000_000)).toBe(null)
  })

  it('形状规范化会丢掉非法 monthly，保留 updatedAt', () => {
    expect(normalizeLedgerBudget({ monthly: '300', updatedAt: '2026-09-01' })).toEqual({ monthly: 300, updatedAt: '2026-09-01' })
    expect(normalizeLedgerBudget({ monthly: 'oops' })).toEqual({ monthly: null, updatedAt: '' })
    expect(normalizeLedgerBudget(null)).toEqual({ monthly: null, updatedAt: '' })
  })
})

describe('预算状态与阈值', () => {
  it('未设预算时什么都不该显示（不是显示 0/0）', () => {
    const status = budgetStatus({ spent: 123.45, budget: null })
    expect(status.set).toBe(false)
    expect(status.level).toBe('none')
    expect(budgetAlertText(status)).toBe('')
    // 判别力：一个"总是返回一句话"的实现会在这里红。
    expect(budgetAlertText(budgetStatus({ spent: 0, budget: null }))).toBe('')
  })

  it('在预算内 / 达到 80% / 超出 三档分部精确', () => {
    expect(budgetStatus({ spent: 799.99, budget: 1000 }).level).toBe('ok')
    expect(budgetStatus({ spent: 800, budget: 1000 }).level).toBe('near')
    expect(budgetStatus({ spent: 999.99, budget: 1000 }).level).toBe('near')
    // 恰好花完不算超支（spent > budget 才 over）
    expect(budgetStatus({ spent: 1000, budget: 1000 }).level).toBe('near')
    expect(budgetStatus({ spent: 1000.01, budget: 1000 }).level).toBe('over')
    expect(BUDGET_NEAR_RATIO).toBe(0.8)
  })

  it('金额比较全在「分」上做，剩余额度与百分比都可核验', () => {
    const status = budgetStatus({ spent: 0.1 + 0.2, budget: 1 })
    expect(status.spentCents).toBe(30)
    expect(status.spent).toBe(0.3)
    expect(status.remaining).toBe(0.7)
    expect(status.pct).toBe(30)
    const over = budgetStatus({ spent: 120, budget: 100 })
    expect(over.remaining).toBe(-20)
    expect(over.level).toBe('over')
  })

  it('退款多于支出（负的当月总额）也能正确算出剩余额度', () => {
    const status = budgetStatus({ spent: -30, budget: 100 })
    expect(status.set).toBe(true)
    expect(status.level).toBe('ok')
    expect(status.remaining).toBe(130)
    expect(status.pct).toBe(-30)
  })

  it('超支与接近预算是两句不同的话，且带上金额/百分比', () => {
    const near = budgetAlertText(budgetStatus({ spent: 850, budget: 1000 }))
    const over = budgetAlertText(budgetStatus({ spent: 1200, budget: 1000 }))
    expect(near).toContain('85%')
    expect(near).toContain('还剩')
    expect(over).toContain('已超预算')
    expect(over).not.toBe(near)
    expect(over).toContain('200.00')
  })

  it('外币折算过的当月总额要在文案里说明是折算值', () => {
    const text = budgetAlertText(budgetStatus({ spent: 1200, budget: 1000 }), { base: 'CNY', converted: true })
    expect(text).toContain('已按手工汇率折算')
    expect(budgetAlertText(budgetStatus({ spent: 1200, budget: 1000 }))).not.toContain('折算')
  })
})

describe('预算存储读写（sl_ledger_budget）', () => {
  beforeEach(() => {
    localStorage.removeItem(LEDGER_BUDGET_KEY)
  })

  it('保存后写入 monthly 与 updatedAt，并落进 localStorage；清除后 monthly 为 null', () => {
    const { budget, saveBudget, clearBudget } = useLedgerBudget()
    budget.value = { monthly: null, updatedAt: '' }

    saveBudget('1500')
    expect(budget.value.monthly).toBe(1500)
    expect(budget.value.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(LEDGER_BUDGET_KEY)).monthly).toBe(1500)

    clearBudget()
    expect(budget.value.monthly).toBe(null)
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(LEDGER_BUDGET_KEY)).monthly).toBe(null)
  })

  it('非法输入抛中文错误而不是静默存成 0', () => {
    const { saveBudget } = useLedgerBudget()
    expect(() => saveBudget('abc')).toThrow('预算需为大于 0 的数字')
    expect(() => saveBudget(0)).toThrow('预算需为大于 0 的数字')
    expect(() => saveBudget(-1)).toThrow('预算需为大于 0 的数字')
  })
})