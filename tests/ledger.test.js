// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildLedgerIndex,
  classifyTransaction,
  commonCategories,
  computeFrequent,
  computeFrequentFromIndex,
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  ledgerPeriodStatsFromIndex,
} from '../src/composables/ledger.js'
import { normalizeLedgerCategories } from '../src/composables/ledgerCategories.js'

const NOW = new Date('2026-08-28T12:00:00').getTime()

describe('ledger index', () => {
  it('保持原有的日期时间排序，并复用原记录对象', () => {
    const early = { id: 'early', name: '早餐', amount: 8, date: '2026-08-27', time: '08:00' }
    const latest = { id: 'latest', name: '午餐', amount: 18, date: '2026-08-28', time: '12:00' }
    const laterSameDay = { id: 'later', name: '晚餐', amount: 22, date: '2026-08-27', time: '19:00' }

    const index = buildLedgerIndex([early, latest, laterSameDay])

    expect(index.sortedExpenses.map((item) => item.id)).toEqual(['latest', 'later', 'early'])
    expect(index.sortedExpenses[0]).toBe(latest)
    expect(index.sortedExpenses[0]).not.toHaveProperty('showDay')
  })

  it('从同一次索引构建中读取月度、当日统计', () => {
    const index = buildLedgerIndex([
      { id: 'a', name: 'A', amount: 10, date: '2026-08-28', time: '08:00' },
      { id: 'b', name: 'B', amount: 12.5, date: '2026-08-28', time: '09:00' },
      { id: 'c', name: 'C', amount: 20, date: '2026-08-01', time: '10:00' },
      { id: 'd', name: 'D', amount: 99, date: '2026-07-31', time: '10:00' },
    ])

    expect(ledgerPeriodStatsFromIndex(index, '2026-08-28')).toEqual({
      monthTotal: 42.5,
      monthCount: 3,
      todayTotal: 22.5,
    })
  })

  it('索引版常记与原有推导的顺序和内容一致', () => {
    const records = [
      { id: 'a1', name: '咖啡', amount: 12, cat: 'food', date: '2026-08-20', time: '09:00', createdAt: '2026-08-20T09:00:00' },
      { id: 'a2', name: '咖啡', amount: 15, cat: 'food', date: '2026-08-27', time: '09:00', createdAt: '2026-08-27T09:00:00' },
      { id: 'b1', name: '地铁', amount: 3, cat: 'transit', date: '2026-08-28', time: '08:00', createdAt: '2026-08-28T08:00:00' },
      { id: 'c1', name: '打印', amount: 2, cat: 'study', date: '2026-08-21', time: '10:00', createdAt: '2026-08-21T10:00:00' },
      { id: 'c2', name: '打印', amount: 4, cat: 'study', date: '2026-08-22', time: '10:00', createdAt: '2026-08-22T10:00:00' },
    ]
    const prefs = { pinned: ['地铁'], hidden: ['打印'] }
    const index = buildLedgerIndex(records)

    const indexed = computeFrequentFromIndex(index, prefs, 6, NOW)
    expect(indexed).toEqual(computeFrequent(records, prefs, 6, NOW))
    expect(indexed.map(({ name, amount, cat, count }) => ({ name, amount, cat, count }))).toEqual([
      { name: '地铁', amount: 3, cat: 'transit', count: 1 },
      { name: '咖啡', amount: 15, cat: 'food', count: 2 },
    ])
  })

  it('旧备份中的残缺记录不会拖垮账本索引或污染日期统计', () => {
    const index = buildLedgerIndex([
      { id: 'ok', name: '午饭', amount: 18, date: '2026-08-28', time: '12:00' },
      { id: 'missing-date', name: '旧记录', amount: 9 },
      null,
    ])
    expect(index.sortedExpenses.map((item) => item?.id)).toEqual(['ok', 'missing-date', undefined])
    expect(ledgerPeriodStatsFromIndex(index, '2026-08-28')).toMatchObject({
      monthTotal: 18,
      monthCount: 1,
      todayTotal: 18,
    })
  })
})

