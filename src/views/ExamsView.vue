<script setup>
import { computed, nextTick, ref, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import VirtualList from '../components/VirtualList.vue'
import ContextMenu from '../components/ContextMenu.vue'
import Toast from '../components/Toast.vue'
import {
  fmtCountdownDate,
  sortCountdowns,
  useStoredRef,
} from '../composables/store'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isArchived, isTaskActionable, taskStatus } from '../composables/domain/state.js'
import { menuPlacementFor } from '../composables/menuPlacement.js'
import { createLongPress } from '../composables/longPress.js'
import { appToday } from '../composables/timeContext.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'

const CATEGORIES = ['学习', '生活', '纪念日', '项目', '其他']
const domain = useDomainCommands()
const { milestones: exams, courses, tasks } = domain
const route = useRoute()
const router = useRouter()
const showPast = useStoredRef('sl_countdown_show_past', false)
const showHistory = ref(false)
const showForm = ref(false)
const editingId = ref(null)
const error = ref('')
const form = ref(emptyForm())
const deleteTarget = ref(null)
const reviewMessage = ref('')
const focusMessage = ref('')
const focusedMilestoneId = ref('')
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })
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
  }
}

function openAdd() {
  editingId.value = null
  error.value = ''
  form.value = emptyForm()
  showForm.value = true
}

function openEdit(item) {
  editingId.value = item.id
  error.value = ''
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
  }
  showForm.value = true
}

function save() {
  if (!form.value.name.trim()) {
    error.value = '请填写重要日期名称'
    return
  }
  if (!form.value.date) {
    error.value = '请选择目标日期'
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
  }
  if (editingId.value) {
    domain.updateMilestone(editingId.value, data)
  } else {
    domain.createMilestone({ ...data, kind: form.value.category === '学习' ? 'exam' : 'countdown', createdFrom: 'manual' })
  }
  showForm.value = false
}

function remove() {
  const item = exams.value.find((entry) => entry.id === editingId.value)
  showForm.value = false
  if (item) deleteTarget.value = item
}

function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}

const sorted = computed(() => sortCountdowns(exams.value))

const visibleItems = computed(() => {
  const source = showHistory.value ? sorted.value.filter((item) => isArchived(item)) : sorted.value.filter((item) => !isArchived(item))
  return showHistory.value || showPast.value ? source : source.filter((item) => !item.countdown.isPast)
})

