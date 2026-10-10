<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import NoticePaste from '../components/NoticePaste.vue'
import DomainCsvImportButton from '../components/DomainCsvImportButton.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import VirtualList from '../components/VirtualList.vue'
import Toast from '../components/Toast.vue'
import TaskWorkCheckpointFields from '../components/tasks/TaskWorkCheckpointFields.vue'
import TaskWorkSession from '../components/tasks/TaskWorkSession.vue'
import TaskTimeEditor from '../components/tasks/TaskTimeEditor.vue'
import TaskTimeShift from '../components/tasks/TaskTimeShift.vue'
import TaskStageAction from '../components/tasks/TaskStageAction.vue'
import TaskRescheduleDialog from '../components/tasks/TaskRescheduleDialog.vue'
import LearningNavigation from '../components/learning/LearningNavigation.vue'
import TaskFocusLink from '../components/learning/TaskFocusLink.vue'
import { appearance } from '../composables/appearance.js'
import { findUniqueCourseByName } from '../composables/courseLinks.js'
import { classifyTasks } from '../composables/smartClassify.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { selectTaskView } from '../composables/domain/selectors.js'
import { TASK_PLAN_STATE, isArchived, taskPlanningState, taskStatus } from '../composables/domain/state.js'
import { addAppDays, appCalendarDaysBetween, appDateTime, appNow, appToday, formatAppDate } from '../composables/timeContext.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'
import { useTaskEditor } from '../composables/tasks/useTaskEditor.js'
import { taskTimeComparison } from '../composables/tasks/taskWorkProgress.js'
import { useTaskWorkSession } from '../composables/tasks/useTaskWorkSession.js'
import TaskBoard from '../components/task-views/TaskBoard.vue'
import TaskCalendar from '../components/task-views/TaskCalendar.vue'
import { buildTaskBoard, buildTaskMonthGrid, shiftTaskMonth, taskMonthFromQuery, taskMonthLabel, taskViewModeFromQuery } from '../composables/taskViews.js'
import { TASK_REPEATS, taskRepeatLabel } from '../composables/taskRecurrence.js'
import { filterTaskWorkspace, taskWorkspaceSummary } from '../composables/planningViews.js'
import { taskHasTime, taskRepeatBase, taskStages, taskTimeSummary } from '../composables/tasks/taskTimePlan.ts'
import { useTaskStageActions } from '../composables/tasks/useTaskStageActions.ts'
import { undoTaskTimeShift } from '../composables/tasks/taskTimeShift.ts'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { defaultReminderMinutes } from '../composables/settingsPolicy.js'

const domain = useDomainCommands()
/** @type {import('vue').Ref<import('../types/domain').Course[]>} */
const courses = domain.courses
/** @type {import('vue').Ref<import('../types/domain').Task[]>} */
const tasks = domain.tasks
const route = useRoute()
const router = useRouter()
const showNotice = ref(false)
const noticeMessage = ref('')
/** @type {import('vue').Ref<string>} */
const filter = ref(TASK_PLAN_STATE.scheduled)
const filterTouched = ref(false)
const showHistory = ref(false)
const focusedTaskId = ref('')
const focusMessage = ref('')
const sortKey = ref('due')
const query = ref('')
const searchQuery = useDebouncedRef(query)
const priorityFilter = ref('all')
const periodFilter = ref('all')
/** @type {import('vue').Ref<import('../types/domain').Task | null>} */
const rescheduleTarget = ref(null)
/** @type {import('vue').Ref<{ open: boolean, message: string, type: string, actionLabel: string, undoFn?: () => unknown, viewFn?: () => unknown, duration: number }>} */
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', duration: 3200 })
const openSwipeItemId = ref('')
/** @type {import('vue').Ref<HTMLDetailsElement | null>} */
const taskTools = ref(null)

function closeTaskTools() {
  if (taskTools.value) taskTools.value.open = false
}

/** @param {MouseEvent} event */
function dismissTaskTools(event) {
  const target = /** @type {Node | null} */ (event.target)
  if (target && taskTools.value?.open && !taskTools.value.contains(target)) closeTaskTools()
}

function openNotice() {
  closeTaskTools()
  showNotice.value = true
}
const {
  task: workSessionTask, draft: workSessionDraft, error: workSessionError, busy: workSessionBusy,
  statusLabel: workSessionStatusLabel, startLabel: workSessionStartLabel,
  open: openTaskWorkSession, close: closeTaskWorkSession, updateField: updateWorkSessionField,
  start: startTaskWork, save: saveTaskWorkProgress,
} = useTaskWorkSession({ domain, openProjectTask, notify: showToast })

const {
  showForm,
  editingId,
  error,
  errorField,
  titleInput,
  dueDateInput,
  dueTimeInput,
  repeatEndDateInput,
  estimateInput,
  actualInput,
  reminderInput,
  form,
  deleteTarget,
  saveConflict,
  openAdd,
  openEdit: openPersonalTaskEditor,
  clearFormError,
  save,
  confirmConflictSave,
  remove,
} = useTaskEditor({ domain, tasks, courses, events: domain.events, onSaved: (message, options = {}) => showToast(message, { type: 'success', ...options }) })
const { completionTarget, completionMessage, toggle: toggleWithStageGuard, confirmWhole, completeStage } = useTaskStageActions({ domain, now: appNow, notify: showToast })
const repeatBase = computed(() => taskRepeatBase(form.value))
const editingStageId = ref('')
const editorFormId = useId()

function applyTimeShift(plan) {
  Object.assign(form.value, { dueDate: plan.dueDate || '', dueTime: plan.dueTime || '', timeStages: plan.timeStages || [] })
  clearFormError(errorField.value)
}

