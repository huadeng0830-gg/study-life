// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildStudyAnswer, appendQuestionHistory } from '../src/composables/studyQuestion.js'
import { DEFAULT_CATEGORIES } from '../src/composables/ledgerCategories.js'

const now = new Date('2026-10-14T10:00:00.000Z')
const snapshot = () => ({
  tasks: [
    { id: 'task-overdue', title: '虚构实验报告', kind: 'homework', dueDate: '2026-10-10', course: '高数' },
    { id: 'task-due', title: '虚构高数习题', kind: 'homework', dueDate: '2026-10-19', courseId: 'course-math' },
    { id: 'task-later', title: '虚构后续任务', dueDate: '2026-10-21' },
    { id: 'task-done', title: '虚构已完成', dueDate: '2026-10-17', done: true },
  ],
  transactions: [
    { id: 'txn-oct-food', name: '虚构牛肉面', amount: 22, cat: 'food', date: '2026-10-02', direction: 'expense' },
    { id: 'txn-oct-food-2', name: '虚构食堂午饭', amount: 28, cat: 'food', date: '2026-10-03', direction: 'expense' },
    { id: 'txn-oct-drink', name: '虚构饮料', amount: 6, cat: 'drink', date: '2026-10-04', direction: 'expense' },
    { id: 'txn-sep-food', name: '虚构上月晚餐', amount: 20, cat: 'food', date: '2026-09-03', direction: 'expense' },
    { id: 'txn-today-food', name: '虚构当日早餐', amount: 12, cat: 'food', date: '2026-10-14', direction: 'expense' },
    { id: 'txn-today-drink', name: '虚构当日饮料', amount: 4, cat: 'drink', date: '2026-10-14', direction: 'expense' },
    { id: 'txn-today-income', name: '虚构兼职收入', amount: 100, cat: 'part-time', date: '2026-10-14', direction: 'income' },
  ],
  courses: [
    { id: 'course-math', name: '高数', day: 3, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20 },
  ],
  scheduleExceptions: [],
  focusSessions: [
    { id: 'focus-a', startedAt: '2026-10-13T08:00:00.000Z', endedAt: '2026-10-13T09:30:00.000Z', actualFocusSeconds: 5400, minutes: 90 },
    { id: 'focus-b', startedAt: '2026-10-10T08:00:00.000Z', endedAt: '2026-10-10T08:30:00.000Z', actualFocusSeconds: 1800, minutes: 30 },
    { id: 'focus-old', startedAt: '2026-10-01T08:00:00.000Z', actualFocusSeconds: 6000, minutes: 100 },
  ],
  ledgerCategories: DEFAULT_CATEGORIES,
})

describe('本机只读提问', () => {
  it('按截止日期找未完成任务并把逾期项单独分组', () => {
    const answer = buildStudyAnswer('下周一之前要交什么', snapshot(), now)
    expect(answer.intent).toBe('due-tasks')
    expect(answer.rows.map((row) => [row.id, row.group])).toEqual([
      ['task-overdue', '逾期'], ['task-due', '未截止'],
    ])
    expect(answer.trace).toMatchObject({ partition: 'sl_tasks', hitCount: 2 })
  })

  it('按分类汇总本月支出并给出上月对比和最大单笔', () => {
    const answer = buildStudyAnswer('这个月吃饭花了多少', snapshot(), now)
    expect(answer.intent).toBe('month-spend')
    expect(answer.answer).toContain('¥62.00')
    expect(answer.answer).toContain('上月 ¥20.00')
    expect(answer.answer).toContain('虚构食堂午饭 ¥28.00')
    expect(answer.trace.partition).toBe('sl_expenses')
  })

  it('按课程模糊关联只返回未完成任务', () => {
    const answer = buildStudyAnswer('高数还有哪些没做', snapshot(), now)
    expect(answer.intent).toBe('course-tasks')
    expect(answer.rows.map((row) => row.id)).toEqual(['task-overdue', 'task-due'])
  })

  it('明天课程查询应用已有课表日期与例外选择器', () => {
    const answer = buildStudyAnswer('明天有什么课', snapshot(), now)
    expect(answer.intent).toBe('classes')
    expect(answer.rows).toEqual([{ id: 'course-math', title: '高数', date: '2026-10-15', detail: 'p3–p4' }])
  })

  it('汇总当天支出并排除收入，展示分类前三', () => {
    const answer = buildStudyAnswer('今天花了多少钱', snapshot(), now)
    expect(answer.intent).toBe('today-spend')
    expect(answer.rows.map((row) => row.id)).toEqual(['txn-today-food', 'txn-today-drink'])
    expect(answer.answer).toContain('¥16.00，2 笔')
  })

  it('只汇总最近七天的实际专注时长', () => {
    const answer = buildStudyAnswer('最近专注了多少小时', snapshot(), now)
    expect(answer.intent).toBe('recent-focus')
    expect(answer.answer).toContain('2.0 小时，共 2 次')
    expect(answer.rows.map((row) => row.id)).toEqual(['focus-a', 'focus-b'])
  })

  it('问题无法识别时不猜答案，并提供三条示例', () => {
    const answer = buildStudyAnswer('帮我预订一家附近餐厅', snapshot(), now)
    expect(answer.understood).toBe(false)
    expect(answer.examples).toHaveLength(3)
  })

  it('查询不改变输入快照，历史只保留最近二十条', () => {
    const data = snapshot()
    const before = JSON.stringify(data)
    const storedBefore = Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index), localStorage.getItem(localStorage.key(index))]).sort(([a], [b]) => a.localeCompare(b))
    buildStudyAnswer('今天花了多少钱', data, now)
    expect(JSON.stringify(data)).toBe(before)
    const storedAfter = Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index), localStorage.getItem(localStorage.key(index))]).sort(([a], [b]) => a.localeCompare(b))
    expect(storedAfter).toEqual(storedBefore)
    expect(appendQuestionHistory(Array.from({ length: 20 }, (_, i) => ({ question: `旧问题 ${i}` })), { question: '新问题' })).toHaveLength(20)
  })
})
