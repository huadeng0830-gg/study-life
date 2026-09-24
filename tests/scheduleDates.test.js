// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

describe('课表日期使用学期真实首周日期', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 3, 12, 0, 0))
    localStorage.clear()
    localStorage.setItem('sl_semester', JSON.stringify({ start: '2026-09-07' }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('不会把未来设置的首周周一改成当前周一', async () => {
    const { semester, dateForWeekDay, currentWeek } = await import('../src/composables/store/schedule.js')

    expect(semester.value.start).toBe('2026-09-07')
    expect(currentWeek()).toBe(0)
    expect(dateForWeekDay(0, 0)).toBe('2026-08-31')
    expect(dateForWeekDay(1, 0)).toBe('2026-09-07')
  })

  it('移动端课表标题使用学期首周的真实日期', async () => {
    const { useScheduleGrid } = await import('../src/composables/schedule/useScheduleGrid.js')
    const grid = useScheduleGrid(ref([]), ref(0), ref('day'), ref(0))

    expect(grid.mobileDayLabel.value).toBe('周一 · 08月31日')
  })

  it('任意日期都会归一到所在周的周一', async () => {
    const { mondayOfDate } = await import('../src/composables/store/schedule.js')

    expect(mondayOfDate('2026-09-07')).toBe('2026-09-07')
    expect(mondayOfDate('2026-09-10')).toBe('2026-09-07')
    expect(mondayOfDate('')).toBe('')
  })

  it('批量查询多天课程时保留每一天的展示日期与星期筛选', async () => {
    const { coursesForDates } = await import('../src/composables/store/schedule.js')
    const result = coursesForDates([
      { id: 'monday', name: '周一课程', day: 0, startWeek: 1, endWeek: 1 },
      { id: 'tuesday', name: '周二课程', day: 1, startWeek: 1, endWeek: 1 },
    ], ['2026-09-07', '2026-09-08'])

    expect(result.map((day) => day.map((course) => course.id))).toEqual([['monday'], ['tuesday']])
    expect(result[0][0]).toMatchObject({ displayDay: 0, sourceDay: 0, exceptionDate: '' })
    expect(result[1][0]).toMatchObject({ displayDay: 1, sourceDay: 1, exceptionDate: '' })
  })
})