watch(() => [route.path, route.query.new, route.query.courseId], ([path, value, courseId]) => {
  if (path !== '/tasks' || value !== '1') return
  openAdd()
  /** @type {import('../types/domain').Course | undefined} */
  const linkedCourse = courses.value.find((course) => String(course.id) === String(courseId || '') && !isArchived(course) && !course.deletedAt && !course.tombstone)
  if (linkedCourse) {
    form.value.courseId = linkedCourse.id
    form.value.course = linkedCourse.name
  }
  const query = { ...route.query }
  delete query.new
  delete query.courseId
  void router.replace({ query })
}, { immediate: true })

// 一键智能整理：只改字段（补课程、分优先级），不删任何数据。
const organizeMessage = ref('')
const csvImportMessage = ref('')
let organizeTimer = 0
let focusWaitTimer = 0
let focusWaitAttempts = 0
let focusHandled = ''

function selectFilter(value) {
  filterTouched.value = true
  showHistory.value = false
  filter.value = value
  periodFilter.value = 'all'
}

function smartOrganize() {
  closeTaskTools()
  const { list, changed } = classifyTasks(tasks.value, courses.value)
  list.forEach((next, index) => {
    const current = tasks.value[index]
    if (!current || current.id !== next.id || current.sourceType === 'project-task') return
    if (current.courseId !== next.courseId || current.course !== next.course || current.priority !== next.priority) {
      domain.updateTask(current.id, {
        courseId: next.courseId,
        course: next.course,
        priority: next.priority,
      })
    }
  })
  organizeMessage.value = changed ? `已智能整理 ${changed} 条待办` : '待办已经很整齐，无需整理'
  window.clearTimeout(organizeTimer)
  organizeTimer = window.setTimeout(() => { if (organizeMessage.value) organizeMessage.value = '' }, 3000)
}

function importCsvTasks(rows) {
  closeTaskTools()
  let imported = 0
  for (const row of rows) {
    const completed = row.completed
    const task = domain.createTask(row)
    if (completed) domain.toggleTask(task.id)
    imported += 1
  }
  csvImportMessage.value = `已导入 ${imported} 条待办`
}

const PRIORITIES = {
  high: { label: '高优先级', order: 0 },
  normal: { label: '普通', order: 1 },
  low: { label: '低优先级', order: 2 },
}

const SORTS = [
  { key: 'due', label: '按下一步时间' },
  { key: 'priority', label: '按优先级' },
  { key: 'created', label: '按创建时间' },
]

function toggleDone(event, id) {
  event.stopPropagation()
  const task = tasks.value.find((item) => item.id === id)
  toggleTask(task)
}

function toggleTask(task) {
  if (!task) return
  toggleWithStageGuard(task)
}

function openProjectTask(task) {
  if (!task?.relationId) return
  void router.push({ path: '/projects', query: { project: task.relationId, ...(task.sourceId ? { task: task.sourceId } : {}) } })
}

function openEditTask(task, stageId = '') {
  if (task?.sourceType === 'project-task') openProjectTask(task)
  else { editingStageId.value = stageId; openPersonalTaskEditor(task) }
}

function setTaskStatus(task, status) {
  if (!task || !['pending', 'in_progress'].includes(status)) return
  if (task.sourceType === 'project-task') { openProjectTask(task); return }
  domain.updateTask(task.id, { status, done: false, completedAt: null })
}

function openReschedule(task) {
  if (task?.sourceType === 'project-task') { openProjectTask(task); return }
  rescheduleTarget.value = task
}

function saveReschedule(plan) {
  if (!rescheduleTarget.value) return
  if (rescheduleTarget.value.sourceType === 'project-task') { openProjectTask(rescheduleTarget.value); rescheduleTarget.value = null; return }
  const target = tasks.value.find((task) => task.id === rescheduleTarget.value.id)
  if (!target) return
  const before = JSON.parse(JSON.stringify({ dueDate: target.dueDate || '', dueTime: target.dueTime || '', timeStages: target.timeStages || [], repeat: target.repeat, repeatAnchorDay: target.repeatAnchorDay || null }))
  domain.updateTask(target.id, plan)
  const after = JSON.parse(JSON.stringify({ dueDate: target.dueDate || '', dueTime: target.dueTime || '', timeStages: target.timeStages || [], repeat: target.repeat, repeatAnchorDay: target.repeatAnchorDay || null }))
  rescheduleTarget.value = null
  showToast('时间安排已更新', { type: 'success', actionLabel: '撤销', undoFn: () => {
    const current = tasks.value.find((task) => task.id === target.id)
    if (!current) return
    return domain.updateTask(current.id, undoTaskTimeShift(current, before, after))
  }, duration: 6000 })
}

function swipeLabel(task, direction) {
  const action = appearance.value.swipeActions.tasks[direction]
  if (task?.sourceType === 'project-task' && ['edit', 'delete'].includes(action)) return '查看项目'
  if (action === 'complete') return taskStatus(task) === 'completed' ? '恢复待办' : '完成'
  if (action === 'edit') return '编辑'
  if (action === 'delete') return '删除'
  return ''
}

function swipeTone(direction) {
  const action = appearance.value.swipeActions.tasks[direction]
  if (action === 'complete') return 'success'
  if (action === 'delete') return 'danger'
  return 'primary'
}

function setOpenSwipeItem(id, open) {
  if (open) openSwipeItemId.value = id
  else if (openSwipeItemId.value === id) openSwipeItemId.value = ''
}

function handleTaskSwipe(direction, task) {
  const action = appearance.value.swipeActions.tasks[direction]
  if (action === 'complete') toggleTask(task)
  else if (action === 'edit') openEditTask(task)
  else if (action === 'delete') deleteTask(task)
}

