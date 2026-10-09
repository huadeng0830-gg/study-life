// @vitest-environment happy-dom
import { createApp, effectScope, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LedgerView from '../src/views/LedgerView.vue'
import { expenses, freqPrefs, rememberCategoryOverride } from '../src/composables/ledger.js'
import { buildSplit, mySpendCents, mySpendYuan } from '../src/composables/ledgerSplit.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { useLedgerFx } from '../src/composables/ledgerFx.js'
import { useLedgerBudget } from '../src/composables/ledgerBudget.js'
import { useLedgerFeed } from '../src/composables/ledgerView/feed.js'
import { useQuickEntryForm } from '../src/composables/ledgerView/useQuickEntryForm.js'
import { useTransactionDetail } from '../src/composables/ledgerView/useTransactionDetail.js'
import { useLedgerExport } from '../src/composables/ledgerView/export.js'
import { appToday } from '../src/composables/timeContext.js'
import { moneyWithCurrency } from '../src/utils/formatters.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const domain = useDomainCommands()
const { fx } = useLedgerFx()
const { budget } = useLedgerBudget()
const today = () => appToday.value
const money = (amount, code = 'CNY') => moneyWithCurrency(amount, code)
let app, host, scope

beforeEach(() => {
  expenses.value = []
  domain.bills.value = []
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
  budget.value = { monthly: null, updatedAt: '' }
  freqPrefs.value = { pinned: [], hidden: [], categoryOverrides: [] }
  scope = effectScope()
})
afterEach(() => {
  app?.unmount()
  host?.remove()
  scope?.stop()
  app = host = null
  expenses.value = []
  domain.bills.value = []
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
  budget.value = { monthly: null, updatedAt: '' }
  freqPrefs.value = { pinned: [], hidden: [], categoryOverrides: [] }
  vi.restoreAllMocks()
})

function form() {
  return scope.run(() => useQuickEntryForm({
    baseCurrency: ref(fx.value.base), domain, notify: () => {}, closeSwipe: () => {}, ledgerNowHM: () => '12:00',
  }))
}
async function mount(tab = 'ledger') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/bills', component: LedgerView }] })
  await router.push(`/bills?tab=${tab}`)
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(LedgerView).use(router)
  app.mount(host)
  await nextTick()
  await nextTick()
}
async function click(node) {
  expect(node).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 8))
  node.click()
  await nextTick()
  await nextTick()
}
async function input(node, value, event = 'input') {
  expect(node).toBeTruthy()
  node.value = value
  node.dispatchEvent(new Event(event, { bubbles: true }))
  await nextTick()
  await nextTick()
}
const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
const item = (overrides) => ({ id: 'example', name: '示例记录', amount: 30, date: today(), time: '12:00', cat: 'food', ...overrides })

