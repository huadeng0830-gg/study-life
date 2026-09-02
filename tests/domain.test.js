import { describe, expect, it } from 'vitest'
import { migrateDomainData } from '../src/composables/domain/migrations.js'
import { detachCourseRelations } from '../src/composables/domain/relations.js'
import { reminderAction, selectActionCenter, selectDayAgenda, selectReminders } from '../src/composables/domain/selectors.js'
import { isBillDueSoon, taskPlanningState, taskStatus } from '../src/composables/domain/state.js'

describe('domain state and projections', () => {
  it('keeps overdue as a derived task state', () => {
    expect(taskStatus({ done: false, dueDate: '2026-08-28' }, new Date('2026-08-29T10:00:00'))).toBe('overdue')
    expect(taskStatus({ done: false, status: 'in_progress', dueDate: '2026-08-28' }, new Date('2026-08-29T10:00:00'))).toBe('overdue')
    expect(taskStatus({ done: true, dueDate: '2026-08-28' }, new Date('2026-08-29T10:00:00'))).toBe('completed')
  })

  it('exposes the user-facing task planning states without making overdue permanent', () => {
    const now = new Date('2026-08-29T10:00:00')
    expect(taskPlanningState({ id: 'inbox', title: '买洗衣液' }, now)).toBe('unplanned')
    expect(taskPlanningState({ id: 'scheduled', title: '交作业', dueDate: '2026-08-30' }, now)).toBe('scheduled')
    expect(taskPlanningState({ id: 'late', title: '补交', dueDate: '2026-08-28' }, now)).toBe('scheduled')
    expect(taskPlanningState({ id: 'done', title: '已完成', status: 'completed', dueDate: '2026-08-28' }, now)).toBe('completed')
  })

  it('uses the same task status when projecting agenda and reminders', () => {
    const completed = { id: 'done', title: '已完成', done: false, status: 'completed', dueDate: '2026-08-29' }
    const overdue = { id: 'late', title: '已逾期', done: false, status: 'pending', dueDate: '2026-08-28' }
    const now = new Date('2026-08-29T10:00:00')
    expect(selectDayAgenda({ tasks: [completed, overdue] }, now).map((item) => item.sourceId)).toEqual(['late'])
    expect(selectReminders({ tasks: [completed, overdue] }, now).map((item) => item.sourceId)).toEqual(['late'])
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

  it('supports projection exclusions and explicit reminder actions', () => {
    const data = {
      tasks: [{ id: 't1', title: '作业', dueDate: '2026-08-29' }],
      bills: [{ id: 'b1', name: '话费', amount: 39, nextDate: '2026-08-29', active: true }],
    }
    const excluded = selectActionCenter(data, new Date('2026-08-29T10:00:00'), { excludeKeys: new Set(['task:t1']) })
    const all = [...excluded.urgent, ...excluded.today, ...excluded.soon]
    expect(all.map((item) => item.sourceType)).toEqual(['bill'])
    expect(reminderAction({ sourceType: 'task', sourceId: 't1' })).toEqual({ action: 'complete', targetType: 'task', targetId: 't1' })
    expect(reminderAction({ sourceType: 'bill', sourceId: 'b1' })).toEqual({ action: 'pay', targetType: 'bill', targetId: 'b1' })
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

  it('projects today courses and actionable records into one time-ordered agenda', () => {
    const agenda = selectDayAgenda({
      courses: [{ id: 'c1', name: '高数', time: '08:00', room: 'A101' }],
      tasks: [{ id: 't1', title: '交作业', dueDate: '2026-08-29', dueTime: '10:00' }],
      events: [{ id: 'e1', title: '组会', date: '2026-08-29', time: '14:00' }],
    }, new Date('2026-08-29T09:00:00'))
    expect(agenda.map((item) => item.sourceType)).toEqual(['course', 'task', 'event'])
    expect(agenda[0]).toMatchObject({ title: '高数', meta: 'A101' })
  })

  it('can reserve a source type for its dedicated home projection', () => {
    const agenda = selectDayAgenda({
      courses: [{ id: 'c1', name: '高数', time: '08:00' }],
      tasks: [{ id: 't1', title: '交作业', dueDate: '2026-08-29', dueTime: '10:00' }],
      events: [{ id: 'e1', title: '组会', date: '2026-08-29', time: '14:00' }],
    }, new Date('2026-08-29T09:00:00'), { excludeTypes: ['course', 'task'] })
    expect(agenda.map((item) => item.sourceType)).toEqual(['event'])
  })

  it('keeps unscheduled tasks out of Today until the user assigns a date', () => {
    const task = { id: 'inbox', title: '买洗衣液', status: 'pending', dueDate: '' }
    expect(taskPlanningState(task, new Date('2026-08-29T09:00:00'))).toBe('unplanned')
    expect(selectDayAgenda({ tasks: [task] }, new Date('2026-08-29T09:00:00'))).toEqual([])
    expect(task.dueDate).toBe('')
  })

  it('does not project a paid bill after it advances beyond its reminder window', () => {
    const paidBill = { id: 'b-paid', name: '会员订阅', nextDate: '2026-10-02', remindDays: 3, active: true }
    expect(isBillDueSoon(paidBill, new Date('2026-09-02T10:00:00'))).toBe(false)
    expect(isBillDueSoon({ ...paidBill, nextDate: '2026-09-04' }, new Date('2026-09-02T10:00:00'))).toBe(true)
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
