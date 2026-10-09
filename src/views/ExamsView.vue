<script setup>
import { computed, nextTick, ref, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import VirtualList from '../components/VirtualList.vue'
import ContextMenu from '../components/ContextMenu.vue'
import Toast from '../components/Toast.vue'
import {
  fmtCountdownDate,
  useStoredRef,
} from '../composables/store'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isArchived, isTaskActionable, taskStatus } from '../composables/domain/state.js'
import { menuPlacementFor } from '../composables/menuPlacement.js'
import { createLongPress } from '../composables/longPress.js'
import { addAppDays, appNow, appToday } from '../composables/timeContext.js'
import { defaultReminderMinutes } from '../composables/settingsPolicy.js'
import { isValidPlanningDate, selectMilestoneWorkspace } from '../composables/planningViews.js'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { countdownState } from '../composables/store/countdown.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'

const CATEGORIES = ['学习', '生活', '纪念日', '项目', '其他']
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
const showForm = ref(false)
/** @type {import('vue').Ref<string | null>} */
const editingId = ref(null)
const error = ref('')
const errorField = ref('')
/** @type {import('vue').Ref<HTMLInputElement | null>} */
const nameInput = ref(null)
/** @type {import('vue').Ref<HTMLInputElement | null>} */
const dateInput = ref(null)
const query = ref('')
const searchQuery = useDebouncedRef(query)
const categoryFilter = ref('all')
const periodFilter = ref('all')
const sortKey = ref('date')
const form = ref(emptyForm())
const deleteTarget = ref(null)
const reviewMessage = ref('')
const focusMessage = ref('')
const focusedMilestoneId = ref('')
/** @type {import('vue').Ref<{ open: boolean, message: string, type: string, actionLabel: string, undoFn?: () => unknown, viewFn?: () => unknown, duration: number }>} */
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', duration: 3200 })
let focusHandled = ''

function emptyForm() {
  return {
    name: '',
    date: '',
    time: '',
    location: '',
    category: '学习',
    repeat: 'none',
    pinned: false,
    courseId: '',
    reviewProgress: 0,
    reminderMinutes: '',
  }
}

function openAdd() {
  editingId.value = null
  error.value = ''
  errorField.value = ''
  form.value = emptyForm()
  showForm.value = true
}

function openEdit(item) {
  editingId.value = item.id
  error.value = ''
  errorField.value = ''
  form.value = {
    name: item.name,
    date: item.date,
    time: item.time ?? '',
    location: item.location ?? '',
    category: item.category ?? '其他',
    repeat: item.repeat ?? 'none',
    pinned: Boolean(item.pinned),
    courseId: item.courseId ?? '',
    reviewProgress: Number(item.reviewProgress ?? 0),
    reminderMinutes: String(item.reminderMinutes ?? ''),
  }
  showForm.value = true
}

function save() {
  if (!form.value.name.trim()) {
    error.value = '请填写重要日期名称'
    errorField.value = 'name'
    void nextTick(() => nameInput.value?.focus())
    return
  }
  if (!isValidPlanningDate(form.value.date)) {
    error.value = '请选择有效的目标日期'
    errorField.value = 'date'
    void nextTick(() => dateInput.value?.focus())
    return
  }
  const reminder = String(form.value.reminderMinutes).trim()
  if (reminder && (!Number.isFinite(Number(reminder)) || Number(reminder) < 0)) {
    error.value = '提醒提前量需要是大于或等于 0 的分钟数'
    errorField.value = 'reminder'
    return
  }
  const isStudyCountdown = form.value.category === '学习'
  const data = {
    name: form.value.name.trim(),
    date: form.value.date,
    time: form.value.time,
    location: form.value.location.trim(),
    category: form.value.category,
    repeat: form.value.repeat,
    pinned: form.value.pinned,
    courseId: isStudyCountdown ? form.value.courseId : '',
    courseName: isStudyCountdown ? (courses.value.find((course) => course.id === form.value.courseId)?.name ?? '') : '',
    reviewProgress: isStudyCountdown ? Math.max(0, Math.min(100, Number(form.value.reviewProgress) || 0)) : 0,
    reminderMinutes: defaultReminderMinutes('milestone', reminder),
  }
  if (editingId.value) {
    if (!domain.updateMilestone(editingId.value, data)) {
      error.value = '这条重要日期已不存在，请关闭后重新添加。'
      return
    }
  } else {
    domain.createMilestone({ ...data, kind: form.value.category === '学习' ? 'exam' : 'countdown', createdFrom: 'manual' })
  }
  showForm.value = false
  showToast(editingId.value ? '重要日期已更新' : '重要日期已添加', { type: 'success' })
}

function clearFormError(field) {
  if (errorField.value === field) { error.value = ''; errorField.value = '' }
}

function setFormDate(offset) {
  form.value.date = addAppDays(appToday.value, offset)
  clearFormError('date')
}

const defaultReminder = computed(() => defaultReminderMinutes('milestone'))

