import { describe, expect, it } from 'vitest'
import { buildMonthlyTrendScale, monthlyTrendBarGeometry } from '../src/composables/monthlyTrendChart.js'

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
})
