// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { eventInputError } from '../src/composables/events/eventFields.js'
import { eventCalendarDays, eventDuration, eventRows, eventState, eventWeek, selectEventPlan, shiftEventMonth } from '../src/composables/events/eventPlanning.js'

const today = '2026-10-09'
const options = { today, time: '10:00' }
const events = [
  { id: 'ended', title: '晨间讨论', date: today, time: '08:00', endTime: '09:00' },
  { id: 'active', title: '项目讨论', date: today, time: '09:30', endTime: '10:30', location: '讨论室' },
  { id: 'future', title: '阅读交流', date: '2026-10-11', time: '14:00' },
  { id: 'inbox', title: '整理书架', date: '' },
  { id: 'archive', title: '旧计划', date: today, archivedAt: '2026-10-08T00:00:00Z' },
  { id: 'deleted', title: '删除项', date: today, deletedAt: '2026-10-08T00:00:00Z' },
]

describe('日程筛选和时间状态', () => {
  it('结束边界即时进入历史，正在进行的日程保留在即将到来和今天', () => {
    const result = selectEventPlan(events, options)
    expect(result.counts).toEqual({ upcoming: 2, today: 2, week: 3, unplanned: 1, past: 1, archived: 1 })
    expect(result.visible.map((event) => event.id)).toEqual(['active', 'future'])
    expect(result.next.id).toBe('active')
    expect(eventState(events[1], today, '10:30').key).toBe('past')
    expect(selectEventPlan(events, { ...options, filter: 'today' }).visible.map((event) => event.id)).toEqual(['ended', 'active'])
  })
  it('只搜索活跃/归档记录，并同步筛选数量和月历标记的数据源', () => {
    const result = selectEventPlan(events, { ...options, query: '讨论室' })
    expect(result.matched.map((event) => event.id)).toEqual(['active'])
    expect(result.counts.upcoming).toBe(1)
    expect(selectEventPlan(events, { ...options, query: '2026-10-11' }).matched.map((event) => event.id)).toEqual(['future'])
    expect(selectEventPlan(events, { ...options, filter: 'archived' }).visible.map((event) => event.id)).toEqual(['archive'])
  })
  it('日期未定和仅有开始时间的旧日程仍可查看，不虚构结束时间', () => {
    expect(eventState({ date: today, time: '09:00' }, today, '10:00').key).toBe('started')
    expect(eventState({ date: '2026-02-30' }, today, '10:00').key).toBe('unplanned')
    expect(selectEventPlan(events, { ...options, filter: 'unplanned' }).visible.map((event) => event.id)).toEqual(['inbox'])
  })
  it('接下来优先展示进行中或即将开始的有时间日程', () => {
    const dateOnly = { id: 'date-only', title: '日期事项', date: today }
    expect(selectEventPlan([dateOnly, ...events], options).next.id).toBe('active')
  })
  it('过去的安排按日期和时间倒序排列，分组数量只计算当前结果', () => {
    const history = [{ id: 'old', title: '历史', date: '2026-10-08' }, ...events, { id: 'later', title: '稍后结束', date: today, time: '08:30', endTime: '09:30' }]
    const visible = selectEventPlan(history, { ...options, filter: 'past' }).visible
    expect(visible.map((event) => event.id)).toEqual(['later', 'ended', 'old'])
    expect(eventRows(visible).map(({ startsGroup, count }) => [startsGroup, count])).toEqual([[true, 2], [false, 2], [true, 1]])
  })
})

describe('日历日期计算', () => {
  it('按周一到周日定位本周，支持跨年', () => {
    expect(eventWeek('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' })
    expect(shiftEventMonth('2026-12', 1)).toBe('2027-01')
  })
  it('闰年月历始终为 6 周，前后月日期和事件数量准确', () => {
    const days = eventCalendarDays('2028-02', [{ id: 'leap', title: '闰日安排', date: '2028-02-29' }])
    expect(days).toHaveLength(42)
    expect(new Date(`${days[0].date}T12:00:00Z`).getUTCDay()).toBe(1)
    expect(days.find((day) => day.date === '2028-02-29').events.map((event) => event.id)).toEqual(['leap'])
    expect(days.filter((day) => day.inMonth)).toHaveLength(29)
    expect(eventDuration({ time: '09:00', endTime: '10:30' })).toBe('1 小时 30 分钟')
  })
})

describe('保存边界校验', () => {
  it.each([
    [{ title: ' ' }, 'title'],
    [{ title: '安排', date: '2026-02-30' }, 'date'],
    [{ title: '安排', date: today, time: '24:00' }, 'time'],
    [{ title: '安排', time: '10:00' }, 'date'],
    [{ title: '安排', date: today, endTime: '10:00' }, 'time'],
    [{ title: '安排', date: today, time: '10:00', endTime: '09:00' }, 'endTime'],
    [{ title: '安排', date: today, time: '10:00', endTime: '10:00' }, 'endTime'],
    [{ title: '安排', reminderMinutes: -1 }, 'reminderMinutes'],
  ])('拒绝无效字段并返回具体字段名称 %j', (value, field) => { expect(eventInputError(value)?.field).toBe(field) })
  it('允许无日期草稿、0 分钟提醒和单条关闭提醒', () => {
    expect(eventInputError({ title: '安排', reminderMinutes: 0 })).toBeNull()
    expect(eventInputError({ title: '安排', reminderEnabled: false, reminderMinutes: -1 })).toBeNull()
  })
})
