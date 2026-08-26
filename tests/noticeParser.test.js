import { describe, expect, it } from 'vitest'
import { findNoticeChanges, parseNotice } from '../src/composables/noticeParser.js'

function dateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

describe('parseNotice', () => {
  it('解析相对日期与中文时间', () => {
    const result = parseNotice('明天下午三点前提交实验报告，文件名为学号姓名。')
    expect(result.dueDate).toBe(dateStr(1))
    expect(result.dueTime).toBe('15:00')
    expect(result.title).toContain('实验报告')
    expect(result.note).toContain('文件名为学号姓名')
    expect(result.priority).toBe('normal')
  })

  it('解析数字日期与 24 小时时间', () => {
    const result = parseNotice('请于2026-09-01 08:30前上交表格')
    expect(result.dueDate).toBe('2026-09-01')
    expect(result.dueTime).toBe('08:30')
  })

  it("识别'下周一'为下周的星期一", () => {
    const result = parseNotice('下周一交作业')
    const target = new Date(result.dueDate + 'T00:00:00')
    const now = new Date()
    const currentFromMonday = (now.getDay() + 6) % 7
    const targetFromMonday = (target.getDay() + 6) % 7
    expect(target > now).toBe(true)
    expect((targetFromMonday - currentFromMonday + 7) % 7 === 0 || targetFromMonday === 0).toBe(true)
  })

  it('匹配到课程名时回填课程字段', () => {
    const courses = [{ id: 'c1', name: '高等数学' }]
    const result = parseNotice('高等数学：周五提交第一次作业', courses)
    expect(result.course).toBe('高等数学')
  })

  it('包含紧急字样时提升优先级', () => {
    const result = parseNotice('今晚十点前务必完成报名，逾期视为放弃')
    expect(result.priority).toBe('high')
  })

  it('空输入返回默认结构', () => {
    const result = parseNotice('')
    expect(result.title).toBe('待处理通知')
    expect(result.dueDate).toBe('')
  })
})

describe('findNoticeChanges', () => {
  it('同一通知能匹配到已有待办', () => {
    const parsed = parseNotice('明天下午五点前提交实验报告')
    const tasks = [
      { id: 't1', title: '提交实验报告', dueDate: '', dueTime: '', course: '', sourceText: '明天下午五点前提交实验报告' },
      { id: 't2', title: '买水果', dueDate: '', dueTime: '', course: '' },
    ]
    const matches = findNoticeChanges(parsed, tasks)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].task.id).toBe('t1')
  })

  it('完全无关的待办不会被误匹配', () => {
    const parsed = parseNotice('后天中午十二点前缴纳班费')
    const matches = findNoticeChanges(parsed, [
      { id: 't1', title: '图书馆借书', dueDate: '', dueTime: '', course: '' },
    ])
    expect(matches).toHaveLength(0)
  })
})
