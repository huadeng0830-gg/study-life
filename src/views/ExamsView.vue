<script setup>
import { computed, ref, onBeforeUnmount } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import VirtualList from '../components/VirtualList.vue'
import {
  useStoredRef,
  fmtCountdownDate,
  sortCountdowns,
} from '../composables/store'

const CATEGORIES = ['学习', '生活', '纪念日', '项目', '其他']
const exams = useStoredRef('sl_exams', [])
const courses = useStoredRef('sl_courses', [])
const showPast = useStoredRef('sl_countdown_show_past', false)
const showForm = ref(false)
const editingId = ref(null)
const error = ref('')
const form = ref(emptyForm())
const deleteTarget = ref(null)

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
    error.value = '请填写倒计时名称'
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
    const target = exams.value.find((item) => item.id === editingId.value)
    if (target) Object.assign(target, data)
  } else {
    exams.value.push({ id: 'e' + Date.now(), ...data })
  }
  showForm.value = false
}

function remove() {
  const item = exams.value.find((entry) => entry.id === editingId.value)
  showForm.value = false
  if (item) deleteTarget.value = item
}

const sorted = computed(() => sortCountdowns(exams.value))

const visibleItems = computed(() =>
  showPast.value ? sorted.value : sorted.value.filter((item) => !item.countdown.isPast)
)

// 窄屏（单列）下清单很长时做虚拟滚动；宽屏保持多列网格原样渲染。
// 入场动画只对少量卡片有意义，长列表直接禁用，避免一次挂载几十个动画。
const EXAM_LIST_THRESHOLD = 16
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches)
let narrowMql = null
let narrowMqlHandler = null
if (typeof window !== 'undefined') {
  narrowMql = window.matchMedia('(max-width: 620px)')
  narrowMqlHandler = (event) => { isNarrow.value = event.matches }
  narrowMql.addEventListener('change', narrowMqlHandler)
}
onBeforeUnmount(() => {
  if (narrowMql && narrowMqlHandler) narrowMql.removeEventListener('change', narrowMqlHandler)
})

// ---------- 卡片展示辅助：日期牌 / 短日期 / 时间轴 ----------
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad2 = (v) => String(v).padStart(2, '0')
const todayMid = new Date(new Date().toDateString())

// 日期牌：目标月 / 日（无法解析时显示 --）
function tileOf(item) {
  const t = item.countdown.target
  if (!t) return { month: '--', day: '--' }
  return { month: pad2(t.getMonth() + 1), day: pad2(t.getDate()) }
}

// 短日期行：8月30日 · 周日（含时间时追加），不再与「本周日」等信息重复
function shortDateOf(item) {
  const t = item.countdown.target
  if (!t) return fmtCountdownDate(item, null)
  let text = `${t.getMonth() + 1}月${t.getDate()}日 · ${WEEKDAYS[t.getDay()]}`
  if (item.time) text += ` ${item.time}`
  return text
}

// 底部轻量时间轴：今天 ─── ● 目标日
function timelineOf(item) {
  const t = item.countdown.target
  if (!t) return null
  const start = `${todayMid.getMonth() + 1}/${todayMid.getDate()}`
  const end = `${t.getMonth() + 1}/${t.getDate()}`
  const sameDay = t.toDateString() === todayMid.toDateString()
  return { start, end, sameDay }
}

// ---------- 卡片右上 ··· 菜单：置顶 / 编辑 / 删除 ----------
const openMenuId = ref(null)

function toggleMenu(item, event) {
  event.stopPropagation()
  openMenuId.value = openMenuId.value === item.id ? null : item.id
}

function closeMenu() {
  openMenuId.value = null
}

