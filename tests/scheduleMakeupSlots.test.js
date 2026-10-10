// @vitest-environment happy-dom
import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coursesForDate, coursesForDates, removeScheduleException, scheduleExceptions, semester, upsertScheduleException } from '../src/composables/store/schedule.js'
import { defaultTimeConfig, timeConfig } from '../src/composables/store/timeConfig.js'
import { useScheduleGrid } from '../src/composables/schedule/useScheduleGrid.js'
import { useScheduleCampusSeason } from '../src/composables/scheduleCampusSeason.js'
import { findEventConflicts } from '../src/composables/events/eventConflicts.js'
import { buildLearningDay } from '../src/composables/learningPlan.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const DATE = '2026-10-14'
const COURSES = [
  { id: 'demo-regular', name: '示例常规课', day: 2, start: 'p1', end: 'p2', startWeek: 1, endWeek: 20 },
  { id: 'demo-math', name: '示例数学', day: 0, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20 },
  { id: 'demo-physics', name: '示例物理', day: 1, start: 'p1', end: 'p2', startWeek: 1, endWeek: 20 },
]
const previous = { semester: semester.value, exceptions: scheduleExceptions.value, times: timeConfig.value }
const makeup = (overrides = {}) => ({ date: DATE, type: 'session_makeup', courseIds: ['demo-math'],
  courseSlots: [{ courseId: 'demo-math', start: 'p5', end: 'p6' }], ...overrides })

beforeEach(() => {
  semester.value = { start: '2026-08-31' }
  scheduleExceptions.value = []
  timeConfig.value = defaultTimeConfig()
})
afterEach(() => {
  semester.value = previous.semester
  scheduleExceptions.value = previous.exceptions
  timeConfig.value = previous.times
})

