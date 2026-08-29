import { describe, expect, it } from 'vitest'
import { migrateDomainData } from '../src/composables/domain/migrations.js'
import { detachCourseRelations } from '../src/composables/domain/relations.js'
import { selectActionCenter, selectReminders } from '../src/composables/domain/selectors.js'
import { taskStatus } from '../src/composables/domain/state.js'

describe('domain state and projections', () => {
  it('keeps overdue as a derived task state', () => {
    expect(taskStatus({ done: false, dueDate: '2026-08-28' }, new Date('2026-08-29T10:00:00'))).toBe('overdue')
    expect(taskStatus({ done: true, dueDate: '2026-08-28' }, new Date('2026-08-29T10:00:00'))).toBe('completed')
  })

  it('does not duplicate one source in action center buckets', () => {
    const now = new Date('2026-08-29T10:00:00')
    const center = selectActionCenter({
      tasks: [{ id: 't1', title: '交报告', dueDate: '2026-08-29', dueTime: '12:00', priority: 'high' }],
      bills: [{ id: 'b1', name: '话费', amount: 39, nextDate: '2026-08-30', remindDays: 3, active: true }],
    }, now)
    const all = [...center.urgent, ...center.today, ...center.soon].map((item) => item.key)
    expect(new Set(all).size).toBe(all.length)
  })

  it('unifies task, bill, milestone and event reminders without storing copies', () => {
    const reminders = selectReminders({
      tasks: [{ id: 't1', title: '作业', dueDate: '2026-08-29' }],
      bills: [{ id: 'b1', name: '话费', amount: 39, nextDate: '2026-08-30', remindDays: 3, active: true }],
      milestones: [{ id: 'm1', name: '考试', date: '2026-09-01' }],
      events: [{ id: 'e1', title: '组会', date: '2026-08-30', time: '15:00' }],
    }, new Date('2026-08-29T10:00:00'))
    expect(reminders.map((item) => item.sourceType).sort()).toEqual(['bill', 'event', 'milestone', 'task'])
  })
})

describe('domain compatibility and relations', () => {
  it('migrates legacy fields without replacing user values', () => {
    const tasks = [{ id: 't1', title: '高数作业', done: false, createdAt: '2026-08-01T00:00:00Z' }]
    const transactions = [{ id: 'x1', name: '午饭', amount: 18, createdAt: '2026-08-01T00:00:00Z' }]
    migrateDomainData({ tasks, transactions })
    expect(tasks[0]).toMatchObject({ kind: 'homework', status: 'pending', updatedAt: '2026-08-01T00:00:00Z' })
    expect(transactions[0].direction).toBe('expense')
  })

  it('course deletion unlinks every related entity but preserves its readable name', () => {
    const tasks = [{ courseId: 'c1', course: '' }]
    const milestones = [{ courseId: 'c1', courseName: '' }]
    const events = [{ courseId: 'c1', courseName: '' }]
    const notes = [{ courseId: 'c1', courseName: '' }]
    expect(detachCourseRelations({ id: 'c1', name: '高数' }, { tasks, milestones, events, notes })).toEqual({ tasks: 1, milestones: 1, events: 1, notes: 1 })
    expect([tasks[0].course, milestones[0].courseName, events[0].courseName, notes[0].courseName]).toEqual(['高数', '高数', '高数', '高数'])
  })
})
