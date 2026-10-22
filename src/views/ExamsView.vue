<script setup>
import PageHeader from '../components/PageHeader.vue'
import { usePageToast } from '../composables/usePageToast.js'
import { pad2 } from '../utils/formatters.js'
import { computed, nextTick, ref, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'
import { parseDate } from '@internationalized/date'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Calendar } from '../components/ui/calendar'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import VirtualList from '../components/VirtualList.vue'
import ContextMenu from '../components/ContextMenu.vue'
import Toast from '../components/Toast.vue'
import LearningNavigation from '../components/learning/LearningNavigation.vue'
import TaskFocusLink from '../components/learning/TaskFocusLink.vue'
import { ensureMilestoneReviewTask } from '../composables/learningPlan.js'
import {
  fmtCountdownDate,
  useStoredRef,
} from '../composables/store'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isArchived, isTaskActionable, taskStatus } from '../composables/domain/state.js'
import { menuPlacementFor } from '../composables/menuPlacement.js'
import { createLongPress } from '../composables/longPress.js'
import { addAppDays, appCalendarDaysBetween, appNow, appToday } from '../composables/timeContext.js'
import { defaultReminderMinutes } from '../composables/settingsPolicy.js'
import { reminderNotificationHint } from '../composables/reminderScheduler.js'
import { matchesMilestoneQuery, milestoneCalendarOccurrenceDate, selectMilestoneWorkspace } from '../composables/planningViews.js'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { countdownState } from '../composables/store/countdown.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'
import { externalExamTimelineTarget, normalizeExternalExamItems } from '../composables/externalExam.js'
import { useMilestoneEditor } from '../composables/useMilestoneEditor.js'

const CATEGORIES = ['学习', '校外考试', '生活', '纪念日', '项目', '其他']
const domain = useDomainCommands()
/** @type {import('vue').Ref<import('../types/domain').Milestone[]>} */
const exams = domain.milestones
/** @type {import('vue').Ref<import('../types/domain').Course[]>} */
const courses = domain.courses
/** @type {import('vue').Ref<import('../types/domain').Task[]>} */
const tasks = domain.tasks
const route = useRoute()
const router = useRouter()
const showPast = useStoredRef('sl_countdown_show_past', false)
const showHistory = ref(false)
const viewMode = useStoredRef('sl_countdown_view', 'list')
const selectedCalendarDate = ref(parseDate(appToday.value))
const calendarPlaceholder = ref(parseDate(appToday.value))
const query = ref('')
const searchQuery = useDebouncedRef(query)
const categoryFilter = ref('all')
const periodFilter = ref('all')
const sortKey = ref('date')
const deleteTarget = ref(null)
const reviewMessage = ref('')
const focusMessage = ref('')
const focusedMilestoneId = ref('')
/** @type {import('vue').Ref<{ open: boolean, message: string, type: string, actionLabel: string, undoFn?: () => unknown, viewFn?: () => unknown, duration: number }>} */
const { toast, showToast } = usePageToast()
let focusHandled = ''

const milestoneEditor = useMilestoneEditor({ domain, courses, showToast })
const { showForm, editingId, error, errorField, nameInput, dateInput, form, formId: editorFormId, formElement,
  newRequiredItemName, openAdd, openEdit, save, clearFormError, setFormDate, addRequiredItem, removeRequiredItem } = milestoneEditor

watch(appToday, (todayKey, previousTodayKey) => {
  if (selectedCalendarDate.value.toString() === previousTodayKey) selectedCalendarDate.value = parseDate(todayKey)
  if (calendarPlaceholder.value.toString() === previousTodayKey) calendarPlaceholder.value = parseDate(todayKey)
})
watch(calendarPlaceholder, (monthDate) => {
  if (selectedCalendarDate.value.year === monthDate.year && selectedCalendarDate.value.month === monthDate.month) return
  const lastDay = new Date(Date.UTC(monthDate.year, monthDate.month, 0)).getUTCDate()
  selectedCalendarDate.value = monthDate.set({ day: Math.min(selectedCalendarDate.value.day, lastDay) })
})
watch(viewMode, (mode) => {
  if (mode !== 'list' && mode !== 'calendar') viewMode.value = 'list'
}, { immediate: true })

watch(() => [route.path, route.query.new, route.query.courseId], ([path, value, courseId]) => {
  if (path !== '/exams' || value !== '1') return
  openAdd()
  const course = courses.value.find((item) => String(item.id) === String(courseId || '') && !isArchived(item) && !item.deletedAt && !item.tombstone)
  if (course) form.value.courseId = course.id
  const query = { ...route.query }
  delete query.new
  delete query.courseId
  void router.replace({ query })
}, { immediate: true })

function updateExternalExamItems(item, updater) {
  const requiredItems = normalizeExternalExamItems(item.requiredItems).map((entry, index) => updater(entry, index))
  domain.updateMilestone(item.id, { requiredItems })
}

function toggleRequiredItem(item, index) {
  updateExternalExamItems(item, (entry, itemIndex) => itemIndex === index ? { ...entry, checked: !entry.checked } : entry)
}

function checkAllRequiredItems(item) {
  updateExternalExamItems(item, (entry) => ({ ...entry, checked: true }))
  showToast('考试用品已全部确认', { type: 'success' })
}

const defaultReminder = computed(() => defaultReminderMinutes('milestone'))
// 提醒能力说明必须照实说：安卓安装版的 WebView 没有系统通知，
// 提醒只会在应用打开时以应用内提示出现（见 reminderScheduler.js）。
const reminderHint = computed(() => reminderNotificationHint())

function remove() {
  const item = exams.value.find((entry) => entry.id === editingId.value)
  showForm.value = false
  if (item) deleteTarget.value = item
}

