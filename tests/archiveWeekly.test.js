// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { selectDayAgenda, selectHistoricalItems, selectReminders } from '../src/composables/domain/selectors.js'
import { isArchived } from '../src/composables/domain/state.js'
import { selectNextWeekHighlights, selectWeeklyBillSummary, selectWeeklyFinanceSummary, selectWeeklyMoodSummary, selectWeeklyTaskSummary, weekRange } from '../src/composables/domain/weeklySelectors.js'
import { settings } from '../src/composables/settingsPolicy.js'

const domain = useDomainCommands()
let originalSettings

beforeEach(() => {
  originalSettings = { ...settings.value, defaultReminders: { ...(settings.value.defaultReminders || {}) } }
  domain.tasks.value = []
  domain.courses.value = []
  domain.milestones.value = []
  domain.bills.value = []
  domain.transactions.value = []
  domain.events.value = []
  domain.notes.value = []
})

afterEach(() => { settings.value = originalSettings })

describe('P2-A archive lifecycle', () => {
  it('archives a completed task out of current projections and restores it with undo command', () => {
    const task = domain.createTask({ id: 'archive-task', title: '交报告', dueDate: '2026-09-02' })
    domain.toggleTask(task.id)
    domain.archiveTask(task.id)

    expect(isArchived(task)).toBe(true)
    expect(selectDayAgenda({ tasks: domain.tasks.value }, new Date('2026-09-02T10:00:00'))).toEqual([])
    expect(selectReminders({ tasks: domain.tasks.value }, new Date('2026-09-02T10:00:00'))).toEqual([])
    expect(selectHistoricalItems(domain.tasks.value)).toContainEqual(expect.objectContaining({ id: task.id }))

    domain.restoreTask(task.id)
    expect(isArchived(task)).toBe(false)
  })

  it('archives courses without touching relations, while delete unlinks them', () => {
    const course = { id: 'course-archive', name: '高数' }
    domain.courses.value.push(course)
    domain.tasks.value.push({ id: 'course-task', title: '作业', courseId: course.id, course: course.name })
    domain.milestones.value.push({ id: 'course-milestone', name: '考试', date: '2026-09-10', courseId: course.id })
    domain.notes.value.push({ id: 'course-note', title: '笔记', content: '内容', courseId: course.id })

    domain.archiveCourse(course.id)
    expect(selectDayAgenda({ courses: domain.courses.value }, new Date('2026-09-02T10:00:00'))).toEqual([])
    expect(domain.tasks.value[0].courseId).toBe(course.id)
    expect(domain.milestones.value[0].courseId).toBe(course.id)
    expect(domain.notes.value[0].courseId).toBe(course.id)

    domain.deleteCourse(course.id)
    expect(domain.tasks.value[0].courseId).toBe('')
    expect(domain.milestones.value[0].courseId).toBe('')
    expect(domain.notes.value[0].courseId).toBe('')
  })

  it('keeps past milestones and inactive bills out of current reminders but keeps history', () => {
    const milestone = { id: 'past-milestone', name: '期中', date: '2026-08-20' }
    const bill = { id: 'inactive-bill', name: '话费', amount: 39, nextDate: '2026-09-02', active: true }
    domain.milestones.value.push(milestone)
    domain.bills.value.push(bill)
    domain.archiveBill(bill.id)
    domain.transactions.value.push({ id: 'bill-tx', name: '话费', amount: 39, date: '2026-09-02', direction: 'expense', source: 'bill', billId: bill.id })

    expect(selectReminders({ milestones: domain.milestones.value, bills: domain.bills.value }, new Date('2026-09-02T10:00:00'))).toEqual([])
    expect(selectHistoricalItems(domain.milestones.value)).toContainEqual(milestone)
    expect(domain.transactions.value).toHaveLength(1)
  })

  it('archives a note without breaking its task source relation', () => {
    const note = { id: 'archive-note', title: '通知', content: '周五交', sourceType: 'notice' }
    domain.notes.value.push(note)
    domain.tasks.value.push({ id: 'note-task', title: '交报告', sourceType: 'note', sourceId: note.id })
    domain.archiveNote(note.id)
    expect(isArchived(note)).toBe(true)
    expect(domain.tasks.value[0]).toMatchObject({ sourceType: 'note', sourceId: note.id })
  })
})

describe('P2-A weekly review selectors', () => {
  it('counts completedAt in the policy week, not a later updatedAt', () => {
    const now = new Date('2026-09-06T16:30:00Z')
    settings.value = { ...settings.value, timezone: 'Asia/Shanghai' }
    expect(weekRange(now)).toMatchObject({ startDate: '2026-09-07', endDate: '2026-09-14' })
    const summary = selectWeeklyTaskSummary({ tasks: [
      { id: 'current', completedAt: '2026-09-06T17:00:00Z', updatedAt: '2026-09-06T17:00:00Z' },
      { id: 'prior', completedAt: '2026-08-31T08:00:00Z', updatedAt: '2026-09-07T01:00:00Z' },
    ] }, now)
    expect(summary.completed).toBe(1)
  })

  it('summarizes weekly income, expense, bill payment, mood and deduplicated next-week items', () => {
    const now = new Date('2026-09-02T10:00:00')
    const finance = selectWeeklyFinanceSummary({ transactions: [
      { id: 'expense', date: '2026-08-31', amount: 18, direction: 'expense', cat: '餐饮' },
      { id: 'income', date: '2026-09-01', amount: 100, direction: 'income' },
      { id: 'bill-paid', date: '2026-09-02', amount: 39, direction: 'expense', source: 'bill', billId: 'bill-1' },
    ] }, now)
    expect(finance).toMatchObject({ income: 100, expense: 57 })
    expect(selectWeeklyBillSummary({ bills: [{ id: 'bill-1', nextDate: '2026-09-02', active: true }], transactions: [{ id: 'bill-paid', date: '2026-09-02', amount: 39, direction: 'expense', source: 'bill', billId: 'bill-1' }] }, now)).toMatchObject({ due: 1, paid: 1, paidAmount: 39 })
    expect(selectWeeklyMoodSummary({ moodLog: { '2026-09-01': { mood: '😊' } } }, now)).toMatchObject({ days: 1, sunny: 1 })

    const highlights = selectNextWeekHighlights({
      tasks: [{ id: 't1', title: '作业', dueDate: '2026-09-07' }, { id: 't1', title: '作业重复', dueDate: '2026-09-07' }],
      events: [{ id: 'e1', title: '组会', date: '2026-09-08' }],
      milestones: [{ id: 'm1', name: '考试', date: '2026-09-09' }],
      bills: [{ id: 'b1', name: '账单', nextDate: '2026-09-10', active: true }],
    }, now)
    expect(highlights.map((item) => item.sourceType)).toEqual(['task', 'event', 'milestone', 'bill'])
    expect(new Set(highlights.map((item) => item.key)).size).toBe(4)
  })
})
