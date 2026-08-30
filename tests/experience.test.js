import { describe, expect, it } from 'vitest'
import { COURSE_CHECKIN_STATES, courseWorkload, focusElapsedSeconds, rescueTaskPatch, upsertCourseCheckin, weeklyPulse } from '../src/composables/experience.js'

describe('experience helpers', () => {
  it('keeps one course feedback record per course and day', () => {
    const first = upsertCourseCheckin([], { courseId: 'c1', courseName: '高数', date: '2026-08-30', state: COURSE_CHECKIN_STATES.unclear }, new Date('2026-08-30T09:00:00'))
    const next = upsertCourseCheckin(first, { courseId: 'c1', courseName: '高数', date: '2026-08-30', state: COURSE_CHECKIN_STATES.review }, new Date('2026-08-30T10:00:00'))
    expect(next).toHaveLength(1)
    expect(next[0].state).toBe('review')
  })

  it('builds safe reschedule patches without deleting a task', () => {
    expect(rescueTaskPatch('tonight', new Date('2026-08-30T12:00:00'))).toMatchObject({ dueDate: '2026-08-30', dueTime: '20:00', priority: 'high' })
    expect(rescueTaskPatch('tomorrow', new Date('2026-08-30T12:00:00'))?.dueDate).toBe('2026-08-31')
  })

  it('surfaces courses with overdue work and review signals first', () => {
    const rows = courseWorkload([{ id: 'c1', name: '高数' }, { id: 'c2', name: '英语' }], [{ courseId: 'c2', dueDate: '2026-08-20', done: false }], [{ courseId: 'c1', state: 'review' }], new Date('2026-08-30T10:00:00'))
    expect(rows[0].course.id).toBe('c2')
  })

  it('only keeps the latest recent course feedback as an active review signal', () => {
    const now = new Date('2026-08-30T10:00:00')
    const rows = courseWorkload([{ id: 'c1', name: '高数' }], [], [
      { courseId: 'c1', date: '2026-08-01', state: 'review', updatedAt: '2026-08-01T08:00:00Z' },
      { courseId: 'c1', date: '2026-08-30', state: 'understood', updatedAt: '2026-08-30T08:00:00Z' },
    ], now)
    expect(rows).toEqual([])
  })

  it('does not count paused time as focus time', () => {
    const active = {
      startedAt: '2026-08-30T10:00:00.000Z',
      segmentStartedAt: '2026-08-30T10:40:00.000Z',
      elapsedSeconds: 600,
      durationMinutes: 25,
    }
    expect(focusElapsedSeconds(active, new Date('2026-08-30T10:45:00.000Z'))).toBe(900)
    expect(focusElapsedSeconds({ ...active, pausedAt: '2026-08-30T10:45:00.000Z' }, new Date('2026-08-30T11:45:00.000Z'))).toBe(600)
  })

  it('summarizes completed work and actual focus this week', () => {
    const pulse = weeklyPulse({ tasks: [{ completedAt: '2026-08-25T08:00:00Z' }], focusSessions: [{ endedAt: '2026-08-26T08:00:00Z', minutes: 25 }], courseCheckins: [{ date: '2026-08-26', courseId: 'c1', state: 'review' }], moodLog: { '2026-08-26': { mood: '😊' } } }, new Date('2026-08-30T10:00:00'))
    expect(pulse).toMatchObject({ done: 1, minutes: 25, reviewCourses: 1, moodDays: 1 })
  })

  it('excludes future course feedback from this week\'s pulse', () => {
    const pulse = weeklyPulse({
      courseCheckins: [{ date: '2026-09-01', courseId: 'c1', state: 'review' }],
    }, new Date('2026-08-30T10:00:00'))
    expect(pulse.reviewCourses).toBe(0)
  })
})
