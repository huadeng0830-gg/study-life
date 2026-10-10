import { describe, expect, it } from 'vitest'
import { projectTaskOverview, selectProjectTasks, projectTaskRisks } from '../src/composables/projects/projectTaskSelectors.js'

const tasks = [
  { id: 'parent', title: '虚构主任务', status: 'completed', priority: 'normal', dueOn: '2026-10-08' },
  { id: 'child', parentTaskId: 'parent', title: '虚构实验验证', status: 'in_progress', assigneeId: 'fictional-user', dueOn: '2026-10-09' },
  { id: 'next', title: '虚构报告', status: 'todo', priority: 'urgent', dueOn: '2026-10-12', milestoneId: 'fictional-stage', dependsOnTaskId: 'child', dependencyStatus: 'in_progress' },
  { id: 'review', title: '虚构演示', status: 'review', assigneeId: 'fictional-other', dueOn: '2026-10-10' },
  { id: 'undated', title: '虚构附件', status: 'todo', priority: 'low', workCheckpoint: { nextStep: '核对数据' } },
]

describe('project task filtering', () => {
  it('retains completed parent context for unfinished children', () => {
    const result = selectProjectTasks(tasks)
    expect(result.parents.map((task) => task.id)).toEqual(['parent', 'next', 'review', 'undated'])
    expect(result.children.get('parent').map((task) => task.id)).toEqual(['child'])
    expect(result.matchingIds.has('parent')).toBe(false)
    expect(result.count).toBe(4)
  })

  it('finds the current member through their assigned child task', () => {
    const result = selectProjectTasks(tasks, { assignee: 'mine', userId: 'fictional-user' })
    expect(result.parents.map((task) => task.id)).toEqual(['parent'])
    expect(result.count).toBe(1)
  })

  it('combines milestone, status and assignee filters', () => {
    expect(selectProjectTasks(tasks, { status: 'todo', milestone: 'fictional-stage', assignee: 'unassigned' }).parents.map((task) => task.id)).toEqual(['next'])
    expect(selectProjectTasks(tasks, { status: 'review', assignee: 'fictional-other' }).parents.map((task) => task.id)).toEqual(['review'])
  })

  it('searches task progress and child titles without changing task objects', () => {
    expect(selectProjectTasks(tasks, { search: ' 实验验证 ' }).parents.map((task) => task.id)).toEqual(['parent'])
    expect(selectProjectTasks(tasks, { search: '核对数据' }).parents.map((task) => task.id)).toEqual(['undated'])
    expect(selectProjectTasks(tasks, { search: 'does not exist' }).count).toBe(0)
    expect(tasks[0].id).toBe('parent')
  })

  it('excludes completed work and tasks due today from overdue work', () => {
    const result = selectProjectTasks(tasks, { status: 'overdue', today: '2026-10-10' })
    expect(result.count).toBe(1)
    expect(result.parents.map((task) => task.id)).toEqual(['parent'])
    expect(selectProjectTasks(tasks, { status: 'blocked' }).parents.map((task) => task.id)).toEqual(['next'])
  })

  it('orders due dates and priorities stably with undated work last', () => {
    expect(selectProjectTasks(tasks, { status: 'all', sort: 'due' }).parents.map((task) => task.id)).toEqual(['parent', 'review', 'next', 'undated'])
    expect(selectProjectTasks(tasks, { status: 'all', sort: 'priority' }).parents.map((task) => task.id)).toEqual(['next', 'parent', 'review', 'undated'])
  })

  it('counts each task once, including child tasks', () => {
    expect(projectTaskOverview(tasks, { userId: 'fictional-user', today: '2026-10-10' })).toEqual({
      total: 5, completed: 1, open: 4, progress: 20, inProgress: 1, review: 1,
      overdue: 1, blocked: 1, unassigned: 2, mine: 1,
    })
  })

  it('sorts matching children and parent context by the child sort value', () => {
    const result = selectProjectTasks([
      { id: 'parent-a', status: 'completed', priority: 'urgent' },
      { id: 'parent-b', status: 'completed', priority: 'low' },
      { id: 'routine', parentTaskId: 'parent-a', status: 'todo', priority: 'low' },
      { id: 'important', parentTaskId: 'parent-a', status: 'todo', priority: 'high' },
      { id: 'urgent', parentTaskId: 'parent-b', status: 'todo', priority: 'urgent' },
    ], { sort: 'priority' })
    expect(result.parents.map((task) => task.id)).toEqual(['parent-b', 'parent-a'])
    expect(result.children.get('parent-a').map((task) => task.id)).toEqual(['important', 'routine'])
  })

  it('uses the account timezone for cutoff reminders near midnight', () => {
    const risks = projectTaskRisks({
      project: { id: 'fictional-project' }, tasks: [{ title: '虚构任务', status: 'todo', dueOn: '2026-10-10' }],
      deliverables: [], deliveryChecks: [], inbox: { reviews: [], adjustments: [], meetings: [] },
      isDependencyBlocked: () => false, now: new Date('2026-10-10T17:00:00Z'), timeZone: 'Asia/Shanghai',
    })
    expect(risks).toEqual(['任务「虚构任务」已超过截止日期'])
  })

  it('uses the loaded dependency title when its denormalized title is missing', () => {
    const risks = projectTaskRisks({
      project: { id: 'fictional-project' },
      tasks: [{ id: 'first', title: '虚构前置任务', status: 'in_progress' }, { id: 'next', title: '虚构后续任务', status: 'todo', dependsOnTaskId: 'first' }],
      deliverables: [], deliveryChecks: [], inbox: { reviews: [], adjustments: [], meetings: [] },
      isDependencyBlocked: (task) => Boolean(task.dependsOnTaskId),
    })
    expect(risks).toEqual(['任务「虚构后续任务」等待前置任务「虚构前置任务」完成'])
  })
})