/** @param {string} message @param {{ type?: string, actionLabel?: string, undoFn?: () => unknown, viewFn?: () => unknown, duration?: number }} [options] */
const courseNamesById = computed(() => new Map(courses.value.map((course) => [course.id, course.name])))
const timelineMilestones = computed(() => exams.value.map((item) => {
  if (item.kind !== 'externalExam') return item
  const target = externalExamTimelineTarget(item, appToday.value)
  return target ? { ...item, date: target.date, time: target.time, externalExamStage: target.stage } : item
}))
const milestoneView = computed(() => selectMilestoneWorkspace(timelineMilestones.value, {
  now: appNow.value, query: searchQuery.value, category: categoryFilter.value,
  period: periodFilter.value, sortKey: sortKey.value, showPast: showPast.value,
  showHistory: showHistory.value, courseNames: courseNamesById.value,
}))
const summary = computed(() => milestoneView.value.summary)
const hasFilters = computed(() => Boolean(query.value.trim() || categoryFilter.value !== 'all' || periodFilter.value !== 'all'))

const calendarItems = computed(() => {
  const month = calendarPlaceholder.value.month
  const year = calendarPlaceholder.value.year
  const rows = []

  for (const item of timelineMilestones.value) {
    if (isArchived(item) !== showHistory.value) continue
    if (categoryFilter.value !== 'all' && (item.category || '其他') !== categoryFilter.value) continue
    if (!matchesMilestoneQuery(item, searchQuery.value, courseNamesById.value)) continue

    const occurrenceDate = milestoneCalendarOccurrenceDate(item, year, month)
    if (!occurrenceDate) continue
    const countdown = countdownState({ ...item, date: occurrenceDate, repeat: 'none' }, appNow.value)
    const days = appCalendarDaysBetween(appToday.value, occurrenceDate)

    if (!showHistory.value) {
      if (periodFilter.value === 'past') {
        if (!countdown.isPast) continue
      } else {
        if (!showPast.value && countdown.isPast) continue
        if (periodFilter.value === 'pinned' && (!item.pinned || countdown.isPast)) continue
        if (periodFilter.value === 'week' && (countdown.isPast || days < 0 || days >= 7)) continue
        if (periodFilter.value === 'month' && (countdown.isPast || days < 0 || days >= 30)) continue
      }
    }
    rows.push({ ...item, occurrenceDate, countdown, days })
  }

  return rows.sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate)
    || Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || String(left.time || '').localeCompare(String(right.time || ''))
    || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN'))
})

const calendarMarkedDates = computed(() => [...new Set(calendarItems.value.map((item) => item.occurrenceDate))])
const selectedCalendarKey = computed(() => selectedCalendarDate.value.toString())
const selectedCalendarItems = computed(() => calendarItems.value
  .filter((item) => item.occurrenceDate === selectedCalendarKey.value)
  .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || (sortKey.value === 'name' ? String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN') : 0)
    || (sortKey.value === 'created' ? String(right.createdAt || '').localeCompare(String(left.createdAt || '')) : 0)
    || String(left.time || '').localeCompare(String(right.time || ''))))
const calendarMonthLabel = computed(() => new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', timeZone: 'UTC',
}).format(new Date(`${calendarPlaceholder.value.year}-${pad2(calendarPlaceholder.value.month)}-01T00:00:00Z`)))
const selectedCalendarLabel = computed(() => new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC',
}).format(new Date(`${selectedCalendarKey.value}T00:00:00Z`)))

function openAddForSelectedCalendarDate() {
  openAdd()
  form.value.date = selectedCalendarKey.value
}

function goToCalendarToday() {
  const todayDate = parseDate(appToday.value)
  selectedCalendarDate.value = todayDate
  calendarPlaceholder.value = todayDate
}

function resetFilters() {
  query.value = ''
  searchQuery.flush('')
  categoryFilter.value = 'all'
  periodFilter.value = 'all'
}

function selectOverview(period) {
  resetFilters()
  showHistory.value = false
  showPast.value = period === 'past'
  periodFilter.value = period
}

function setHistory() {
  showHistory.value = !showHistory.value
  resetFilters()
}

const emptyInfo = computed(() => {
  if (hasFilters.value) return { title: '没有符合条件的重要日期', description: '试试其他关键词、类型或时间范围。', action: '清除筛选' }
  if (showHistory.value) return { title: '还没有归档的重要日期', description: '归档后会保留在这里，随时可以恢复。', action: '返回当前' }
  if (summary.value.past) return { title: '当前没有即将到来的重要日期', description: `有 ${summary.value.past} 项已结束，可以查看或添加下一个日期。`, action: '查看已结束' }
  if (summary.value.archived) return { title: '当前列表暂时为空', description: `有 ${summary.value.archived} 项重要日期已归档，可以在历史中查看或恢复。`, action: '查看历史' }
  return { title: '还没有重要日期', description: '先记下一场考试、一个生日或下次交付日期。', action: '＋ 添加重要日期' }
})

function emptyAction() {
  if (hasFilters.value) resetFilters()
  else if (showHistory.value) setHistory()
  else if (summary.value.past) selectOverview('past')
  else if (summary.value.archived) setHistory()
  else openAdd()
}

// 卡片上这些派生值原来全部在模板里现算：tileOf / courseLabel 各调 2 次、
// timelineOf 调 4 次，而 reviewSummary 每次都要**遍历整份待办表**（reviewTasksFor
// 是个 filter）。也就是说每张卡片要重复做 O(待办数) 的活，一张卡片 2 次，
// 16 张卡片就是 32 趟全表扫描 —— 而且 clock 每跳一次（60s）就重来一遍。
//
// 这里改成「先算好再渲染」：把待办按 sourceId 归成一张 Map（一次分组，O(待办数)），
// 然后每个卡片只查一次 Map，装饰值随卡片一起预计算后交给模板直接取。
const reviewTasksBySourceId = computed(() => {
  const grouped = new Map()
  for (const task of tasks.value) {
    if (task.sourceType !== 'milestone-review' || !task.sourceId) continue
    const bucket = grouped.get(task.sourceId)
    if (bucket) bucket.push(task)
    else grouped.set(task.sourceId, [task])
  }
  return grouped
})

