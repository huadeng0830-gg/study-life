import { describe, expect, it } from 'vitest'
import { groupProjectSubtasks, projectDeliveryCenter, projectTaskRisks } from '../src/composables/projects/projectTaskSelectors.js'

describe('齐行任务摘要选择器', () => {
  it('groups child tasks under their parent without changing task objects', () => {
    const child = { id: 'child-1', parentTaskId: 'parent-1' }
    const grouped = groupProjectSubtasks([{ id: 'parent-1' }, child, { id: 'other' }])
    expect(grouped.get('parent-1')).toEqual([child])
    expect(grouped.has('other')).toBe(false)
  })

  it('summarizes overdue, blocked, and near-deadline work with a five-item cap', () => {
    const risks = projectTaskRisks({
      project: { id: 'project-1' },
      tasks: [
        { title: '逾期任务', status: 'todo', dueOn: '2026-10-08' },
        { title: '前置未完成', status: 'todo', dependencyTaskTitle: '前置任务' },
        { title: '已完成', status: 'completed', dueOn: '2026-10-08' },
        { title: '三天内截止', status: 'todo', dueOn: '2026-10-12' },
      ],
      deliverables: [{ title: '报告', required: true, versions: [] }],
      deliveryChecks: [],
      inbox: { reviews: [], adjustments: [], meetings: [] },
      isDependencyBlocked: (task) => task.title === '前置未完成',
      now: new Date('2026-10-09T02:00:00.000Z'),
    })
    expect(risks).toEqual([
      '任务「逾期任务」已超过截止日期',
      '任务「三天内截止」将在三天内截止',
      '任务「前置未完成」等待前置任务「前置任务」完成',
      '必需成果「报告」尚未提交',
    ])
  })

  it('separates completed tasks, missing deliveries, review, and approved versions', () => {
    const summary = projectDeliveryCenter([
      { id: 'done-1', status: 'completed' }, { id: 'todo-1', status: 'todo' },
    ], [
      { title: '缺少版本', required: true, versions: [] },
      { title: '待验收', required: true, reviewRequired: true, versions: [{ reviewStatus: 'pending' }] },
      { title: '已验收', required: true, reviewRequired: true, versions: [{ reviewStatus: 'approved' }] },
    ])
    expect(summary.completedTasks.map((task) => task.id)).toEqual(['done-1'])
    expect(summary.missing.map((item) => item.title)).toEqual(['缺少版本', '待验收'])
    expect(summary.awaitingReview.map((item) => item.title)).toEqual(['待验收'])
    expect(summary.approved.map((item) => item.title)).toEqual(['已验收'])
  })
})
