// @vitest-environment happy-dom
/**
 * 账本第二批守卫：账单周期推进 / 预算节奏 / 收入与结余 / 导出范围。
 *
 * 【为什么要单独一个文件】第一批是「金额算错」，这一批是「算对了但语义不对」或
 * 「功能缺失」。两者容易混在一起，但修法不同：前者改判据，后者补字段与分支。
 * 每条仍然写明「修之前会红成什么样」，便于变异复核。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { budgetStatus, budgetPaceText, budgetAlertText, BUDGET_NEAR_RATIO } from '../src/composables/ledgerBudget.js'
import { buildLedgerMonthReview } from '../src/composables/ledger.js'
import { personalSpendTotals, buildSplit } from '../src/composables/ledgerSplit.js'

const tx = (over = {}) => ({
  id: 't1', name: '午饭', amount: 18.5, cat: 'food',
  date: '2026-09-01', time: '12:00', direction: 'expense',
  createdAt: '2026-09-01T04:00:00.000Z', updatedAt: '2026-09-01T04:00:00.000Z', ...over,
})

describe('固定账单：日期推进不得不可逆漂移（真缺陷）', () => {
  let domain
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    const mod = await import('../src/composables/domain/commands.js')
    domain = useDomainCommands(mod)
  })

  /**
   * `skipBill` 会调用 `nextBillDate`，而后者有一个 `while (next <= today)` 把日期
   * 推到**未来**（今天 = 2026-10-01）。所以断言不能写死「2026-02-28」——
   * 那会把「跳到下一期」和「跳到未来」两件事混在一起。
   * 这里改成**只断言不变量**：日号必须是 31，而不是 28。
   */
  it('31 号账单经过 2 月后仍回到 31 号（修之前永久停在 28）', () => {
    const bill = domain.createBill({ name: '房租', amount: 800, cycle: 'monthly', nextDate: '2026-01-31' })
    const target = domain.bills.value.find((b) => b.id === bill.id)
    domain.skipBill(bill.id)
    // 关键不变量：日号仍是 31。修复前 2 月被压成 28 之后，28 成为新基准，
    // 于是这一跳就变成 28 号，并且永久停在 28。
    expect(target.nextDate.slice(8)).toBe('31')
  })

  it('非月末日期的日号始终不变（判别力：不能把所有账单都推到月末）', () => {
    const bill = domain.createBill({ name: '话费', amount: 50, cycle: 'monthly', nextDate: '2026-01-15' })
    const target = domain.bills.value.find((b) => b.id === bill.id)
    domain.skipBill(bill.id)
    expect(target.nextDate.slice(8)).toBe('15')
  })

  it('闰年 2 月：2028-02-29 推进到 2 月且日号不越界', () => {
    const bill = domain.createBill({ name: '年费', amount: 100, cycle: 'yearly', nextDate: '2028-02-29' })
    const target = domain.bills.value.find((b) => b.id === bill.id)
    domain.skipBill(bill.id)
    const [, month, day] = target.nextDate.split('-')
    // 2029 不是闰年：推进结果必须是一个合法日期，且落在 2 月
    expect(month).toBe('02')
    expect(Number(day)).toBeLessThanOrEqual(29)
  })

  it('非法 nextDate 不再抛 RangeError（修之前 toISOString() 会炸）', () => {
    const bill = domain.createBill({ name: '坏数据', amount: 10, cycle: 'monthly', nextDate: '2026-01-31' })
    const target = domain.bills.value.find((b) => b.id === bill.id)
    target.nextDate = '坏数据'
    expect(() => domain.skipBill(bill.id)).not.toThrow()
  })
})