describe('部分补课的具体节次', () => {
  it('保存指定节次，在实际日期显示，保留原课表和当天正常课程', () => {
    const saved = upsertScheduleException(makeup())
    expect(saved.courseSlots).toEqual([{ courseId: 'demo-math', start: 'p5', end: 'p6' }])
    const result = coursesForDate(COURSES, DATE)
    expect(result.find((course) => course.id === 'demo-math')).toMatchObject({ start: 'p5', end: 'p6', displayDay: 2,
      sourceDay: 0, sessionMakeup: true, exceptionId: saved.id, exceptionDate: DATE })
    expect(result.find((course) => course.id === 'demo-regular')).toMatchObject({ start: 'p1', end: 'p2' })
    expect(coursesForDate(COURSES, '2026-10-12')[0]).toMatchObject({ id: 'demo-math', start: 'p3', end: 'p4' })
    expect(COURSES[1]).toMatchObject({ start: 'p3', end: 'p4' })
  })

  it('多门补课可以各自使用不同节次，也可只补一节', () => {
    upsertScheduleException(makeup({ courseIds: ['demo-math', 'demo-physics'], courseSlots: [
      { courseId: 'demo-math', start: 'p5', end: 'p6' }, { courseId: 'demo-physics', start: 'p9', end: 'p9' },
    ] }))
    expect(coursesForDates(COURSES, [DATE])[0].map((course) => [course.id, course.start, course.end])).toEqual([
      ['demo-regular', 'p1', 'p2'], ['demo-math', 'p5', 'p6'], ['demo-physics', 'p9', 'p9'],
    ])
  })

  it('编辑和删除补课只影响这条安排，不改其他日期', () => {
    const saved = upsertScheduleException(makeup())
    upsertScheduleException(makeup({ id: saved.id, courseSlots: [{ courseId: 'demo-math', start: 'p7', end: 'p8' }] }))
    expect(scheduleExceptions.value).toHaveLength(1)
    expect(coursesForDate(COURSES, DATE).find((course) => course.sessionMakeup).start).toBe('p7')
    expect(coursesForDate(COURSES, '2026-10-21').map((course) => course.id)).toEqual(['demo-regular'])
    removeScheduleException(saved.id)
    expect(coursesForDate(COURSES, DATE).map((course) => course.id)).toEqual(['demo-regular'])
  })

  it('兼容只有课程 ID 的旧补课，继续使用原节次', () => {
    upsertScheduleException(makeup({ courseSlots: null }))
    expect(coursesForDate(COURSES, DATE).find((course) => course.sessionMakeup)).toMatchObject({ start: 'p3', end: 'p4' })
  })

  it('放假期间的补课仍使用选定的新节次；部分停课继续优先', () => {
    upsertScheduleException({ date: DATE, type: 'off' })
    upsertScheduleException(makeup())
    expect(coursesForDate(COURSES, DATE)).toHaveLength(1)
    expect(coursesForDate(COURSES, DATE)[0].start).toBe('p5')
    upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['demo-math'] })
    expect(coursesForDate(COURSES, DATE)).toEqual([])
  })

  it('冲突标记按补课的新节次计算，移出重叠时间后冲突消失', () => {
    const saved = upsertScheduleException(makeup({ courseSlots: [{ courseId: 'demo-math', start: 'p2', end: 'p3' }] }))
    const grid = useScheduleGrid(computed(() => COURSES), ref(7), ref('week'), ref(2))
    expect(grid.conflictCount.value).toBe(1)
    expect(grid.conflictIds.value.size).toBe(2)
    upsertScheduleException(makeup({ id: saved.id }))
    expect(grid.conflictCount.value).toBe(0)
  })

  it('日程冲突及学习时段按新节次占用，原节次释放', () => {
    upsertScheduleException(makeup())
    const context = { courses: COURSES }
    expect(findEventConflicts({ date: DATE, time: '10:10', endTime: '10:30' }, context)).toEqual([])
    expect(findEventConflicts({ date: DATE, time: '14:10', endTime: '14:30' }, context)[0]).toMatchObject({
      entityId: 'course:demo-math', existing: { time: '14:00', endTime: '15:35' },
    })
    const plan = buildLearningDay({ courses: COURSES }, DATE, new Date('2026-10-14T07:00:00+08:00'))
    expect(plan.busyIntervals).toContainEqual(expect.objectContaining({ start: 840, end: 935 }))
    expect(plan.busyIntervals).not.toContainEqual(expect.objectContaining({ start: 605, end: 705 }))
  })

  it('节次只被补课使用时也不能删除，防止安排失效', () => {
    upsertScheduleException(makeup())
    const settings = useScheduleCampusSeason({ courses: ref(COURSES), courseTemplates: ref([]) })
    expect(settings.courseCountByPeriodId('p5')).toBe(1)
    expect(settings.courseCountByPeriodId('p6')).toBe(1)
    expect(settings.courseCountByPeriodId('p7')).toBe(0)
  })

  it('导入的损坏补课节次不会悄悄改回原上课时间', () => {
    scheduleExceptions.value = [{ id: 'broken-demo', ...makeup({ courseSlots: [{ courseId: 'demo-math', start: 'missing', end: 'p6' }] }) }]
    expect(coursesForDate(COURSES, DATE).map((course) => course.id)).toEqual(['demo-regular'])
  })
})

describe('补课节次的存储校验', () => {
  it.each([
    [], {}, [null], [{ courseId: 'other', start: 'p5', end: 'p6' }],
    [{ courseId: 'demo-math', start: '', end: 'p6' }],
    [{ courseId: 'demo-math', start: 'p5', end: 'missing' }],
    [{ courseId: 'demo-math', start: 'p6', end: 'p5' }],
    [{ courseId: 'demo-math', start: 'p5', end: 'p6' }, { courseId: 'demo-math', start: 'p5', end: 'p6' }],
  ])('拒绝不完整、无效、倒置或重复节次：%j', (courseSlots) => {
    expect(upsertScheduleException(makeup({ courseSlots }))).toBeNull()
    expect(scheduleExceptions.value).toEqual([])
  })

  it('每门课都必须有节次，不能使用重复的课程 ID 代替另一门课', () => {
    expect(upsertScheduleException(makeup({ courseIds: ['demo-math', 'demo-physics'], courseSlots: [
      { courseId: 'demo-math', start: 'p5', end: 'p6' }, { courseId: 'demo-math', start: 'p7', end: 'p8' },
    ] }))).toBeNull()
  })
})
