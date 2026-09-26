import { ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { weekOf, dateForWeekDay } from './store/schedule.js'
import { currentWeek as appCurrentWeek } from './timeContext.js'
import { isArchived } from './domain/state.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from './focusNavigation.js'

/**
 * 「从别处跳到某一节课」的聚焦路由（从 ScheduleView 拆出）。
 *
 * 必须在 setup 里同步调用：watch 建在 composable 内部，
 * 生命周期与宿主组件一致（拆成普通函数会让 watch 失去当前作用域）。
 */
export function useScheduleFocusRoute({
  courses,
  clampViewWeek,
  viewWeek,
  mobileDay,
  showArchivedCourses,
}) {
  const route = useRoute()
  const router = useRouter()
  const focusedCourseId = ref('')
  const focusMessage = ref('')
  let focusHandled = ''

  function weekdayIndex(date) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    return day === 0 ? 6 : day - 1
  }

  async function focusRouteCourse() {
    const { id, date } = readFocusQuery(route)
    if (!id || focusHandled === id) return
    focusHandled = id
    const course = courses.value.find((item) => String(item.id) === id)
    if (!course) {
      focusMessage.value = '这门课程可能已删除或已移动。'
      await clearFocusFromRoute(router, route)
      return
    }
    showArchivedCourses.value = isArchived(course)
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : dateForWeekDay(clampViewWeek(appCurrentWeek.value), course.day)
    viewWeek.value = clampViewWeek(weekOf(targetDate))
    mobileDay.value = weekdayIndex(targetDate)
    focusedCourseId.value = id
    await nextTick()
    const element = await focusElementWhenReady(id, { date: targetDate }) || await focusElementWhenReady(id)
    if (!element) focusMessage.value = '这门课程可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
  }

  watch(
    () => [route.query.focus, route.query.date, courses.value.length, viewWeek.value, mobileDay.value],
    () => { void focusRouteCourse() },
    { immediate: true },
  )

  return { focusedCourseId, focusMessage }
}
