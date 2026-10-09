// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  coursesForDate, coursesForDates, removeScheduleException, repairScheduleExceptionIds, scheduleExceptionForDate,
  scheduleExceptions, semester, upsertScheduleException,
} from '../src/composables/store/schedule.js'

const DATE = '2026-10-14'
const COURSES = [
  { id: 'math', name: '示例数学', day: 2, start: 'p1', end: 'p2', startWeek: 1, endWeek: 20 },
  { id: 'english', name: '示例英语', day: 2, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20 },
  { id: 'physics', name: '示例物理', day: 0, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20 },
]
const idsOn = (date = DATE) => coursesForDate(COURSES, date).map((course) => course.id).sort()

beforeEach(() => {
  semester.value = { start: '2026-09-07' }
  scheduleExceptions.value = []
})

describe('课程调整的记录与优先级', () => {
  it('修复历史重复 ID，并保留每条记录的全部安排内容', () => {
    scheduleExceptions.value = [
      { id: 'legacy-id', date: DATE, type: 'session_off', courseIds: ['math'], note: '示例通知甲' },
      { id: 'legacy-id', date: DATE, type: 'session_off', courseIds: ['english'], note: '示例通知乙' },
    ]
    expect(repairScheduleExceptionIds()).toBe(true)
    expect(scheduleExceptions.value[0].id).toBe('legacy-id')
    const repaired = scheduleExceptions.value[1]
    expect(repaired.id).not.toBe('legacy-id')
    expect(repaired).toMatchObject({ date: DATE, courseIds: ['english'], note: '示例通知乙' })
    expect(repairScheduleExceptionIds()).toBe(false)
    removeScheduleException(repaired.id)
    expect(idsOn()).toEqual(['english'])
  })
  it('同一天的多条部分停课有独立 ID，可分别编辑和删除', () => {
    const first = upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['math'] })
    const second = upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['english'] })
    expect(second.id).not.toBe(first.id)
    upsertScheduleException({ ...second, note: '只改第二条' })
    expect(scheduleExceptions.value.find((item) => item.id === first.id).note).not.toBe('只改第二条')
    expect(removeScheduleException(second.id).courseIds).toEqual(['english'])
    expect(idsOn()).toEqual(['english'])
  })

  it.each([false, true])('单日整天调课优先于放假范围，与数组顺序无关（倒序 %s）', (reverse) => {
    const records = [
      { id: 'holiday', type: 'off', date: '2026-10-12', endDate: '2026-10-18' },
      { id: 'makeup', type: 'makeup', date: DATE, sourceDay: 0 },
    ]
    scheduleExceptions.value = reverse ? records.reverse() : records
    expect(scheduleExceptionForDate(DATE)?.id).toBe('makeup')
    expect(idsOn()).toEqual(['physics'])
    expect(idsOn('2026-10-12')).toEqual([])
  })

  it('在放假开始日期安排整天调课时，假期余下的日期仍保留', () => {
    upsertScheduleException({ date: '2026-10-12', endDate: '2026-10-18', type: 'off' })
    upsertScheduleException({ date: '2026-10-12', type: 'makeup', sourceDay: 2 })
    expect(scheduleExceptions.value).toHaveLength(2)
    expect(idsOn('2026-10-12')).toEqual(['english', 'math'])
    expect(scheduleExceptionForDate('2026-10-14')?.type).toBe('off')
  })

  it('覆盖同一天的单日安排时保留记录 ID', () => {
    const first = upsertScheduleException({ date: DATE, type: 'off' })
    const second = upsertScheduleException({ date: DATE, type: 'makeup', sourceDay: 0 })
    expect(second.id).toBe(first.id)
    expect(scheduleExceptions.value).toHaveLength(1)
  })

  it('历史重复整天安排按最近更新时间生效', () => {
    scheduleExceptions.value = [
      { id: 'old', date: DATE, type: 'off', updatedAt: '2026-10-09T01:00:00Z' },
      { id: 'new', date: DATE, type: 'makeup', sourceDay: 0, updatedAt: '2026-10-09T02:00:00Z' },
    ]
    expect(idsOn()).toEqual(['physics'])
    scheduleExceptions.value.reverse()
    expect(idsOn()).toEqual(['physics'])
  })

  it('放假期间明确安排的部分补课仍生效，原课表继续停课', () => {
    upsertScheduleException({ date: '2026-10-12', endDate: '2026-10-18', type: 'off' })
    upsertScheduleException({ date: DATE, type: 'session_makeup', courseIds: ['physics'] })
    expect(idsOn()).toEqual(['physics'])
  })

  it('历史数据中同一门课既补课又停课时，停课优先', () => {
    upsertScheduleException({ date: DATE, type: 'session_makeup', courseIds: ['physics', 'math'] })
    upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['physics', 'math'] })
    expect(idsOn()).toEqual(['english'])
  })

  it('预览可以排除正在编辑的记录，不会修改已保存安排', () => {
    const record = upsertScheduleException({ date: DATE, type: 'session_off', courseIds: ['math'] })
    const previewRecords = scheduleExceptions.value.filter((item) => item.id !== record.id)
    expect(coursesForDate(COURSES, DATE, previewRecords).map((course) => course.id).sort()).toEqual(['english', 'math'])
    expect(coursesForDates(COURSES, [DATE], previewRecords)[0]).toHaveLength(2)
    expect(idsOn()).toEqual(['english'])
  })
})

describe('课程调整的输入校验', () => {
  it.each([
    { date: '2026-02-30', type: 'off' },
    { date: DATE, endDate: '2026-10-01', type: 'off' },
    { date: DATE, type: 'session_off', courseIds: [] },
    { date: DATE, type: 'makeup', sourceDay: 1.5 },
    { date: DATE, type: 'makeup', sourceDay: 7 },
    { date: DATE, type: 'makeup', sourceWeek: 26 },
    { date: DATE, type: 'invalid-type' },
  ])('拒绝无效安排：%j', (record) => {
    expect(upsertScheduleException(record)).toBeNull()
    expect(scheduleExceptions.value).toHaveLength(0)
  })
  it('导入记录中不存在的结束日期不会意外把后续日期全停课', () => {
    scheduleExceptions.value = [{ id: 'broken', date: '2026-10-12', endDate: '9999-99-99', type: 'off' }]
    expect(idsOn()).toEqual(['english', 'math'])
  })
})
