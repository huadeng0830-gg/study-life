import { describe, expect, it } from 'vitest'
import { buildLastYearComparison, lastYearComparisonDates } from '../src/composables/lastYearComparison.js'
import { gregorianToLunar, lunarToGregorian } from '../src/composables/lunar.js'

describe('去年同期对照查询', () => {
  it('把公历窗口两端都计入，窗口外一天不计入', () => {
    const result = buildLastYearComparison({
      transactions: [
        { date: '2025-10-10', amount: 10 },
        { date: '2025-10-11', amount: 820 },
        { date: '2025-10-17', amount: 30 },
        { date: '2025-10-18', amount: 40 },
      ],
    }, '2026-10-14', { timezone: 'UTC' })

    expect(result.previousDates).toEqual(['2025-10-11', '2025-10-12', '2025-10-13', '2025-10-14', '2025-10-15', '2025-10-16', '2025-10-17'])
    expect(result.transactionCount).toBe(2)
    expect(result.expense).toBe(850)
    expect(result.sentence).toContain('支出 ¥850.00')
    expect(result.hasRecords).toBe(true)
  })

  it('跨公历年匹配时仍覆盖窗口两侧', () => {
    const result = buildLastYearComparison({
      tasks: [
        { id: 'fiction-task-in-window', completedAt: '2025-01-01T12:00:00Z' },
        { id: 'fiction-task-outside', completedAt: '2025-01-06T12:00:00Z' },
      ],
    }, '2026-01-02', { timezone: 'UTC' })

    expect(result.previousDates).toContain('2024-12-30')
    expect(result.previousDates).toContain('2025-01-05')
    expect(result.completedTasks).toBe(1)
  })

  it('用去年对应的农历日期对齐已配置的农历纪念日', () => {
    const currentDate = lunarToGregorian(2026, 3, 3)
    const priorDate = lunarToGregorian(2025, 3, 3)
    const todayKey = `${currentDate.year}-${String(currentDate.month).padStart(2, '0')}-${String(currentDate.day).padStart(2, '0')}`
    const priorKey = `${priorDate.year}-${String(priorDate.month).padStart(2, '0')}-${String(priorDate.day).padStart(2, '0')}`
    const anniversary = { lunarMonth: 3, lunarDay: 3, isLeapMonth: false, label: '虚构纪念日' }
    const window = lastYearComparisonDates(todayKey, { timezone: 'UTC', lunarAnniversaries: [anniversary] })
    const summary = buildLastYearComparison({ transactions: [{ date: priorKey, amount: 12 }] }, todayKey, {
      timezone: 'UTC',
      lunarAnniversaries: [anniversary],
    })

    expect(gregorianToLunar(todayKey)).toMatchObject({ year: 2026, month: 3, day: 3 })
    expect(window.lunarAlignments).toContainEqual({ currentDate: todayKey, previousDate: priorKey, label: '虚构纪念日' })
    expect(summary.transactionCount).toBe(1)
    expect(summary.sentence).toContain('虚构纪念日按农历日期对齐')
  })

  it('内置农历节日也按去年农历日期对齐，周边公历日期仍按公历对齐', () => {
    const window = lastYearComparisonDates('2026-09-25', { timezone: 'UTC' })

    expect(window.previousDates).toContain('2025-10-06')
    expect(window.previousDates).toContain('2025-09-24')
    expect(window.lunarAlignments).toContainEqual({ currentDate: '2026-09-25', previousDate: '2025-10-06', label: '中秋节' })
  })

  it('没有去年同期样本时显示之后累积的记录条数', () => {
    const result = buildLastYearComparison({
      focusSessions: [{ startedAt: '2026-01-20T09:00:00Z', actualFocusSeconds: 1500 }],
      tasks: [{ completedAt: '2026-02-02T12:00:00Z' }],
      transactions: [{ date: '2026-03-03', amount: 18 }],
      moodLog: { '2026-04-04': { mood: '🙂' } },
      weeklyReflections: { '2026-01-19': { wins: '虛構周复盘', learned: '', next: '' } },
    }, '2026-10-14', { timezone: 'UTC' })

    expect(result.hasRecords).toBe(false)
    expect(result.totalRecords).toBe(0)
    expect(result.subsequentRecordCount).toBe(5)
  })
})
