// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  amountToCents,
  buildLedgerIndex,
  filterLedgerTransactions,
  isDateInLedgerRange,
  ledgerMonthCategoryTotalsFromIndex,
  ledgerMonthIncomeFromIndex,
  ledgerPeriodStatsFromIndex,
  ledgerWeekTotalFromIndex,
  normalizeAmount,
  rememberCategoryOverride,
  sumLedgerAmounts,
  transactionIntegrityIssues,
  expenses,
  freqPrefs,
  ledgerCategories,
} from '../src/composables/ledger.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { parseQuickRecord } from '../src/composables/quickRecord/parser.js'
import { normalizeLedgerCategories } from '../src/composables/ledgerCategories.js'
import { policyDateKey, policyDateTime, settings } from '../src/composables/settingsPolicy.js'

const domain = useDomainCommands()

beforeEach(() => {
  domain.transactions.value = []
  domain.bills.value = []
})

afterEach(() => {
  domain.transactions.value = []
  domain.bills.value = []
})

describe('账本最终金额边界与索引', () => {
  it('金额接受 0 与正数、最多两位小数，并按分消除浮点误差', () => {
    expect(amountToCents(5)).toBe(500)
    expect(amountToCents('5.5')).toBe(550)
    expect(amountToCents('¥1,234.56')).toBe(123456)
    expect(amountToCents(0.1 + 0.2)).toBe(30)
    expect(normalizeAmount(0.1 + 0.2)).toBe(0.3)
    // 0 元是合法金额（免费、报销占位等），空值才是“未填写”。
    expect(amountToCents(0)).toBe(0)
    expect(amountToCents('0')).toBe(0)
    expect(amountToCents('0.00')).toBe(0)
    expect(normalizeAmount('0')).toBe(0)
    expect(normalizeAmount('')).toBeNull()
    expect(normalizeAmount('   ')).toBeNull()
    expect(amountToCents(-1)).toBeNull()
    expect(amountToCents('1.234')).toBeNull()
    expect(amountToCents('1e3')).toBeNull()
    expect(amountToCents(Infinity)).toBeNull()
    expect(amountToCents(NaN)).toBeNull()
  })

  it('月度、分类、周度统计共用同一份按分索引，收入不混入支出', () => {
    const index = buildLedgerIndex([
      { id: 'a', name: '早餐', amount: 0.1, cat: 'food', date: '2026-08-31', time: '08:00' },
      { id: 'b', name: '咖啡', amount: 0.2, cat: 'drink', date: '2026-09-01', time: '09:00' },
      { id: 'income', name: '工资', amount: 500, direction: 'income', cat: 'salary', date: '2026-09-01', time: '10:00' },
      { id: 'archived', name: '旧记录', amount: 99, date: '2026-09-01', archivedAt: '2026-09-02T00:00:00Z' },
      { id: 'invalid-date', name: '坏日期', amount: 99, date: '2026-02-31' },
    ])

    expect(ledgerPeriodStatsFromIndex(index, '2026-09-01')).toEqual({ monthTotal: 0.2, monthCount: 2, todayTotal: 0.2 })
    expect(ledgerMonthIncomeFromIndex(index, '2026-09-01')).toBe(500)
    expect(ledgerWeekTotalFromIndex(index, '2026-09-01')).toBe(0.3)
    expect(ledgerMonthCategoryTotalsFromIndex(index, '2026-09-01')).toEqual(new Map([['drink', 0.2]]))
    expect(sumLedgerAmounts([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
  })

  it('普通同额交易各自保留，1000+ 条记录索引不会因数据量失效', () => {
    const records = Array.from({ length: 1201 }, (_, index) => ({
      id: `tx-${index}`,
      name: index % 2 ? '午饭' : '咖啡',
      amount: 12.5,
      cat: index % 2 ? 'food' : 'drink',
      date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
      time: '12:00',
    }))
    const index = buildLedgerIndex(records)
    expect(index.sortedExpenses).toHaveLength(1201)
    expect(index.frequentEntries.find((item) => item.name === '午饭')).toMatchObject({ count: 600, amount: 12.5 })
  })

  it('同一天的历史记录会把非补零时间按真实时刻排序', () => {
    const index = buildLedgerIndex([
      { id: 'nine', name: '早餐', amount: 8, date: '2026-09-01', time: '9:5' },
      { id: 'ten', name: '咖啡', amount: 12, date: '2026-09-01', time: '10:00' },
    ])

    expect(index.sortedExpenses.map((item) => item.id)).toEqual(['ten', 'nine'])
  })

  it.each([100, 1000, 5000, 10000])('规模 %s 条时统计与搜索仍可完成', (size) => {
    const records = Array.from({ length: size }, (_, index) => ({
      id: `scale-${index}`, name: index % 2 ? '午饭' : '咖啡', amount: 12.5,
      cat: index % 2 ? 'food' : 'drink', account: index % 3 ? '微信' : '现金',
      date: `2026-09-${String((index % 28) + 1).padStart(2, '0')}`,
    }))
    const start = performance.now()
    const index = buildLedgerIndex(records)
    const filtered = filterLedgerTransactions(index.sortedExpenses, { query: '午饭', account: '微信' })
    expect(index.sortedExpenses).toHaveLength(size)
    expect(filtered.length).toBeGreaterThan(0)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('完整校验可识别脏记录，但不删除历史数据', () => {
    expect(transactionIntegrityIssues({ id: 'broken', name: '旧记录', amount: 3, cat: 'missing', date: '2026-02-31' }, {
      categories: [{ key: 'food' }],
    })).toEqual(expect.arrayContaining(['date', 'category']))
    expect(transactionIntegrityIssues({ id: 'ok', name: '旧记录', amount: 3, date: '2026-02-28' })).toEqual([])
  })
})

describe('账本领域命令与固定账单', () => {
  it('交易创建/更新统一归一化金额，空名称有安全默认值', () => {
    const created = domain.createTransaction({ id: 'tx-boundary', amount: '¥0.10', date: '2026-09-01' })
    expect(created).toMatchObject({ id: 'tx-boundary', amount: 0.1, name: '日常支出', direction: 'expense' })
    expect(() => domain.createTransaction({ amount: '1.234', date: '2026-09-01' })).toThrow()

    const updated = domain.updateTransaction(created.id, { amount: 0.2, name: '', direction: 'income', date: '2026-09-02' })
    expect(updated).toMatchObject({ id: created.id, amount: 0.2, name: '收入', direction: 'income', date: '2026-09-02' })
    expect(domain.transactions.value).toHaveLength(1)
  })

  it('交易写入时规范时间，并拒绝无法排序的时间', () => {
    const created = domain.createTransaction({ id: 'tx-time', name: '早餐', amount: 8, date: '2026-09-01', time: '9:5' })
    expect(created.time).toBe('09:05')

    const updated = domain.updateTransaction(created.id, { time: '7:03' })
    expect(updated.time).toBe('07:03')
    expect(() => domain.createTransaction({ name: '错误时间', amount: 1, date: '2026-09-01', time: '24:00' })).toThrow('时间格式不正确')
  })

  it('同一账单周期重复支付幂等，跨月日期按日历推进且历史金额冻结', () => {
    const bill = domain.createBill({ id: 'bill-final', name: '会员', amount: '39.00', cycle: 'monthly', nextDate: '2099-01-31' })
    expect(buildLedgerIndex(domain.transactions.value).frequentEntries).toEqual([])
    const first = domain.payBill(bill.id)
    expect(first).toMatchObject({ duplicate: false, transaction: { amount: 39, billingPeriodKey: '2099-01-31', billId: bill.id } })
    expect(sumLedgerAmounts(domain.transactions.value)).toBe(39)
    expect(bill.nextDate).toBe('2099-02-28')

    bill.nextDate = '2099-01-31'
    const duplicate = domain.payBill(bill.id)
    expect(duplicate).toMatchObject({ duplicate: true, transaction: { id: first.transaction.id } })
    expect(domain.transactions.value).toHaveLength(1)

    domain.updateBill(bill.id, { amount: 99 })
    expect(domain.transactions.value[0].amount).toBe(39)
  })

  it('撤销固定账单只能处理没有后续支付的最新账期', () => {
    const bill = domain.createBill({ id: 'bill-order', name: '会员', amount: 39, cycle: 'monthly', nextDate: '2099-01-31' })
    const first = domain.payBill(bill.id)
    const second = domain.payBill(bill.id)
    const nextDateBeforeUndo = bill.nextDate

    const blocked = domain.undoBillPayment(first.transaction.id)

    expect(blocked).toMatchObject({ blocked: true })
    expect(bill.nextDate).toBe(nextDateBeforeUndo)
    expect(domain.transactions.value.map((item) => item.billingPeriodKey)).toEqual([
      first.transaction.billingPeriodKey,
      second.transaction.billingPeriodKey,
    ])
  })

  it('暂停或归档账单不能支付或跳过周期', () => {
    const bill = domain.createBill({ id: 'bill-paused', name: '会员', amount: 39, cycle: 'monthly', nextDate: '2099-01-31', active: false })
    const nextDateBefore = bill.nextDate

    expect(domain.payBill(bill.id)).toMatchObject({ blocked: true })
    expect(domain.skipBill(bill.id)).toMatchObject({ blocked: true })
    expect(bill.nextDate).toBe(nextDateBefore)
    expect(domain.transactions.value).toHaveLength(0)
  })
})

describe('QuickRecord 账本输入', () => {
  it.each([
    ['买牛肉面花了5元', 5, '牛肉面'],
    ['花了5元买牛肉面', 5, '牛肉面'],
    ['牛肉面5块', 5, '牛肉面'],
    ['早餐 8 元', 8, '早餐'],
    ['打车花了18.5', 18.5, '打车'],
    ['今天买书花了46', 46, '买书'],
    ['昨天午饭20元', 20, '午饭'],
    ['微信支付12元买咖啡', 12, '咖啡'],
    ['收到兼职工资500元', 500, '收到兼职工资'],
  ])('识别常见金额语序：%s', (text, amount, title) => {
    const [draft] = parseQuickRecord(text, { now: new Date('2026-09-05T10:00:00') })
    expect(draft).toMatchObject({ type: text.includes('兼职') ? 'income' : 'expense', amount, title })
  })

  it('金额不完整不直接入账，并保留原文作为可解释降级出口', () => {
    const [draft] = parseQuickRecord('牛肉面1.234元')
    expect(draft).toMatchObject({ type: 'unknown', uncertain: true, amount: 0, note: '牛肉面1.234元' })
  })

  it('周期账单保留干净的账单名称，不把周期日期混进历史交易标题', () => {
    const [draft] = parseQuickRecord('每月15号39元话费', { now: new Date('2026-09-05T10:00:00') })
    expect(draft).toMatchObject({ type: 'bill', amount: 39, title: '话费', cycle: 'monthly' })
  })
})

describe('账本搜索筛选与本地偏好隔离', () => {
  const records = [
    { id: 'food', name: '午饭', note: '微信支付', amount: 18, cat: 'food', account: '微信', direction: 'expense', source: 'manual', date: '2026-09-05' },
    { id: 'income', name: '工资', amount: 500, cat: 'salary', account: '银行卡', direction: 'income', source: 'manual', date: '2026-09-05' },
    { id: 'bill', name: '话费', amount: 39, cat: 'communication', account: '支付宝', direction: 'expense', source: 'bill', date: '2026-09-01' },
  ]

  it('搜索、分类、方向、来源、金额和日期范围可组合', () => {
    expect(filterLedgerTransactions(records, { query: '微信' }).map((item) => item.id)).toEqual(['food'])
    expect(filterLedgerTransactions(records, { direction: 'income' }).map((item) => item.id)).toEqual(['income'])
    expect(filterLedgerTransactions(records, { kind: 'bill' }).map((item) => item.id)).toEqual(['bill'])
    expect(filterLedgerTransactions(records, { category: 'food', account: '微信', min: '10', max: '20' }).map((item) => item.id)).toEqual(['food'])
    expect(filterLedgerTransactions(records, { dateFilter: (date) => date === '2026-09-05' }).map((item) => item.id)).toEqual(['food', 'income'])
  })

  it('快捷时间范围使用日历日期，当前月与跨周边界明确', () => {
    expect(isDateInLedgerRange('2026-09-05', 'month', { today: '2026-09-05' })).toBe(true)
    expect(isDateInLedgerRange('2026-08-31', 'month', { today: '2026-09-05' })).toBe(false)
    expect(isDateInLedgerRange('2026-08-31', 'week', { today: '2026-09-05' })).toBe(true)
    expect(isDateInLedgerRange('2026-09-06', 'week', { today: '2026-09-05' })).toBe(true)
    expect(isDateInLedgerRange('2026-09-07', 'week', { today: '2026-09-05' })).toBe(false)
  })

  it('分类隐藏和默认账户变更不改写既有交易，偏好也不写入交易集合', () => {
    const previousCategories = ledgerCategories.value
    const previousSettings = settings.value
    const previousPrefs = freqPrefs.value
    ledgerCategories.value = normalizeLedgerCategories([...previousCategories, { key: 'custom-study', name: '自定义学习', icon: '📖', scope: 'expense' }])
    const transaction = domain.createTransaction({ id: 'tx-relation', name: '自定义学习', amount: 6, cat: 'custom-study', account: '现金', date: '2026-09-05' })
    const before = JSON.stringify(domain.transactions.value)

    rememberCategoryOverride('自定义学习', 'custom-study')
    ledgerCategories.value = ledgerCategories.value.map((item) => item.key === 'custom-study' ? { ...item, hidden: true } : item)
    settings.value = { ...settings.value, defaultAccount: '微信' }

    expect(JSON.stringify(domain.transactions.value)).toBe(before)
    expect(transaction).toMatchObject({ cat: 'custom-study', account: '现金' })
    expect(domain.createTransaction({ id: 'tx-new-account', name: '新记录', amount: 1, date: '2026-09-05' }).account).toBe('微信')

    ledgerCategories.value = previousCategories
    settings.value = previousSettings
    freqPrefs.value = previousPrefs
  })
})

describe('账本配置时区边界', () => {
  it('跨 UTC 日期边界时，日期、时间和反向时间戳保持同一配置时区', () => {
    expect(policyDateKey(new Date('2026-08-31T15:30:00.000Z'), 'Asia/Shanghai')).toBe('2026-08-31')
    expect(policyDateKey(new Date('2026-08-31T16:30:00.000Z'), 'Asia/Shanghai')).toBe('2026-09-01')
    const beforeMidnight = new Date('2026-09-01T15:59:59.999Z')
    const afterMidnight = new Date('2026-09-01T16:00:00.000Z')
    expect(policyDateKey(beforeMidnight, 'Asia/Shanghai')).toBe('2026-09-01')
    expect(policyDateKey(afterMidnight, 'Asia/Shanghai')).toBe('2026-09-02')
    const instant = policyDateTime('2026-09-02', '00:00', 'Asia/Shanghai')
    expect(instant).toBe(new Date('2026-09-01T16:00:00.000Z').getTime())
    expect(policyDateKey(new Date(instant), 'Asia/Shanghai')).toBe('2026-09-02')
    expect(policyDateKey(new Date('2026-03-08T06:59:59.000Z'), 'America/New_York')).toBe('2026-03-08')
    expect(policyDateKey(new Date('2026-03-08T07:00:00.000Z'), 'America/New_York')).toBe('2026-03-08')
    expect(policyDateKey(new Date('2026-11-01T05:59:59.000Z'), 'America/New_York')).toBe('2026-11-01')
    expect(policyDateKey(new Date('2026-11-01T06:00:00.000Z'), 'America/New_York')).toBe('2026-11-01')
  })
})