function onNoticeCommit(payload) {
  const firstData = payload.data || payload.items?.[0] || {}
  const course = findUniqueCourseByName(courses.value, firstData.course)
  const withCourse = (value) => ({ ...value, courseId: findUniqueCourseByName(courses.value, value.course)?.id ?? '' })
  if (payload.type === 'update') {
    if (!domain.updateTask(payload.id, firstData)) return
    showNoticeMessage(payload.courseUnmatched
      ? `已更新“${payload.title}”；课程名称未唯一匹配，原课程关联已保留`
      : `已根据新通知更新“${payload.title}”`)
  } else if (payload.type === 'event') {
    payload.items.forEach((item) => domain.createEvent({ ...withCourse(item), courseName: item.course || '', createdFrom: 'clipboard', sourceType: 'notice' }))
    showNoticeMessage(payload.items.length > 1 ? `已加入 ${payload.items.length} 项日程` : `已加入日程“${payload.items[0].title}”`)
  } else {
    const items = payload.items?.length ? payload.items : [firstData]
    items.forEach((item) => domain.createTask({ ...withCourse(item), kind: payload.kind || 'todo', createdFrom: 'clipboard', sourceType: 'notice' }))
    showNoticeMessage(items.length > 1 ? `已创建 ${items.length} 项${payload.kind === 'homework' ? '作业' : '待办'}` : course || !firstData.course ? `已创建待办“${payload.title}”` : `已创建“${payload.title}”；课程名称未唯一匹配，请检查关联`)
  }
}

let noticeMessageTimer = 0

function showNoticeMessage(message) {
  noticeMessage.value = message
  window.clearTimeout(noticeMessageTimer)
  noticeMessageTimer = window.setTimeout(() => {
    if (noticeMessage.value === message) noticeMessage.value = ''
  }, 3500)
}

/** @param {string} message @param {{ type?: string, actionLabel?: string, undoFn?: () => unknown, viewFn?: () => unknown, duration?: number }} [options] */
function showToast(message, { type = 'info', actionLabel = '', undoFn = undefined, viewFn = undefined, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}

onBeforeUnmount(() => {
  window.clearTimeout(noticeMessageTimer)
  window.clearTimeout(organizeTimer)
  window.clearTimeout(focusWaitTimer)
})

function dueTimestamp(task) {
  if (!task.dueDate) return Infinity
  return appDateTime(task.dueDate, task.dueTime || '23:59')
}

function dueInfo(task) {
  if (taskStatus(task) === 'completed') return { text: task.completedAt ? `完成于 ${formatAppDate(task.completedAt, { withWeekday: false })}` : '已完成', cls: 'completed' }
  if (taskStages(task).length) { const plan = taskTimeSummary(task, appNow.value.getTime()); return { text: plan.text, cls: plan.risk ? 'overdue' : '' } }
  if (!task.dueDate) return { text: '无截止日期', cls: '' }
  const today = appToday.value
  const days = appCalendarDaysBetween(today, task.dueDate)
  const isOverdue = taskStatus(task, appNow.value) === 'overdue' && dueTimestamp(task) < appNow.value.getTime()
  if (isOverdue) return { text: days < 0 ? `逾期 ${-days} 天` : '已逾期', cls: 'overdue' }
  if (days === 0) return { text: task.dueTime ? `今天 ${task.dueTime}` : '今天截止', cls: 'today' }
  if (days === 1) return { text: task.dueTime ? `明天 ${task.dueTime}` : '明天截止', cls: 'soon' }
  return { text: `${formatAppDate(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ''}`, cls: '' }
}

const taskView = computed(() => selectTaskView(tasks.value, {
  now: appNow.value,
  sortKey: sortKey.value,
  filter: filter.value,
  showHistory: showHistory.value,
}))

const counts = computed(() => taskView.value.counts)
const workspaceSummary = computed(() => taskWorkspaceSummary(tasks.value, appNow.value))
const courseNamesById = computed(() => new Map(courses.value.map((course) => [course.id, course.name])))
const hasWorkspaceFilters = computed(() => Boolean(query.value.trim() || priorityFilter.value !== 'all' || periodFilter.value !== 'all'))
const defaultTaskReminder = computed(() => defaultReminderMinutes('task'))

function applyWorkspaceFilters(items) {
  return filterTaskWorkspace(items, { query: searchQuery.value, priority: priorityFilter.value, period: periodFilter.value, now: appNow.value, courseNames: courseNamesById.value })
}

function resetWorkspaceFilters() {
  query.value = ''
  searchQuery.flush('')
  priorityFilter.value = 'all'
  periodFilter.value = 'all'
}

function selectPeriod(value) {
  periodFilter.value = value
  if (value !== 'all') { filter.value = 'all'; filterTouched.value = true; showHistory.value = false }
}

/** @param {Event} event */
function changePeriod(event) {
  const target = /** @type {HTMLSelectElement | null} */ (event.target)
  if (target) selectPeriod(target.value)
}

/** @param {unknown} value @returns {value is import('../types/domain').Task} */
function isTaskRow(value) {
  return Boolean(value && typeof value === 'object' && 'title' in value)
}

function selectOverview(value) {
  resetWorkspaceFilters()
  selectPeriod(value)
  if (viewMode.value !== 'list') setViewMode('list')
}

function setFormDueDate(offset) {
  form.value.dueDate = offset === null ? '' : addAppDays(appToday.value, offset)
  if (offset === null) form.value.dueTime = ''
  clearFormError('dueDate')
}

function openRelatedMilestone(task) {
  if (task.sourceId) void router.push({ path: '/exams', query: { focus: task.sourceId } })
}

// 看板、月历都以当前未归档待办为数据源；列表筛选器只影响列表，避免“已安排”把
// 无截止日的待办从看板里藏掉。状态列与日期格分别由纯选择器派生。
const viewMode = computed(() => taskViewModeFromQuery(route.query.view))
const monthKey = computed(() => taskMonthFromQuery(route.query.month, appToday.value))
const todayMonth = computed(() => appToday.value.slice(0, 7))
const calendarDate = ref('')
const allCurrentTasks = computed(() => applyWorkspaceFilters(selectTaskView(tasks.value, {
  now: appNow.value,
  sortKey: sortKey.value,
  filter: 'all',
  showHistory: false,
}).visible))
const boardColumns = computed(() => buildTaskBoard(allCurrentTasks.value))
const monthGrid = computed(() => buildTaskMonthGrid(monthKey.value, allCurrentTasks.value))
const calendarTasks = computed(() => monthGrid.value.byDate.get(calendarDate.value) ?? [])
const monthLabel = computed(() => taskMonthLabel(monthKey.value, appToday.value))

watch([monthKey, viewMode], ([month, mode], [previousMonth, previousMode]) => {
  if (month !== previousMonth || mode !== previousMode) calendarDate.value = ''
})

function setViewMode(mode) {
  const query = { ...route.query }
  if (mode === 'list') {
    delete query.view
    delete query.month
  } else {
    query.view = mode
    if (mode === 'calendar') query.month = monthKey.value
    else delete query.month
  }
  calendarDate.value = ''
  void router.replace({ query })
}

function setHistory() {
  showHistory.value = !showHistory.value
  resetWorkspaceFilters()
  if (showHistory.value && viewMode.value !== 'list') setViewMode('list')
}

function shiftMonth(delta) {
  const month = shiftTaskMonth(monthKey.value, delta)
  if (!month) return
  calendarDate.value = ''
  void router.replace({ query: { ...route.query, view: 'calendar', month } })
}

function taskRepeatText(task) {
  return task?.repeat && task.repeat !== 'none' ? taskRepeatLabel(task.repeat) : ''
}

watch(
  () => [counts.value.scheduled, counts.value.unplanned, counts.value.done, filterTouched.value, showHistory.value],
  () => {
    if (filterTouched.value || showHistory.value || route.query.focus) return
    if (!counts.value.scheduled && counts.value.unplanned) filter.value = TASK_PLAN_STATE.unplanned
    else if (!counts.value.scheduled && !counts.value.unplanned && counts.value.done) filter.value = TASK_PLAN_STATE.completed
  },
  { immediate: true }
)

function deleteTask(task) {
  if (task?.sourceType === 'project-task') { openProjectTask(task); return }
  deleteTarget.value = task
}

function archiveTask(task) {
  if (task?.sourceType === 'project-task') { openProjectTask(task); return }
  if (!task || isArchived(task)) return
  domain.archiveTask(task.id)
  showToast('待办已归档', {
    type: 'success',
    actionLabel: '撤销',
    undoFn: () => domain.restoreTask(task.id),
    duration: 6000,
  })
}

function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  if (target.sourceType === 'project-task') { deleteTarget.value = null; openProjectTask(target); return }
  const index = tasks.value.findIndex((item) => item.id === target.id)
  if (index < 0) return
  domain.deleteTask(target.id)
  deleteTarget.value = null
  showToast('待办已删除', {
    type: 'warning',
    actionLabel: '撤销',
    undoFn: () => domain.restoreDeletedTask(target),
    duration: 6000,
  })
}