const visibleItems = computed(() => {
  const grouped = reviewTasksBySourceId.value
  return milestoneView.value.visible.map((item) => ({
    ...item,
    tile: tileOf(item),
    course: courseLabel(item),
    timeline: timelineOf(item),
    review: reviewSummaryOf(item, grouped.get(item.id)),
    activeReview: (grouped.get(item.id) || []).find((task) => isTaskActionable(task)),
    progress: Math.max(0, Math.min(100, Number(item.reviewProgress) || 0)),
  }))
})

/** @param {unknown} value @returns {value is (typeof visibleItems.value)[number]} */
function isMilestoneCard(value) {
  return Boolean(value && typeof value === 'object' && 'countdown' in value)
}

function createReviewTask(item, event) {
  event?.stopPropagation()
  try {
    const { task, created } = ensureMilestoneReviewTask(domain, item.id)
    if (!created) { void router.push({ path: '/tasks', query: { focus: task.id } }); return }
    reviewMessage.value = `已安排“${item.name}”的 25 分钟复习，可直接准备专注`
    showToast('已安排 25 分钟复习', { type: 'success', actionLabel: '查看待办', viewFn: () => router.push({ path: '/tasks', query: { focus: task.id } }), duration: 6000 })
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '安排复习失败，请重试。', { type: 'error' }) }
}

function openReviewTasks(item) {
  const list = reviewTasksBySourceId.value.get(item.id) || []
  const target = list.find((task) => isTaskActionable(task)) || list.at(-1)
  if (target) void router.push({ path: '/tasks', query: { focus: target.id } })
}

function reviewTasksFor(item) {
  return tasks.value.filter((task) => task.sourceType === 'milestone-review' && task.sourceId === item.id)
}

/** 复习进度文案。批量渲染时 reviewTasks 由调用方按 sourceId 预先分组好传入。 */
function reviewSummaryOf(item, reviewTasks) {
  const list = reviewTasks ?? reviewTasksFor(item)
  if (!list.length) return ''
  const completed = list.filter((task) => task.done || taskStatus(task) === 'completed').length
  return `复习任务 ${completed}/${list.length}`
}

// 窄屏（单列）下清单很长时做虚拟滚动；宽屏保持多列网格原样渲染。
// 入场动画只对少量卡片有意义，长列表直接禁用，避免一次挂载几十个动画。
const EXAM_LIST_THRESHOLD = 16
const narrowQuery = '(max-width: 760px)'
const narrowMql = typeof window !== 'undefined' ? window.matchMedia(narrowQuery) : null
const isNarrow = ref(narrowMql?.matches ?? false)
const narrowMqlHandler = (event) => { isNarrow.value = event.matches }
let viewListenersActive = false

function activateViewListeners() {
  if (viewListenersActive) return
  viewListenersActive = true
  if (narrowMql) {
    isNarrow.value = narrowMql.matches
    narrowMql.addEventListener('change', narrowMqlHandler)
  }
  if (typeof document !== 'undefined') document.addEventListener('click', closeMenu)
}

function deactivateViewListeners() {
  if (!viewListenersActive) return
  viewListenersActive = false
  narrowMql?.removeEventListener('change', narrowMqlHandler)
  if (typeof document !== 'undefined') document.removeEventListener('click', closeMenu)
}

onMounted(activateViewListeners)
onActivated(activateViewListeners)
onDeactivated(deactivateViewListeners)
onBeforeUnmount(deactivateViewListeners)

// ---------- 卡片展示辅助：日期牌 / 短日期 / 时间轴 ----------
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const todayKey = computed(() => appToday.value)

// 日期牌：目标月 / 日（无法解析时显示 --）
function tileOf(item) {
  const t = item.countdown.target
  if (!t) return { month: '--', day: '--' }
  return { month: pad2(item.occurrenceDate.slice(5, 7)), day: pad2(item.occurrenceDate.slice(8, 10)) }
}

// 短日期行：8月30日 · 周日（含时间时追加），不再与「本周日」等信息重复
function shortDateOf(item) {
  const t = item.countdown.target
  if (!t) return fmtCountdownDate(item, null)
  const date = item.occurrenceDate
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const year = date.slice(0, 4) !== todayKey.value.slice(0, 4) ? `${date.slice(0, 4)}年` : ''
  let text = `${year}${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 · ${WEEKDAYS[weekday]}`
  if (item.time) text += ` ${item.time}`
  return text
}

// 底部轻量时间轴：今天 ─── ● 目标日
function timelineOf(item) {
  const t = item.countdown.target
  if (!t) return null
  const start = `${Number(todayKey.value.slice(5, 7))}/${Number(todayKey.value.slice(8, 10))}`
  const end = `${Number(item.occurrenceDate.slice(5, 7))}/${Number(item.occurrenceDate.slice(8, 10))}`
  const sameDay = item.occurrenceDate === todayKey.value
  return { start, end, sameDay }
}

async function focusRouteMilestone() {
  const { id } = readFocusQuery(route)
  if (!id || focusHandled === id) return
  focusHandled = id
  const item = exams.value.find((entry) => String(entry.id) === id)
  if (!item) {
    focusMessage.value = '这条重要日期可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
    return
  }
  showHistory.value = isArchived(item)
  resetFilters()
  showPast.value = showHistory.value || countdownState(item, appNow.value).isPast
  focusedMilestoneId.value = id
  await nextTick()
  const element = await focusElementWhenReady(id)
  if (!element) focusMessage.value = '这条重要日期可能已删除或已移动。'
  await clearFocusFromRoute(router, route)
}

watch(
  () => [route.query.focus, exams.value.length, showHistory.value, showPast.value],
  () => { void focusRouteMilestone() },
  { immediate: true }
)