function remove() {
  const item = exams.value.find((entry) => entry.id === editingId.value)
  showForm.value = false
  if (item) deleteTarget.value = item
}

/** @param {string} message @param {{ type?: string, actionLabel?: string, undoFn?: () => unknown, viewFn?: () => unknown, duration?: number }} [options] */
function showToast(message, { type = 'info', actionLabel = '', undoFn = undefined, viewFn = undefined, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}

const courseNamesById = computed(() => new Map(courses.value.map((course) => [course.id, course.name])))
const milestoneView = computed(() => selectMilestoneWorkspace(exams.value, {
  now: appNow.value, query: searchQuery.value, category: categoryFilter.value,
  period: periodFilter.value, sortKey: sortKey.value, showPast: showPast.value,
  showHistory: showHistory.value, courseNames: courseNamesById.value,
}))
const summary = computed(() => milestoneView.value.summary)
const hasFilters = computed(() => Boolean(query.value.trim() || categoryFilter.value !== 'all' || periodFilter.value !== 'all'))

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
  const existing = tasks.value.find((task) => isTaskActionable(task) && task.sourceType === 'milestone-review' && task.sourceId === item.id)
  if (existing) {
    void router.push({ path: '/tasks', query: { focus: existing.id } })
    return
  }
  const course = courses.value.find((entry) => entry.id === item.courseId)
  const task = domain.createTask({
    title: `复习：${item.name}`,
    kind: 'review',
    courseId: item.courseId || '',
    course: course?.name || item.courseName || '',
    dueDate: appToday.value,
    priority: 'high',
    estimateMinutes: 25,
    note: `由学习类重要日期「${item.name}」创建，可在今天页直接开始专注。`,
    createdFrom: 'milestone-review',
    sourceType: 'milestone-review',
    sourceId: item.id,
  })
  reviewMessage.value = `已安排“${item.name}”的 25 分钟复习，可在今天页开始专注`
  showToast('已安排 25 分钟复习', { type: 'success', actionLabel: '查看待办', viewFn: () => router.push({ path: '/tasks', query: { focus: task.id } }), duration: 6000 })
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
const pad2 = (v) => String(v).padStart(2, '0')
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
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">重要日期</h1>
        <p class="page-desc">考试、生日、纪念日和重要截止都可以放在这里。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" :aria-expanded="showHistory" @click="setHistory">{{ showHistory ? '返回当前' : `历史 ${summary.archived || ''}` }}</button>
        <label v-if="!showHistory" class="past-toggle">
          <input v-model="showPast" type="checkbox" />
          显示已结束
        </label>
        <button class="btn btn-primary" @click="openAdd">＋ 添加重要日期</button>
      </div>
    </header>

    <div v-if="exams.length && !showHistory" class="date-overview" role="group" aria-label="重要日期概览">
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'all' && !showPast }" :aria-pressed="periodFilter === 'all' && !showPast" @click="selectOverview('all')"><span>即将到来</span><b>{{ summary.upcoming }}</b><small>全部当前日期</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'week' }" :aria-pressed="periodFilter === 'week'" @click="selectOverview('week')"><span>未来 7 天</span><b>{{ summary.week }}</b><small>含今天</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'pinned' }" :aria-pressed="periodFilter === 'pinned'" @click="selectOverview('pinned')"><span>已置顶</span><b>{{ summary.pinned }}</b><small>优先关注</small></button>
      <button type="button" class="card overview-item" :class="{ selected: periodFilter === 'past' }" :aria-pressed="periodFilter === 'past'" @click="selectOverview('past')"><span>已结束</span><b>{{ summary.past }}</b><small>查看与归档</small></button>
    </div>

    <section class="card date-filters" aria-label="重要日期筛选">
      <div class="filter-topline">
        <div class="date-search"><label class="sr-only" for="dates-search">搜索重要日期</label><input id="dates-search" v-model="query" type="search" placeholder="搜索名称、课程、地点或备注" /><button v-if="query" type="button" class="link-btn" aria-label="清除重要日期搜索" @click="query = ''; searchQuery.flush('')">×</button></div>
        <label v-if="!showHistory" class="filter-select"><span>范围</span><select v-model="periodFilter"><option value="all">全部日期</option><option value="week">未来 7 天</option><option value="month">未来 30 天</option><option value="pinned">已置顶</option><option value="past">已结束</option></select></label>
        <label class="filter-select"><span>排序</span><select v-model="sortKey"><option value="date">最近日期优先</option><option value="name">按名称</option><option value="created">最近添加优先</option></select></label>
      </div>
      <div class="filter-bottomline">
        <div class="segmented category-filters" role="group" aria-label="重要日期类型"><button type="button" :class="{ on: categoryFilter === 'all' }" :aria-pressed="categoryFilter === 'all'" @click="categoryFilter = 'all'">全部类型</button><button v-for="category in CATEGORIES" :key="category" type="button" :class="{ on: categoryFilter === category }" :aria-pressed="categoryFilter === category" @click="categoryFilter = category">{{ category }}</button></div>
        <div class="filter-result"><span role="status">{{ visibleItems.length }} 项{{ showHistory ? '归档日期' : '重要日期' }}</span><button v-if="hasFilters" type="button" class="link-btn" @click="resetFilters">清除筛选</button></div>
      </div>
    </section>
    <p v-if="reviewMessage" class="review-message" role="status">✓ {{ reviewMessage }}</p>
    <p v-if="focusMessage" class="review-message" role="status">{{ focusMessage }}</p>

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
            <span class="category">{{ item.category ?? '其他' }}</span>
            <span v-if="item.repeat === 'yearly'" class="repeat-tag">每年重复</span>
            <span v-if="item.pinned" class="repeat-tag">置顶</span>
            <span v-if="isArchived(item)" class="repeat-tag">已归档</span>
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
            <div class="date">{{ shortDateOf(item) }}</div>
            <div v-if="item.category === '学习' && item.course" class="loc" :title="item.course">{{ item.course }}</div>
            <div v-if="item.location" class="loc" :title="item.location">{{ item.location }}</div>
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
      </div>
      </template>
    </VirtualList>

    <Modal v-if="showForm" :open="showForm" :title="editingId ? '编辑重要日期' : '添加重要日期'" @close="showForm = false">
      <form class="form" novalidate @submit.prevent="save">
        <label for="exams-name">名称 *</label>
        <input id="exams-name" ref="nameInput" v-model="form.name" maxlength="200" :aria-invalid="errorField === 'name' || undefined" :aria-describedby="errorField === 'name' ? 'dates-form-error' : undefined" placeholder="例如：期末考试、生日或项目截止日" @input="clearFormError('name')" />

        <div class="form-row">
          <div>
            <label for="exams-target-date">目标日期 *</label>
            <input id="exams-target-date" ref="dateInput" v-model="form.date" type="date" :aria-invalid="errorField === 'date' || undefined" :aria-describedby="errorField === 'date' ? 'dates-form-error' : undefined" @input="clearFormError('date')" />
          </div>
          <div>
            <label for="exams-time">具体时间</label>
            <input id="exams-time" v-model="form.time" type="time" />
          </div>
        </div>

        <div class="date-shortcuts" role="group" aria-label="快速选择目标日期"><button type="button" :aria-pressed="form.date === appToday" @click="setFormDate(0)">今天</button><button type="button" :aria-pressed="form.date === addAppDays(appToday, 1)" @click="setFormDate(1)">明天</button><button type="button" :aria-pressed="form.date === addAppDays(appToday, 7)" @click="setFormDate(7)">一周后</button></div>

        <div class="form-row">
          <div>
            <label for="exams-category">类型</label>
            <select id="exams-category" v-model="form.category">
              <option v-for="category in CATEGORIES" :key="category" :value="category">{{ category }}</option>
            </select>
          </div>
          <div>
            <label for="exams-repeat">重复</label>
            <select id="exams-repeat" v-model="form.repeat">
              <option value="none">不重复</option>
              <option value="yearly">每年重复</option>
            </select>
          </div>
        </div>

        <small v-if="form.repeat === 'yearly'" class="field-hint">按公历每年重复，卡片显示下一次日期；2 月 29 日在平年按 2 月最后一天显示。</small>

        <label for="exams-location">备注或地点</label>
        <textarea id="exams-location" v-model="form.location" rows="2" placeholder="选填，例如：教学楼 A101；携带证件和文具"></textarea>

        <label for="dates-reminder">提前提醒（分钟）</label>
        <input id="dates-reminder" v-model="form.reminderMinutes" type="number" min="0" step="1" :placeholder="`默认提前 ${defaultReminder} 分钟`" :aria-invalid="errorField === 'reminder' || undefined" aria-describedby="dates-reminder-hint" @input="clearFormError('reminder')" />
        <small id="dates-reminder-hint" class="field-hint">0 表示到点提醒，留空使用默认设置。未填时间按 23:59 计算；应用打开且允许通知时提醒。</small>

        <div v-if="form.category === '学习'" class="form-row">
          <div><label for="exams-course">关联课程</label><select id="exams-course" v-model="form.courseId"><option value="">暂不关联</option><option v-for="course in courses" :key="course.id" :value="course.id">{{ course.name }}</option></select></div>
          <div><label for="exams-review-progress">复习完成度 {{ form.reviewProgress }}%</label><input id="exams-review-progress" v-model.number="form.reviewProgress" type="range" min="0" max="100" step="5" /></div>
        </div>

        <label class="pin-option">
          <input v-model="form.pinned" type="checkbox" />
          在列表顶部显示
        </label>

        <p v-if="error" id="dates-form-error" class="error" role="alert">{{ error }}</p>

        <div class="actions">
          <button v-if="editingId" type="button" class="btn btn-danger" @click="remove">删除</button>
          <button type="button" class="btn" @click="showForm = false">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
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
