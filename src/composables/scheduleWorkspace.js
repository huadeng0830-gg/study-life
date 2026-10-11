import { computed, ref } from 'vue'
import { parseDate } from '@internationalized/date'
import { MAX_WEEK } from './store'
import { currentDayIndex, currentWeek as appCurrentWeek } from './timeContext.js'
import { coursesForDates, dateForWeekDay, weekOf } from './store/schedule.js'
import { DAYS } from './scheduleBatchText.js'
import { isArchived } from './domain/state.js'

/** Date navigation and read-only schedule projection share one view context. */
export function useScheduleWorkspace({ courses }) {
  const showArchivedCourses = ref(false)
  const visibleCourses = computed(() => showArchivedCourses.value ? courses.value : courses.value.filter((course) => !isArchived(course)))
  const courseQuery = ref('')
  const normalizedCourseQuery = computed(() => courseQuery.value.trim().toLocaleLowerCase())
  const filteredCourses = computed(() => {
    const query = normalizedCourseQuery.value
    if (!query) return visibleCourses.value
    return visibleCourses.value.filter((course) =>
      [course.name, course.teacher, course.room]
        .some((value) => String(value ?? '').toLocaleLowerCase().includes(query)),
    )
  })
  const clampViewWeek = (week) => Math.min(Math.max(week, 0), MAX_WEEK)
  const viewWeek = ref(clampViewWeek(appCurrentWeek.value))
  const mobileView = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches ? 'day' : 'week')
  const mobileDay = ref(currentDayIndex.value)
  const todayIdx = currentDayIndex
  const calendarOpen = ref(false)
  const selectedCalendarDate = computed(() => parseDate(dateForWeekDay(viewWeek.value, mobileDay.value)))
  const calendarMinDate = computed(() => parseDate(dateForWeekDay(0, 0)))
  const calendarMaxDate = computed(() => parseDate(dateForWeekDay(MAX_WEEK, 6)))

  const curWeek = computed(() => clampViewWeek(appCurrentWeek.value))
  const weekDates = computed(() => DAYS.map((_, day) => dateForWeekDay(viewWeek.value, day)))
  const weekMeetings = computed(() => coursesForDates(filteredCourses.value, weekDates.value).flat())
  const searchOccurrences = computed(() => {
    if (!normalizedCourseQuery.value) return []
    const dates = Array.from({ length: MAX_WEEK + 1 }, (_, week) =>
      DAYS.map((_, day) => dateForWeekDay(week, day)),
    ).flat()

    return coursesForDates(filteredCourses.value, dates).flatMap((meetings, index) =>
      meetings.map((course) => ({
        id: `${String(course.id)}:${dates[index]}:${course.start}:${course.end}`,
        course,
        date: dates[index],
        week: Math.floor(index / DAYS.length),
        day: index % DAYS.length,
      })),
    )
  })
  const searchCourseCount = computed(() => new Set(searchOccurrences.value.map((item) => String(item.course.id))).size)
  const selectedScheduleDate = computed(() => dateForWeekDay(viewWeek.value, mobileDay.value))
  const weekCourseCount = computed(() => new Set(weekMeetings.value.map((course) => String(course.id))).size)
  const weekTeachingDayCount = computed(() => new Set(weekMeetings.value.map((course) => course.displayDay)).size)
  const weekDateRange = computed(() => {
    const format = (date) => {
      const [, month, day] = date.split('-')
      return `${Number(month)}月${Number(day)}日`
    }
    return `${format(weekDates.value[0])} – ${format(weekDates.value[6])}`
  })
  const showReturnToday = computed(() =>
    viewWeek.value !== curWeek.value || (mobileView.value === 'day' && mobileDay.value !== todayIdx.value),
  )

  function returnToToday() {
    viewWeek.value = curWeek.value
    if (todayIdx.value >= 0 && todayIdx.value <= 6) mobileDay.value = todayIdx.value
  }

  function goWeek(delta) {
    const next = viewWeek.value + delta
    if (next >= 0 && next <= MAX_WEEK) viewWeek.value = next
  }

  function goToScheduleDate(value) {
    const date = String(value ?? '')
    const week = weekOf(date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(week) || week < 0 || week > MAX_WEEK) return
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    viewWeek.value = week
    mobileDay.value = weekday === 0 ? 6 : weekday - 1
    calendarOpen.value = false
  }

  function formatSearchDate(value) {
    const [, month, day] = String(value ?? '').split('-')
    return month && day ? `${Number(month)}月${Number(day)}日` : value
  }

  function setMobileView(value) {
    if (value === 'day' || value === 'week') mobileView.value = value
  }

  function shiftMobileDay(delta) {
    const next = mobileDay.value + delta
    if (next < 0 && viewWeek.value > 0) {
      viewWeek.value -= 1
      mobileDay.value = 6
    } else if (next > 6 && viewWeek.value < MAX_WEEK) {
      viewWeek.value += 1
      mobileDay.value = 0
    } else if (next >= 0 && next <= 6) {
      mobileDay.value = next
    }
  }

  return {
    showArchivedCourses, visibleCourses, courseQuery, normalizedCourseQuery, filteredCourses,
    clampViewWeek, viewWeek, mobileView, mobileDay, todayIdx, calendarOpen,
    selectedCalendarDate, calendarMinDate, calendarMaxDate, curWeek, weekDates,
    weekMeetings, searchOccurrences, searchCourseCount, selectedScheduleDate,
    weekCourseCount, weekTeachingDayCount, weekDateRange, showReturnToday,
    returnToToday, goWeek, goToScheduleDate, formatSearchDate, setMobileView, shiftMobileDay,
  }
}