// 空状态文案按当前筛选变化
const emptyInfo = computed(() => {
  if (hasWorkspaceFilters.value) return { icon: '⌕', title: '没有符合条件的待办', description: '试试其他关键词、优先级或时间范围。', hint: '', action: '清除筛选' }
  if (showHistory.value) return { icon: '▱', title: '还没有归档待办', description: '已完成事项可以归档到这里，当前清单会更清爽。', hint: '', action: '' }
  if (tasks.value.length === 0) {
    return {
      icon: '✓',
       title: '今天很轻松',
       description: '目前没有待办。',
       hint: '新待办会自动出现在这里。',
      action: '添加待办',
    }
  }
  if (filter.value === TASK_PLAN_STATE.unplanned) {
    return { icon: '＋', title: '没有待安排日期的待办', description: '还没有日期的事项会留在这里。', hint: '', action: '' }
  }
  if (filter.value === TASK_PLAN_STATE.scheduled) {
    return counts.value.unplanned > 0
      ? { icon: '→', title: '暂时没有已安排的任务', description: `还有 ${counts.value.unplanned} 个待安排日期的待办。`, hint: '', action: '查看待安排' }
      : { icon: '✓', title: '没有已安排待办', description: '有明确日期的事项会出现在这里。', hint: '', action: '添加待办' }
  }
  if (filter.value === TASK_PLAN_STATE.completed) {
    return { icon: '◐', title: '还没有已完成的待办', description: '完成待办后会出现在这里。', hint: '', action: '' }
  }
  return { icon: '✦', title: '这个列表暂时是空的', description: '', hint: '', action: '' }
})

const visibleTasks = computed(() => applyWorkspaceFilters(taskView.value.visible))

function emptyAction() {
  if (hasWorkspaceFilters.value) resetWorkspaceFilters()
  else if (emptyInfo.value.action === '查看待安排') selectFilter(TASK_PLAN_STATE.unplanned)
  else openAdd()
}

async function focusRouteTask() {
  const { id } = readFocusQuery(route)
  if (!id || focusHandled === id) return
  if (!tasks.value.length) {
    if (focusWaitAttempts >= 12) {
      focusWaitAttempts = 0
      focusHandled = id
      focusMessage.value = '这条待办可能已删除或已移动。'
      await clearFocusFromRoute(router, route)
      return
    }
    focusWaitAttempts += 1
    window.clearTimeout(focusWaitTimer)
    focusWaitTimer = window.setTimeout(() => { void focusRouteTask() }, 150)
    return
  }
  focusWaitAttempts = 0
  focusHandled = id
  const task = tasks.value.find((item) => String(item.id) === id)
  if (!task) {
    focusMessage.value = '这条待办可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
    return
  }
  showHistory.value = isArchived(task)
  resetWorkspaceFilters()
  filterTouched.value = true
  if (viewMode.value !== 'list') {
    const nextQuery = { ...route.query }
    delete nextQuery.view
    delete nextQuery.month
    await router.replace({ query: nextQuery })
  }
  if (!showHistory.value) {
    const state = taskPlanningState(task, appNow.value)
    filter.value = state === TASK_PLAN_STATE.completed ? TASK_PLAN_STATE.completed : state === TASK_PLAN_STATE.scheduled ? TASK_PLAN_STATE.scheduled : TASK_PLAN_STATE.unplanned
  }
  focusedTaskId.value = id
  await nextTick()
  const element = await focusElementWhenReady(id)
  if (element) focusMessage.value = ''
  else focusMessage.value = '这条待办可能已删除或已移动。'
  await clearFocusFromRoute(router, route)
}

