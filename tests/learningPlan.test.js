// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()

let domain, buildLearningDay, createLearningBlock, ensureMilestoneReviewTask, learningTasks, studyBlockTaskId
const today = '2026-10-09'
const now = new Date('2026-10-09T01:00:00Z')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  const { settings } = await import('../src/composables/settingsPolicy.js')
  settings.value = { timezone: 'Asia/Shanghai' }
  const { clock } = await import('../src/composables/store/core.js')
  clock.value = now
  const { timeConfig } = await import('../src/composables/store/timeConfig.js')
  timeConfig.value = { campuses: [{ id: 'sample', name: '示例校区' }], seasons: [{ id: 'term', name: '示例作息' }], periods: [{ id: 'p0', label: '第1节' }], times: { term: { sample: [{ start: '09:00', end: '10:00' }] } }, currentCampus: 'sample', currentSeason: 'term', autoSeason: false }
  const { semester } = await import('../src/composables/store/schedule.js')
  semester.value = { start: '2026-10-05' }
  ;({ buildLearningDay, createLearningBlock, ensureMilestoneReviewTask, learningTasks, studyBlockTaskId } = await import('../src/composables/learningPlan.js'))
  domain = (await import('../src/composables/domain/commands.js')).useDomainCommands()
  domain.courses.value = [{ id: 'c1', name: '示例数学', day: 4, start: 'p0', end: 'p0', startWeek: 1, endWeek: 16, weekType: 'all' }]
  domain.tasks.value = [{ id: 't1', title: '示例章节练习', courseId: 'c1', status: 'pending', estimateMinutes: 25 }]
})

afterEach(async () => { (await import('../src/composables/dataVault.js')).cancelPendingMirrorWrites() })
const data = () => ({ courses: domain.courses.value, tasks: domain.tasks.value, events: domain.events.value, focusSessions: domain.focusSessions.value })

describe('课表、待办和复习的学习安排联动', () => {
  it('respects the timetable, school holidays and all-day events', async () => {
    expect(buildLearningDay(data()).suggestions[0].startTime).toBe('10:10')
    const { scheduleExceptions } = await import('../src/composables/store/schedule.js')
    scheduleExceptions.value = [{ id: 'off', date: today, type: 'off' }]
    expect(buildLearningDay(data()).suggestions[0].startTime).toBe('09:00')
    domain.events.value = [{ id: 'all-day', title: '示例全天安排', date: today, time: '' }]
    expect(buildLearningDay(data()).suggestions).toEqual([])
  })

  it('does not exclude tasks because of yesterday, tomorrow or an ended session', () => {
    domain.events.value = [
      { id: 'old', date: '2026-10-08', time: '14:00', endTime: '14:25', sourceText: 'study-block:t1:2026-10-08' },
      { id: 'next', date: '2026-10-10', time: '14:00', endTime: '14:25', sourceText: 'study-block:t1:2026-10-10' },
      { id: 'ended', date: today, time: '08:00', endTime: '08:25', sourceText: `study-block:t1:${today}` },
    ]
    expect(buildLearningDay(data()).suggestions[0].taskId).toBe('t1')
    domain.events.value.push({ id: 'active', date: today, time: '14:00', endTime: '14:25', sourceText: `study-block:t1:${today}` })
    expect(buildLearningDay(data()).suggestions).toEqual([])
  })

  it('revalidates suggestions on save and refuses duplicate or stale conflicting writes', () => {
    const suggestion = buildLearningDay(data()).suggestions[0]
    const event = createLearningBlock(domain, suggestion)
    expect(event).toMatchObject({ sourceType: 'study-block', sourceId: 't1', courseId: 'c1', courseName: '示例数学', time: '10:10', endTime: '10:35' })
    expect(() => createLearningBlock(domain, suggestion)).toThrow('已更新')
    expect(domain.events.value).toHaveLength(1)
    domain.deleteEvent(event.id)
    domain.events.value.push({ id: 'new-conflict', date: today, time: '10:00', endTime: '11:00' })
    expect(() => createLearningBlock(domain, suggestion)).toThrow('已更新')
    expect(domain.tasks.value[0].status).toBe('pending')
  })

  it('reads legacy links containing colon characters and structured links', () => {
    expect(studyBlockTaskId({ sourceText: `study-block:legacy:task:${today}` })).toBe('legacy:task')
    expect(studyBlockTaskId({ sourceType: 'study-block', sourceId: 't1' })).toBe('t1')
    expect(studyBlockTaskId({ sourceText: '普通通知' })).toBe('')
  })

  it('does not mix unrelated errands, archived classes or ambiguous course names into suggestions', () => {
    const courses = [...domain.courses.value, { id: 'old', name: '示例旧课', archivedAt: '2026-09-01' }, { id: 'c2', name: '重名课' }, { id: 'c3', name: '重名课' }]
    const tasks = [...domain.tasks.value, { id: 'errand', title: '示例取件' }, { id: 'archived', title: '旧课程作业', courseId: 'old' }, { id: 'ambiguous', title: '重名任务', course: '重名课' }, { id: 'review', title: '示例复习', kind: 'review' }]
    expect(learningTasks(tasks, courses).map((task) => task.id)).toEqual(['t1', 'review'])
  })

  it('reuses the original review task, allows a new round after completion, and rejects ended exams', () => {
    domain.milestones.value = [{ id: 'exam', name: '示例测验', category: '学习', courseId: 'c1', date: '2026-10-12' }]
    const first = ensureMilestoneReviewTask(domain, 'exam')
    expect(first.created).toBe(true)
    expect(first.task).toMatchObject({ kind: 'review', sourceId: 'exam', courseId: 'c1', dueDate: today })
    expect(ensureMilestoneReviewTask(domain, 'exam')).toMatchObject({ created: false, task: { id: first.task.id } })
    domain.completeTask(first.task.id)
    expect(ensureMilestoneReviewTask(domain, 'exam').created).toBe(true)
    domain.milestones.value[0].date = '2026-10-08'
    expect(() => ensureMilestoneReviewTask(domain, 'exam')).toThrow('已结束')
  })

  it('counts actual focus time on the app timezone date and leaves past dates without suggestions', () => {
    domain.focusSessions.value = [{ id: 's1', startedAt: '2026-10-08T18:00:00Z', actualFocusSeconds: 900 }, { id: 's2', startedAt: '2026-10-08T12:00:00Z', actualFocusSeconds: 600 }]
    expect(buildLearningDay(data()).focusSeconds).toBe(900)
    expect(buildLearningDay(data(), '2026-10-08').suggestions).toEqual([])
  })

  it('handles old focus records without dates and uses the timetable fallback when auto seasons are incomplete', async () => {
    domain.focusSessions.value = [{ id: 'undated', startedAt: '', actualFocusSeconds: 900 }]
    const { timeConfig } = await import('../src/composables/store/timeConfig.js')
    timeConfig.value.autoSeason = true
    timeConfig.value.seasons.push({ id: 'other', name: '示例第二作息' })
    expect(buildLearningDay(data()).suggestions[0].startTime).toBe('10:10')
    expect(buildLearningDay(data()).focusSeconds).toBe(0)
    expect(buildLearningDay(data(), '2026-02-30').suggestions).toEqual([])
  })
})
