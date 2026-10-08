// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { detectTaskEventConflicts } from '../src/composables/conflictDetection.js'

const date = '2026-10-07'

describe('detectTaskEventConflicts', () => {
  it('does not treat date-only items as one-hour blocks at midnight', () => {
    const first = { id: 'first', title: '先记下', dueDate: date, estimateMinutes: 30 }
    const second = { id: 'second', title: '再记一条', dueDate: date, estimateMinutes: 45 }

    expect(detectTaskEventConflicts(second, [first], date)).toEqual([])
    expect(detectTaskEventConflicts(
      { ...second, dueTime: '00:30' },
      [first],
      date,
    )).toEqual([])
    expect(detectTaskEventConflicts(
      second,
      [{ ...first, dueTime: '10:00' }],
      date,
    )).toEqual([])
  })

  it('uses estimateMinutes for task overlap ranges', () => {
    const conflicts = detectTaskEventConflicts(
      { id: 'new', title: '新任务', dueDate: date, dueTime: '10:00', estimateMinutes: 20 },
      [{ id: 'existing', title: '已有任务', dueDate: date, dueTime: '10:15', estimateMinutes: 10 }],
      date,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].timeRange).toEqual({ start: 615, end: 620 })
  })

  it('uses an event endTime instead of assuming a one-hour duration', () => {
    const conflicts = detectTaskEventConflicts(
      { id: 'task', title: '待办', dueDate: date, dueTime: '11:30', estimateMinutes: 30 },
      [{ id: 'event', title: '长会议', date, time: '10:00', endTime: '12:00' }],
      date,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ type: 'task-event', entityType: 'Event' })
    expect(conflicts[0].timeRange).toEqual({ start: 690, end: 720 })
  })

  it('uses a new event endTime when checking existing tasks', () => {
    const conflicts = detectTaskEventConflicts(
      { id: 'event', title: '新日程', date, time: '10:00', endTime: '12:00' },
      [{ id: 'task', title: '已有待办', dueDate: date, dueTime: '11:30', estimateMinutes: 15 }],
      date,
      'event',
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ type: 'event-task', entityType: 'Task' })
    expect(conflicts[0].timeRange).toEqual({ start: 690, end: 705 })
  })
})
