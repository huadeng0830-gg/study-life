import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { TASK_PLAN_STATE, isArchived, taskPlanningState } from '../domain/state.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../focusNavigation.js'

/** Applies a task deep link to the list state and moves keyboard focus to its row. */
export function useTaskRouteFocus({ tasks, route, router, now, filter, showHistory, applyViewState }) {
  const focusedTaskId = ref('')
  const focusMessage = ref('')
  let waitTimer = 0
  let waitAttempts = 0
  let handledId = ''

  async function focusRouteTask() {
    const { id } = readFocusQuery(route)
    if (!id || handledId === id) return
    if (!tasks.value.length) {
      if (waitAttempts >= 12) {
        waitAttempts = 0
        handledId = id
        focusMessage.value = '这条待办可能已删除或已移动。'
        await clearFocusFromRoute(router, route)
        return
      }
      waitAttempts += 1
      window.clearTimeout(waitTimer)
      waitTimer = window.setTimeout(() => { void focusRouteTask() }, 150)
      return
    }

    waitAttempts = 0
    handledId = id
    const task = tasks.value.find((item) => String(item.id) === id)
    if (!task) {
      focusMessage.value = '这条待办可能已删除或已移动。'
      await clearFocusFromRoute(router, route)
      return
    }

    const archived = isArchived(task)
    const planState = taskPlanningState(task, now.value)
    // Make the deep-linked row visible before trying to focus its element.
    applyViewState(
      {
        history: archived,
        q: '',
        priority: 'all',
        period: 'all',
        ...(archived ? {} : { filter: planState === TASK_PLAN_STATE.completed ? TASK_PLAN_STATE.completed : planState === TASK_PLAN_STATE.scheduled ? TASK_PLAN_STATE.scheduled : TASK_PLAN_STATE.unplanned }),
      },
      { touchFilter: true, also: { view: null, month: null } },
    )
    focusedTaskId.value = id
    await nextTick()
    const element = await focusElementWhenReady(id)
    focusMessage.value = element ? '' : '这条待办可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
  }

  watch(
    () => [route.query.focus, tasks.value.length, filter.value, showHistory.value],
    () => { void focusRouteTask() },
    { immediate: true },
  )
  onBeforeUnmount(() => window.clearTimeout(waitTimer))

  return { focusedTaskId, focusMessage }
}