watch(
  () => [route.query.focus, tasks.value.length, filter.value, showHistory.value],
  () => { void focusRouteTask() },
  { immediate: true }
)

const courseNames = computed(() => [...new Set(courses.value.map((course) => course.name).filter(Boolean))])
const coursesById = computed(() => new Map(courses.value.map((course) => [course.id, course])))

function linkCourseFromName() {
  const course = findUniqueCourseByName(courses.value, form.value.course)
  form.value.courseId = course?.id ?? ''
}

function taskCourseName(task) {
  return coursesById.value.get(task.courseId)?.name ?? task.course
}

function taskFocusSummary(task) {
  const count = Math.max(0, Number(task.focusCount) || 0)
  const seconds = Math.max(0, Number(task.focusTotalSeconds) || 0)
  if (!count && !seconds) return ''
  const minutes = Math.max(1, Math.round(seconds / 60))
  return `已专注 ${count} 次 · ${minutes} 分钟`
}

function taskCheckpointCue(task) {
  const checkpoint = task?.workCheckpoint
  if (checkpoint?.nextStep) return `下一步：${checkpoint.nextStep}`
  if (checkpoint?.blocker) return `上次卡在：${checkpoint.blocker}`
  if (checkpoint?.lastStep) return `上次做到：${checkpoint.lastStep}`
  return ''
}

function updateTaskCheckpointField(field, value) {
  form.value[field] = value
}
</script>