function createReviewTask(item, event) {
  event?.stopPropagation()
  const existing = tasks.value.find((task) => isTaskActionable(task) && task.sourceType === 'milestone-review' && task.sourceId === item.id)
  if (existing) {
    reviewMessage.value = `“${item.name}”已有待完成的复习任务`
    return
  }
  const course = courses.value.find((entry) => entry.id === item.courseId)
  domain.createTask({
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
}

function reviewTasksFor(item) {
  return tasks.value.filter((task) => task.sourceType === 'milestone-review' && task.sourceId === item.id)
}

function reviewSummary(item) {
  const reviewTasks = reviewTasksFor(item)
  if (!reviewTasks.length) return ''
  const completed = reviewTasks.filter((task) => taskStatus(task) === 'completed').length
  return `复习任务 ${completed}/${reviewTasks.length}`
}

// 窄屏（单列）下清单很长时做虚拟滚动；宽屏保持多列网格原样渲染。
// 入场动画只对少量卡片有意义，长列表直接禁用，避免一次挂载几十个动画。
const EXAM_LIST_THRESHOLD = 16
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
let narrowMql = null
let narrowMqlHandler = null
if (typeof window !== 'undefined') {
  narrowMql = window.matchMedia('(max-width: 760px)')
  narrowMqlHandler = (event) => { isNarrow.value = event.matches }
  narrowMql.addEventListener('change', narrowMqlHandler)
}
onBeforeUnmount(() => {
  if (narrowMql && narrowMqlHandler) narrowMql.removeEventListener('change', narrowMqlHandler)
})

// ---------- 卡片展示辅助：日期牌 / 短日期 / 时间轴 ----------
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad2 = (v) => String(v).padStart(2, '0')
const todayKey = computed(() => appToday.value)

// 日期牌：目标月 / 日（无法解析时显示 --）
function tileOf(item) {
  const t = item.countdown.target
  if (!t) return { month: '--', day: '--' }
  return { month: pad2(item.date.slice(5, 7)), day: pad2(item.date.slice(8, 10)) }
}

// 短日期行：8月30日 · 周日（含时间时追加），不再与「本周日」等信息重复
function shortDateOf(item) {
  const t = item.countdown.target
  if (!t) return fmtCountdownDate(item, null)
  const weekday = new Date(`${item.date}T00:00:00Z`).getUTCDay()
  let text = `${Number(item.date.slice(5, 7))}月${Number(item.date.slice(8, 10))}日 · ${WEEKDAYS[weekday]}`
  if (item.time) text += ` ${item.time}`
  return text
}

// 底部轻量时间轴：今天 ─── ● 目标日
function timelineOf(item) {
  const t = item.countdown.target
  if (!t) return null
  const start = `${Number(todayKey.value.slice(5, 7))}/${Number(todayKey.value.slice(8, 10))}`
  const end = `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`
  const sameDay = item.date === todayKey.value
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
  showPast.value = showHistory.value || Boolean(item.countdown?.isPast)
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
  return courses.value.find((course) => course.id === item.courseId)?.name ?? item.courseName ?? ''
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', closeMenu)
}
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('click', closeMenu)
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">重要日期</h1>
        <p class="page-desc">考试、生日、纪念日和重要截止都可以放在这里。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" :aria-expanded="showHistory" @click="showHistory = !showHistory">{{ showHistory ? '返回当前' : '历史' }}</button>
        <label class="past-toggle">
          <input v-model="showPast" type="checkbox" />
          显示已结束
        </label>
        <button class="btn btn-primary" @click="openAdd">＋ 添加重要日期</button>
      </div>
    </header>
    <p v-if="reviewMessage" class="review-message" role="status">✓ {{ reviewMessage }}</p>
    <p v-if="focusMessage" class="review-message" role="status">{{ focusMessage }}</p>

    <EmptyState :level="2"
      v-if="exams.length === 0"
      class="card empty-box"
      icon="⏳"
      title="还没有重要日期"
      description="添加一个重要日期，未来的自己会感谢你。"
      primary-label="＋ 添加重要日期"
      @primary="openAdd"
    />

    <EmptyState :level="2"
      v-else-if="visibleItems.length === 0"
      class="card empty-box"
      icon="✦"
      title="已结束的重要日期已隐藏"
      description="可在右上角重新显示已结束的项目。"
    />

    <VirtualList
      v-else
      class="list"
      :class="[isNarrow ? 'narrow' : 'grid', { 'no-anim': visibleItems.length > EXAM_LIST_THRESHOLD }]"
      :items="visibleItems"
      item-key="id"
      :estimated-height="174"
      :gap="14"
      :threshold="isNarrow ? EXAM_LIST_THRESHOLD : Number.MAX_SAFE_INTEGER"
      :reveal-key="focusedMilestoneId"
    >
      <template #default="{ item }">
        <div
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
          </div>
          <button
            type="button"
            class="menu-btn"
            aria-label="更多操作"
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
            <small>{{ tileOf(item).month }}</small>
            <b>{{ tileOf(item).day }}</b>
          </div>
          <div class="exam-info">
            <div class="name">{{ item.name }}</div>
            <div class="date">{{ shortDateOf(item) }}</div>
            <div v-if="item.category === '学习' && courseLabel(item)" class="loc">{{ courseLabel(item) }} · 复习 {{ item.reviewProgress || 0 }}%</div>
            <div v-if="reviewSummary(item)" class="loc">{{ reviewSummary(item) }}</div>
            <div v-if="item.location" class="loc">{{ item.location }}</div>
          </div>
          <div class="count" :class="item.countdown.cls">
            <span v-if="item.countdown.relativeText" class="countdown-human">{{ item.countdown.relativeText }}</span>
            <template v-else>
              <small v-if="!item.countdown.isPast && /^\d+$/.test(String(item.countdown.text))">还有</small>
              <span class="num" :class="{ tiny: !/^\d+$/.test(String(item.countdown.text)) }">{{ item.countdown.text }}</span>
              <span v-if="item.countdown.label && /^\d+$/.test(String(item.countdown.text))" class="unit">{{ item.countdown.label }}</span>
            </template>
          </div>
        </div>

        <!-- 底部轻量时间轴 -->
        <div v-if="timelineOf(item)" class="timeline" aria-hidden="true">
          <span class="tl-label">{{ timelineOf(item).start }}</span>
          <span class="tl-track"><i></i></span>
          <span class="tl-label strong">{{ timelineOf(item).end }}</span>
          <span class="tl-dot" :class="{ on: timelineOf(item).sameDay }"></span>
        </div>
        <button v-if="item.category === '学习' && !item.countdown.isPast" type="button" class="review-action" @click="createReviewTask(item, $event)">{{ reviewSummary(item) ? '再安排 25 分钟复习' : '安排 25 分钟复习' }}</button>
      </div>
      </template>
    </VirtualList>

    <Modal v-if="showForm" :open="showForm" :title="editingId ? '编辑重要日期' : '添加重要日期'" @close="showForm = false">
      <div class="form">
        <label for="exams-name">名称 *</label>
        <input id="exams-name" v-model="form.name" placeholder="例如：期末考试、生日或项目截止日" />

        <div class="form-row">
          <div>
            <label for="exams-target-date">目标日期 *</label>
            <input id="exams-target-date" v-model="form.date" type="date" />
          </div>
          <div>
            <label for="exams-time">具体时间</label>
            <input id="exams-time" v-model="form.time" type="time" />
          </div>
        </div>

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

        <label for="exams-location">备注或地点</label>
        <input id="exams-location" v-model="form.location" placeholder="选填，例如：教学楼 A101" />

        <div v-if="form.category === '学习'" class="form-row">
          <div><label for="exams-course">关联课程</label><select id="exams-course" v-model="form.courseId"><option value="">暂不关联</option><option v-for="course in courses" :key="course.id" :value="course.id">{{ course.name }}</option></select></div>
          <div><label for="exams-review-progress">复习完成度 {{ form.reviewProgress }}%</label><input id="exams-review-progress" v-model.number="form.reviewProgress" type="range" min="0" max="100" step="5" /></div>
        </div>

        <label class="pin-option">
          <input v-model="form.pinned" type="checkbox" />
          在列表顶部显示
        </label>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div class="actions">
          <button v-if="editingId" class="btn btn-danger" @click="remove">删除</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
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

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page-actions {
  gap: 14px;
}
.past-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
  cursor: pointer;
  white-space: nowrap;
}
.past-toggle input,
.pin-option input {
  accent-color: var(--primary);
}
.empty-box {
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
}
/* ---------- 倒计时卡：日期牌 + 主体 + 大数字 + 轻量时间轴 ---------- */
.list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.list.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.list.no-anim .exam {
  animation: none;
}
.exam {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 16px;
  cursor: pointer;
  transition: transform var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard), border-color var(--dur-base) var(--ease-standard);
  animation: exam-in var(--dur-base) var(--ease-out) both;
}
@keyframes exam-in {
  from { opacity: 0; transform: translateY(4px); }
}
.exam:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}
.exam.finished { opacity: 0.6; }
.exam.pinned { border-color: color-mix(in srgb, var(--primary) 30%, var(--card)); background: linear-gradient(180deg, var(--bg-tint), var(--card)); }
.exam.hot { border-color: color-mix(in srgb, var(--danger) 30%, var(--card)); }
.exam.menu-open { z-index: 10; overflow: visible; content-visibility: visible; contain: none; }

