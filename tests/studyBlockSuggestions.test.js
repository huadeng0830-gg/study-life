import { describe, expect, it } from 'vitest'
import { buildStudyBlockSuggestions, studyFreeIntervals } from '../src/composables/studyBlockSuggestions.js'

const date = '2026-10-09'
const task = (id, fields = {}) => ({ id, title: `示例任务 ${id}`, ...fields })

describe('学习空档建议', () => {
  it('keeps class buffers, merges overlapping appointments, and separates successive sessions', () => {
    expect(studyFreeIntervals([{ start: 540, end: 600 }, { start: 570, end: 660 }], 540)).toEqual([{ start: 670, end: 1320 }])
    const blocks = buildStudyBlockSuggestions({ date, nowMinutes: 540, tasks: [task('a'), task('b')], busyIntervals: [{ start: 540, end: 600 }] })
    expect(blocks.map((block) => [block.startTime, block.endTime])).toEqual([['10:10', '10:35'], ['10:45', '11:10']])
  })

  it('prioritizes overdue and today deadlines ahead of far-away high-priority work', () => {
    const blocks = buildStudyBlockSuggestions({ date, nowMinutes: 540, tasks: [task('later', { priority: 'high', dueDate: '2026-11-01' }), task('today', { priority: 'low', dueDate: date }), task('late', { priority: 'low', dueDate: '2026-10-08' })] })
    expect(blocks.map((block) => block.taskId)).toEqual(['late', 'today', 'later'])
  })

  it('uses the remaining estimate and breaks a long task into manageable sessions', () => {
    const blocks = buildStudyBlockSuggestions({ date, nowMinutes: 540, tasks: [task('a', { estimateMinutes: 60, focusTotalSeconds: 2400 }), task('b', { estimateMinutes: 180 }), task('c', { estimateMinutes: 15, actualMinutes: 20 })] })
    expect(blocks.map((block) => block.minutes)).toEqual([20, 45, 25])
    expect(blocks[1].partial).toBe(true)
  })

  it('fits a short session before a timed deadline instead of scheduling past it', () => {
    const blocks = buildStudyBlockSuggestions({ date, nowMinutes: 540, tasks: [task('a', { dueDate: date, dueTime: '09:15', estimateMinutes: 40 }), task('b', { dueDate: date, dueTime: '09:05' })] })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ taskId: 'a', endTime: '09:15', minutes: 15, partial: true })
  })

  it('ignores completed, cancelled, deleted, archived and already planned tasks', () => {
    const blocks = buildStudyBlockSuggestions({ date, tasks: [task('done', { done: true }), task('cancelled', { status: 'cancelled' }), task('deleted', { tombstone: true }), task('archived', { archivedAt: '2026-10-01' }), task('planned'), task('ok')], plannedTaskIds: ['planned'] })
    expect(blocks.map((block) => block.taskId)).toEqual(['ok'])
  })

  it('returns no slot after the end of the day or during an all-day appointment', () => {
    expect(buildStudyBlockSuggestions({ date, nowMinutes: 1330, tasks: [task('a')] })).toEqual([])
    expect(buildStudyBlockSuggestions({ date, tasks: [task('a')], busyIntervals: [{ start: 480, end: 1320 }] })).toEqual([])
  })
})