// ---------- 卡片右上 ··· 菜单：置顶 / 编辑 / 删除 ----------
const openMenuId = ref(null)
const menuPlacement = ref('down')

function toggleMenu(item, event) {
  event.stopPropagation()
  if (openMenuId.value !== item.id) {
    const buttonRect = event.currentTarget?.getBoundingClientRect?.()
    menuPlacement.value = menuPlacementFor(buttonRect, window.innerHeight)
  }
  openMenuId.value = openMenuId.value === item.id ? null : item.id
}

function closeMenu() {
  openMenuId.value = null
}

function menuPin(item) {
  domain.updateMilestone(item.id, { pinned: !item.pinned })
  closeMenu()
}

function menuEdit(item) {
  closeMenu()
  openEdit(item)
}

function menuDelete(item) {
  closeMenu()
  deleteTarget.value = item
}

/* ---------- 长按 / 右键：在触点附近弹出上下文菜单，操作只针对这一条 ---------- */
const contextMenu = ref(null)
let longPressItem = null

const cardLongPress = createLongPress({
  onLongPress: ({ x, y }) => {
    if (!longPressItem) return
    closeMenu()
    contextMenu.value = { item: longPressItem, x, y }
  },
})

function onCardPointerDown(item, event) {
  longPressItem = item
  cardLongPress.onPointerDown(event)
}

function onCardClick(item, event) {
  // 长按刚弹过菜单，这一次 click 必须吃掉，否则会顺手打开编辑弹窗盖住菜单
  if (cardLongPress.shouldSuppressClick()) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    return
  }
  openEdit(item)
}

// 桌面端用右键，与移动端长按得到同一个菜单
function openContextMenuAt(item, event) {
  // 触屏长按：浏览器在长按之后**还会补一个 contextmenu 事件**。
  // 长按路径（cardLongPress）已经开过菜单，这里再开一次就是"关掉再打开"——
  // 肉眼可见地闪一下，还会把浮层栈的 history 标记推掉再补一条。
  // sourceCapabilities.firesTouchEvents 精确区分触屏与鼠标（Firefox 没有这个属性，走右键路径）。
  if (event?.sourceCapabilities?.firesTouchEvents) return
  closeMenu()
  contextMenu.value = { item, x: Number(event?.clientX) || 0, y: Number(event?.clientY) || 0 }
}

const contextMenuTarget = computed(() => contextMenu.value?.item ?? null)

const contextMenuActions = computed(() => {
  const item = contextMenuTarget.value
  if (!item) return []
  const actions = [
    { key: 'pin', label: item.pinned ? '取消置顶' : '置顶', icon: '📌' },
    { key: 'edit', label: '编辑', icon: '✏️' },
  ]
  actions.push(isArchived(item)
    ? { key: 'restore', label: '恢复', icon: '↩️' }
    : { key: 'archive', label: '归档', icon: '📥' })
  actions.push({ key: 'delete', label: '删除', icon: '🗑️', tone: 'danger' })
  return actions
})

function onContextMenuSelect(action) {
  const item = contextMenuTarget.value
  contextMenu.value = null
  if (!item) return
  if (action.key === 'pin') menuPin(item)
  else if (action.key === 'edit') menuEdit(item)
  else if (action.key === 'delete') menuDelete(item)
  else if (action.key === 'archive') menuArchive(item)
  else if (action.key === 'restore') {
    domain.restoreMilestone(item.id)
    closeMenu()
  }
}

function menuArchive(item) {
  domain.archiveMilestone(item.id)
  showToast('重要日期已归档', {
    type: 'success',
    actionLabel: '撤销',
    undoFn: () => domain.restoreMilestone(item.id),
    duration: 6000,
  })
  closeMenu()
}

function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  const index = exams.value.findIndex((entry) => entry.id === target.id)
  if (index < 0) return
  domain.deleteMilestone(target.id)
  deleteTarget.value = null
  showToast('重要日期已删除', {
    type: 'warning',
    actionLabel: '撤销',
    undoFn: () => domain.restoreDeletedMilestone(target),
    duration: 6000,
  })
}

function courseLabel(item) {
  return courseNamesById.value.get(item.courseId) ?? item.courseName ?? ''
}

</script>

