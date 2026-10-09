// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MonthlyTrendCard from '../src/views/ledger-panels/MonthlyTrendCard.vue'
import LedgerView from '../src/views/LedgerView.vue'
import { expenses } from '../src/composables/ledger.js'
import { useLedgerReview } from '../src/composables/ledgerView/review.js'
import { buildSplit, mySpendYuan } from '../src/composables/ledgerSplit.js'
import { moneyWithCurrency } from '../src/utils/formatters.js'
import { appToday } from '../src/composables/timeContext.js'
import { shiftTrendMonth } from '../src/composables/monthlyTrendChart.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
let app, host, review
const money = (value) => moneyWithCurrency(value, 'CNY')
const query = (selector) => host.querySelector(selector)
const month = (key) => query(`.trend-month[data-month="${key}"]`)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expenses.value = [
    { id: 'trend-history', date: '2024-04-10', amount: 100, cat: 'food' },
    { id: 'trend-april', date: '2026-04-10', amount: 100, cat: 'food' },
    { id: 'trend-may', date: '2026-05-10', amount: 220, cat: 'food' },
    { id: 'trend-may-income', date: '2026-05-10', amount: 600, direction: 'income' },
    { id: 'trend-august', date: '2026-08-10', amount: 90, cat: 'food' },
    { id: 'trend-refund', date: '2026-08-10', amount: 120, direction: 'refund' },
    { id: 'trend-sept-one', date: '2026-09-10', amount: 0.1, cat: 'food' },
    { id: 'trend-sept-two', date: '2026-09-10', amount: 0.2, cat: 'food' },
    { id: 'trend-usd', date: '2026-09-10', amount: 5, currency: 'USD', cat: 'food' },
    { id: 'trend-eur', date: '2026-09-10', amount: 20, currency: 'EUR', cat: 'food' },
    { id: 'trend-october', date: '2026-10-01', amount: 40, cat: 'food' },
    { id: 'trend-income', date: '2026-10-01', amount: 300, direction: 'income' },
    { id: 'trend-archived', date: '2020-01-10', amount: 999, archivedAt: '2020-02-01' },
    { id: 'trend-deleted', date: '2020-01-10', amount: 999, deletedAt: '2020-02-01' },
    { id: 'trend-invalid', date: '2020-02-31', amount: 999 },
  ]
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  app = host = review = null
  expenses.value = []
  vi.restoreAllMocks()
})

async function mount() {
  review = useLedgerReview({ personalAmount: mySpendYuan, ledgerToday: () => '2026-10-09', tab: ref('review'), fx: ref({ base: 'CNY', rates: { USD: 7 }, updatedAt: '2026-10-01' }) })
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(MonthlyTrendCard, {
    months: review.reviewTrendMonths.value,
    reviewMonth: review.reviewMonth.value,
    todayMonth: '2026-10',
    earliestMonth: review.earliestTrendMonth.value,
    currency: 'CNY',
    onJumpToMonth: review.jumpToMonth,
    onRangeEndChange: review.setTrendEndMonth,
  }) })
  app.mount(host)
  await nextTick()
}
async function click(button) {
  expect(button).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 8))
  button.click()
  await nextTick()
  await nextTick()
}

