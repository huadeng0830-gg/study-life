// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildCourseProgress, courseDateLabel, courseTaskDueLabel } from '../src/composables/courseProgress.js'
import { settings } from '../src/composables/settingsPolicy.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const now = new Date('2026-10-09T02:00:00Z')
const courses = [{ id: 'math', name: '示例数学' }, { id: 'english', name: '示例英语' }]
beforeEach(() => { settings.value = { timezone: 'Asia/Shanghai' } })

describe('课程进度汇总', () => {
  it('only includes actionable tasks in remaining work and excludes archives, cancellations, and deletions from the progress denominator', () => {
    const tasks = [
      { id: 'late', courseId: 'math', title: '过期练习', dueDate: '2026-10-08' },
      { id: 'today-late', courseId: 'math', dueDate: '2026-10-09', dueTime: '09:00' },
      { id: 'today', courseId: 'math', dueDate: '2026-10-09', dueTime: '11:00' },
      { id: 'later', courseId: 'math', dueDate: '2026-10-15' },
      { id: 'unscheduled', courseId: 'math', status: 'in_progress' },
      { id: 'done', courseId: 'math', done: true, completedAt: '2026-10-08T16:15:00Z', dueDate: '2026-10-01' },
      { id: 'cancelled', courseId: 'math', status: 'cancelled' },
      { id: 'archived', courseId: 'math', archivedAt: '2026-10-01', done: true },
      { id: 'deleted', courseId: 'math', deletedAt: '2026-10-01' },
      { id: 'tombstone', courseId: 'math', tombstone: true },
    ]
    const [math] = buildCourseProgress({ courses, tasks }, now)
    expect(math.pendingTasks.map((row) => row.task.id)).toEqual(['late', 'today-late', 'today', 'later', 'unscheduled'])
    expect(math).toMatchObject({ completedCount: 1, taskTotal: 6, overdueCount: 2, dueSoonCount: 2 })
    expect(courseTaskDueLabel(math.pendingTasks[0], now)).toBe('逾期 1 天')
    expect(courseTaskDueLabel(math.pendingTasks[1], now)).toBe('今天已逾期')
    expect(courseTaskDueLabel(math.pendingTasks[2], now)).toBe('今天截止 · 11:00')
    expect(math.timeline.find((row) => row.id === 'done')).toMatchObject({ date: '2026-10-09', time: '00:15', status: '已完成' })
    expect(math.timeline.map((row) => row.id)).not.toContain('deleted')
    expect(math.timeline.map((row) => row.id)).not.toContain('tombstone')
    expect(math.timeline.find((row) => row.id === 'archived').archived).toBe(true)
  })

  it('uses stable IDs and only associates name-only legacy records when the name is unique', () => {
    const profiles = buildCourseProgress({
      courses: [...courses, { id: 'english-2', name: '示例英语' }, { id: 'deleted-course', name: '示例数学', tombstone: true }],
      tasks: [
        { id: 'unique', course: ' 示例数学 ' },
        { id: 'ambiguous', course: '示例英语' },
        { id: 'explicit', courseId: 'english', course: '示例数学' },
        { id: 'missing-id', courseId: 'removed', course: '示例数学' },
        { id: 'no-relation' },
      ],
    }, now)
    expect(profiles.find((item) => item.course.id === 'math').tasks.map((task) => task.id)).toEqual(['unique'])
    expect(profiles.find((item) => item.course.id === 'english').tasks.map((task) => task.id)).toEqual(['explicit'])
    expect(profiles.find((item) => item.course.id === 'english-2').tasks).toEqual([])
    expect(profiles).toHaveLength(3)
  })

  it('shows future milestone occurrences and unfinished events while preserving historical and archived records', () => {
    const [math] = buildCourseProgress({
      courses: [courses[0]],
      milestones: [
        { id: 'exam', courseId: 'math', kind: 'exam', date: '2026-10-10', reviewProgress: 25 },
        { id: 'yearly', courseId: 'math', date: '2025-10-12', repeat: 'yearly' },
        { id: 'past', courseId: 'math', date: '2026-10-08' },
        { id: 'past-time', courseId: 'math', date: '2026-10-09', time: '09:00' },
        { id: 'archive', courseId: 'math', date: '2026-10-11', archivedAt: '2026-10-01' },
        { id: 'far', courseId: 'math', date: '2026-10-16' },
      ],
      events: [
        { id: 'ongoing', courseId: 'math', date: '2026-10-09', time: '09:00', endTime: '11:00' },
        { id: 'finished', courseId: 'math', date: '2026-10-09', time: '08:00', endTime: '09:00' },
      ],
    }, now)
    expect(math.upcoming.map((row) => row.id)).toEqual(['ongoing', 'exam', 'yearly', 'far'])
    expect(math.upcomingCount).toBe(3)
    expect(math.upcoming.find((row) => row.id === 'yearly').date).toBe('2026-10-12')
    expect(math.timeline).toHaveLength(8)
    expect(math.upcoming.find((row) => row.id === 'exam').reviewProgress).toBe(25)
    expect(courseDateLabel('2026-10-10', now)).toBe('明天')
    expect(courseDateLabel('', now)).toBe('未安排日期')
  })

  it('counts focus in the configured timezone over seven calendar days and resolves older task-only sessions without duplication', () => {
    const [math] = buildCourseProgress({
      courses: [courses[0]], tasks: [{ id: 't1', courseId: 'math', title: '示例练习' }],
      focusSessions: [
        { sessionId: 'local-midnight', courseId: 'math', todoId: 't1', startedAt: '2026-10-02T16:10:00Z', actualFocusSeconds: 600, status: 'completed' },
        { sessionId: 'task-only', todoId: 't1', startedAt: '2026-10-08T16:20:00Z', actualFocusSeconds: 900, status: 'completed' },
        { sessionId: 'old', courseId: 'math', startedAt: '2026-10-02T15:50:00Z', actualFocusSeconds: 300 },
        { sessionId: 'future', courseId: 'math', startedAt: '2026-10-09T03:00:00Z', actualFocusSeconds: 120 },
        { sessionId: 'wrong', courseId: 'removed', todoId: 't1', startedAt: now.toISOString(), actualFocusSeconds: 6000 },
        { sessionId: 'deleted', courseId: 'math', startedAt: now.toISOString(), actualFocusSeconds: 6000, tombstone: true },
      ],
    }, now)
    expect(math.recentFocusSeconds).toBe(1500)
    expect(math.focusSeconds).toBe(1920)
    expect(math.timeline.find((row) => row.id === 'task-only')).toMatchObject({ title: '示例练习', date: '2026-10-09', time: '00:20' })
    expect(math.timeline.filter((row) => row.type === 'focus')).toHaveLength(4)
  })

  it('ranks courses by actionable urgency, places archives last, and never changes input records', () => {
    const data = {
      courses: [...courses, { id: 'archived', name: '上学期课程', archivedAt: '2026-09-01' }],
      tasks: [{ id: 'urgent', courseId: 'english', dueDate: '2026-10-08' }, { id: 'old-urgent', courseId: 'archived', dueDate: '2026-09-01' }],
    }
    const snapshot = JSON.stringify(data)
    expect(buildCourseProgress(data, now).map((item) => item.course.id)).toEqual(['english', 'math', 'archived'])
    expect(JSON.stringify(data)).toBe(snapshot)
  })

  it('keeps malformed imported dates visible without making the workspace fail', () => {
    const [math] = buildCourseProgress({
      courses: [courses[0]],
      tasks: [{ id: 'invalid-task', courseId: 'math', dueDate: '2026-99-99' }],
      milestones: [{ id: 'invalid-node', courseId: 'math', date: '2026-02-30' }],
      events: [{ id: 'invalid-event', courseId: 'math', date: '2026-99-99' }],
    }, now)
    expect(math.pendingTasks).toHaveLength(1)
    expect(math.upcoming).toEqual([])
    expect(math.timeline).toHaveLength(3)
    expect(courseTaskDueLabel(math.pendingTasks[0], now)).toBe('未设截止日期')
  })
})
