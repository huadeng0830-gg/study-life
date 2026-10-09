import { describe, expect, it } from 'vitest'
import { buildMonthlyTrendScale, monthlyTrendBarGeometry, shiftTrendMonth, summarizeMonthlyTrend } from '../src/composables/monthlyTrendChart.js'

describe('monthly cash-flow chart scale', () => {
  it('keeps positive expenses and income on one readable zero-based scale', () => {
    const scale = buildMonthlyTrendScale([
      { expense: 1200, income: 3600 },
      { expense: 2400, income: 0 },
    ])

    expect(scale.min).toBe(0)
    expect(scale.max).toBeGreaterThanOrEqual(3600)
    expect(scale.ticks[0]).toBe(0)
    expect(scale.ticks.at(-1)).toBe(scale.max)
    expect(scale.zeroPosition).toBe(0)
    expect(monthlyTrendBarGeometry(1200, scale).bottom).toBe(0)
    expect(monthlyTrendBarGeometry(3600, scale).height).toBeGreaterThan(monthlyTrendBarGeometry(1200, scale).height)
  })

  it('places refund-driven negative net expenses below zero and income above it', () => {
    const scale = buildMonthlyTrendScale([
      { expense: -300, income: 900 },
    ])
    const refund = monthlyTrendBarGeometry(-300, scale)
    const income = monthlyTrendBarGeometry(900, scale)

    expect(scale.min).toBeLessThan(-300)
    expect(scale.zeroPosition).toBeGreaterThan(0)
    expect(refund.bottom + refund.height).toBeCloseTo(scale.zeroPosition)
    expect(income.bottom).toBeCloseTo(scale.zeroPosition)
    expect(income.bottom + income.height).toBeGreaterThan(scale.zeroPosition)
  })

  it('uses finite fallback geometry for empty or malformed values', () => {
    const scale = buildMonthlyTrendScale([])
    expect(scale).toMatchObject({ min: 0, max: 1, zeroPosition: 0 })
    expect(monthlyTrendBarGeometry('bad', scale)).toEqual({ bottom: 0, height: 0 })

    const malformed = buildMonthlyTrendScale([{ expense: 'bad', income: Infinity }])
    expect(malformed.ticks.every(Number.isFinite)).toBe(true)
  })

  it('leaves a readable negative band without letting a small refund consume the income chart', () => {
    const scale = buildMonthlyTrendScale([{ expense: -240, income: 4000 }])
    expect(scale.min).toBeLessThanOrEqual(-240)
    expect(scale.zeroPosition).toBeGreaterThan(5)
    expect(scale.zeroPosition).toBeLessThan(20)
    expect(scale.ticks).toContain(0)
    expect(scale.ticks[0]).toBe(scale.min)
    expect(scale.ticks.at(-1)).toBe(scale.max)
    expect(monthlyTrendBarGeometry(-240, scale).bottom).toBeGreaterThanOrEqual(0)
  })

  it('does not duplicate the minimum tick for fractional amounts', () => {
    const scale = buildMonthlyTrendScale([{ expense: -0.3, income: 0.9 }])
    expect(new Set(scale.ticks).size).toBe(scale.ticks.length)
    expect(scale.ticks).toContain(0)
    expect(scale.ticks.every(Number.isFinite)).toBe(true)
  })
})

describe('monthly trend periods and totals', () => {
  it('moves across year boundaries and rejects invalid or out-of-range months', () => {
    expect(shiftTrendMonth('2026-02', -6)).toBe('2025-08')
    expect(shiftTrendMonth('2025-12', 1)).toBe('2026-01')
    expect(shiftTrendMonth('0099-12', 1)).toBe('0100-01')
    expect(shiftTrendMonth('0001-01', -1)).toBe('')
    expect(shiftTrendMonth('9999-12', 1)).toBe('')
    expect(shiftTrendMonth('2026-13', 1)).toBe('')
    expect(shiftTrendMonth('2026-10', 0.5)).toBe('')
  })

  it('sums converted amounts in cents, including refund surplus and excluded records', () => {
    const totals = summarizeMonthlyTrend([
      { expense: 0.1, income: 0.2, count: 2 },
      { expense: 0.2, income: 0.1, count: 2, excludedCount: 1 },
      { expense: -5, income: 10, count: 1, excludedCount: 2 },
    ])
    expect(totals).toEqual({ expense: -4.7, income: 10.3, balance: 15, count: 5, excludedCount: 3 })
    expect(summarizeMonthlyTrend([{ expense: 20, income: 0 }]).balance).toBe(-20)
    expect(summarizeMonthlyTrend([])).toEqual({ expense: 0, income: 0, balance: 0, count: 0, excludedCount: 0 })
  })
})
