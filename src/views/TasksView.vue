<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import NoticePaste from '../components/NoticePaste.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import VirtualList from '../components/VirtualList.vue'
import { appearance } from '../composables/appearance.js'
import { fmtDate, todayStr } from '../composables/store'
import { findUniqueCourseByName } from '../composables/courseLinks.js'
import { classifyTasks } from '../composables/smartClassify.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { TASK_PLAN_STATE, isArchived, taskPlanningState, taskStatus } from '../composables/domain/state.js'

const domain = useDomainCommands()
const { tasks, courses } = domain
const showForm = ref(false)
const showNotice = ref(false)
const noticeMessage = ref('')
const editingId = ref(null)
const error = ref('')
const filter = ref(TASK_PLAN_STATE.scheduled)
const showHistory = ref(false)
const sortKey = ref('due')
const form = ref(emptyForm())
const deleteTarget = ref(null)
const rescheduleTarget = ref(null)
const rescheduleDate = ref('')
const undoToast = ref(null)
let undoTimer = 0

// 一键智能整理：只改字段（补课程、分优先级），不删任何数据。
const organizeMessage = ref('')
let organizeTimer = 0

function smartOrganize() {
  const { list, changed } = classifyTasks(tasks.value, courses.value)
  list.forEach((next, index) => {
    const current = tasks.value[index]
    if (!current || current.id !== next.id) return
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

const PRIORITIES = {
  high: { label: '高优先级', order: 0 },
  normal: { label: '普通', order: 1 },
  low: { label: '低优先级', order: 2 },
}

const SORTS = [
  { key: 'due', label: '按截止时间' },
  { key: 'priority', label: '按优先级' },
  { key: 'created', label: '按创建时间' },
]

function emptyForm() {
  return {
    title: '',
    course: '',
    courseId: '',
    dueDate: '',
    dueTime: '',
    priority: 'normal',
    note: '',
    estimateMinutes: '',
    repeat: 'none',
  }
}

function openAdd() {
  editingId.value = null
  error.value = ''
  form.value = emptyForm()
  showForm.value = true
}

function openEdit(task) {
  editingId.value = task.id
  error.value = ''
  form.value = {
    title: task.title,
    course: task.course ?? '',
    courseId: task.courseId ?? '',
    dueDate: task.dueDate ?? '',
    dueTime: task.dueTime ?? '',
    priority: task.priority ?? 'normal',
    note: task.note ?? '',
    estimateMinutes: task.estimateMinutes ?? '',
    repeat: task.repeat ?? 'none',
  }
  showForm.value = true
}

function save() {
  if (!form.value.title.trim()) {
    error.value = '请填写待办内容'
    return
  }
  const linkedCourse = courses.value.find((course) => course.id === form.value.courseId)
  const data = {
    title: form.value.title.trim(),
    course: linkedCourse?.name ?? form.value.course.trim(),
    courseId: linkedCourse?.id ?? '',
    dueDate: form.value.dueDate,
    dueTime: form.value.dueTime,
    priority: form.value.priority,
    note: form.value.note.trim(),
    estimateMinutes: Math.max(0, Number(form.value.estimateMinutes) || 0),
    repeat: form.value.repeat,
  }
  if (editingId.value) {
    domain.updateTask(editingId.value, data)
  } else {
    domain.createTask({ ...data, createdFrom: 'manual' })
  }
  showForm.value = false
}

function remove() {
  const task = tasks.value.find((item) => item.id === editingId.value)
  showForm.value = false
  if (task) deleteTarget.value = task
}

function toggleDone(event, id) {
  event.stopPropagation()
  const task = tasks.value.find((item) => item.id === id)
  toggleTask(task)
}

function toggleTask(task) {
  if (!task) return
  domain.toggleTask(task.id)
}

function openReschedule(task) {
  const tomorrow = new Date()
  tomorrow.setHours(0, 0, 0, 0)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const pad = (value) => String(value).padStart(2, '0')
  rescheduleTarget.value = task
  rescheduleDate.value = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
}

function saveReschedule() {
  if (!rescheduleTarget.value || !rescheduleDate.value) return
  domain.updateTask(rescheduleTarget.value.id, { dueDate: rescheduleDate.value, status: 'pending', done: false, completedAt: null })
  rescheduleTarget.value = null
}

function swipeLabel(task, direction) {
  const action = appearance.value.swipeActions.tasks[direction]
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

function handleTaskSwipe(direction, task) {
  const action = appearance.value.swipeActions.tasks[direction]
  if (action === 'complete') toggleTask(task)
  else if (action === 'edit') openEdit(task)
  else if (action === 'delete') deleteTarget.value = task
}

function onNoticeCommit(payload) {
  const firstData = payload.data || payload.items?.[0] || {}
  const course = findUniqueCourseByName(courses.value, firstData.course)
  const withCourse = (value) => ({ ...value, courseId: findUniqueCourseByName(courses.value, value.course)?.id ?? '' })
  if (payload.type === 'update') {
    const data = withCourse(firstData)
    if (!domain.updateTask(payload.id, data)) return
    showNoticeMessage(course || !firstData.course ? `已根据新通知更新“${payload.title}”` : `已更新“${payload.title}”；课程名称未唯一匹配，请检查关联`)
  } else if (payload.type === 'event') {
    payload.items.forEach((item) => domain.createEvent({ ...withCourse(item), courseName: item.course || '', createdFrom: 'clipboard', sourceType: 'notice' }))
    showNoticeMessage(payload.items.length > 1 ? `已加入 ${payload.items.length} 项日程` : `已加入日程“${payload.items[0].title}”`)
  } else if (payload.type === 'note') {
    const data = withCourse(firstData)
    domain.createNote({ ...data, title: payload.title, content: firstData.content || firstData.rawText, courseName: data.course, createdFrom: 'clipboard', sourceType: 'notice' })
    showNoticeMessage('已保存通知，未创建待办')
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

onBeforeUnmount(() => {
  window.clearTimeout(noticeMessageTimer)
  window.clearTimeout(undoTimer)
  window.clearTimeout(organizeTimer)
})

function dueTimestamp(task) {
  if (!task.dueDate) return Infinity
  return new Date(`${task.dueDate}T${task.dueTime || '23:59'}`).getTime()
}

function dueInfo(task) {
  if (!task.dueDate) return { text: '无截止日期', cls: '' }
  const today = todayStr()
  const targetDay = new Date(task.dueDate + 'T00:00:00')
  const todayDate = new Date(today + 'T00:00:00')
  const days = Math.round((targetDay - todayDate) / 86400000)
  const isOverdue = taskStatus(task) === 'overdue' && dueTimestamp(task) < Date.now()
  if (isOverdue) return { text: days < 0 ? `逾期 ${-days} 天` : '已逾期', cls: 'overdue' }
  if (days === 0) return { text: task.dueTime ? `今天 ${task.dueTime}` : '今天截止', cls: 'today' }
  if (days === 1) return { text: task.dueTime ? `明天 ${task.dueTime}` : '明天截止', cls: 'soon' }
  return { text: `${fmtDate(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ''}`, cls: '' }
}

const taskView = computed(() => {
  let unplanned = 0
  let scheduled = 0
  let done = 0
  for (const task of tasks.value) {
    if (isArchived(task)) continue
    const planState = taskPlanningState(task)
    if (planState === TASK_PLAN_STATE.completed) done++
    else if (planState === TASK_PLAN_STATE.scheduled) scheduled++
    else if (planState === TASK_PLAN_STATE.unplanned) unplanned++
  }
  const sorted = [...tasks.value].sort((a, b) => {
    const aCompleted = taskStatus(a) === 'completed'
    const bCompleted = taskStatus(b) === 'completed'
    if (aCompleted !== bCompleted) return aCompleted ? 1 : -1
    if (sortKey.value === 'priority') {
      const priorityDiff = (PRIORITIES[a.priority]?.order ?? 1) - (PRIORITIES[b.priority]?.order ?? 1)
      if (priorityDiff) return priorityDiff
      return dueTimestamp(a) - dueTimestamp(b)
    }
    if (sortKey.value === 'created') {
      const createdDiff = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
      if (createdDiff) return createdDiff
      return dueTimestamp(a) - dueTimestamp(b)
    }
    const dueDiff = dueTimestamp(a) - dueTimestamp(b)
    if (dueDiff) return dueDiff
    return (PRIORITIES[a.priority]?.order ?? 1) - (PRIORITIES[b.priority]?.order ?? 1)
  })
  const archived = tasks.value.filter(isArchived).length
  const current = sorted.filter((task) => !isArchived(task))
  const visible = showHistory.value
    ? sorted.filter(isArchived)
    : filter.value === 'all'
      ? current
      : current.filter((task) => taskPlanningState(task) === filter.value)
  return { counts: { unplanned, scheduled, done, all: current.length, archived }, visible }
})

const counts = computed(() => taskView.value.counts)

function deleteTask(task) {
  deleteTarget.value = task
}

function archiveTask(task) {
  if (!task || isArchived(task)) return
  domain.archiveTask(task.id)
  undoToast.value = { item: task, action: 'archive', text: '待办已归档' }
  window.clearTimeout(undoTimer)
  undoTimer = window.setTimeout(() => { undoToast.value = null }, 6000)
}

function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  const index = tasks.value.findIndex((item) => item.id === target.id)
  if (index < 0) return
  domain.deleteTask(target.id)
  deleteTarget.value = null
  undoToast.value = { item: target, index, action: 'delete', text: '待办已删除' }
  window.clearTimeout(undoTimer)
  undoTimer = window.setTimeout(() => { undoToast.value = null }, 6000)
}

function undoDelete() {
  if (!undoToast.value) return
  const { item, index, action } = undoToast.value
  if (action === 'archive') domain.restoreTask(item.id)
  else domain.restoreDeletedTask(item)
  undoToast.value = null
  window.clearTimeout(undoTimer)
}

// 空状态文案按当前筛选变化
const emptyInfo = computed(() => {
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
    return { icon: '✓', title: '没有已安排待办', description: '有明确日期的事项会出现在这里。', hint: '', action: '' }
  }
  if (filter.value === TASK_PLAN_STATE.completed) {
    return { icon: '◐', title: '还没有已完成的待办', description: '完成待办后会出现在这里。', hint: '', action: '' }
  }
  return { icon: '✦', title: '这个列表暂时是空的', description: '', hint: '', action: '' }
})

const visibleTasks = computed(() => taskView.value.visible)

const courseNames = computed(() => [...new Set(courses.value.map((course) => course.name).filter(Boolean))])

function linkCourseFromName() {
  const course = findUniqueCourseByName(courses.value, form.value.course)
  form.value.courseId = course?.id ?? ''
}

function taskCourseName(task) {
  return courses.value.find((course) => course.id === task.courseId)?.name ?? task.course
}

function taskFocusSummary(task) {
  const count = Math.max(0, Number(task.focusCount) || 0)
  const seconds = Math.max(0, Number(task.focusTotalSeconds) || 0)
  if (!count && !seconds) return ''
  const minutes = Math.max(1, Math.round(seconds / 60))
  return `已专注 ${count} 次 · ${minutes} 分钟`
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">待办</h1>
        <p class="page-desc">把要做的事情放这里，按截止时间轻松管理。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="showHistory = !showHistory">{{ showHistory ? '返回当前' : `历史 ${counts.archived || ''}` }}</button>
        <label class="sort-select">
          <span>排序</span>
          <select v-model="sortKey">
            <option v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
          </select>
        </label>
        <button class="btn btn-ghost" @click="smartOrganize">✦ 一键整理</button>
        <button class="btn btn-ghost" @click="showNotice = true">📋 粘贴通知</button>
        <button class="btn btn-primary" @click="openAdd">＋ 添加待办</button>
      </div>
    </header>

    <p v-if="noticeMessage" class="notice-success">✓ {{ noticeMessage }}</p>
    <p v-if="organizeMessage && !noticeMessage" class="notice-success">✓ {{ organizeMessage }}</p>

    <div class="segmented task-toolbar" role="tablist" aria-label="待办筛选">
      <template v-if="!showHistory">
         <button :class="{ on: filter === 'unplanned' }" @click="filter = 'unplanned'">待安排日期 <b>{{ counts.unplanned }}</b></button>
      <button :class="{ on: filter === 'scheduled' }" @click="filter = 'scheduled'">已安排 <b>{{ counts.scheduled }}</b></button>
      <button :class="{ on: filter === 'completed' }" @click="filter = 'completed'">已完成 <b>{{ counts.done }}</b></button>
      <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部 <b>{{ counts.all }}</b></button>
      </template>
      <span v-else class="history-label">归档历史 · {{ counts.archived }} 条</span>
    </div>

    <EmptyState
      v-if="visibleTasks.length === 0"
      class="empty-box card"
      :icon="emptyInfo.icon"
      :title="emptyInfo.title"
      :description="emptyInfo.description"
      :hint="emptyInfo.hint"
      :primary-label="emptyInfo.action"
      @primary="openAdd"
    />

    <VirtualList v-else v-slot="{ item: task }" class="task-list" :items="visibleTasks" :estimated-height="62" :gap="8" :threshold="40">
      <SwipeActionItem
        :left-label="swipeLabel(task, 'left')"
        :right-label="swipeLabel(task, 'right')"
        :left-tone="swipeTone('left')"
        :right-tone="swipeTone('right')"
        @swipe="handleTaskSwipe($event, task)"
      >
          <article
            class="card task"
            :class="{ done: taskStatus(task) === 'completed', archived: isArchived(task) }"
          @click="openEdit(task)"
        >
          <span v-if="task.priority === 'high'" class="urgent-bar" aria-hidden="true"></span>

          <button
            type="button"
            class="check"
            :class="{ checked: taskStatus(task) === 'completed' }"
            :aria-label="taskStatus(task) === 'completed' ? '标记为未完成' : '标记为已完成'"
            @click="toggleDone($event, task.id)"
          >
            {{ taskStatus(task) === 'completed' ? '✓' : '' }}
          </button>

<span v-if="taskFocusSummary(task)" class="course-tag focus-tag">{{ taskFocusSummary(task) }}</span>
          <div class="task-main">
            <div class="task-topline">
              <h3>{{ task.title }}</h3>
              <span class="priority" :class="task.priority ?? 'normal'">
                {{ PRIORITIES[task.priority]?.label ?? '普通' }}
              </span>
              <span v-if="taskCourseName(task)" class="course-tag">{{ taskCourseName(task) }}</span>
              <span v-if="task.estimateMinutes" class="course-tag">{{ task.estimateMinutes }} 分钟</span>
            </div>
            <p v-if="task.note">{{ task.note }}</p>
          </div>

          <span class="due" :class="dueInfo(task).cls">{{ dueInfo(task).text }}</span>

          <div class="more" @click.stop>
            <button v-if="!isArchived(task) && taskStatus(task) === 'overdue'" class="link-btn reschedule-link" title="重新安排日期" @click.stop="openReschedule(task)">重新安排</button>
            <button v-if="isArchived(task)" class="link-btn" title="恢复待办" @click="domain.restoreTask(task.id)">↶</button>
            <button class="link-btn" title="编辑待办" @click="openEdit(task)">✎</button>
            <button v-if="!isArchived(task) && taskStatus(task) === 'completed'" class="link-btn" title="归档待办" @click="archiveTask(task)">▱</button>
            <button class="link-btn danger" title="删除待办" @click="deleteTask(task)">🗑</button>
          </div>
        </article>
      </SwipeActionItem>
    </VirtualList>

    <Modal v-if="showForm" :open="showForm" :title="editingId ? '编辑待办' : '添加待办'" @close="showForm = false">
      <div class="form">
        <label>待办内容 *</label>
        <input v-model="form.title" placeholder="例如：完成高数第三章作业" />

        <label>所属课程或类别</label>
        <input v-model="form.course" list="course-options" placeholder="选填，可直接输入" @change="linkCourseFromName" />
        <datalist id="course-options">
          <option v-for="name in courseNames" :key="name" :value="name"></option>
        </datalist>

        <div class="form-row">
          <div>
            <label>截止日期</label>
            <input v-model="form.dueDate" type="date" />
          </div>
          <div>
            <label>截止时间</label>
            <input v-model="form.dueTime" type="time" :disabled="!form.dueDate" />
          </div>
        </div>

        <label>优先级</label>
        <select v-model="form.priority">
          <option value="high">高优先级</option>
          <option value="normal">普通</option>
          <option value="low">低优先级</option>
        </select>

        <div class="form-row">
          <div><label>预计时长（分钟）</label><input v-model="form.estimateMinutes" type="number" min="0" inputmode="numeric" placeholder="选填" /></div>
          <div><label>重复</label><select v-model="form.repeat"><option value="none">不重复</option><option value="weekly">每周（完成后生成下周）</option></select></div>
        </div>

        <label>备注</label>
        <textarea v-model="form.note" rows="3" placeholder="选填"></textarea>

        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions">
          <button v-if="editingId" class="btn btn-danger" @click="remove">删除</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
    </Modal>

    <NoticePaste
      :open="showNotice"
      :tasks="tasks"
      :courses="courses"
      @close="showNotice = false"
      @commit="onNoticeCommit"
    />
    <ConfirmDialog :open="Boolean(deleteTarget)" title="删除待办" :message="`确定删除待办“${deleteTarget?.title || ''}”吗？删除后可在短时间内撤销。`" confirm-label="删除" @close="deleteTarget = null" @confirm="confirmDelete" />
    <Modal v-if="rescheduleTarget" :open="Boolean(rescheduleTarget)" title="重新安排日期" @close="rescheduleTarget = null">
      <div class="reschedule-form">
        <p>为“{{ rescheduleTarget.title }}”选择一个新的截止日期。</p>
        <label>新的截止日期<input v-model="rescheduleDate" type="date" /></label>
        <div class="actions"><button class="btn" @click="rescheduleTarget = null">取消</button><button class="btn btn-primary" @click="saveReschedule">保存日期</button></div>
      </div>
    </Modal>
    <div v-if="undoToast" class="undo-toast" role="status" aria-live="polite"><span>{{ undoToast.text }}</span><button type="button" @click="undoDelete">撤销</button></div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sort-select {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-faint);
  font-size: 12px;
  font-weight: 600;
}
.sort-select select {
  padding: 7px 9px;
  font-size: 12.5px;
}
.notice-success {
  padding: 8px 12px;
  color: #087a58;
  font-size: 12.5px;
  border: 1px solid #b9e6d5;
  border-radius: 9px;
  background: #effaf6;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-list :deep(.swipe-item) {
  border-radius: var(--card-radius);
}
.empty-box {
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
}
.task {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.task:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}
.reschedule-link { flex: 0 0 auto; padding-inline: 5px; color: var(--primary); }
.reschedule-form { display: flex; flex-direction: column; gap: 14px; }
.reschedule-form p { color: var(--ink-soft); font-size: 13px; line-height: 1.5; }
.reschedule-form label { display: flex; flex-direction: column; gap: 6px; color: var(--ink-soft); font-size: 12px; font-weight: 700; }
.reschedule-form input { width: 100%; }
.reschedule-form .actions { display: flex; justify-content: flex-end; gap: 8px; }
.task.done {
  opacity: 0.55;
}
.urgent-bar {
  position: absolute;
  left: -1px;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 999px;
  background: var(--danger);
}
.check {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  color: #fff;
  font-weight: 800;
  font-size: 13px;
  border: 2px solid #c3cbd9;
  border-radius: 8px;
  background: #fff;
  transition: background 0.14s, border-color 0.14s;
}
.check:hover {
  border-color: #19a878;
}
.check.checked {
  border-color: #19a878;
  background: #19a878;
}
.task-main {
  flex: 1;
  min-width: 0;
}
.task-topline {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.task-topline h3 {
  overflow: hidden;
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task.done .task-topline h3 {
  text-decoration: line-through;
}
.priority,
.course-tag {
  flex: 0 0 auto;
  padding: 2px 7px;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 5px;
}
.priority.high {
  color: #d43f3f;
  background: #feecec;
}
.priority.normal {
  color: var(--primary);
  background: var(--primary-soft);
}
.priority.low {
  color: #607084;
  background: #eef1f5;
}
.course-tag {
  max-width: 150px;
  overflow: hidden;
  color: #7b55d4;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #f1ebff;
}
.course-tag.focus-tag {
  color: #087a58;
  background: #e7f8f1;
}
.task-main p {
  overflow: hidden;
  margin-top: 3px;
  color: var(--ink-soft);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.due {
  flex: 0 0 auto;
  max-width: 170px;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.due.today,
.due.soon {
  padding: 4px 8px;
  color: #b86b16;
  font-weight: 800;
  border-radius: 6px;
  background: #fff5df;
}
.due.overdue {
  padding: 4px 8px;
  color: var(--danger);
  font-weight: 800;
  border-radius: 6px;
  background: #feecec;
}
.more {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.14s;
}
.task:hover .more,
.task:focus-within .more {
  opacity: 1;
}
@media (hover: none) {
  .more {
    opacity: 1;
  }
}
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form label {
  margin-top: 6px;
  color: var(--ink-soft);
  font-size: 13px;
}
.form input,
.form select,
.form textarea {
  width: 100%;
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
.error {
  color: var(--danger);
  font-size: 13px;
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
.undo-toast { position: fixed; right: 18px; bottom: 18px; z-index: 110; display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 28px); padding: 10px 12px 10px 14px; color: var(--text); border: 1px solid var(--border); border-radius: 10px; background: var(--card); box-shadow: var(--shadow-md); font-size: 13px; }
.undo-toast button { padding: 5px 8px; color: var(--primary); font-weight: 800; border: 0; border-radius: 6px; background: var(--primary-soft); }

@media (max-width: 720px) {
  .page-head {
    align-items: stretch;
    flex-direction: column;
  }
  .page-actions {
    justify-content: space-between;
  }
  .task {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 12px 13px;
  }
  .task-main {
    width: calc(100% - 38px);
  }
  .due {
    margin-left: 36px;
  }
  .more {
    margin-left: auto;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
  .undo-toast { right: 14px; bottom: calc(76px + env(safe-area-inset-bottom)); }
}
</style>
