import { computed } from 'vue'
import { periodIndex, timeConfig } from '../store/timeConfig.js'
import { coursesForDate } from '../store/schedule.js'

export function useScheduleGrid(courses, scheduleExceptions, semester, viewWeek, mobileView, mobileDay) {
  const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

  const viewDates = computed(() =>
    DAYS.map((_, day) => {
      const date = new Date(semester.value.start + 'T00:00:00')
      date.setDate(date.getDate() + (viewWeek.value - 1) * 7 + day)
      const p = (v) => String(v).padStart(2, '0')
      return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    })
  )

  const viewExceptions = computed(() =>
    viewDates.value.map((date) => scheduleExceptions.value.find((item) => item.date === date) ?? null)
  )

  const visibleCourses = computed(() =>
    viewDates.value.flatMap((date) => coursesForDate(courses.value, date))
  )

  const mobileDate = computed(() => {
    const date = new Date(semester.value.start + 'T00:00:00')
    date.setDate(date.getDate() + (viewWeek.value - 1) * 7 + mobileDay.value)
    const p = (v) => String(v).padStart(2, '0')
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
  })

  const mobileCourses = computed(() =>
    coursesForDate(courses.value, mobileDate.value).sort((a, b) => periodIndex(a.start) - periodIndex(b.start))
  )

  const mobileDayLabel = computed(() => `${DAYS[mobileDay.value]} · ${mobileDate.value.slice(5).replace('-', '月')}日`)

  const conflictSummary = computed(() => {
    const positions = new Map(timeConfig.value.periods.map((period, index) => [period.id, index]))
    const byDay = new Map()
    for (const course of visibleCourses.value) {
      const start = positions.get(course.start) ?? -1
      const end = positions.get(course.end) ?? -1
      if (start < 0 || end < 0) continue
      const day = course.displayDay
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push({ course, start: Math.min(start, end), end: Math.max(start, end) })
    }
    const ids = new Set()
    let count = 0
    for (const dayCourses of byDay.values()) {
      dayCourses.sort((left, right) => left.start - right.start || left.end - right.end)
      for (let i = 0; i < dayCourses.length; i++) {
        const left = dayCourses[i]
        for (let j = i + 1; j < dayCourses.length; j++) {
          const right = dayCourses[j]
          if (right.start > left.end) break
          count++
          ids.add(`${left.course.id}-${left.course.displayDay ?? left.course.day}`)
          ids.add(`${right.course.id}-${right.course.displayDay ?? right.course.day}`)
        }
      }
    }
    return { ids, count }
  })

  const conflictIds = computed(() => conflictSummary.value.ids)
  const conflictCount = computed(() => conflictSummary.value.count)

  function shiftMobileDay(delta) {
    const next = mobileDay.value + delta
    if (next >= 0 && next <= 6) mobileDay.value = next
  }

  return {
    DAYS,
    viewDates,
    viewExceptions,
    visibleCourses,
    mobileDate,
    mobileCourses,
    mobileDayLabel,
    conflictIds,
    conflictCount,
    shiftMobileDay,
  }
}