<template>
  <div class="page tasks-page" @click.capture="dismissTaskTools">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">待办</h1>
        <p class="page-desc">记下要做的事，按下一步时间管理截止与阶段安排。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" :aria-expanded="showHistory" @click="setHistory">{{ showHistory ? '返回当前' : `历史 ${counts.archived || ''}` }}</button>
        <label class="sort-select">
          <span>排序</span>
          <select v-model="sortKey">
            <option v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
        </label>
        <details ref="taskTools" class="task-tools" @keydown.esc.stop.prevent="closeTaskTools">
          <summary class="btn btn-ghost">更多操作</summary>
          <div class="task-tools-menu">
            <button type="button" class="btn btn-ghost" @click="smartOrganize">✦ 一键整理</button>
            <button type="button" class="btn btn-ghost" @click="openNotice">📋 粘贴通知</button>
            <DomainCsvImportButton kind="tasks" :records="tasks" @import="importCsvTasks" />
          </div>
        </details>
        <button class="btn btn-primary" @click="openAdd">＋ 添加待办</button>
      </div>
    </header>

    <LearningNavigation current="tasks" />

    <div v-if="tasks.length && !showHistory" class="task-overview" role="group" aria-label="待办概览">
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'today' }" :aria-pressed="periodFilter === 'today'" @click="selectOverview('today')"><span>今天的安排</span><b>{{ workspaceSummary.today }}</b><small>阶段或截止时间</small></button>
      <button type="button" class="card overview-item overdue-overview" :class="{ selected: periodFilter === 'overdue' }" :aria-pressed="periodFilter === 'overdue'" @click="selectOverview('overdue')"><span>需要确认</span><b>{{ workspaceSummary.overdue }}</b><small>逾期或阶段已结束</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'week' }" :aria-pressed="periodFilter === 'week'" @click="selectOverview('week')"><span>未来 7 天</span><b>{{ workspaceSummary.week }}</b><small>含今天</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'unplanned' }" :aria-pressed="periodFilter === 'unplanned'" @click="selectOverview('unplanned')"><span>待安排日期</span><b>{{ workspaceSummary.unplanned }}</b><small>给想法安排时间</small></button>
    </div>

    <p v-if="noticeMessage" class="notice-success" role="status">✓ {{ noticeMessage }}</p>
    <p v-if="csvImportMessage" class="notice-success" role="status">✓ {{ csvImportMessage }}</p>
    <p v-if="organizeMessage && !noticeMessage" class="notice-success" role="status">✓ {{ organizeMessage }}</p>
    <p v-if="focusMessage" class="notice-success" role="status">{{ focusMessage }}</p>

    <div class="task-controls">
      <div v-if="!showHistory" class="segmented task-view-toolbar" role="group" aria-label="待办视图">
        <button v-for="mode in ['list', 'board', 'calendar']" :key="mode" type="button" :aria-pressed="viewMode === mode" :class="{ on: viewMode === mode }" @click="setViewMode(mode)">{{ mode === 'list' ? '列表' : mode === 'board' ? '看板' : '月历' }}</button>
      </div>

      <div v-if="viewMode === 'list'" class="segmented task-toolbar" role="group" aria-label="待办筛选">
        <template v-if="!showHistory">
          <button :aria-pressed="filter === 'unplanned'" :class="{ on: filter === 'unplanned' }" @click="selectFilter('unplanned')">待安排日期 <b>{{ counts.unplanned }}</b></button>
          <button :aria-pressed="filter === 'scheduled'" :class="{ on: filter === 'scheduled' }" @click="selectFilter('scheduled')">已安排 <b>{{ counts.scheduled }}</b></button>
          <button :aria-pressed="filter === 'completed'" :class="{ on: filter === 'completed' }" @click="selectFilter('completed')">已完成 <b>{{ counts.done }}</b></button>
          <button :aria-pressed="filter === 'all'" :class="{ on: filter === 'all' }" @click="selectFilter('all')">全部 <b>{{ counts.all }}</b></button>
        </template>
        <span v-else class="history-label">归档历史 · {{ counts.archived }} 条</span>
      </div>
    </div>

    <section class="card workspace-filters" aria-label="搜索和筛选待办">
      <div class="workspace-search"><label class="sr-only" for="tasks-search">搜索待办</label><input id="tasks-search" v-model="query" type="search" placeholder="搜索待办、课程、备注或下一步" /><button v-if="query" type="button" class="link-btn" aria-label="清除待办搜索" @click="query = ''; searchQuery.flush('')">×</button></div>
      <label class="workspace-select"><span>优先级</span><select v-model="priorityFilter"><option value="all">全部优先级</option><option value="high">高优先级</option><option value="normal">普通</option><option value="low">低优先级</option></select></label>
      <label v-if="!showHistory" class="workspace-select"><span>范围</span><select :value="periodFilter" @change="changePeriod"><option value="all">全部日期</option><option value="today">今天的安排</option><option value="overdue">逾期或待确认</option><option value="week">未来 7 天</option><option value="unplanned">待安排日期</option></select></label>
      <div class="workspace-result"><span role="status">{{ viewMode === 'list' ? visibleTasks.length : allCurrentTasks.length }} 项待办</span><button v-if="hasWorkspaceFilters" type="button" class="link-btn" @click="resetWorkspaceFilters">清除筛选</button></div>
    </section>

    <EmptyState :level="2"
      v-if="(viewMode === 'list' && visibleTasks.length === 0) || (viewMode !== 'list' && hasWorkspaceFilters && allCurrentTasks.length === 0)"
      class="empty-box card"
      :icon="emptyInfo.icon"
      :title="emptyInfo.title"
      :description="emptyInfo.description"
      :hint="emptyInfo.hint"
      :primary-label="emptyInfo.action"
      @primary="emptyAction"
    />

    <TaskBoard
      v-else-if="viewMode === 'board'"
      :columns="boardColumns"
      :due-info-of="dueInfo"
      :status-of="taskStatus"
      :course-name-of="taskCourseName"
      :repeat-label-of="taskRepeatText"
      @open="openEditTask"
      @toggle="toggleTask"
      @set-status="setTaskStatus"
      @archive="archiveTask"
      @remove="deleteTask"
    />

    <TaskCalendar
      v-else-if="viewMode === 'calendar'"
      :month="monthKey"
      :today-month="todayMonth"
      :today-date="appToday"
      :cells="monthGrid.cells"
      :selected-date="calendarDate"
      :selected-tasks="calendarTasks"
      :month-label="monthLabel"
      :due-info-of="dueInfo"
      :status-of="taskStatus"
      @shift-month="shiftMonth"
      @select-date="calendarDate = $event"
      @open="openEditTask"
      @toggle="toggleTask"
    />

    <VirtualList v-else-if="viewMode === 'list'" v-slot="{ item: task }" class="task-list" :items="visibleTasks" :estimated-height="74" :gap="8" :threshold="40" :reveal-key="focusedTaskId">
      <SwipeActionItem
        v-if="isTaskRow(task)"
        :left-label="swipeLabel(task, 'left')"
        :right-label="swipeLabel(task, 'right')"
        :left-tone="swipeTone('left')"
        :right-tone="swipeTone('right')"
        :open="openSwipeItemId === task.id"
        @update:open="setOpenSwipeItem(task.id, $event)"
        @action="handleTaskSwipe($event, task)"
      >
          <article
            class="card task"
            :class="{ done: taskStatus(task, appNow) === 'completed', archived: isArchived(task), 'focus-target-highlight': focusedTaskId === task.id }"
            :data-focus-id="task.id"
          @click="openEditTask(task)"
        >
          <span v-if="task.priority === 'high'" class="urgent-bar" aria-hidden="true"></span>

          <button
            type="button"
            class="check"
            :class="{ checked: taskStatus(task) === 'completed' }"
            :aria-label="taskStatus(task) === 'completed' ? '标记为未完成' : '标记为已完成'"
            :aria-pressed="taskStatus(task) === 'completed'"
            @click="toggleDone($event, task.id)"
          >
            {{ taskStatus(task) === 'completed' ? '✓' : '' }}
          </button>

          <div class="task-main">
            <div class="task-topline">
              <h2><button type="button" class="task-title-button" :title="task.title" @click.stop="openEditTask(task)">{{ task.title }}</button></h2>
            </div>
            <div class="task-meta">
              <span class="priority" :class="task.priority ?? 'normal'">
                {{ PRIORITIES[task.priority]?.label ?? '普通' }}
              </span>
              <span v-if="taskCourseName(task)" class="course-tag">{{ taskCourseName(task) }}</span>
              <span v-if="taskTimeComparison(task)" class="course-tag time-comparison">{{ taskTimeComparison(task) }}</span>
              <span v-if="taskFocusSummary(task)" class="course-tag focus-tag">{{ taskFocusSummary(task) }}</span>
              <span v-if="taskRepeatText(task)" class="course-tag">↻ {{ taskRepeatText(task) }}</span>
              <span v-if="task.status === 'in_progress' && !isArchived(task) && !task.done" class="course-tag">进行中</span>
            </div>
            <p v-if="task.note" :title="task.note">{{ task.note }}</p>
            <p v-if="taskCheckpointCue(task)" class="checkpoint-cue" :title="taskCheckpointCue(task)">{{ taskCheckpointCue(task) }}</p>
            <p v-if="task.timeStages?.length" class="stage-time-summary" :class="dueInfo(task).cls">{{ dueInfo(task).text }}</p>
            <!-- sl_tasks 显式提交后父视图重绘；传入快照使子组件也能观察就地状态变更。 -->
            <TaskStageAction v-if="task.timeStages?.length" :task="{ ...task }" :now-ms="appNow.getTime()" @complete="completeStage(task, $event)" @open="openEditTask(task)" />
            <p v-if="task.repeatGenerationError" class="stage-time-summary overdue" role="status">{{ task.repeatGenerationError }}</p>
            <button v-if="task.sourceType === 'milestone-review' && task.sourceId" type="button" class="milestone-link" @click.stop="openRelatedMilestone(task)">查看关联重要日期 →</button>
          </div>

          <span v-if="!task.timeStages?.length" class="due" :class="dueInfo(task).cls">{{ dueInfo(task).text }}</span>

          <div class="more" @click.stop>
            <TaskFocusLink v-if="task.sourceType !== 'project-task' && !isArchived(task) && !task.done && task.status !== 'completed' && task.status !== 'cancelled'" :task="task" />
            <button v-if="task.sourceType === 'project-task'" class="link-btn" :aria-label="task.workCheckpoint?.nextStep ? `继续齐行任务：${task.title}` : `打开齐行工作台：${task.title}`" :title="task.workCheckpoint?.nextStep ? '查看齐行上次进度并继续' : '打开齐行工作台'" @click.stop="openProjectTask(task)">{{ task.workCheckpoint?.nextStep ? '继续' : '查看项目' }}</button>
            <button v-if="task.sourceType !== 'project-task' && !isArchived(task) && taskStatus(task) !== 'completed'" class="link-btn continue-link" :aria-label="task.workCheckpoint?.nextStep ? `继续待办：${task.title}` : `开始待办：${task.title}`" :title="task.workCheckpoint?.nextStep ? '查看上次进度并继续' : '开始并记录任务进度'" @click.stop="openTaskWorkSession(task)">{{ task.workCheckpoint?.nextStep ? '继续' : task.status === 'in_progress' ? '工作台' : '开始' }}</button>
            <button v-if="task.sourceType !== 'project-task' && !isArchived(task) && taskStatus(task) !== 'completed' && taskHasTime(task)" class="link-btn reschedule-link" title="重新安排时间" @click.stop="openReschedule(task)">改期</button>
            <button v-if="task.sourceType !== 'project-task' && isArchived(task)" class="link-btn" aria-label="恢复待办" title="恢复待办" @click="domain.restoreTask(task.id)">↶</button>
            <button v-if="task.sourceType !== 'project-task'" class="link-btn" aria-label="编辑待办" title="编辑待办" @click="openEditTask(task)">✎</button>
            <button v-if="task.sourceType !== 'project-task' && !isArchived(task) && taskStatus(task) === 'completed'" class="link-btn" aria-label="归档待办" title="归档待办" @click="archiveTask(task)">▱</button>
            <button v-if="task.sourceType !== 'project-task'" class="link-btn danger" aria-label="删除待办" title="删除待办" @click="deleteTask(task)">🗑</button>
          </div>
        </article>
      </SwipeActionItem>
    </VirtualList>

    <Modal v-if="showForm" :open="showForm" :title="editingId ? '编辑待办' : '添加待办'" @close="showForm = false">
      <form :id="editorFormId" class="form" novalidate @submit.prevent="save">
        <label for="tasks-title">待办内容 *</label>
        <input id="tasks-title" ref="titleInput" v-model="form.title" maxlength="200" placeholder="例如：完成高数第三章作业" :aria-invalid="errorField === 'title' || undefined" :aria-describedby="errorField === 'title' ? 'tasks-form-error' : undefined" @input="clearFormError('title')" />

        <label for="tasks-course">所属课程或类别</label>
        <input id="tasks-course" v-model="form.course" list="course-options" placeholder="选填，可直接输入" @change="linkCourseFromName" />
        <datalist id="course-options">
          <option v-for="name in courseNames" :key="name" :value="name"></option>
        </datalist>

        <div class="form-row">
          <div>
            <label for="tasks-due-date">截止日期</label>
            <input id="tasks-due-date" ref="dueDateInput" v-model="form.dueDate" type="date" :aria-invalid="errorField === 'dueDate' || undefined" :aria-describedby="errorField === 'dueDate' ? 'tasks-form-error' : undefined" @input="clearFormError('dueDate'); if (!form.dueDate) form.dueTime = ''" />
          </div>
          <div>
            <label for="tasks-due-time">截止时间</label>
            <input id="tasks-due-time" ref="dueTimeInput" v-model="form.dueTime" type="time" :disabled="!form.dueDate" :aria-invalid="errorField === 'dueTime' || undefined" :aria-describedby="errorField === 'dueTime' ? 'tasks-form-error' : undefined" @input="clearFormError('dueTime')" />
          </div>
        </div>

        <div class="date-shortcuts" role="group" aria-label="快速选择截止日期"><button type="button" :aria-pressed="form.dueDate === appToday" @click="setFormDueDate(0)">今天</button><button type="button" :aria-pressed="form.dueDate === addAppDays(appToday, 1)" @click="setFormDueDate(1)">明天</button><button type="button" :aria-pressed="form.dueDate === addAppDays(appToday, 7)" @click="setFormDueDate(7)">一周后</button><button type="button" :aria-pressed="!form.dueDate" @click="setFormDueDate(null)">暂不安排</button></div>
        <small v-if="!taskHasTime(form)" class="repeat-hint">未设置日期的事项会留在“待安排日期”，随时可以补上。</small>
        <TaskTimeEditor v-model="form.timeStages" :error-field="errorField" :focus-stage-id="editingStageId" :now-ms="appNow.getTime()" @change="clearFormError(errorField)" />
        <TaskTimeShift v-if="taskHasTime(form)" :task="form" :now-ms="appNow.getTime()" @apply="applyTimeShift" @undo="applyTimeShift" />

        <label for="tasks-priority">优先级</label>
        <select id="tasks-priority" v-model="form.priority">
          <option value="high">高优先级</option>
          <option value="normal">普通</option>
          <option value="low">低优先级</option>
        </select>

        <label for="tasks-note">备注</label>
        <textarea id="tasks-note" v-model="form.note" rows="2" placeholder="选填，记下要求、地点或准备事项"></textarea>

        <details class="task-details" :open="Boolean((editingId && (form.repeat !== 'none' || form.estimateMinutes || form.actualMinutes)) || ['estimateMinutes', 'actualMinutes', 'reminderMinutes', 'repeatEndDate'].includes(errorField))">
        <summary>时长、重复与提醒 <small>按需设置</small></summary>
        <div class="form-row">
          <div><label for="tasks-estimate-minutes">预计时长（分钟）</label><input id="tasks-estimate-minutes" ref="estimateInput" v-model="form.estimateMinutes" type="number" min="0" step="0.1" inputmode="decimal" placeholder="选填" :aria-invalid="errorField === 'estimateMinutes' || undefined" @input="clearFormError('estimateMinutes')" /></div>
          <div><label for="tasks-actual-minutes">实际用时（分钟）</label><input id="tasks-actual-minutes" ref="actualInput" v-model="form.actualMinutes" type="number" min="0" step="0.1" inputmode="decimal" placeholder="专注计时会自动累计" :aria-invalid="errorField === 'actualMinutes' || undefined" @input="clearFormError('actualMinutes')" /></div>
        </div>
        <label for="tasks-repeat">重复</label>
        <select id="tasks-repeat" v-model="form.repeat"><option v-for="rule in TASK_REPEATS" :key="rule.value" :value="rule.value">{{ rule.value === 'none' ? rule.label : `${rule.label}（完成后生成下一期）` }}</option></select>
        <label v-if="form.repeat !== 'none'" for="tasks-repeat-end">重复结束日期</label>
        <input v-if="form.repeat !== 'none'" id="tasks-repeat-end" ref="repeatEndDateInput" v-model="form.repeatEndDate" type="date" :min="repeatBase.date || undefined" :disabled="!repeatBase.date" :aria-invalid="errorField === 'repeatEndDate' || undefined" :aria-describedby="errorField === 'repeatEndDate' ? 'tasks-form-error' : undefined" @input="clearFormError('repeatEndDate')" />
        <small v-if="form.repeat !== 'none'" class="repeat-hint">完成事项后，所有阶段一起进入下一期。基准：{{ repeatBase.label }}{{ repeatBase.date ? `（${repeatBase.date}）` : '，请填写阶段或截止日期' }}；结束日期含当天，留空持续重复。</small>

        <label for="tasks-reminder">提前提醒（分钟）</label>
        <input id="tasks-reminder" ref="reminderInput" v-model="form.reminderMinutes" type="number" min="0" step="1" :disabled="!form.dueDate" :placeholder="`默认提前 ${defaultTaskReminder} 分钟`" :aria-invalid="errorField === 'reminderMinutes' || undefined" aria-describedby="tasks-reminder-hint" @input="clearFormError('reminderMinutes')" />
        <small id="tasks-reminder-hint" class="repeat-hint">0 表示到点提醒，留空使用默认设置。未填时间按 23:59 计算；应用打开且允许通知时提醒。</small>
        </details>

        <TaskWorkCheckpointFields :form="form" :task="tasks.find((task) => task.id === editingId)" :editing="Boolean(editingId)" @update:field="updateTaskCheckpointField" />

        <p v-if="error" id="tasks-form-error" class="error" role="alert">{{ error }}</p>
      </form>
      <template #foot>
        <div class="actions">
          <button v-if="editingId" type="button" class="btn btn-danger" @click="remove">删除</button>
          <button type="button" class="btn" @click="showForm = false">取消</button>
          <button type="submit" :form="editorFormId" class="btn btn-primary">保存</button>
        </div>
      </template>
    </Modal>

    <TaskWorkSession :open="Boolean(workSessionTask)" :task="workSessionTask" :checkpoint="workSessionTask?.workCheckpoint" :form="workSessionDraft"
      :status-label="workSessionStatusLabel" :start-label="workSessionStartLabel" :can-start="Boolean(workSessionTask)" :can-save="Boolean(workSessionTask)"
      :busy="workSessionBusy" :error="workSessionError" @close="closeTaskWorkSession" @start="startTaskWork" @save="saveTaskWorkProgress" @update:field="updateWorkSessionField" />
    <NoticePaste
      :open="showNotice"
      :tasks="tasks"
      :courses="courses"
      @close="showNotice = false"
      @commit="onNoticeCommit"
    />
    <ConfirmDialog :open="Boolean(deleteTarget)" title="删除待办" :message="`确定删除待办“${deleteTarget?.title || ''}”吗？删除后可在短时间内撤销。`" confirm-label="删除" @close="deleteTarget = null" @confirm="confirmDelete" />
    <!-- 冲突提示会叠在「添加/编辑待办」表单之上，所以 v-if 随目标挂载（见 ConfirmDialog 顶部说明）。 -->
    <ConfirmDialog
      v-if="saveConflict"
      :open="Boolean(saveConflict)"
      title="时间冲突"
      :message="saveConflict?.message || ''"
      confirm-label="继续保存"
      cancel-label="返回修改"
      tone="primary"
      @close="saveConflict = null"
      @confirm="confirmConflictSave"
    />
    <TaskRescheduleDialog v-if="rescheduleTarget" :task="rescheduleTarget" :today="appToday" :now-ms="appNow.getTime()" :existing-items="[...tasks, ...domain.events.value]" @close="rescheduleTarget = null" @save="saveReschedule" />
    <ConfirmDialog v-if="completionTarget" :open="Boolean(completionTarget)" title="完成整个事项" :message="completionMessage" confirm-label="直接完成事项" cancel-label="继续处理阶段" tone="primary" @close="completionTarget = null" @confirm="confirmWhole" />
    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :view-fn="toast.viewFn" :duration="toast.duration" @action="() => {}" @close="toast.open = false" />
  </div>
</template>

<style scoped src="./tasks.css"></style>
