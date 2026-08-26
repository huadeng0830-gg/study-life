<script setup>
import { ref, computed } from 'vue'
import Modal from '../components/Modal.vue'
import {
  useStoredRef,
  fmtCountdownDate,
  sortCountdowns,
} from '../composables/store.js'

const CATEGORIES = ['学习', '生活', '纪念日', '项目', '其他']
const exams = useStoredRef('sl_exams', [])
const showPast = useStoredRef('sl_countdown_show_past', false)
const showForm = ref(false)
const editingId = ref(null)
const error = ref('')
const form = ref(emptyForm())

function emptyForm() {
  return {
    name: '',
    date: '',
    time: '',
    location: '',
    category: '学习',
    repeat: 'none',
    pinned: false,
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
  }
  showForm.value = true
}

function save() {
  if (!form.value.name.trim()) {
    error.value = '请填写倒计时名称'
    return
  }
  if (!form.value.date) {
    error.value = '请选择目标日期'
    return
  }
  const data = {
    name: form.value.name.trim(),
    date: form.value.date,
    time: form.value.time,
    location: form.value.location.trim(),
    category: form.value.category,
    repeat: form.value.repeat,
    pinned: form.value.pinned,
  }
  if (editingId.value) {
    const target = exams.value.find((item) => item.id === editingId.value)
    if (target) Object.assign(target, data)
  } else {
    exams.value.push({ id: 'e' + Date.now(), ...data })
  }
  showForm.value = false
}

function remove() {
  exams.value = exams.value.filter((item) => item.id !== editingId.value)
  showForm.value = false
}

function togglePin(event, id) {
  event.stopPropagation()
  const target = exams.value.find((item) => item.id === id)
  if (target) target.pinned = !target.pinned
}

const sorted = computed(() => sortCountdowns(exams.value))

const visibleItems = computed(() =>
  showPast.value ? sorted.value : sorted.value.filter((item) => !item.countdown.isPast)
)
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h2>⏳ 我的倒计时</h2>
        <p>考试、生日、纪念日和项目节点都可以放在这里</p>
      </div>
      <div class="head-actions">
        <label class="past-toggle">
          <input v-model="showPast" type="checkbox" />
          显示已结束
        </label>
        <button class="btn btn-primary" @click="openAdd">＋ 添加倒计时</button>
      </div>
    </div>

    <div v-if="exams.length === 0" class="card empty">
      还没有倒计时，点击右上角「添加倒计时」开始吧 🎯
    </div>

    <div v-else-if="visibleItems.length === 0" class="card empty">
      已结束的倒计时已隐藏，可在右上角重新显示
    </div>

    <div v-else class="list">
      <div
        v-for="item in visibleItems"
        :key="item.id"
        class="card exam"
        :class="{ finished: item.countdown.isPast, pinned: item.pinned }"
        @click="openEdit(item)"
      >
        <div class="count" :class="item.countdown.cls">
          <span class="num">{{ item.countdown.text }}</span>
          <span class="unit">{{ item.countdown.label }}</span>
        </div>
        <div class="info">
          <div class="meta-row">
            <span class="category">{{ item.category ?? '其他' }}</span>
            <span v-if="item.repeat === 'yearly'" class="repeat-tag">每年重复</span>
          </div>
          <div class="name">{{ item.name }}</div>
          <div class="date">{{ fmtCountdownDate(item, item.countdown.target) }}</div>
          <div v-if="item.location" class="loc">📝 {{ item.location }}</div>
        </div>
        <button
          type="button"
          class="pin-button"
          :class="{ on: item.pinned }"
          :aria-label="item.pinned ? '取消置顶' : '置顶倒计时'"
          :title="item.pinned ? '取消置顶' : '置顶'"
          @click="togglePin($event, item.id)"
        >
          ◆
        </button>
      </div>
    </div>

    <Modal :open="showForm" :title="editingId ? '编辑倒计时' : '添加倒计时'" @close="showForm = false">
      <div class="form">
        <label>倒计时名称 *</label>
        <input v-model="form.name" placeholder="例如：期末考试、生日或项目截止日" />

        <div class="form-row">
          <div>
            <label>目标日期 *</label>
            <input v-model="form.date" type="date" />
          </div>
          <div>
            <label>具体时间</label>
            <input v-model="form.time" type="time" />
          </div>
        </div>

        <div class="form-row">
          <div>
            <label>类型</label>
            <select v-model="form.category">
              <option v-for="category in CATEGORIES" :key="category" :value="category">{{ category }}</option>
            </select>
          </div>
          <div>
            <label>重复</label>
            <select v-model="form.repeat">
              <option value="none">不重复</option>
              <option value="yearly">每年重复</option>
            </select>
          </div>
        </div>

        <label>备注或地点</label>
        <input v-model="form.location" placeholder="选填，例如：教学楼 A101" />

        <label class="pin-option">
          <input v-model="form.pinned" type="checkbox" />
          在列表顶部显示
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="actions">
          <button v-if="editingId" class="btn btn-danger" @click="remove">删除</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
    </Modal>
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
  justify-content: space-between;
  align-items: center;
}
.head h2 {
  font-size: 22px;
}
.head > div:first-child p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 13px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.past-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.past-toggle input,
.pin-option input {
  accent-color: var(--primary);
}
.empty {
  color: var(--muted);
  text-align: center;
  padding: 60px 20px;
}
.list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.exam {
  position: relative;
  display: flex;
  align-items: center;
  gap: 18px;
  cursor: pointer;
  transition: transform 0.12s, box-shadow 0.12s;
}
.exam:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(30, 40, 80, 0.1);
}
.exam.finished {
  opacity: 0.55;
}
.exam.pinned {
  border-color: #cfd8fb;
}
.count {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 74px;
  padding: 10px 8px;
  border-radius: 12px;
  background: var(--primary-soft);
  color: var(--primary);
}
.count .num {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.15;
}
.count .unit {
  font-size: 12px;
}
.count.hot {
  background: #fee2e2;
  color: var(--danger);
}
.count.past {
  background: #f3f4f6;
  color: var(--muted);
}
.count.past .num {
  font-size: 15px;
}
.info {
  flex: 1;
  min-width: 0;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
.category,
.repeat-tag {
  padding: 3px 7px;
  color: var(--primary);
  font-size: 10px;
  font-weight: 700;
  border-radius: 5px;
  background: var(--primary-soft);
}
.repeat-tag {
  color: #7b55d4;
  background: #f1ebff;
}
.name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}
.date {
  font-size: 13px;
  color: var(--muted);
}
.loc {
  font-size: 13px;
  color: var(--muted);
  margin-top: 2px;
}
.pin-button {
  position: absolute;
  top: 11px;
  right: 11px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #b6bdcb;
  border: none;
  border-radius: 8px;
  background: transparent;
}
.pin-button:hover {
  background: var(--bg);
}
.pin-button.on {
  color: #7a55e8;
  background: #f1ebff;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form label {
  font-size: 13px;
  color: var(--muted);
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
    gap: 12px;
  }

  .head-actions {
    width: 100%;
    justify-content: space-between;
  }

  .head-actions .btn {
    width: 100%;
  }

  .list {
    grid-template-columns: 1fr;
  }

  .exam {
    gap: 14px;
    padding: 16px;
  }

  .count {
    min-width: 66px;
  }

  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
