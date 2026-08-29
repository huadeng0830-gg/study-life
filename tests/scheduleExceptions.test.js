// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  coursesForDate,
  dateForWeekDay,
  scheduleExceptions,
  semester,
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
})