describe('ledger entry and refund correctness', () => {
  it('edits a recent custom split without detecting itself as a duplicate or rewriting member shares', async () => {
    const split = { total: 100, mine: 25, participants: [{ label: '我', amount: 25 }, { label: '成员甲', amount: 30 }, { label: '成员乙', amount: 45 }] }
    const original = domain.createTransaction({ name: '示例聚餐', amount: 100, date: today(), cat: 'food', split })
    const api = form()
    api.openQuick(original)
    api.noteInput.value = '只修改备注'
    await nextTick()
    expect(api.duplicateHit.value).toBe(false)
    expect(await api.saveExpense(false, original.id)).toBe(true)
    expect(original.split).toEqual(split)
    expect(original.note).toBe('只修改备注')
    expect(expenses.value).toHaveLength(1)
  })

  it('does not treat different currencies, accounts, dates or directions as the same recent entry', async () => {
    domain.createTransaction({ name: '示例记录', amount: 10, date: today(), currency: 'USD', account: '示例账户' })
    const api = form()
    const context = { name: '示例记录', amount: 10, date: today(), currency: 'USD', account: '示例账户' }
    api.openQuick(context)
    await nextTick()
    expect(api.duplicateHit.value).toBe(true)
    for (const patch of [{ currency: 'CNY' }, { account: '另一账户' }, { date: '2026-01-02' }, { direction: 'income' }]) {
      api.openQuick({ ...context, ...patch })
      await nextTick()
      expect(api.duplicateHit.value).toBe(false)
    }
  })

  it('keeps invalid dates and fractional split counts out of storage and resets split state after continuous entry', async () => {
    const api = form()
    api.openQuick({ name: '示例记录', amount: 10.01, date: '2026-02-31' })
    await nextTick()
    expect(await api.saveExpense()).toBe(false)
    expect(api.errorField.value).toBe('date')
    api.dateInput.value = today()
    api.splitCount.value = '1.5'
    await nextTick()
    expect(await api.saveExpense()).toBe(false)
    expect(api.errorField.value).toBe('split')
    expect(expenses.value).toHaveLength(0)
    api.splitCount.value = '3'
    await nextTick()
    expect(await api.saveExpense(true)).toBe(true)
    expect(mySpendCents(expenses.value[0])).toBe(334)
    expect(api.splitCount.value).toBe('1')
    expect(api.splitMode.value).toBe('equal')
    expect(api.amountInput.value).toBe('')
  })

  it('protects refund relationships and interprets old inherited splits as the actual partial refund', () => {
    const original = domain.createTransaction({ name: '示例聚餐', amount: 100, date: today(), split: buildSplit(100, { count: 2, mine: 60 }) })
    expect(mySpendCents({ amount: 10, direction: 'refund', split: original.split })).toBe(1000)
    expect(domain.refundTransaction(original.id, { amount: 0 }).blocked).toBe(true)
    expect(domain.refundTransaction(original.id, { amount: 10, date: '2026-02-31' }).blocked).toBe(true)
    expect(domain.refundTransaction(original.id, { amount: 10, date: '' }).blocked).toBe(true)
    const refund = domain.refundTransaction(original.id, { amount: 20, date: today() })
    expect(() => domain.updateTransaction(original.id, { direction: 'income' })).toThrow('已有退款')
    expect(() => domain.updateTransaction(original.id, { currency: 'USD' })).toThrow('更换币种')
    expect(() => domain.updateTransaction(original.id, { split: buildSplit(100, { count: 2, mine: 19 }) })).toThrow('不能小于')
    expect(domain.deleteTransaction(original.id).blocked).toBe(true)
    expect(domain.deleteTransaction(refund.id).id).toBe(refund.id)
    expect(domain.deleteTransaction(original.id).id).toBe(original.id)
  })

  it('edits a refunded base-currency record without treating its empty currency alias as a change', async () => {
    const original = domain.createTransaction({ name: '人民币示例', amount: 100, date: today(), currency: 'CNY' })
    domain.refundTransaction(original.id, { amount: 20, date: today() })
    const api = form()
    api.openQuick(original, original.id)
    await nextTick()
    api.noteInput.value = '更新示例备注'
    expect(await api.saveExpense(false, original.id)).toBe(true)
    expect(original.note).toBe('更新示例备注')
    original.archivedAt = '2026-10-01T00:00:00Z'
    expect(domain.updateTransaction(original.id, { note: '不可更新' })).toBeNull()
    expect(original.note).toBe('更新示例备注')
  })

  it('preserves learned category rules when pinning and hiding a frequent name', () => {
    const original = domain.createTransaction({ name: '示例记录', amount: 20, date: today(), cat: 'food' })
    rememberCategoryOverride(original.name, 'transport', 'expense')
    const learned = structuredClone(JSON.parse(JSON.stringify(freqPrefs.value.categoryOverrides)))
    const api = scope.run(() => useTransactionDetail({ domain, notify: () => {}, closeSwipe: () => {}, flashTransaction: () => {}, baseCurrency: ref('CNY'), ledgerToday: today }))
    api.openDetail(original.id)
    api.togglePinName()
    api.toggleHideName()
    expect(freqPrefs.value.categoryOverrides).toEqual(learned)
  })

  it('completes a one-time bill and restores it when its payment is undone', () => {
    const bill = domain.createBill({ name: '示例单次付款', amount: 25, nextDate: today(), cycle: 'once' })
    const paid = domain.payBill(bill.id)
    expect(bill.active).toBe(false)
    expect(domain.payBill(bill.id).blocked).toBe(true)
    domain.undoBillPayment(paid.transaction.id)
    expect(bill.active).toBe(true)
    expect(domain.transactions.value).toHaveLength(0)
    expect(domain.payBill(bill.id).duplicate).toBe(false)
  })
})

