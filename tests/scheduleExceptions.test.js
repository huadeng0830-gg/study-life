// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  coursesForDate,
  dateForWeekDay,
  scheduleExceptionForDate,
  scheduleExceptions,
  semester,
  upsertScheduleException,
} from '../src/composables/store/schedule.js'

const courses = [
  { id: 'monday', name: '周一课程', day: 0, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16, weekType: 'all' },
  { id: 'saturday', name: '周六课程', day: 5, start: 'p3', end: 'p4', startWeek: 1, endWeek: 16, weekType: 'all' },
]

beforeEach(() => {
  semester.value = { start: '2026-08-24' }
  scheduleExceptions.value = []
})

describe('特殊日期课表', () => {
  it('可以根据学期周次得到具体日期', () => {
    expect(dateForWeekDay(1, 0)).toBe('2026-08-24')
    expect(dateForWeekDay(2, 5)).toBe('2026-09-05')
  })

  it('停课日不显示原课程', () => {
    scheduleExceptions.value = [{ id: 'off', date: '2026-08-24', type: 'off' }]
    expect(coursesForDate(courses, '2026-08-24')).toEqual([])
  })

  it('补课日按照指定星期显示课程并保留实际显示列', () => {
    scheduleExceptions.value = [{ id: 'makeup', date: '2026-08-29', type: 'makeup', sourceDay: 0 }]
    const result = coursesForDate(courses, '2026-08-29')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('monday')
    expect(result[0].displayDay).toBe(5)
    expect(result[0].sourceDay).toBe(0)
  })

  it('放假日期范围覆盖范围内的每一天，范围外不受影响', () => {
    scheduleExceptions.value = [{ id: 'holiday', date: '2026-10-01', endDate: '2026-10-07', type: 'off' }]
    expect(scheduleExceptionForDate('2026-09-30')).toBeNull()
    expect(scheduleExceptionForDate('2026-10-01')?.type).toBe('off')
    expect(scheduleExceptionForDate('2026-10-04')?.type).toBe('off')
    expect(scheduleExceptionForDate('2026-10-07')?.type).toBe('off')
    expect(scheduleExceptionForDate('2026-10-08')).toBeNull()
    expect(coursesForDate(courses, '2026-10-03')).toEqual([])
  })

  it('编辑已有例外时按 id 覆盖，即使日期改变也不会残留旧条目', () => {
    scheduleExceptions.value = []
    const created = upsertScheduleException({ date: '2026-10-01', type: 'off', note: '国庆' })
    const edited = upsertScheduleException({ id: created.id, date: '2026-10-02', type: 'makeup', sourceDay: 0, note: '补课' })
    expect(scheduleExceptions.value).toHaveLength(1)
    expect(edited.date).toBe('2026-10-02')
    expect(edited.type).toBe('makeup')
    expect(scheduleExceptions.value[0].id).toBe(created.id)
  })

  it('补课日可以指定补齐哪一周的课程', () => {
    scheduleExceptions.value = [{ id: 'makeup', date: '2026-08-29', type: 'makeup', sourceDay: 0, sourceWeek: 2 }]
    const onlyWeek2 = [{ id: 'week2', name: '第2周课程', day: 0, start: 'p1', end: 'p2', startWeek: 2, endWeek: 2, weekType: 'all' }]
    const result = coursesForDate(onlyWeek2, '2026-08-29')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('week2')
    expect(result[0].sourceDay).toBe(0)

    // 未指定周次时按补课日所在周（第 1 周）查找，第 2 周的课程不会被显示。
    scheduleExceptions.value = [{ id: 'makeup-auto', date: '2026-08-29', type: 'makeup', sourceDay: 0 }]
    expect(coursesForDate(onlyWeek2, '2026-08-29')).toEqual([])
  })
})