describe('固定账单：once 与 autoRenew 不再是死字段', () => {
  let domain
  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    const mod = await import('../src/composables/domain/commands.js')
    domain = useDomainCommands(mod)
  })

  it('autoRenew: false 时不再把日期一路推到今天之后', () => {
    const bill = domain.createBill({ name: '一次性会员', amount: 68, cycle: 'monthly', nextDate: '2026-01-31', autoRenew: false })
    const target = domain.bills.value.find((b) => b.id === bill.id)
    // 修之前 autoRenew 是死字段：`while (next <= today)` 把它推到 2026-10。
    // 现在只推进一期，静默跳过的期数也不再发生。
    domain.skipBill(bill.id)
    expect(target.nextDate).toBe('2026-02-28')
    // 再跳一次仍按账单原始锚点顺延（手动跳过是一次性的，不该被开关锁死）
    domain.skipBill(bill.id)
    expect(target.nextDate).toBe('2026-03-31')
  })

  it('once 周期原地不动（判别力）', () => {
    const bill = domain.createBill({ name: '仅一次', amount: 100, cycle: 'once', nextDate: '2026-01-31' })
    const target = domain.bills.value.find((b) => b.id === bill.id)
    domain.skipBill(bill.id)
    expect(target.nextDate).toBe('2026-01-31')
  })

  it('autoRenew 默认开启时照常推进（判别力：不能把推进整个停掉）', () => {
    const bill = domain.createBill({ name: '房租', amount: 800, cycle: 'monthly', nextDate: '2026-01-31' })
    const target = domain.bills.value.find((b) => b.id === bill.id)
    expect(target.autoRenew).toBe(true)
    domain.skipBill(bill.id)
    const first = target.nextDate
    domain.skipBill(bill.id)
    // 两次跳过必须真的往前走了（否则说明开关把推进整个停死了）
    expect(target.nextDate > first).toBe(true)
  })
})

describe('收入与结余：回顾层与分摊层都必须给得出（真缺失）', () => {
  it('buildLedgerMonthReview 给出 incomeTotal / balance', () => {
    const review = buildLedgerMonthReview([
      tx({ id: 'a', amount: 200, direction: 'expense' }),
      tx({ id: 'b', amount: 50, direction: 'income', cat: 'salary' }),
    ], '2026-09')
    // 修之前 income 被整个 continue 掉，incomeTotal 是 undefined
    expect(review.incomeTotal).toBe(50)
    expect(review.total).toBe(200)
    expect(review.balance).toBe(-150)
  })

  it('退款计入 balance：收入 0、支出 100、退款 40 → 结余 −60', () => {
    const review = buildLedgerMonthReview([
      tx({ id: 'a', amount: 100, direction: 'expense' }),
      tx({ id: 'r', amount: 40, direction: 'refund', refundOf: 'a' }),
    ], '2026-09')
    expect(review.total).toBe(60)
    expect(review.incomeTotal).toBe(0)
    expect(review.balance).toBe(-60)
  })

  it('分摊支出的收入/结余走「我承担」口径', () => {
    const review = buildLedgerMonthReview([
      tx({ id: 'a', amount: 100, cat: 'food', split: buildSplit(100, { count: 2, mine: 60 }) }),
    ], '2026-09', { amountOf: (item) => (item.split ? Math.round(item.split.mine * 100) : Math.round(item.amount * 100)) })
    expect(review.total).toBe(60)
  })

  it('personalSpendTotals 也给 balance（口径与回顾一致）', () => {
    const totals = personalSpendTotals([
      tx({ id: 'a', amount: 200 }),
      tx({ id: 'b', amount: 50, direction: 'income' }),
    ])
    expect(totals.incomeTotal).toBe(50)
    expect(totals.balance).toBe(-150)
  })

  it('收入不进分类分布（判别力：不能把收入也算成"花在哪"）', () => {
    const review = buildLedgerMonthReview([
      tx({ id: 'a', amount: 200, cat: 'food' }),
      tx({ id: 'b', amount: 999, cat: 'salary', direction: 'income' }),
    ], '2026-09')
    expect(review.categoryTotals.every((c) => c.key !== 'salary')).toBe(true)
  })

  it('回顾页必须报告币种混用（否则合计是无意义的直加）', () => {
    const single = buildLedgerMonthReview([tx({ id: 'a', amount: 10 })], '2026-09')
    expect(single.currencyCount).toBe(0)
    expect(single.hasForeignCurrency).toBe(false)
    const mixed = buildLedgerMonthReview([
      tx({ id: 'a', amount: 10 }),
      tx({ id: 'b', amount: 5, currency: 'USD' }),
    ], '2026-09')
    expect(mixed.currencyCount).toBe(1)
    expect(mixed.hasForeignCurrency).toBe(true)
  })
})