<template>
  <div class="page">
    <PageHeader class="page-head" title="重要日期" description="考试、生日、纪念日和重要截止都可以放在这里。">
      <template #actions>
        <button class="btn btn-ghost" :aria-expanded="showHistory" @click="setHistory">{{ showHistory ? '返回当前' : `历史 ${summary.archived || ''}` }}</button>
        <label v-if="!showHistory" class="past-toggle">
          <input v-model="showPast" type="checkbox" />
          显示已结束
        </label>
        <Button v-if="!showHistory" class="btn btn-primary" @click="openAdd">＋ 添加重要日期</Button>
        <Button v-if="!showHistory" variant="outline" @click="openAdd('externalExam')">＋ 校外考试</Button>
      </template>
    </PageHeader>

    <LearningNavigation current="exams" />

    <div v-if="exams.length && !showHistory" class="date-overview" role="group" aria-label="重要日期概览">
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'all' && !showPast }" :aria-pressed="periodFilter === 'all' && !showPast" @click="selectOverview('all')"><span>即将到来</span><b>{{ summary.upcoming }}</b><small>全部当前日期</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'week' }" :aria-pressed="periodFilter === 'week'" @click="selectOverview('week')"><span>未来 7 天</span><b>{{ summary.week }}</b><small>含今天</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'pinned' }" :aria-pressed="periodFilter === 'pinned'" @click="selectOverview('pinned')"><span>已置顶</span><b>{{ summary.pinned }}</b><small>优先关注</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'past' }" :aria-pressed="periodFilter === 'past'" @click="selectOverview('past')"><span>已结束</span><b>{{ summary.past }}</b><small>查看与归档</small></button>
    </div>

    <section class="card date-filters" aria-label="重要日期筛选">
      <div class="filter-topline">
        <div class="date-search"><label class="sr-only" for="dates-search">搜索重要日期</label><Input id="dates-search" v-model="query" type="search" placeholder="搜索名称、课程、地点或备注" /><button v-if="query" type="button" class="link-btn" aria-label="清除重要日期搜索" @click="query = ''; searchQuery.flush('')">×</button></div>
        <label v-if="!showHistory" class="filter-select"><span>范围</span><select v-model="periodFilter"><option value="all">全部日期</option><option value="week">未来 7 天</option><option value="month">未来 30 天</option><option value="pinned">已置顶</option><option value="past">已结束</option></select></label>
        <label class="filter-select"><span>排序</span><select v-model="sortKey"><option value="date">最近日期优先</option><option value="name">按名称</option><option value="created">最近添加优先</option></select></label>
      </div>
      <div class="filter-bottomline">
        <div class="segmented category-filters" role="group" aria-label="重要日期类型"><button type="button" :class="{ on: categoryFilter === 'all' }" :aria-pressed="categoryFilter === 'all'" @click="categoryFilter = 'all'">全部类型</button><button v-for="category in CATEGORIES" :key="category" type="button" :class="{ on: categoryFilter === category }" :aria-pressed="categoryFilter === category" @click="categoryFilter = category">{{ category }}</button></div>
        <div class="filter-result"><span role="status">{{ viewMode === 'calendar' ? calendarItems.length : visibleItems.length }} 项{{ showHistory ? '归档日期' : '重要日期' }}</span><button v-if="hasFilters" type="button" class="link-btn" @click="resetFilters">清除筛选</button></div>
      </div>
    </section>
    <p v-if="reviewMessage" class="review-message" role="status">✓ {{ reviewMessage }}</p>
    <p v-if="focusMessage" class="review-message" role="status">{{ focusMessage }}</p>

    <Tabs v-model="viewMode" class="date-views">
      <TabsList class="date-view-switch" aria-label="重要日期显示方式">
        <TabsTrigger value="list">列表</TabsTrigger>
        <TabsTrigger value="calendar">月历</TabsTrigger>
      </TabsList>

      <TabsContent value="list" class="date-view-panel">
        <EmptyState :level="2"
          v-if="visibleItems.length === 0"
          class="card empty-box"
          icon="⏳"
          :title="emptyInfo.title"
          :description="emptyInfo.description"
          :primary-label="emptyInfo.action"
          @primary="emptyAction"
        />

        <VirtualList
          v-else
          class="list"
          :class="[isNarrow ? 'narrow' : 'grid', { 'no-anim': visibleItems.length > EXAM_LIST_THRESHOLD }]"
          :items="visibleItems"
          item-key="id"
          :estimated-height="240"
          :gap="14"
          :threshold="isNarrow ? EXAM_LIST_THRESHOLD : Number.MAX_SAFE_INTEGER"
          :reveal-key="focusedMilestoneId"
        >
      <template #default="{ item }">
        <div
          v-if="isMilestoneCard(item)"
          class="card exam cvi-card"
          :class="{ finished: item.countdown.isPast, pinned: item.pinned, hot: item.countdown.cls === 'hot' && !item.countdown.isPast, 'menu-open': openMenuId === item.id, 'focus-target-highlight': focusedMilestoneId === item.id }"
          :data-focus-id="item.id"
          @pointerdown="onCardPointerDown(item, $event)"
          @pointermove="cardLongPress.onPointerMove"
          @pointerup="cardLongPress.onPointerUp"
          @pointercancel="cardLongPress.onPointerCancel"
          @contextmenu.prevent="openContextMenuAt(item, $event)"
          @click="onCardClick(item, $event)"
        >
        <!-- 顶部：轻量标签 + 操作菜单 -->
        <div class="exam-top">
          <div class="meta-row">
            <Badge variant="secondary" class="category">{{ item.category ?? '其他' }}</Badge>
            <Badge v-if="item.kind === 'externalExam'" variant="outline" class="repeat-tag">报名与备考</Badge>
            <Badge v-if="item.repeat === 'yearly'" variant="outline" class="repeat-tag">每年重复</Badge>
            <Badge v-if="item.pinned" variant="outline" class="repeat-tag">置顶</Badge>
            <Badge v-if="isArchived(item)" variant="outline" class="repeat-tag">已归档</Badge>
          </div>
          <button
            type="button"
            class="menu-btn"
            :aria-label="`重要日期「${item.name}」的更多操作`"
            :aria-expanded="openMenuId === item.id"
            @click="toggleMenu(item, $event)"
          >···</button>
          <div v-if="openMenuId === item.id" class="card-menu" :class="menuPlacement" @click.stop>
            <button @click="menuPin(item)">{{ item.pinned ? '取消置顶' : '置顶' }}</button>
            <button @click="menuEdit(item)">编辑</button>
            <button v-if="!isArchived(item)" @click="menuArchive(item)">归档</button>
            <button v-else @click="domain.restoreMilestone(item.id); closeMenu()">恢复</button>
            <button class="danger" @click="menuDelete(item)">删除</button>
          </div>
        </div>

        <!-- 主体：日期牌 + 事件 + 剩余天数 -->
        <div class="exam-main">
          <div class="date-tile" aria-hidden="true">
            <small>{{ item.tile.month }}</small>
            <b>{{ item.tile.day }}</b>
          </div>
          <div class="exam-info">
            <h2 class="name"><button type="button" :title="item.name" @pointerdown.stop @click.stop="openEdit(item)">{{ item.name }}</button></h2>
            <div class="date">{{ item.kind === 'externalExam' ? (item.externalExamStage === 'registration' ? '报名截止 · ' : '考试 · ') : '' }}{{ shortDateOf(item) }}</div>
            <div v-if="item.kind === 'externalExam' && item.externalExamStage === 'registration' && item.examDate" class="external-exam-meta">考试日期：{{ item.examDate }}{{ item.examTime ? ` ${item.examTime}` : '' }}</div>
            <div v-if="item.category === '学习' && item.course" class="loc" :title="item.course">{{ item.course }}</div>
            <div v-if="item.kind === 'externalExam' && item.registerStart" class="external-exam-meta">报名开始：{{ item.registerStart }}</div>
            <div v-if="item.kind === 'externalExam' && item.registerDeadline" class="external-exam-meta">报名截止：{{ item.registerDeadline }}</div>
            <div v-if="item.kind === 'externalExam' && item.campus" class="external-exam-meta">校区：{{ item.campus }}</div>
            <div v-if="item.kind === 'externalExam' && item.seatNo" class="external-exam-meta">座位号：{{ item.seatNo }}</div>
            <div v-if="item.kind === 'externalExam' && item.admissionNo" class="external-exam-meta">准考证号：{{ item.admissionNo }}</div>
            <div v-if="item.location" class="loc" :title="item.location">{{ item.location }}</div>
            <div v-if="item.note" class="note" :title="item.note"><span>备注</span>{{ item.note }}</div>
          </div>
          <div class="count" :class="item.countdown.cls">
            <span v-if="item.countdown.relativeText && (item.countdown.isPast || Number(item.countdown.days) < 3)" class="countdown-human">{{ item.countdown.relativeText }}</span>
            <template v-else>
              <small v-if="!item.countdown.isPast && /^\d+$/.test(String(item.countdown.text))">还有</small>
              <span class="num" :class="{ tiny: !/^\d+$/.test(String(item.countdown.text)) }">{{ item.countdown.text }}</span>
              <span v-if="item.countdown.label && /^\d+$/.test(String(item.countdown.text))" class="unit">{{ item.countdown.label }}</span>
            </template>
          </div>
        </div>

        <section v-if="item.kind === 'externalExam'" class="external-exam-checklist" aria-label="考试随身物品" @click.stop>
          <div class="external-exam-checklist-head">
            <strong>考试随身物品</strong>
            <span>{{ (item.requiredItems || []).filter((entry) => entry.checked).length }}/{{ (item.requiredItems || []).length }}</span>
          </div>
          <div class="external-exam-items">
            <label v-for="(entry, index) in item.requiredItems || []" :key="entry.id || `${item.id}-${entry.name}-${index}`" class="external-exam-item" :class="{ checked: entry.checked }">
              <input type="checkbox" :checked="entry.checked" :aria-label="`确认携带${entry.name}`" @change="toggleRequiredItem(item, index)" />
              <span>{{ entry.name }}<small v-if="entry.quantity !== 1 || entry.unit">×{{ entry.quantity }} {{ entry.unit }}</small></span>
            </label>
          </div>
          <button v-if="item.examDate === appToday || (item.examDate === undefined && item.date === appToday)" type="button" class="external-exam-check-all" @click="checkAllRequiredItems(item)">考试日一键确认全部用品</button>
        </section>

        <div v-if="item.category === '学习'" class="review-progress">
          <div class="progress-caption"><span>复习完成度</span><b>{{ item.progress }}%</b></div>
          <progress :value="item.progress" max="100" :aria-label="`${item.name}复习完成度`"></progress>
          <button v-if="item.review" type="button" class="review-link" @click.stop="openReviewTasks(item)">{{ item.review }} · 查看待办 →</button>
        </div>

        <!-- 底部轻量时间轴 -->
        <div v-if="item.timeline" class="timeline" aria-hidden="true">
          <span class="tl-label">{{ item.timeline.start }}</span>
          <span class="tl-track"><i></i></span>
          <span class="tl-label strong">{{ item.timeline.end }}</span>
          <span class="tl-dot" :class="{ on: item.timeline.sameDay }"></span>
        </div>
        <button v-if="item.category === '学习' && !item.countdown.isPast && !isArchived(item)" type="button" class="review-action" @click="createReviewTask(item, $event)">{{ item.activeReview ? '继续复习 →' : item.review ? '再安排 25 分钟复习' : '安排 25 分钟复习' }}</button>
        <TaskFocusLink v-if="item.activeReview && item.category === '学习' && !item.countdown.isPast && !isArchived(item)" :task="item.activeReview" />
      </div>
      </template>
        </VirtualList>
      </TabsContent>

      <TabsContent value="calendar" class="date-view-panel">
        <div class="date-calendar-layout">
          <Card class="date-calendar-card">
            <CardHeader class="date-calendar-heading">
              <CardTitle>{{ calendarMonthLabel }}</CardTitle>
              <CardDescription>点选日期查看安排；有标记的日期包含重要事项。</CardDescription>
              <CardAction><Button variant="outline" size="sm" @click="goToCalendarToday">今天</Button></CardAction>
            </CardHeader>
            <CardContent class="date-calendar-content">
              <Calendar
                v-model="selectedCalendarDate"
                v-model:placeholder="calendarPlaceholder"
                :marked-dates="calendarMarkedDates"
                locale="zh-CN"
                :week-starts-on="1"
                :fixed-weeks="true"
                class="important-date-calendar"
              />
            </CardContent>
          </Card>

          <Card class="date-calendar-day-card">
            <CardHeader class="date-calendar-heading">
              <CardTitle>{{ selectedCalendarLabel }}</CardTitle>
              <CardDescription>{{ selectedCalendarItems.length ? `${selectedCalendarItems.length} 项安排` : '这一天还没有安排' }}</CardDescription>
            </CardHeader>
            <CardContent class="date-calendar-day-content">
              <div v-if="selectedCalendarItems.length" class="date-calendar-events">
                <Button
                  v-for="item in selectedCalendarItems"
                  :key="`${item.id}-${item.occurrenceDate}`"
                  variant="ghost"
                  class="date-calendar-event"
                  :aria-label="`编辑重要日期：${item.name}`"
                  @click="openEdit(item)"
                >
                  <span class="date-calendar-event-time">{{ item.time || '全天' }}</span>
                  <span class="date-calendar-event-copy">
                    <span class="date-calendar-event-name">{{ item.name }}</span>
                    <span class="date-calendar-event-meta">
                      <Badge variant="secondary">{{ item.category || '其他' }}</Badge>
                      <span v-if="item.repeat === 'yearly'">每年重复</span>
                      <span v-if="item.location">{{ item.location }}</span>
                      <span v-if="item.note">备注：{{ item.note }}</span>
                    </span>
                  </span>
                  <span class="date-calendar-event-arrow" aria-hidden="true">›</span>
                </Button>
              </div>
              <div v-else class="date-calendar-empty">
                <p>{{ calendarItems.length ? '这一天没有符合当前筛选条件的日期。' : '这个月还没有符合条件的重要日期。' }}</p>
                <Button v-if="!showHistory" variant="outline" size="sm" @click="openAddForSelectedCalendarDate">＋ 添加到这一天</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>

    <Modal v-if="showForm" :open="showForm" :title="editingId ? '编辑重要日期' : '添加重要日期'" mobile-full-screen @close="showForm = false">
      <form :id="editorFormId" ref="formElement" class="form" novalidate @submit.prevent="save">
        <label for="exams-name">名称 *</label>
        <input id="exams-name" ref="nameInput" v-model="form.name" maxlength="200" :aria-invalid="errorField === 'name' || undefined" :aria-describedby="errorField === 'name' ? 'dates-form-error' : undefined" placeholder="例如：期末考试、生日或项目截止日" @input="clearFormError('name')" />

        <div class="form-row">
          <div>
            <label v-if="form.category !== '校外考试'" for="exams-target-date">目标日期 *</label>
            <input v-if="form.category !== '校外考试'" id="exams-target-date" ref="dateInput" v-model="form.date" type="date" :aria-invalid="errorField === 'date' || undefined" :aria-describedby="errorField === 'date' ? 'dates-form-error' : undefined" @input="clearFormError('date')" />
            <label v-else for="exams-exam-date">考试日期</label>
            <input v-if="form.category === '校外考试'" id="exams-exam-date" ref="dateInput" v-model="form.examDate" type="date" :aria-invalid="errorField === 'examDate' || undefined" :aria-describedby="errorField === 'examDate' ? 'dates-form-error' : undefined" @input="clearFormError('examDate')" />
          </div>
          <div>
            <label for="exams-category">类型</label>
            <select id="exams-category" v-model="form.category">
              <option v-for="category in CATEGORIES" :key="category" :value="category">{{ category }}</option>
            </select>
          </div>
        </div>

        <div class="date-shortcuts" role="group" aria-label="快速选择目标日期"><button type="button" :aria-pressed="(form.category === '校外考试' ? form.examDate : form.date) === appToday" @click="setFormDate(0)">今天</button><button type="button" :aria-pressed="(form.category === '校外考试' ? form.examDate : form.date) === addAppDays(appToday, 1)" @click="setFormDate(1)">明天</button><button type="button" :aria-pressed="(form.category === '校外考试' ? form.examDate : form.date) === addAppDays(appToday, 7)" @click="setFormDate(7)">一周后</button></div>

        <template v-if="form.category === '校外考试'">
          <div class="form-row">
            <div><label for="external-register-start">报名开始（选填）</label><input id="external-register-start" v-model="form.registerStart" type="date" :aria-invalid="errorField === 'registerStart' || undefined" :aria-describedby="errorField === 'registerStart' ? 'dates-form-error' : undefined" @input="clearFormError('registerStart')" /></div>
            <div><label for="external-register-deadline">报名截止</label><input id="external-register-deadline" v-model="form.registerDeadline" type="date" :aria-invalid="errorField === 'registerDeadline' || undefined" :aria-describedby="errorField === 'registerDeadline' ? 'dates-form-error' : undefined" @input="clearFormError('registerDeadline')" /></div>
          </div>
          <small class="field-hint">考试日期和报名截止日期至少填一项，其他信息可以稍后补充。</small>
          <details class="milestone-details" :open="Boolean(editingId)">
          <summary>考场与用品（选填）</summary>
          <div class="milestone-extra">
          <div class="form-row">
            <div><label for="external-venue">考点 / 考场</label><Input id="external-venue" v-model="form.venue" maxlength="200" placeholder="选填，例如：市一中考点" /></div>
            <div><label for="external-campus">校区</label><Input id="external-campus" v-model="form.campus" maxlength="100" placeholder="选填" /></div>
          </div>
          <div class="form-row">
            <div><label for="external-seat">座位号</label><Input id="external-seat" v-model="form.seatNo" maxlength="50" placeholder="选填" /></div>
            <div><label for="external-admission">准考证号</label><Input id="external-admission" v-model="form.admissionNo" maxlength="50" placeholder="选填" /></div>
          </div>
          <section class="external-exam-form-items" aria-label="考试用品清单">
            <div class="external-exam-form-heading"><strong>考试用品</strong><small>可调整数量或添加自定义物品</small></div>
            <div v-for="(entry, index) in form.requiredItems" :key="entry.id || `${entry.name}-${index}`" class="external-exam-form-item">
              <input v-model="entry.name" maxlength="60" :aria-label="`用品 ${index + 1} 名称`" />
              <input v-model.number="entry.quantity" type="number" min="0.01" step="1" :aria-label="`${entry.name}数量`" />
              <input v-model="entry.unit" maxlength="10" :aria-label="`${entry.name}单位`" placeholder="单位" />
              <button type="button" :aria-label="`删除${entry.name}`" @click="removeRequiredItem(index)">移除</button>
            </div>
            <div class="external-exam-add-item"><Input v-model="newRequiredItemName" maxlength="60" aria-label="新增考试用品" placeholder="例如：水、透明文件袋" @keydown.enter.prevent="addRequiredItem" /><button type="button" @click="addRequiredItem">添加用品</button></div>
          </section>
          <small class="field-hint">至少填写考试日期或报名截止日期；提醒会在报名截止前 14/7/3 天、考试前 30/7/1 天触发，并在考前一晚提示检查用品。</small>
          </div>
          </details>
        </template>

        <details class="milestone-details" :open="Boolean(editingId) || ['time', 'examTime', 'reminder'].includes(errorField)">
        <summary>时间、提醒与更多信息（选填）</summary>
        <div class="milestone-extra">
        <div class="form-row">
          <div>
            <label for="exams-time">{{ form.category === '校外考试' ? '考试时间' : '具体时间' }}（选填）</label>
            <input id="exams-time" v-if="form.category !== '校外考试'" v-model="form.time" type="time" :aria-invalid="errorField === 'time' || undefined" :aria-describedby="errorField === 'time' ? 'dates-form-error' : undefined" @input="clearFormError('time')" />
            <input id="exams-time" v-else v-model="form.examTime" type="time" :aria-invalid="errorField === 'examTime' || undefined" :aria-describedby="errorField === 'examTime' ? 'dates-form-error' : undefined" @input="clearFormError('examTime')" />
          </div>
          <div v-if="form.category !== '校外考试'">
            <label for="exams-repeat">重复</label>
            <select id="exams-repeat" v-model="form.repeat">
              <option value="none">不重复</option>
              <option value="yearly">每年重复</option>
            </select>
          </div>
        </div>

        <small v-if="form.repeat === 'yearly' && form.category !== '校外考试'" class="field-hint">按公历每年重复，卡片显示下一次日期；2 月 29 日在平年按 2 月最后一天显示。</small>

        <label v-if="form.category !== '校外考试'" for="exams-location">地点</label>
        <Input v-if="form.category !== '校外考试'" id="exams-location" v-model="form.location" maxlength="200" placeholder="选填，例如：教学楼 A101" />

        <label for="exams-note">备注</label>
        <textarea id="exams-note" v-model="form.note" rows="3" maxlength="2000" placeholder="准备事项、提醒内容或其他补充"></textarea>

        <label for="dates-reminder">提前提醒（分钟）</label>
        <input id="dates-reminder" v-model="form.reminderMinutes" type="number" min="0" step="1" :placeholder="`默认提前 ${defaultReminder} 分钟`" :aria-invalid="errorField === 'reminder' || undefined" aria-describedby="dates-reminder-hint" @input="clearFormError('reminder')" />
        <small id="dates-reminder-hint" class="field-hint">0 表示到点提醒，留空使用默认设置。未填时间按 23:59 计算；{{ reminderHint }}</small>

        <div v-if="form.category === '学习'" class="form-row">
          <div><label for="exams-course">关联课程</label><select id="exams-course" v-model="form.courseId"><option value="">暂不关联</option><option v-for="course in courses" :key="course.id" :value="course.id">{{ course.name }}</option></select></div>
          <div><label for="exams-review-progress">复习完成度 {{ form.reviewProgress }}%</label><input id="exams-review-progress" v-model.number="form.reviewProgress" type="range" min="0" max="100" step="5" /></div>
        </div>

        <label class="pin-option">
          <input v-model="form.pinned" type="checkbox" />
          在列表顶部显示
        </label>
        </div>
        </details>

        <p v-if="error" id="dates-form-error" class="error" role="alert">{{ error }}</p>
      </form>
      <template #foot>
        <div class="actions">
          <button v-if="editingId" type="button" class="btn btn-danger" @click="remove">删除</button>
          <button type="button" class="btn" @click="showForm = false">取消</button>
          <button type="submit" :form="editorFormId" class="btn btn-primary">保存</button>
        </div>
      </template>
    </Modal>

    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      title="删除重要日期"
      :message="`确定删除重要日期“${deleteTarget?.name || ''}”吗？删除后可在短时间内撤销。`"
      confirm-label="删除"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :view-fn="toast.viewFn" :duration="toast.duration" @action="() => {}" @close="toast.open = false" />

    <ContextMenu
      :open="Boolean(contextMenu)"
      :x="contextMenu?.x || 0"
      :y="contextMenu?.y || 0"
      :title="contextMenuTarget?.name || ''"
      :items="contextMenuActions"
      @select="onContextMenuSelect"
      @close="contextMenu = null"
    />
  </div>
