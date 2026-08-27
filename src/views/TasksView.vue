<script setup>
import { computed, ref } from 'vue'
import Modal from '../components/Modal.vue'
import NoticePaste from '../components/NoticePaste.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import VirtualList from '../components/VirtualList.vue'
import { appearance } from '../composables/appearance.js'
import { fmtDate, todayStr, useStoredRef } from '../composables/store.js'

const tasks = useStoredRef('sl_tasks', [])
const courses = useStoredRef('sl_courses', [])
const showForm = ref(false)
const showNotice = ref(false)
const noticeMessage = ref('')
const editingId = ref(null)
const error = ref('')
const filter = ref('todo')
const form = ref(emptyForm())

const PRIORITIES = {
  high: { label: '高优先级', order: 0 },
  normal: { label: '普通', order: 1 },
  low: { label: '低优先级', order: 2 },
}

function emptyForm() {
  return {
    title: '',
    course: '',
    dueDate: '',
    dueTime: '',
    priority: 'normal',
    note: '',
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
    dueDate: task.dueDate ?? '',
    dueTime: task.dueTime ?? '',
    priority: task.priority ?? 'normal',
    note: task.note ?? '',
  }
  showForm.value = true
}

function save() {
  if (!form.value.title.trim()) {
    error.value = '请填写待办内容'
    return
  }
  const data = {
    title: form.value.title.trim(),
    course: form.value.course.trim(),
    dueDate: form.value.dueDate,
    dueTime: form.value.dueTime,
    priority: form.value.priority,
    note: form.value.note.trim(),
  }
  if (editingId.value) {
    const target = tasks.value.find((task) => task.id === editingId.value)
    if (target) Object.assign(target, data)
  } else {
    tasks.value.push({
      id: 't' + Date.now(),
      done: false,
      createdAt: new Date().toISOString(),
      ...data,
    })
  }
  showForm.value = false
}

function remove() {
  tasks.value = tasks.value.filter((task) => task.id !== editingId.value)
  showForm.value = false
}

function toggleDone(event, id) {
  event.stopPropagation()
  const task = tasks.value.find((item) => item.id === id)
  toggleTask(task)
}

function toggleTask(task) {
  if (!task) return
  task.done = !task.done
  task.completedAt = task.done ? new Date().toISOString() : null
}

function swipeLabel(task, direction) {
  const action = appearance.value.swipeActions.tasks[direction]
  if (action === 'complete') return task.done ? '恢复待办' : '完成'
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
  else if (action === 'delete' && window.confirm(`确定删除待办“${task.title}”吗？`)) {
    tasks.value = tasks.value.filter((item) => item.id !== task.id)
  }
}

function onNoticeCommit(payload) {
  const now = new Date().toISOString()
  if (payload.type === 'update') {
    const target = tasks.value.find((task) => task.id === payload.id)
    if (!target) return
    Object.assign(target, payload.data, { updatedAt: now })
    showNoticeMessage(`已根据新通知更新“${payload.title}”`)
  } else {
    tasks.value.push({
      id: 't' + Date.now(),
      done: false,
      createdAt: now,
      ...payload.data,
    })
    showNoticeMessage(`已创建待办“${payload.title}”`)
  }
}

function showNoticeMessage(message) {
  noticeMessage.value = message
  window.setTimeout(() => {
    if (noticeMessage.value === message) noticeMessage.value = ''
  }, 3500)
}

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
  const isOverdue = !task.done && dueTimestamp(task) < Date.now()
  if (isOverdue) return { text: days < 0 ? `逾期 ${-days} 天` : '已逾期', cls: 'overdue' }
  if (days === 0) return { text: task.dueTime ? `今天 ${task.dueTime}` : '今天截止', cls: 'today' }
  if (days === 1) return { text: task.dueTime ? `明天 ${task.dueTime}` : '明天截止', cls: 'soon' }
  return { text: `${fmtDate(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ''}`, cls: '' }
}

const counts = computed(() => ({
  todo: tasks.value.filter((task) => !task.done).length,
  done: tasks.value.filter((task) => task.done).length,
  all: tasks.value.length,
}))

const sorted = computed(() =>
  [...tasks.value].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1
    const dueDiff = dueTimestamp(a) - dueTimestamp(b)
    if (dueDiff) return dueDiff
    return (PRIORITIES[a.priority]?.order ?? 1) - (PRIORITIES[b.priority]?.order ?? 1)
  })
)

const visibleTasks = computed(() =>
  sorted.value.filter((task) => {
    if (filter.value === 'todo') return !task.done
    if (filter.value === 'done') return task.done
    return true
  })
)

