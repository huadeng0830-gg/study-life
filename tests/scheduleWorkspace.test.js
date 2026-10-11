// @vitest-environment happy-dom
import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScheduleWorkspace } from '../src/composables/scheduleWorkspace.js'
import { MAX_WEEK } from '../src/composables/store'
import { clock } from '../src/composables/store/core.js'
import { dateForWeekDay, semester, scheduleExceptions } from '../src/composables/store/schedule.js'
import { defaultTimeConfig, timeConfig } from '../src/composables/store/timeConfig.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
let previousSemester, previousTimes, previousExceptions, previousClock
beforeEach(() => {
  previousSemester = semester.value
  previousTimes = timeConfig.value
  previousExceptions = scheduleExceptions.value
  previousClock = clock.value
  semester.value = { start: '2026-09-07' }
  timeConfig.value = defaultTimeConfig()
  scheduleExceptions.value = []
  clock.value = new Date('2026-09-14T09:00:00+08:00')
})
afterEach(() => {
  semester.value = previousSemester
  timeConfig.value = previousTimes
  scheduleExceptions.value = previousExceptions
  clock.value = previousClock
})

describe('课表工作区日期与查询合同', () => {
  it('周次上下界、跨周日切换、返回今天与日期跳转保持同步', () => {
    const workspace = useScheduleWorkspace({ courses: ref([]) })
    workspace.viewWeek.value = 0
    workspace.mobileDay.value = 0
    workspace.goWeek(-1)
    workspace.shiftMobileDay(-1)
    expect([workspace.viewWeek.value, workspace.mobileDay.value]).toEqual([0, 0])
    workspace.viewWeek.value = MAX_WEEK
    workspace.mobileDay.value = 6
    workspace.goWeek(1)
    workspace.shiftMobileDay(1)
    expect([workspace.viewWeek.value, workspace.mobileDay.value]).toEqual([MAX_WEEK, 6])
    workspace.viewWeek.value = 2
    workspace.mobileDay.value = 6
    workspace.shiftMobileDay(1)
    expect([workspace.viewWeek.value, workspace.mobileDay.value]).toEqual([3, 0])
    workspace.shiftMobileDay(-1)
    expect([workspace.viewWeek.value, workspace.mobileDay.value]).toEqual([2, 6])
    workspace.calendarOpen.value = true
    const date = dateForWeekDay(4, 2)
    workspace.goToScheduleDate(date)
    expect([workspace.viewWeek.value, workspace.mobileDay.value, workspace.calendarOpen.value]).toEqual([4, 2, false])
    expect(String(workspace.selectedCalendarDate.value)).toBe(date)
    workspace.goToScheduleDate('invalid')
    expect(workspace.selectedScheduleDate.value).toBe(date)
    workspace.returnToToday()
    expect(workspace.showReturnToday.value).toBe(false)
    workspace.setMobileView('unexpected')
    expect(['day', 'week']).toContain(workspace.mobileView.value)
  })

  it('课程/教师/教室搜索、归档与周统计仍使用同一实时数据源', () => {
    const courses = ref([
      { id: 'fictional-active', name: '测试课程', teacher: '虚构教师', room: 'Test Room', day: 0, start: 1, end: 2, startWeek: 1, endWeek: 16, weeks: 'all' },
      { id: 'fictional-archived', name: '历史课程', archivedAt: '2026-09-01', day: 1, start: 1, end: 2, startWeek: 1, endWeek: 16, weeks: 'all' },
    ])
    const workspace = useScheduleWorkspace({ courses })
    workspace.viewWeek.value = 2
    expect(workspace.weekCourseCount.value).toBe(1)
    expect(workspace.weekTeachingDayCount.value).toBe(1)
    for (const query of ['测试', '虚构教师', 'test room']) {
      workspace.courseQuery.value = query
      expect(workspace.filteredCourses.value.map(course => course.id)).toEqual(['fictional-active'])
      expect(workspace.searchCourseCount.value).toBe(1)
      expect(workspace.searchOccurrences.value.length).toBeGreaterThan(0)
      expect(workspace.searchOccurrences.value.every(item => dateForWeekDay(item.week, item.day) === item.date)).toBe(true)
    }
    workspace.showArchivedCourses.value = true
    workspace.courseQuery.value = '历史'
    expect(workspace.filteredCourses.value.map(course => course.id)).toEqual(['fictional-archived'])
    workspace.courseQuery.value = 'new'
    const count = computed(() => workspace.filteredCourses.value.length)
    expect(count.value).toBe(0)
    courses.value[0].name = 'New Course'
    expect(count.value).toBe(1)
    workspace.courseQuery.value = ''
    expect(workspace.searchOccurrences.value).toEqual([])
    expect(workspace.filteredCourses.value).toHaveLength(2)
  })
})