</template>

<style scoped src="./exams.css"></style>
<style scoped>
.external-exam-meta{color:var(--ink-soft);font-size:var(--fs-12)}
.external-exam-checklist{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-tint)}
.external-exam-checklist-head,.external-exam-form-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;color:var(--text);font-size:var(--fs-12)}
.external-exam-checklist-head span,.external-exam-form-heading small{color:var(--ink-soft);font-size:var(--fs-11)}
.external-exam-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px}
.external-exam-item{display:flex;align-items:center;gap:7px;min-width:0;color:var(--text);font-size:var(--fs-12)}
.external-exam-item input{flex:0 0 auto}
.external-exam-item span{min-width:0}
.external-exam-item small{display:block;color:var(--ink-soft);font-size:var(--fs-10)}
.external-exam-item.checked span{text-decoration:line-through;color:var(--ink-soft)}
.external-exam-check-all,.external-exam-add-item button,.external-exam-form-item button{min-height:32px;padding:5px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--card);color:var(--primary);font:inherit;font-size:var(--fs-11);cursor:pointer}
.external-exam-form-items{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-tint)}
.external-exam-form-item{display:grid;grid-template-columns:minmax(0,1fr) 70px 70px auto;gap:6px;align-items:center}
.external-exam-form-item input{min-width:0;width:100%;min-height:36px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-12)}
.external-exam-add-item{display:flex;gap:7px}
.external-exam-add-item :deep(input){min-width:0;flex:1}
@media(max-width:520px){.external-exam-items{grid-template-columns:1fr}.external-exam-form-item{grid-template-columns:minmax(0,1fr) 56px 56px auto}}
</style>
