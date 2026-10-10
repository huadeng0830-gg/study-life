// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findEventConflicts } from '../src/composables/events/eventConflicts.js'
import { scheduleExceptions, semester } from '../src/composables/store/schedule.js'
import { timeConfig } from '../src/composables/store/timeConfig.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const previous = { semester: semester.value, exceptions: scheduleExceptions.value, times: timeConfig.value }
const date = '2026-10-09'
const value = { title: '示例讨论', date, time: '09:15', endTime: '09:45' }
const occupiedStage = [{ id: 'occupied', kind: 'scheduled', label: '实际执行', start: { date, time: '09:30' }, end: { date, time: '10:00' }, reminders: [] }]
const course = { id: 'demo-course', name: '示例课程', day: 4, start: 'p0', end: 'p1', startWeek: 1, endWeek: 20 }

beforeEach(() => {
  semester.value = { start: '2026-09-07' }
  scheduleExceptions.value = []
  timeConfig.value = {
    campuses: [{ id: 'demo-campus', name: '示例校区' }],
    seasons: [{ id: 'summer', startDate: '05-01' }, { id: 'winter', startDate: '10-01' }],
    periods: [{ id: 'p0' }, { id: 'p1' }],
    currentCampus: 'demo-campus', currentSeason: 'summer', autoSeason: true,
    times: {
      summer: { 'demo-campus': [{ start: '08:00', end: '08:25' }, { start: '08:30', end: '09:00' }] },
      winter: { 'demo-campus': [{ start: '09:00', end: '09:25' }, { start: '09:30', end: '10:00' }] },
    },
  }
})
afterEach(() => {
  semester.value = previous.semester
  scheduleExceptions.value = previous.exceptions
  timeConfig.value = previous.times
})

describe('日程的实际课程与任务冲突', () => {
  it('按日程日期使用冬季作息，临界衔接不算重叠', () => {
    const conflicts = findEventConflicts(value, { courses: [course] })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ entityId: 'course:demo-course', entityName: '示例课程', existing: { time: '09:00', endTime: '10:00' } })
    expect(findEventConflicts({ ...value, time: '10:00', endTime: '10:30' }, { courses: [course] })).toEqual([])
  })

  it('停课不提示冲突，补课按实际日期提示，并遵守周次', () => {
    scheduleExceptions.value = [{ id: 'demo-off', date, type: 'session_off', courseIds: [course.id] }]
    expect(findEventConflicts(value, { courses: [course] })).toEqual([])
    scheduleExceptions.value = [{ id: 'demo-makeup', date, type: 'session_makeup', courseIds: [course.id] }]
    expect(findEventConflicts(value, { courses: [{ ...course, day: 0 }] })).toHaveLength(1)
    scheduleExceptions.value = []
    expect(findEventConflicts(value, { courses: [{ ...course, weekType: 'even' }] })).toEqual([])
  })

  it('排除自身、已完成任务和归档删除记录，保留真正重叠的任务', () => {
    const conflicts = findEventConflicts(value, {
      events: [{ ...value, id: 'editing' }, { ...value, id: 'archived', status: 'archived' }],
      tasks: [
        { id: 'actionable', title: '示例准备', dueDate: date, dueTime: '09:30', status: 'pending', timeStages: occupiedStage },
        { id: 'deadline-only', title: '只设截止不占用', dueDate: date, dueTime: '09:30', estimateMinutes: 30, status: 'pending' },
        { id: 'done', title: '已完成准备', dueDate: date, dueTime: '09:30', status: 'completed', timeStages: occupiedStage },
        { id: 'legacy-done', title: '旧格式完成记录', dueDate: date, dueTime: '09:30', done: true, timeStages: occupiedStage },
      ],
      courses: [null, { ...course, deletedAt: '2026-10-08T00:00:00Z' }],
    }, 'editing')
    expect(conflicts.map((item) => item.entityId)).toEqual(['actionable'])
  })
})
