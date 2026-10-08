// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { selectHomeNextUp } from '../src/composables/home/nextUp.js'
import { addAppDays, appNow, appToday } from '../src/composables/timeContext.js'

describe('home next-up projection', () => {
  it('selects the nearest actionable item from one domain snapshot', () => {
    const today = appToday.value
    const tomorrow = addAppDays(today, 1)
    const result = selectHomeNextUp({
      now: appNow.value,
      today,
      courses: [],
      tasks: [{ id: 'task-1', title: '作业', dueDate: tomorrow, dueTime: '10:00', status: 'pending', done: false }],
      events: [{ id: 'event-1', title: '会议', date: tomorrow, time: '11:00' }],
      bills: [],
      milestones: [],
    })

    expect(result.nextUp.kind).toBe('task')
    expect(result.nextUp.entity.id).toBe('task-1')
    expect(result.nextUpTimeRange).toBe('')
    expect(result.nextDeparture).toBe('')
  })

  it('returns a stable empty projection when there is nothing to show', () => {
    const result = selectHomeNextUp({
      now: appNow.value,
      today: appToday.value,
      courses: [], tasks: [], events: [], bills: [], milestones: [],
    })

    expect(result.nextUp).toEqual({ kind: 'none' })
    expect(result.nextTimingLabel).toBe('')
  })
})