function menuPin(item) {
  const target = exams.value.find((entry) => entry.id === item.id)
  if (target) target.pinned = !target.pinned
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

function confirmDelete() {
  if (!deleteTarget.value) return
  exams.value = exams.value.filter((entry) => entry.id !== deleteTarget.value.id)
  deleteTarget.value = null
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
        <h1 class="page-title">我的倒计时</h1>
        <p class="page-desc">考试、生日、纪念日等重要节点都可以放在这里。</p>
      </div>
      <div class="page-actions">
        <label class="past-toggle">
          <input v-model="showPast" type="checkbox" />
          显示已结束
        </label>
        <button class="btn btn-primary" @click="openAdd">＋ 添加倒计时</button>
      </div>
    </header>

    <EmptyState
      v-if="exams.length === 0"
      class="card empty-box"
      icon="⏳"
      title="还没有倒计时"
      description="添加一个重要日期，未来的自己会感谢你。"
      primary-label="＋ 添加倒计时"
      @primary="openAdd"
    />

    <EmptyState
      v-else-if="visibleItems.length === 0"
      class="card empty-box"
      icon="✦"
      title="已结束的倒计时已隐藏"
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
    >
      <template #default="{ item }">
        <div
          class="card exam cvi-card"
          :class="{ finished: item.countdown.isPast, pinned: item.pinned, hot: item.countdown.cls === 'hot' && !item.countdown.isPast }"
          @click="openEdit(item)"
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
          <div v-if="openMenuId === item.id" class="card-menu" @click.stop>
            <button @click="menuPin(item)">{{ item.pinned ? '取消置顶' : '置顶' }}</button>
            <button @click="menuEdit(item)">编辑</button>
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
            <div v-if="item.location" class="loc">{{ item.location }}</div>
          </div>
          <div class="count" :class="item.countdown.cls">
            <small v-if="!item.countdown.isPast && /^\d+$/.test(String(item.countdown.text))">还有</small>
            <span class="num" :class="{ tiny: !/^\d+$/.test(String(item.countdown.text)) }">{{ item.countdown.text }}</span>
            <span v-if="item.countdown.label && /^\d+$/.test(String(item.countdown.text))" class="unit">{{ item.countdown.label }}</span>
          </div>
        </div>

        <!-- 底部轻量时间轴 -->
        <div v-if="timelineOf(item)" class="timeline" aria-hidden="true">
          <span class="tl-label">{{ timelineOf(item).start }}</span>
          <span class="tl-track"><i></i></span>
          <span class="tl-label strong">{{ timelineOf(item).end }}</span>
          <span class="tl-dot" :class="{ on: timelineOf(item).sameDay }"></span>
        </div>
      </div>
      </template>
    </VirtualList>

    <Modal v-if="showForm" :open="showForm" :title="editingId ? '编辑倒计时' : '添加倒计时'" @close="showForm = false">
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

        <div v-if="form.category === '学习'" class="form-row">
          <div><label>关联课程</label><select v-model="form.courseId"><option value="">暂不关联</option><option v-for="course in courses" :key="course.id" :value="course.id">{{ course.name }}</option></select></div>
          <div><label>复习完成度 {{ form.reviewProgress }}%</label><input v-model.number="form.reviewProgress" type="range" min="0" max="100" step="5" /></div>
        </div>

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

    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      title="删除倒计时"
      :message="`确定删除倒计时“${deleteTarget?.name || ''}”吗？此操作无法撤销。`"
      confirm-label="删除"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
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
  font-size: 12.5px;
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
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  animation: exam-in 0.2s ease-out both;
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
.exam.pinned { border-color: #cfd8fb; background: linear-gradient(180deg, #fbfcff, #fff); }
.exam.hot { border-color: #f3c2c2; }

/* 顶部标签：小号浅色，不抢标题 */
.exam-top { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.meta-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.category,
.repeat-tag {
  padding: 2.5px 8px;
  color: var(--ink-faint);
  font-size: 10.5px;
  font-weight: 650;
  border-radius: 6px;
  background: var(--bg-tint);
}
.category { color: var(--primary); background: var(--primary-soft); }
.repeat-tag { color: #8b6ad4; background: #f3eeff; }
.menu-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 22px;
  flex: 0 0 auto;
  color: #aab2c2;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.05em;
  border: none;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
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
  border-radius: 10px;
  background: #fff;
  box-shadow: var(--shadow-md);
}
.card-menu button {
  padding: 8px 11px;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  border: none;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  transition: background 0.14s;
}
.card-menu button:hover { background: var(--bg); }
.card-menu button.danger { color: var(--danger); }
.card-menu button.danger:hover { background: #feecec; }

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
  border-radius: 16px;
  background: linear-gradient(160deg, #eef2ff 0%, #f4f0ff 100%);
}
.date-tile small { color: #8a94d8; font-size: 11px; font-weight: 700; line-height: 1.2; }
.date-tile b { color: #3d4ec0; font-size: 23px; font-weight: 900; line-height: 1.15; letter-spacing: 0.01em; }
.exam-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.name {
  overflow: hidden;
  font-size: clamp(19px, 1.6vw, 23px);
  font-weight: 750;
  letter-spacing: -0.01em;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.date { color: var(--ink-soft); font-size: 13px; font-variant-numeric: tabular-nums; }
.loc { overflow: hidden; color: var(--ink-faint); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }

/* 剩余天数：整张卡最显眼的信息 */
.count {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 84px;
  flex: 0 0 auto;
  color: var(--primary);
}
.count small { color: var(--ink-faint); font-size: 11px; font-weight: 700; }
.count .num {
  font-size: clamp(42px, 3.6vw, 50px);
  font-weight: 900;
  line-height: 1.02;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  transition: opacity 0.2s ease;
}
.count .num.tiny { font-size: 22px; letter-spacing: 0; }
.count .unit { margin-top: 2px; color: var(--ink-soft); font-size: 12px; font-weight: 700; }
.count.hot { color: var(--danger); }
.count.hot .unit { color: var(--danger); }
.count.past { color: var(--ink-faint); }
.count.past .num { font-size: 17px; }

/* 底部轻量时间轴：今天 ── ● 目标日 */
.timeline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.tl-label { color: var(--ink-faint); font-size: 10.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tl-label.strong { color: var(--ink-soft); font-weight: 700; margin-right: 10px; }
.tl-track {
  position: relative;
  flex: 1;
  height: 3px;
  border-radius: 999px;
  background: #e7ecf6;
}
.tl-track i { position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(90deg, rgba(69,111,232,.32), rgba(120,100,220,.32)); }
.exam.finished .tl-track i { background: #eef1f6; }
.tl-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  margin-left: -12px;
  border-radius: 50%;
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
  font-size: 13px;
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

@media (max-width: 720px) {
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
  .date-tile { width: 50px; height: 58px; flex-basis: 50px; border-radius: 13px; }
  .date-tile small { font-size: 10px; }
  .date-tile b { font-size: 19px; }
  .name { font-size: 18px; }
  .date { font-size: 12px; }
  .count { min-width: 72px; }
  .count .num { font-size: 38px; }

  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