const courseNames = computed(() => [...new Set(courses.value.map((course) => course.name).filter(Boolean))])
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h2>✅ 作业与待办</h2>
        <p>把要完成的事情放在这里，按截止时间逐项清理</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" @click="showNotice = true">📋 粘贴通知</button>
        <button class="btn btn-primary" @click="openAdd">＋ 添加待办</button>
      </div>
    </div>

    <p v-if="noticeMessage" class="notice-success">✓ {{ noticeMessage }}</p>

    <div class="task-toolbar">
      <button :class="{ on: filter === 'todo' }" @click="filter = 'todo'">待完成 <b>{{ counts.todo }}</b></button>
      <button :class="{ on: filter === 'done' }" @click="filter = 'done'">已完成 <b>{{ counts.done }}</b></button>
      <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部 <b>{{ counts.all }}</b></button>
    </div>

    <div v-if="tasks.length === 0" class="card empty">
      还没有作业或待办，添加第一项后就可以开始安排 🎯
    </div>
    <div v-else-if="visibleTasks.length === 0" class="card empty">
      这个列表暂时是空的
    </div>

    <VirtualList v-else v-slot="{ item: task }" class="task-list" :items="visibleTasks" :estimated-height="92" :gap="10" :threshold="40">
      <SwipeActionItem
        :left-label="swipeLabel(task, 'left')"
        :right-label="swipeLabel(task, 'right')"
        :left-tone="swipeTone('left')"
        :right-tone="swipeTone('right')"
        @swipe="handleTaskSwipe($event, task)"
      >
        <article
          class="card task"
          :class="{ done: task.done }"
          @click="openEdit(task)"
        >
          <button
            type="button"
            class="check"
            :class="{ checked: task.done }"
            :aria-label="task.done ? '标记为未完成' : '标记为已完成'"
            @click="toggleDone($event, task.id)"
          >
            {{ task.done ? '✓' : '' }}
          </button>

          <div class="task-main">
            <div class="task-topline">
              <span class="priority" :class="task.priority ?? 'normal'">
                {{ PRIORITIES[task.priority]?.label ?? '普通' }}
              </span>
              <span v-if="task.course" class="course-tag">{{ task.course }}</span>
            </div>
            <h3>{{ task.title }}</h3>
            <p v-if="task.note">{{ task.note }}</p>
          </div>

          <span class="due" :class="dueInfo(task).cls">{{ dueInfo(task).text }}</span>
        </article>
      </SwipeActionItem>
    </VirtualList>

    <Modal :open="showForm" :title="editingId ? '编辑待办' : '添加待办'" @close="showForm = false">
      <div class="form">
        <label>待办内容 *</label>
        <input v-model="form.title" placeholder="例如：完成高数第三章作业" />

        <label>所属课程或类别</label>
        <input v-model="form.course" list="course-options" placeholder="选填，可直接输入" />
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
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.head h2 {
  font-size: 22px;
}
.head p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 13px;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.notice-success {
  padding: 9px 12px;
  color: #087a58;
  font-size: 12px;
  border: 1px solid #b9e6d5;
  border-radius: 9px;
  background: #effaf6;
}
.task-toolbar {
  display: flex;
  gap: 6px;
  width: fit-content;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
}
.task-toolbar button {
  padding: 7px 12px;
  color: var(--muted);
  font-size: 13px;
  border: none;
  border-radius: 7px;
  background: transparent;
}
.task-toolbar button.on {
  color: var(--primary);
  font-weight: 700;
  background: var(--primary-soft);
}
.task-toolbar b {
  margin-left: 4px;
}
.empty {
  padding: 58px 20px;
  color: var(--muted);
  text-align: center;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.task {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.task:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.task.done {
  opacity: 0.58;
}
.task.done h3 {
  text-decoration: line-through;
}
.check {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  color: #fff;
  font-weight: 800;
  border: 2px solid #cbd2df;
  border-radius: 8px;
  background: #fff;
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
  gap: 6px;
  margin-bottom: 5px;
}
.priority,
.course-tag {
  padding: 3px 7px;
  font-size: 10px;
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
  max-width: 180px;
  overflow: hidden;
  color: #7b55d4;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #f1ebff;
}
.task h3 {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-main p {
  overflow: hidden;
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.due {
  max-width: 200px;
  color: var(--muted);
  font-size: 12px;
  text-align: right;
}
.due.today,
.due.soon {
  padding: 5px 8px;
  color: #b86b16;
  font-weight: 700;
  border-radius: 6px;
  background: #fff5df;
}
.due.overdue {
  padding: 5px 8px;
  color: var(--danger);
  font-weight: 700;
  border-radius: 6px;
  background: #feecec;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form label {
  margin-top: 6px;
  color: var(--muted);
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

@media (max-width: 620px) {
  .head {
    align-items: flex-start;
    flex-direction: column;
  }
  .head .btn {
    flex: 1;
  }
  .head-actions { width: 100%; }
  .task {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 15px;
  }
  .task-main {
    width: calc(100% - 42px);
  }
  .due {
    width: 100%;
    max-width: none;
    margin-left: 40px;
    text-align: left;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
