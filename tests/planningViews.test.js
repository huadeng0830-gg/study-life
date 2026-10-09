import { beforeEach, describe, expect, it } from 'vitest'
import { filterTaskWorkspace, isValidPlanningDate, selectMilestoneWorkspace, taskWorkspaceSummary } from '../src/composables/planningViews.js'
import { settings } from '../src/composables/settingsPolicy.js'

const now = new Date('2026-10-09T09:00:00Z')
const tasks = [
  { id: 'today', title: '提交实验报告', courseId: 'c1', dueDate: '2026-10-09', priority: 'high', workCheckpoint: { nextStep: '核对数据' } },
  { id: 'late-today', title: '晨间练习', dueDate: '2026-10-09', dueTime: '08:00' },
  { id: 'overdue', title: '补交作业', dueDate: '2026-10-08', status: 'in_progress' },
  { id: 'week', title: '准备答辩', dueDate: '2026-10-15', priority: 'low' },
  { id: 'later', title: '整理资料', dueDate: '2026-10-16' },
  { id: 'unplanned', title: '阅读论文', note: '机器学习' },
  { id: 'done', title: '已完成练习', dueDate: '2026-10-09', done: true },
  { id: 'archived', title: '归档练习', dueDate: '2026-10-09', archivedAt: '2026-10-08' },
  { id: 'cancelled', title: '取消练习', dueDate: '2026-10-09', status: 'cancelled' },
]

beforeEach(() => { settings.value = { timezone: 'UTC' } })

describe('待办工作区筛选', () => {
  it('今天与未来七天只统计待完成事项，今日逾期同时保留在逾期入口', () => {
    expect(taskWorkspaceSummary(tasks, now)).toEqual({ today: 2, overdue: 2, week: 3, unplanned: 1 })
    expect(filterTaskWorkspace(tasks, { period: 'overdue', now }).map((task) => task.id)).toEqual(['late-today', 'overdue'])
    expect(filterTaskWorkspace(tasks, { period: 'week', now }).map((task) => task.id)).toEqual(['today', 'late-today', 'week'])
  })

  it('组合搜索、实时课程名称、下一步与优先级，不改变原记录', () => {
    const result = filterTaskWorkspace(tasks, { query: '物理 核对', priority: 'high', now, courseNames: new Map([['c1', '大学物理']]) })
    expect(result.map((task) => task.id)).toEqual(['today'])
    expect(result[0]).toBe(tasks[0])
    expect(filterTaskWorkspace(tasks, { query: '机器学习', now }).map((task) => task.id)).toEqual(['unplanned'])
    expect(filterTaskWorkspace(tasks, { period: 'unplanned', now }).map((task) => task.id)).toEqual(['unplanned'])
  })

  it('全部日期搜索可查到完成和归档记录，时间快捷筛选不把它们算作欠账', () => {
    expect(filterTaskWorkspace(tasks, { query: '归档', now }).map((task) => task.id)).toEqual(['archived'])
    expect(filterTaskWorkspace(tasks, { period: 'today', now }).map((task) => task.id)).toEqual(['today', 'late-today'])
  })
})

describe('重要日期工作区', () => {
  const items = [
    { id: 'annual', name: '生日', date: '2021-10-10', category: '纪念日', repeat: 'yearly' },
    { id: 'study', name: '考试', date: '2026-10-14', category: '学习', courseId: 'c1', pinned: true },
    { id: 'later', name: '项目答辩', date: '2026-11-10', category: '项目' },
    { id: 'past', name: '过去的考试', date: '2026-10-08', category: '学习' },
    { id: 'older', name: '过去的活动', date: '2026-09-01', category: '生活' },
    { id: 'archive', name: '归档日期', date: '2026-10-10', archivedAt: '2026-10-08', pinned: true },
  ]

  it('使用年度本次发生日期进行概览、排序和范围筛选', () => {
    const view = selectMilestoneWorkspace(items, { now, period: 'week' })
    expect(view.summary).toEqual({ upcoming: 3, week: 2, pinned: 1, past: 2, archived: 1 })
    expect(view.visible.map((item) => item.id)).toEqual(['study', 'annual'])
    expect(view.visible[1].occurrenceDate).toBe('2026-10-10')
    expect(items[0].date).toBe('2021-10-10')
  })

  it('类别与关键词组合筛选可匹配已重命名的课程', () => {
    expect(selectMilestoneWorkspace(items, { now, category: '学习', query: '线性代数', courseNames: new Map([['c1', '线性代数']]) }).visible.map((item) => item.id)).toEqual(['study'])
  })

  it('已结束按最近日期优先，历史入口只返回归档项目', () => {
    expect(selectMilestoneWorkspace(items, { now, period: 'past' }).visible.map((item) => item.id)).toEqual(['past', 'older'])
    expect(selectMilestoneWorkspace(items, { now, showHistory: true }).visible.map((item) => item.id)).toEqual(['archive'])
  })

  it('跨年和闰日使用实际发生的年、月、日', () => {
    const nextYear = selectMilestoneWorkspace([{ name: '年初纪念日', date: '2020-01-01', repeat: 'yearly' }], { now: new Date('2026-12-31T12:00:00Z'), period: 'week' }).visible[0]
    expect(nextYear.occurrenceDate).toBe('2027-01-01')
    const leap = selectMilestoneWorkspace([{ name: '闰日生日', date: '2024-02-29', repeat: 'yearly' }], { now: new Date('2027-02-01T12:00:00Z') }).visible[0]
    expect(leap.occurrenceDate).toBe('2027-02-28')
  })
})

it('拒绝不存在的日期，接受真实闰日', () => {
  expect(isValidPlanningDate('2027-02-29')).toBe(false)
  expect(isValidPlanningDate('2026-13-01')).toBe(false)
  expect(isValidPlanningDate('2026-04-31')).toBe(false)
  expect(isValidPlanningDate('2028-02-29')).toBe(true)
})