describe('monthly cash-flow card with real ledger summaries', () => {
  it('renders exact period totals and discloses missing rates without counting them as zero-value records', async () => {
    await mount()
    expect(query('.trend-period-label').textContent).toBe('2026.05 — 2026.10')
    expect(host.querySelectorAll('.trend-month')).toHaveLength(6)
    expect(query('.trend-summary .expense dd').textContent).toBe(money(265.3))
    expect(query('.trend-summary .income dd').textContent).toBe(money(900))
    expect(query('.trend-summary .balance dd').textContent).toBe(money(634.7))
    expect(query('.trend-fx-warning').textContent).toContain('EUR 缺少汇率，1 笔未计入')
    expect(query('.trend-comparison').textContent).toContain('本月进行中')
    expect(query('.trend-page[aria-label="查看后 6 个月"]').disabled).toBe(true)
    expect(review.earliestTrendMonth.value).toBe('2024-04')

    await click(query('.trend-range button:last-child'))
    expect(host.querySelectorAll('.trend-month')).toHaveLength(12)
    expect(query('.trend-summary .expense dd').textContent).toBe(money(365.3))
  })

  it('pages into history older than a year, stops at the oldest visible record, and returns to recent months', async () => {
    await mount()
    await click(query('.trend-page[aria-label="查看前 6 个月"]'))
    expect(query('.trend-period-label').textContent).toBe('2025.11 — 2026.04')
    expect(query('.trend-summary .expense dd').textContent).toBe(money(100))
    for (let i = 0; i < 4; i++) await click(query('.trend-page[aria-label="查看前 6 个月"]'))
    expect(query('.trend-period-label').textContent).toBe('2023.11 — 2024.04')
    expect(query('.trend-page[aria-label="查看前 6 个月"]').disabled).toBe(true)
    await click(month('2024-04'))
    expect(review.reviewMonth.value).toBe('2024-04')
    expect(query('.trend-selected-tag')).toBeTruthy()
    await click(query('.trend-reset'))
    expect(query('.trend-period-label').textContent).toBe('2026.05 — 2026.10')
    expect(query('.trend-reset').disabled).toBe(true)
    expect(query('.trend-glance-heading>b').textContent).toBe('2026年10月')
    await click(query('.trend-detail-link'))
    expect(review.reviewMonth.value).toBe('2026-10')
    review.setTrendEndMonth('2027-01')
    review.setTrendEndMonth('0000-01')
    expect(review.trendEndMonth.value).toBe('2026-10')
  })

  it('keeps the selected month when narrowing the range and follows the review month navigation', async () => {
    await mount()
    await click(query('.trend-range button:last-child'))
    await click(month('2025-12'))
    await click(query('.trend-range button:first-child'))
    expect(query('.trend-period-label').textContent).toBe('2025.07 — 2025.12')
    expect(month('2025-12').getAttribute('aria-pressed')).toBe('true')
    review.shiftMonth(-7)
    await nextTick()
    await nextTick()
    expect(query('.trend-period-label').textContent).toBe('2024.12 — 2025.05')
    expect(month('2025-05').getAttribute('aria-pressed')).toBe('true')
  })

  it('previews keyboard-focused months without changing selection, and presents negative refund surplus explicitly', async () => {
    await mount()
    await click(month('2026-08'))
    expect(review.reviewMonth.value).toBe('2026-08')
    expect(query('.trend-month-summary dd.negative').textContent).toBe(money(-30))
    expect(query('.trend-key').textContent).toContain('退款超出支出')
    const august = month('2026-08')
    august.focus()
    august.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await nextTick()
    expect(document.activeElement).toBe(month('2026-09'))
    expect(review.reviewMonth.value).toBe('2026-08')
    expect(query('.trend-glance-heading>b').textContent).toBe('2026年9月')
    expect(query('.trend-comparison').textContent).toContain('暂不比较上月')
    expect(month('2026-09').getAttribute('aria-label')).toContain('1 笔缺少汇率未计入')
    await click(month('2026-09'))
    expect(review.reviewMonth.value).toBe('2026-09')
  })

  it('shows different empty states for no records and records excluded by missing exchange rates', async () => {
    expenses.value = []
    await mount()
    expect(query('.trend-empty').textContent).toContain('还没有收支记录')
    expect(query('.trend-page[aria-label="查看前 6 个月"]').disabled).toBe(true)
    expenses.value = [{ id: 'only-missing-rate', date: '2026-09-10', amount: 20, currency: 'EUR' }]
    await nextTick()
    expect(query('.trend-empty').textContent).toContain('缺少汇率')
    expect(query('.trend-fx-warning').textContent).toContain('1 笔未计入')
    expect(query('.trend-summary .expense dd').textContent).toBe(money(0))
  })

  it('keeps split amounts and completed-month comparisons on the same personal-share basis', async () => {
    expenses.value = [
      { id: 'split-july', date: '2026-07-10', amount: 100, split: buildSplit(100, { count: 2, mine: 40 }) },
      { id: 'split-august', date: '2026-08-10', amount: 200, split: buildSplit(200, { count: 2, mine: 30 }) },
    ]
    await mount()
    await click(month('2026-08'))
    expect(query('.trend-summary .expense dd').textContent).toBe(money(70))
    expect(query('.trend-month-summary dd').textContent).toBe(money(30))
    expect(query('.trend-comparison').textContent).toContain(`减少 ${money(10)}`)
  })

  it('keeps cent-level axis labels readable instead of rounding every tick to zero', async () => {
    expenses.value = [
      { id: 'small-expense', date: '2026-09-10', amount: 0.01 },
      { id: 'small-income', date: '2026-09-10', amount: 0.04, direction: 'income' },
    ]
    await mount()
    expect(query('.trend-axis').textContent).toContain('0.01')
    expect(query('.trend-axis').textContent).toContain('0.04')
    expect(query('.trend-summary .expense dd').textContent).toBe(money(0.01))
  })

  it('connects history paging and month selection to the full ledger review panel', async () => {
    const todayMonth = appToday.value.slice(0, 7)
    const historicalMonth = shiftTrendMonth(todayMonth, -6)
    expenses.value = [{ id: 'full-ledger-trend', name: '示例消费', date: `${historicalMonth}-10`, amount: 100, cat: 'food' }]
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/bills', component: LedgerView }] })
    await router.push('/bills?tab=review')
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(LedgerView)
    app.use(router)
    app.mount(host)
    await nextTick()
    await click(query('.trend-page[aria-label="查看前 6 个月"]'))
    expect(query('.trend-period-label').textContent).toContain(historicalMonth.replace('-', '.'))
    await click(month(historicalMonth))
    expect(query('.month-nav b').textContent).toContain(`${Number(historicalMonth.slice(5))}月`)
    expect(query('.rs-top b').textContent).toBe(money(100))
    expect(month(historicalMonth).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches the real review month on the first touch release, even when no compatibility click arrives', async () => {
    const todayMonth = appToday.value.slice(0, 7)
    const targetMonth = shiftTrendMonth(todayMonth, -1)
    expenses.value = [{ id: 'first-tap-review', name: '示例消费', date: `${targetMonth}-10`, amount: 25, cat: 'food' }]
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/bills', component: LedgerView }] })
    await router.push('/bills?tab=review')
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(LedgerView).use(router)
    app.mount(host)
    await nextTick()
    const button = month(targetMonth)
    for (const type of ['pointerdown', 'pointerup']) {
      button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100, button: 0 }))
      await nextTick()
    }
    expect(query('.month-nav b').textContent).toContain(`${Number(targetMonth.slice(5))}月`)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(query('.rs-top b').textContent).toBe(money(25))
  })

  it('does not select a month during a scroll gesture or after pointer cancellation', async () => {
    await mount()
    const target = month('2026-09')
    const pointer = (type, x = 100) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerType: 'touch', pointerId: 4, clientX: x, clientY: 100, button: 0,
    }))
    pointer('pointerdown')
    pointer('pointermove', 125)
    pointer('pointerup', 125)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
    expect(review.reviewMonth.value).toBe('2026-10')
    pointer('pointerdown')
    pointer('pointercancel')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
    expect(review.reviewMonth.value).toBe('2026-10')
    pointer('pointerdown')
    pointer('pointerup')
    await nextTick()
    expect(review.reviewMonth.value).toBe('2026-09')
  })
})