describe('ledger category system', () => {
  it('默认分类使用稳定 ID，并把收入与支出分开', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES.map((item) => item.key)).toContain('drink')
    expect(DEFAULT_EXPENSE_CATEGORIES.map((item) => item.key)).toContain('bathing')
    expect(DEFAULT_INCOME_CATEGORIES.map((item) => item.key)).toEqual(expect.arrayContaining(['salary', 'part-time', 'scholarship', 'allowance', 'refund']))
    expect(DEFAULT_EXPENSE_CATEGORIES.every((item) => item.scope === 'expense')).toBe(true)
    expect(DEFAULT_INCOME_CATEGORIES.every((item) => item.scope === 'income')).toBe(true)
    expect(DEFAULT_CATEGORIES.some((item) => item.key === 'food' && item.name === '餐饮')).toBe(true)
    expect(commonCategories('expense')).toHaveLength(8)
    expect(commonCategories('income').every((item) => item.scope === 'income')).toBe(true)
  })

  it.each([
    ['买牛肉面花了5元', 'food'],
    ['花了5元买牛肉面', 'food'],
    ['外卖20元', 'food'],
    ['奶茶12元', 'drink'],
    ['买咖啡18', 'drink'],
    ['可乐3元', 'drink'],
    ['买薯片6元', 'snack'],
    ['地铁4元', 'transit'],
    ['滴滴打车26元', 'transit'],
    ['买洗衣液28元', 'daily-supplies'],
    ['买数据线19元', 'digital'],
    ['打印论文12元', 'study'],
    ['买书本35元', 'study'],
    ['理发35元', 'daily-service'],
    ['校园网20元', 'utilities'],
    ['iCloud 6元', 'sub'],
    ['洗浴20元', 'bathing'],
    ['沐浴露28元', 'daily-supplies'],
  ])('自然语言“%s”归入 %s', (text, expected) => {
    expect(classifyTransaction(text).categoryId).toBe(expected)
  })

  it('复合语句、平台词和收入词遵守优先级', () => {
    expect(classifyTransaction('午饭加可乐一共25元').categoryId).toBe('food')
    expect(classifyTransaction('美团买奶茶12元').categoryId).toBe('drink')
    expect(classifyTransaction('淘宝买洗衣液30元').categoryId).toBe('daily-supplies')
    expect(classifyTransaction('京东买耳机199元').categoryId).toBe('digital')
    expect(classifyTransaction('便利店买矿泉水和纸巾20元')).toMatchObject({
      categoryId: 'daily-supplies', uncertain: true, ambiguous: true,
    })
    expect(classifyTransaction('兼职赚了200元', { direction: 'income' }).categoryId).toBe('part-time')
    expect(classifyTransaction('收到生活费500元', { direction: 'income' }).categoryId).toBe('allowance')
    expect(classifyTransaction('淘宝退款39元', { direction: 'income' }).categoryId).toBe('refund')
    expect(classifyTransaction('奖学金1000', { direction: 'income' }).categoryId).toBe('scholarship')
  })

  it('用户覆盖优先于系统规则，旧分类只补充新定义不改 ID', () => {
    expect(classifyTransaction('京东买洗衣液30元', {
      overrides: [{ term: '洗衣液', key: 'custom-cleaning', direction: 'expense' }],
    })).toMatchObject({ categoryId: 'custom-cleaning', matchedBy: 'user', confidence: 0.99 })

    const migrated = normalizeLedgerCategories([
      { key: 'food', name: '餐饮', icon: '🍜', hidden: false },
      { key: 'transit', name: '出行', icon: '🚇', hidden: false },
      { key: 'life', name: '生活', icon: '🏠', hidden: false },
      { key: 'other', name: '其他', icon: '📦', hidden: false },
    ])
    expect(migrated.find((item) => item.key === 'transit')).toMatchObject({ key: 'transit', name: '交通' })
    expect(migrated.find((item) => item.key === 'life')).toMatchObject({ key: 'life', name: '生活', hidden: true, legacy: true })
    expect(migrated.find((item) => item.key === 'drink')).toBeTruthy()
    expect(migrated.find((item) => item.key === 'bathing')).toBeTruthy()
  })
})