describe('real ledger panels and exports', () => {
  it('keeps home, budget, review, trend and calendar on the same converted personal-share basis', async () => {
    expenses.value = [
      item({ id: 'cny' }),
      item({ id: 'usd', amount: 10, currency: 'USD', split: buildSplit(10, { count: 2, mine: 4 }) }),
      item({ id: 'refund', amount: 1, currency: 'USD', direction: 'refund', refundOf: 'usd' }),
      item({ id: 'income', amount: 20, currency: 'USD', direction: 'income' }),
      item({ id: 'missing', amount: 5, currency: 'EUR', cat: 'sub' }),
    ]
    fx.value = { base: 'CNY', rates: { USD: 7 }, updatedAt: '2026-10-01' }
    budget.value = { monthly: 100, updatedAt: '' }
    await mount()
    expect(host.querySelector('.spend-metric.current b').textContent).toBe(money(51))
    expect(host.querySelector('.budget-card').textContent).toContain('51%')
    expect(host.querySelector('.budget-card').textContent).toContain(money(49))
    expect(host.querySelector('.feed-day').textContent).toContain(money(51))
    expect(host.querySelector('.category-block').textContent).toContain(money(58))
    await click(host.querySelector('#ledger-tab-review'))
    expect(host.querySelector('.rs-top b').textContent).toBe(money(51))
    expect(host.querySelector('.rs-top span').textContent).toContain('5 笔')
    expect(host.querySelector('.rs-io').textContent).toContain(money(140))
    expect(host.querySelector('.rs-io').textContent).toContain(money(89))
    expect(host.querySelector('.trend-month-summary dd').textContent).toBe(money(51))
    const day = [...host.querySelectorAll('.cal-cell')].find((node) => node.textContent.trim() === String(Number(today().slice(8))))
    await click(day)
    expect(host.querySelector('.cal-detail').textContent).toContain('5 笔')
    expect(host.querySelector('.cal-detail').textContent).toContain(money(51))
    expect(host.querySelectorAll('.cd-row')).toHaveLength(5)
    expect(host.querySelector('.cal-detail').textContent).toContain(money(4, 'USD'))
    expect(host.querySelector('.review-fx-warning').textContent).toContain('EUR')
  })

  it('shows an income-only month and its income in the calendar, then switches through the month picker', async () => {
    expenses.value = [item({ id: 'income-only', amount: 300, direction: 'income' })]
    await mount('review')
    expect(host.querySelector('.review-summary')).toBeTruthy()
    expect(host.querySelector('.rs-io').textContent).toContain(money(300))
    expect(host.querySelector('.review-cats')).toBeNull()
    const picker = host.querySelector('[aria-label="选择回顾月份"]')
    await input(picker, '2026-01', 'change')
    expect(host.querySelector('.month-nav b').textContent).toContain('1月')
    expect(host.querySelector('.review-summary')).toBeNull()
    expect(host.querySelector('.empty-box').textContent).toContain('还没有记录')
  })

  it('populates the currency filter and exports only its current result', async () => {
    expenses.value = [item({ id: 'one', name: '人民币示例' }), item({ id: 'two', name: '外币示例', currency: 'USD', amount: 10, account: '示例账户' })]
    await mount()
    await click(button('筛选'))
    const currency = host.querySelector('[aria-label="筛选币种"]')
    expect([...currency.options].map((option) => option.value)).toContain('USD')
    await input(currency, 'USD', 'change')
    expect(host.querySelectorAll('.feed-item')).toHaveLength(1)
    expect(host.querySelector('.feed-item').textContent).toContain('外币示例')
    let downloaded
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { downloaded = blob; return 'blob:example' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await click(host.querySelector('[aria-label="导出当前筛选结果"] button'))
    const csv = await downloaded.text()
    expect(csv).toContain('外币示例')
    expect(csv).not.toContain('人民币示例')
    expect(csv).toContain('USD')
  })

  it('clears debounced search immediately and reports invalid range bounds', async () => {
    expenses.value = [item({ id: 'search', account: '示例账户' }), item({ id: 'other', name: '其它示例' })]
    const api = scope.run(() => useLedgerFeed())
    api.q.value = '示例账户'
    await new Promise((resolve) => setTimeout(resolve, 190))
    expect(api.filteredExpenses.value.map((entry) => entry.id)).toEqual(['search'])
    api.clearFilters()
    expect(api.q.value).toBe('')
    expect(api.filteredExpenses.value).toHaveLength(2)
    api.fMin.value = '50'; api.fMax.value = '20'
    expect(api.filterError.value).toContain('最低金额')
    expect(api.filteredExpenses.value).toHaveLength(0)
    api.clearFilters()
    api.fRange.value = 'custom'; api.fFrom.value = '2026-10-10'; api.fTo.value = '2026-10-01'
    expect(api.filterError.value).toContain('起始日期')
  })

  it('uses one export snapshot even if records and the selected month change while Excel is loading', async () => {
    const month = ref(today().slice(0, 7))
    expenses.value = [item({ id: 'snapshot', name: '快照示例', amount: 100, split: buildSplit(100, { count: 2, mine: 40 }) })]
    let downloaded
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { downloaded = blob; return 'blob:example' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const api = useLedgerExport({ getMonth: () => month.value, personalAmount: mySpendYuan, baseCurrency: ref('CNY'), notify: () => {} })
    const saving = api.exportLedgerXlsx()
    expenses.value[0].amount = 200
    expenses.value[0].split.mine = 80
    expenses.value.push(item({ id: 'late-record', amount: 5 }))
    month.value = '2026-01'
    await saving
    const XLSX = await import('@e965/xlsx')
    const book = XLSX.read(new Uint8Array(await downloaded.arrayBuffer()), { type: 'array' })
    const summary = XLSX.utils.sheet_to_json(book.Sheets['汇总'], { header: 1 })
    const rows = XLSX.utils.sheet_to_json(book.Sheets['账单明细'])
    expect(summary[0][0]).toContain(today().slice(0, 7))
    expect(summary.find((row) => row[0] === '支出合计')[1]).toBe(40)
    expect(rows).toHaveLength(1)
    expect(rows[0]['金额']).toBe(100)
    expect(rows[0]['我承担']).toBe(40)
  })
})
