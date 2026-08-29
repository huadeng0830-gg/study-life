// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { daySnapshot, dayStory, monthReport, yearReport } from '../src/composables/retrospective.js'

const data = {
  courses: [
    { id: 'c1', name: '高等数学', day: 4, start: 'p1', end: 'p2', room: 'A101', startWeek: 1, endWeek: 25, weekType: 'all' },
  ],
  tasks: [
    { id: 't1', title: '交高数作业', dueDate: '2026-08-28', done: true, estimateMinutes: 30, courseId: 'c1' },
    { id: 't2', title: '背单词', dueDate: '2026-08-28', done: false, estimateMinutes: 15 },
  ],
  exams: [{ id: 'e1', name: '期中考试', date: '2026-08-28' }],
  bills: [{ id: 'b1', name: '话费', amount: 39, nextDate: '2026-08-28' }],
  expenses: [
    { id: 'x1', name: '午饭', amount: 18, date: '2026-08-28' },
    { id: 'x2', name: '地铁', amount: 3, date: '2026-08-27' },
  ],
  moodLog: { '2026-08-28': '😊' },
}

describe('retrospective.js', () => {
  it('daySnapshot 聚合某天的待办/考试/账单/消费统计', () => {
    const snap = daySnapshot('2026-08-28', data)
    expect(snap.tasks.map((task) => task.id)).toEqual(['t1', 't2'])
    expect(snap.exams).toHaveLength(1)
    expect(snap.bills).toHaveLength(1)
    expect(snap.expenses.map((expense) => expense.id)).toEqual(['x1'])
    expect(snap.stats.tasks).toBe(2)
    expect(snap.stats.tasksDone).toBe(1)
    expect(snap.stats.taskRate).toBe(50)
    expect(snap.stats.expensesTotal).toBe(18)
    expect(snap.stats.focusMinutes).toBe(45)
  })

  it('dayStory 生成标题与 p/stat/list blocks', () => {
    const story = dayStory('2026-08-28', data)
    expect(story.title).toContain('那天')
    expect(story.blocks.some((block) => block.type === 'p')).toBe(true)
    expect(story.blocks.some((block) => block.type === 'stat')).toBe(true)
    const list = story.blocks.find((block) => block.type === 'list' && block.title === '当天待办')
    expect(list.items).toContain('交高数作业（已完成）')
  })

  it('monthReport 汇总月度完成度与支出，含情绪叙事', () => {
    const report = monthReport('2026-08', data)
    expect(report.title).toContain('月度回顾')
    const stat = report.blocks.find((block) => block.type === 'stat')
    expect(stat.items.find((item) => item.label === '待办完成').value).toBe('1/2')
    expect(stat.items.find((item) => item.label === '支出').value).toBe('¥21.00')
    expect(report.blocks.some((block) => block.type === 'p' && block.text.includes('晴朗'))).toBe(true)
  })

  it('yearReport 汇总年度完成度与支出', () => {
    const report = yearReport('2026', data)
    expect(report.title).toContain('年度回顾')
    const stat = report.blocks.find((block) => block.type === 'stat')
    expect(stat.items.find((item) => item.label === '待办完成').value).toBe('1/2')
    expect(stat.items.find((item) => item.label === '全年支出').value).toBe('¥21.00')
  })

  it('只读数据：生成的报告不返回历史数据引用之外的新结构', () => {
    const report = yearReport('2026', data)
    expect(Array.isArray(report.blocks)).toBe(true)
    expect(data.tasks).toHaveLength(2)
  })
})