/* 顶部标签：小号浅色，不抢标题 */
.exam-top { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.meta-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.category,
.repeat-tag {
  padding: 2.5px 8px;
  color: var(--ink-faint);
  font-size: var(--fs-10-5);
  font-weight: var(--fw-650);
  border-radius: var(--radius-6);
  background: var(--bg-tint);
}
.category { color: var(--primary); background: var(--primary-soft); }
.repeat-tag { color: #5f3dc4; background: #f3eeff; }
.menu-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 24px;
  flex: 0 0 auto;
  color: var(--ink-faint);
  font-size: var(--fs-13);
  font-weight: var(--fw-900);
  letter-spacing: 0.05em;
  border: none;
  border-radius: var(--radius-7);
  background: transparent;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.menu-btn:hover { color: var(--ink-soft); background: var(--bg); }
.card-menu {
  position: absolute;
  top: 26px;
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 118px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--card);
  box-shadow: var(--shadow-md);
}
.card-menu button {
  padding: 8px 11px;
  color: var(--text);
  font-size: var(--fs-12-5);
  text-align: left;
  border: none;
  border-radius: var(--radius-7);
  background: transparent;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.card-menu button:hover { background: var(--bg); }
.card-menu button.danger { color: var(--danger); }
.card-menu button.danger:hover { background: color-mix(in srgb, var(--danger) 12%, var(--card)); }

/* 主体：日期牌 / 标题 / 剩余天数 同一横向视觉区 */
.exam-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}
.date-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 68px;
  flex: 0 0 60px;
  border-radius: var(--radius-16);
  background: linear-gradient(160deg, #eef2ff 0%, #f4f0ff 100%);
}
/* 渐变底取 #eef2ff→#f4f0ff 的中间值 #f1f1ff 作对比度基准；
   #3d4ec0 在其上 6.15:1（AA 正文 4.5 余量充足）。原 #8a94d8 只有 2.57:1。 */
.date-tile small { color: #3d4ec0; font-size: var(--fs-11); font-weight: var(--fw-700); line-height: 1.2; }
.date-tile b { color: #3d4ec0; font-size: var(--fs-23); font-weight: var(--fw-900); line-height: 1.15; letter-spacing: 0.01em; }
.exam-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.name {
  overflow: hidden;
  font-size: clamp(19px, 1.6vw, 23px);
  font-weight: var(--fw-750);
  letter-spacing: -0.01em;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.date { color: var(--ink-soft); font-size: var(--fs-13); font-variant-numeric: tabular-nums; }
.loc { overflow: hidden; color: var(--ink-faint); font-size: var(--fs-11-5); text-overflow: ellipsis; white-space: nowrap; }

/* 剩余天数：整张卡最显眼的信息 */
.count {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 84px;
  flex: 0 0 auto;
  color: var(--primary);
}
.count small { color: var(--ink-faint); font-size: var(--fs-11); font-weight: var(--fw-700); }
.count .num {
  font-size: clamp(42px, 3.6vw, 50px);
  font-weight: var(--fw-900);
  line-height: 1.02;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  transition: opacity var(--dur-base) var(--ease-standard);
}
.count .num.tiny { font-size: var(--fs-22); letter-spacing: 0; }
.count .unit { margin-top: 2px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); }
.countdown-human { display: block; max-width: 120px; color: inherit; font-size: var(--fs-14); font-weight: var(--fw-800); line-height: 1.35; text-align: right; }
.count.hot { color: var(--danger); }
.count.hot .unit { color: var(--danger); }
.count.past { color: var(--ink-faint); }
.count.past .num { font-size: var(--fs-17); }

/* 底部轻量时间轴：今天 ── ● 目标日 */
.timeline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.tl-label { color: var(--ink-faint); font-size: var(--fs-10-5); white-space: nowrap; font-variant-numeric: tabular-nums; }
.tl-label.strong { color: var(--ink-soft); font-weight: var(--fw-700); margin-right: 10px; }
.tl-track {
  position: relative;
  flex: 1;
  height: 3px;
  border-radius: var(--radius-pill);
  background: #e7ecf6;
}
.tl-track i { position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(90deg, rgba(69,111,232,.32), rgba(120,100,220,.32)); }
.exam.finished .tl-track i { background: #eef1f6; }
.tl-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  margin-left: -12px;
  border-radius: var(--radius-circle);
  background: var(--primary);
  box-shadow: 0 0 0 3px rgba(69, 111, 232, 0.14);
}
.tl-dot.on { background: var(--danger); box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15); }
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form label {
  font-size: var(--fs-13);
  color: var(--ink-soft);
  margin-top: 6px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.form-row > div {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form input,
.form select {
  width: 100%;
}
.form .pin-option {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  cursor: pointer;
}
.form .pin-option input {
  width: auto;
}
.error {
  color: var(--danger);
  font-size: var(--fs-13);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.actions .btn-danger {
  margin-right: auto;
}
.card-menu.up { top: auto; bottom: 26px; }

@media (max-width: 760px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .page-actions {
    width: 100%;
    justify-content: space-between;
  }

  .page-actions .btn {
    flex: 1;
  }

  .list {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  /* 手机端保持横向三段（日期牌/标题/数字），仅按比例收紧，不做纵向堆叠 */
  .exam { padding: 16px 16px 14px; gap: 12px; }
  .exam-main { gap: 12px; }
  .date-tile { width: 50px; height: 58px; flex-basis: 50px; border-radius: var(--radius-13); }
  .date-tile small { font-size: var(--fs-10); }
  .date-tile b { font-size: var(--fs-19); }
  .name { font-size: var(--fs-18); }
  .date { font-size: var(--fs-12); }
  .count { min-width: 72px; }
  .count .num { font-size: var(--fs-38); }

  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>

<style scoped>
.review-message{margin:0;color:var(--success);font-size:var(--fs-12-5);font-weight:var(--fw-700)}.review-action{align-self:flex-start;margin-top:12px;padding:7px 10px;color:var(--primary);font-size:var(--fs-12);font-weight:var(--fw-750);border:1px solid var(--primary);border-radius:var(--radius-8);background:var(--primary-soft)}.review-action:hover{background:var(--primary);color:var(--on-primary,#fff)}
</style>
