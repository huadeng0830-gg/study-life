// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { capture } from '../src/composables/quickCapture.js'

describe('quickCapture.capture', () => {
  it('含金额模式 → 记账', () => {
    const result = capture('午饭 18')
    expect(result.kind).toBe('expense')
    expect(result.draft.name).toBe('午饭')
    expect(result.draft.amount).toBe('18')
    expect(result.draft.cat).toBe('food')
  })

  it('含日期且像节点 → 倒计时', () => {
    const result = capture('12月20日期末考试')
    expect(result.kind).toBe('countdown')
    expect(result.draft.name).toBeTruthy()
    expect(result.draft.date).toBeTruthy()
  })

  it('含日期但非节点关键字 → 待办并带解析出的截止时间', () => {
    const result = capture('明天下午三点前提交实验报告')
    expect(result.kind).toBe('task')
    expect(result.draft.dueDate).toBeTruthy()
    expect(result.draft.dueTime).toBe('15:00')
  })

  it('既无金额也无日期 → 普通待办', () => {
    const result = capture('买瓶牛奶')
    expect(result.kind).toBe('task')
    expect(result.draft.title).toContain('买')
    expect(result.draft.dueDate).toBe('')
  })

  it('空输入返回空待办草稿', () => {
    const result = capture('')
    expect(result.kind).toBe('task')
    expect(result.draft.title).toBe('')
  })
})