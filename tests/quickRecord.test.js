// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseQuickRecord } from '../src/composables/quickRecord/parser.js'

describe('quickRecord.parser', () => {
  it('识别作业、课程、截止时间和优先级', () => {
    const [draft] = parseQuickRecord('周五18点交高数第三章作业，重要', { courses: [{ id: 'c1', name: '高数' }], now: new Date('2026-08-29T10:00:00') })
    expect(draft.type).toBe('homework')
    expect(draft.course).toBe('高数')
    expect(draft.time).toBe('18:00')
  })

  it('识别收入、金额和支付账户', () => {
    const [draft] = parseQuickRecord('生活费到账500微信')
    expect(draft.type).toBe('income')
    expect(draft.amount).toBe(500)
    expect(draft.account).toBe('微信')
  })

  it('按换行批量识别多笔支出', () => {
    const drafts = parseQuickRecord('早餐6\n公交2\n午饭18\n奶茶9')
    expect(drafts).toHaveLength(4)
    expect(drafts.every((draft) => draft.type === 'expense')).toBe(true)
    expect(drafts.reduce((total, draft) => total + draft.amount, 0)).toBe(35)
  })

  it('识别周期账单', () => {
    const [draft] = parseQuickRecord('每月15号39元话费')
    expect(draft.type).toBe('bill')
    expect(draft.amount).toBe(39)
    expect(draft.cycle).toBe('monthly')
  })

  it('没有日期的普通记录仍可成为待办', () => {
    const [draft] = parseQuickRecord('买洗衣液')
    expect(draft.type).toBe('todo')
    expect(draft.date).toBe('')
  })
})