describe('预算节奏：「今天还能花多少」（新增功能）', () => {
  it('按当月真实天数摊，不是 1/30', () => {
    // 2026-09 有 30 天；10 号时已过 10 天、含今天还剩 21 天
    const s = budgetStatus({ spent: 100, budget: 1000, today: '2026-09-10' })
    expect(s.pacing.daysInMonth).toBe(30)
    expect(s.pacing.daysPassed).toBe(10)
    expect(s.pacing.daysLeft).toBe(21)
    expect(s.pacing.daysAfterToday).toBe(20)
    expect(s.pacing.dailyAllowance).toBe(42.85)
    expect(s.pacing.dailySpent).toBeCloseTo(100 / 10, 2)
  })

  it('今日额度单独预留，后续日均不再把今天算进天数或重复计算今日余额', () => {
    const todayUnderLimit = budgetStatus({
      spent: 950, todaySpent: 50, budget: 3000, today: '2026-09-10',
    })
    expect(todayUnderLimit.pacing.daysAfterToday).toBe(20)
    expect(todayUnderLimit.pacing.todayAllowance).toBe(100)
    expect(todayUnderLimit.pacing.todayRemaining).toBe(50)
    expect(todayUnderLimit.pacing.futureDailyAllowance).toBe(100)
    expect(todayUnderLimit.remaining).toBeCloseTo(
      todayUnderLimit.pacing.todayRemaining + todayUnderLimit.pacing.futureDailyAllowance * todayUnderLimit.pacing.daysAfterToday,
      2,
    )

    const moreTodaySpend = budgetStatus({
      spent: 980, todaySpent: 80, budget: 3000, today: '2026-09-10',
    })
    expect(moreTodaySpend.pacing.todayRemaining).toBe(20)
    expect(moreTodaySpend.pacing.futureDailyAllowance).toBe(100)

    const exceededTodayLimit = budgetStatus({
      spent: 1010, todaySpent: 110, budget: 3000, today: '2026-09-10',
    })
    expect(exceededTodayLimit.pacing.todayRemaining).toBe(-10)
    expect(exceededTodayLimit.pacing.futureDailyAllowance).toBe(99.5)
  })

  it('31 天的月份用 31 而不是 30（判别力）', () => {
    const s = budgetStatus({ spent: 0, budget: 3100, today: '2026-01-01' })
    expect(s.pacing.daysInMonth).toBe(31)
    expect(s.pacing.daysLeft).toBe(31)
    expect(s.pacing.daysAfterToday).toBe(30)
    expect(s.pacing.futureDailyAllowance).toBe(100)
  })

  it('月末今天仍单独显示今日额度，但后续没有日均额度可分', () => {
    const s = budgetStatus({ spent: 400, budget: 1000, today: '2026-09-30' })
    expect(s.pacing.daysLeft).toBe(1)
    expect(s.pacing.daysAfterToday).toBe(0)
    expect(s.pacing.futureDailyAllowance).toBe(null)
    expect(s.pacing.todayRemaining).toBe(600)
  })

  it('月度超支后，后续可用额度显示为 0，不继续给出负的可花金额', () => {
    const s = budgetStatus({ spent: 1200, budget: 1000, today: '2026-09-15' })
    expect(s.remaining).toBeLessThan(0)
    expect(s.pacing.futureDailyAllowance).toBe(0)
  })

  it('未设预算时 pacing 为 null，文案为空（不显示 0/0）', () => {
    const s = budgetStatus({ spent: 100, budget: null, today: '2026-09-10' })
    expect(s.set).toBe(false)
    expect(s.pacing).toBeNull()
    expect(budgetPaceText(s)).toBe('')
  })

  it('pace 文案与 alert 文案是两句话，触发条件不同', () => {
    const ok = budgetStatus({ spent: 100, budget: 1000, today: '2026-09-10' })
    expect(budgetPaceText(ok)).toContain('后续')
    expect(budgetPaceText(ok)).toContain('平均每天可用')
    expect(budgetAlertText(ok)).toContain('已用')
    // 超支时 alert 说超支，pace 不该同时出现
    const over = budgetStatus({ spent: 1200, budget: 1000, today: '2026-09-10' })
    expect(budgetAlertText(over)).toContain('超预算')
    expect(budgetPaceText(over)).toBe('')
  })

  it('三档阈值不受影响（判别力：不能把 80% 阈值改掉）', () => {
    expect(BUDGET_NEAR_RATIO).toBe(0.8)
    expect(budgetStatus({ spent: 799, budget: 1000, today: '2026-09-10' }).level).toBe('ok')
    expect(budgetStatus({ spent: 800, budget: 1000, today: '2026-09-10' }).level).toBe('near')
    expect(budgetStatus({ spent: 1001, budget: 1000, today: '2026-09-10' }).level).toBe('over')
  })
})
