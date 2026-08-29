import { describe, expect, it } from 'vitest'
import { detachCourseLinks, findUniqueCourseByName } from '../src/composables/courseLinks.js'
import { ledgerTabFromQuery } from '../src/composables/routeState.js'
import { createNextWeeklyTask } from '../src/composables/taskRecurrence.js'

describe('关联边界与深链接', () => {
  it('删除课程时保留待办与学习倒计时，仅解除稳定关联', () => {
    const course = { id: 'c1', name: '高等数学' }
    const tasks = [{ id: 't1', courseId: 'c1', course: '' }, { id: 't2', courseId: 'c2', course: '英语' }]
    const countdowns = [{ id: 'e1', courseId: 'c1', courseName: '' }, { id: 'e2', courseId: 'c2' }]
    expect(detachCourseLinks(course, tasks, countdowns)).toEqual({ tasks: 1, countdowns: 1 })
    expect(tasks[0]).toMatchObject({ courseId: '', course: '高等数学' })
    expect(countdowns[0]).toMatchObject({ courseId: '', courseName: '高等数学' })
    expect(tasks[1].courseId).toBe('c2')
  })

  it('每周待办创建下一周副本并保留课程关联', () => {
    const next = createNextWeeklyTask({ id: 't1', title: '预习', courseId: 'c1', dueDate: '2026-08-24', repeat: 'weekly', done: true }, new Date('2026-08-29T08:00:00'))
    expect(next).toMatchObject({ dueDate: '2026-08-31', courseId: 'c1', done: false, completedAt: null, repeatGeneratedAt: null })
  })

  it('固定账单深链接只接受已知页签', () => {
    expect(ledgerTabFromQuery('bills')).toBe('bills')
    expect(ledgerTabFromQuery('review')).toBe('review')
    expect(ledgerTabFromQuery('anything')).toBe('ledger')
  })

  it('通知导入仅在课程名称唯一时自动关联', () => {
    expect(findUniqueCourseByName([{ id: 'c1', name: '英语' }], '英语')?.id).toBe('c1')
    expect(findUniqueCourseByName([{ id: 'c1', name: '英语' }, { id: 'c2', name: '英语' }], '英语')).toBeNull()
  })
})
