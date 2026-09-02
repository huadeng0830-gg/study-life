<script setup>
import { computed, reactive, watch } from 'vue'
import Modal from '../Modal.vue'
import { PALETTE, MAX_WEEK } from '../../composables/store/utils.js'
import { periodIndex, periodLabelById, periodRangeById } from '../../composables/store/timeConfig.js'
import { weekLabel } from '../../composables/store/schedule.js'
import { isArchived, taskStatus } from '../../composables/domain/state.js'

const props = defineProps({
  open: Boolean,
  editingId: { type: [String, Number], default: null },
  form: { type: Object, required: true },
  courses: { type: Array, required: true },
  timeConfig: { type: Object, required: true },
  linkedTasks: { type: Array, default: () => [] },
  linkedCountdowns: { type: Array, default: () => [] },
  linkedReviewProgress: { type: [Number, null], default: null },
})

const emit = defineEmits(['close', 'save', 'delete', 'archive', 'add-another', 'add-homework'])

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const draft = reactive({})
const error = reactive({ message: '' })

function syncDraft() {
  Object.assign(draft, JSON.parse(JSON.stringify(props.form)))
  error.message = ''
}

watch(() => [props.open, props.editingId], ([open]) => {
  if (open) syncDraft()
}, { immediate: true })

const formCellCourses = computed(() => {
  if (!props.open) return []
  const day = Number(draft.day)
  const start = periodIndex(draft.start)
  const end = periodIndex(draft.end)
  if (start < 0 || end < 0) return []
  const low = Math.min(start, end)
  const high = Math.max(start, end)
  return props.courses.filter((course) => {
    if (course.id === props.editingId || course.day !== day) return false
    const courseStart = periodIndex(course.start)
    const courseEnd = periodIndex(course.end)
    if (courseStart < 0 || courseEnd < 0) return false
    return Math.min(courseStart, courseEnd) <= high && Math.max(courseStart, courseEnd) >= low
  })
})

function overlaps(course) {
  const startWeek = Number(draft.startWeek)
  const endWeek = Number(draft.endWeek)
  const low = Math.max(startWeek, course.startWeek ?? 1)
  const high = Math.min(endWeek, course.endWeek ?? MAX_WEEK)
  if (low > high) return false
  const currentType = draft.weekType ?? 'all'
  const courseType = course.weekType ?? 'all'
  for (let week = low; week <= high; week++) {
    const currentOn = currentType === 'all' || (currentType === 'odd' ? week % 2 === 1 : week % 2 === 0)
    const courseOn = courseType === 'all' || (courseType === 'odd' ? week % 2 === 1 : week % 2 === 0)
    if (currentOn && courseOn) return true
  }
  return false
}

const formCellClash = computed(() => formCellCourses.value.find((course) => overlaps(course)))
const editingCourse = computed(() => props.courses.find((course) => course.id === props.editingId) ?? null)

function periodOption(id) {
  const label = periodLabelById(id)
  const range = periodRangeById(id)
  return range ? `${label}（${range}）` : label
}

function coursePeriodText(course) {
  const start = periodLabelById(course.start)
  const end = periodLabelById(course.end)
  return course.start === course.end ? start : `${start}至${end}`
}

function save() {
  if (!String(draft.name ?? '').trim()) {
    error.message = '请填写课程名称'
    return
  }
  let start = draft.start
  let end = draft.end
  if (periodIndex(end) < periodIndex(start)) [start, end] = [end, start]
  let startWeek = Number(draft.startWeek)
  let endWeek = Number(draft.endWeek)
  if (endWeek < startWeek) [startWeek, endWeek] = [endWeek, startWeek]
  emit('save', {
    id: props.editingId || `c${crypto.randomUUID()}`,
    editingId: props.editingId,
    data: {
      name: draft.name.trim(),
      teacher: String(draft.teacher ?? '').trim(),
      room: String(draft.room ?? '').trim(),
      campusId: String(draft.campusId ?? '').trim(),
      travelMinutes: Math.max(0, Number(draft.travelMinutes) || 0),
      color: draft.color,
      day: Number(draft.day),
      start,
      end,
      startWeek,
      endWeek,
      weekType: draft.weekType,
    },
  })
}

function requestDelete() {
  emit('delete', props.courses.find((course) => course.id === props.editingId) ?? null)
}
</script>

<template>
  <Modal :open="open" :title="editingId ? '编辑课程' : '添加课程'" @close="emit('close')">
    <div class="form">
      <label>课程名称 *</label>
      <input v-model="draft.name" placeholder="例如：高等数学" />

      <label>任课老师</label>
      <input v-model="draft.teacher" placeholder="选填" />

      <label>上课地点</label>
      <input v-model="draft.room" placeholder="例如：教学楼 A201" />

      <div class="row">
        <div><label>校区</label><select v-model="draft.campusId"><option value="">跟随当前校区</option><option v-for="campus in timeConfig.campuses" :key="campus.id" :value="campus.id">{{ campus.name }}</option></select></div>
        <div><label>提前出发（分钟）</label><input v-model.number="draft.travelMinutes" type="number" min="0" max="180" inputmode="numeric" placeholder="选填" /></div>
      </div>

      <div class="row">
        <div><label>星期</label><select v-model.number="draft.day"><option v-for="(day, index) in DAYS" :key="day" :value="index">{{ day }}</option></select></div>
        <div><label>开始</label><select v-model="draft.start"><option v-for="period in timeConfig.periods" :key="period.id" :value="period.id">{{ periodOption(period.id) }}</option></select></div>
        <div><label>结束</label><select v-model="draft.end"><option v-for="period in timeConfig.periods" :key="period.id" :value="period.id">{{ periodOption(period.id) }}</option></select></div>
      </div>

      <div class="row">
        <div><label>开始周</label><select v-model.number="draft.startWeek"><option v-for="week in MAX_WEEK" :key="week" :value="week">第{{ week }}周</option></select></div>
        <div><label>结束周</label><select v-model.number="draft.endWeek"><option v-for="week in MAX_WEEK" :key="week" :value="week">第{{ week }}周</option></select></div>
        <div><label>上课周类型</label><select v-model="draft.weekType"><option value="all">每周上</option><option value="odd">单周上</option><option value="even">双周上</option></select></div>
      </div>

      <div v-if="formCellCourses.length" class="cell-existing">
        <span class="ce-label">此格已有：</span>
        <span v-for="course in formCellCourses" :key="course.id" class="cell-chip" :class="{ clash: overlaps(course) }">{{ course.name }}（{{ weekLabel(course) }}）</span>
      </div>
      <p v-if="formCellClash" class="error">⚠️ 周次与「{{ formCellClash.name }}」重叠，请调整开始/结束周，否则两门课会叠在一起</p>

      <section v-if="editingId" class="course-links" aria-label="课程关联事项">
        <div class="course-links-head"><div><b>关联事项</b><small>删除课程只会解除关联，待办和重要日期会保留。</small></div><span v-if="linkedReviewProgress !== null" class="link-progress">复习 {{ linkedReviewProgress }}%</span></div>
        <div class="course-link-columns">
          <div><span class="link-label">待办 {{ linkedTasks.length }}</span><p v-if="!linkedTasks.length" class="link-empty">暂无关联待办</p><ul v-else class="link-list"><li v-for="task in linkedTasks.slice(0, 3)" :key="task.id"><span :class="{ done: taskStatus(task) === 'completed' }">{{ task.title }}</span><small>{{ taskStatus(task) === 'completed' ? '已完成' : (task.date || '未安排日期') }}</small></li></ul><div class="link-actions"><RouterLink class="link-action" to="/tasks">管理待办 →</RouterLink><button type="button" class="link-action" @click="emit('add-homework')">添加作业</button></div></div>
          <div><span class="link-label">学习类重要日期 {{ linkedCountdowns.length }}</span><p v-if="!linkedCountdowns.length" class="link-empty">暂无关联学习类重要日期</p><ul v-else class="link-list"><li v-for="item in linkedCountdowns.slice(0, 3)" :key="item.id"><span>{{ item.name }}</span><small>{{ item.date }} · 复习 {{ item.reviewProgress || 0 }}%</small></li></ul><RouterLink class="link-action" to="/exams">管理重要日期 →</RouterLink></div>
        </div>
      </section>

      <label>标记颜色</label>
      <div class="colors"><button v-for="color in PALETTE" :key="color" type="button" class="swatch" :style="{ background: color }" :class="{ picked: draft.color === color }" @click="draft.color = color"></button></div>
      <p v-if="error.message" class="error">{{ error.message }}</p>
      <div class="actions"><button v-if="editingId" class="btn btn-ghost" @click="emit('archive', editingCourse)">{{ isArchived(editingCourse) ? '恢复课程' : '归档课程' }}</button><button v-if="editingId" class="btn btn-danger" @click="requestDelete">删除课程</button><button class="btn btn-primary" @click="save">保存</button></div>
      <p v-if="editingId" class="cell-add-hint">同一格子可以放不同周次的课（如 1-6 周上 A、7-16 周上 B） <button class="btn btn-ghost" @click="emit('add-another')">＋ 在此格添加另一门课</button></p>
    </div>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 8px; }
.link-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.link-actions .link-action { padding: 0; color: var(--primary); font: inherit; background: transparent; border: 0; cursor: pointer; }
.form label { color: var(--muted); font-size: 13px; margin-top: 6px; }
.form input, .form select { width: 100%; }
.row { display: flex; gap: 10px; margin-top: 6px; }
.row > div { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.colors { display: flex; gap: 8px; margin: 4px 0; }
.swatch { width: 28px; height: 28px; border: 3px solid transparent; border-radius: 50%; }
.swatch.picked { border-color: var(--text); }
.error { color: var(--danger); font-size: 13px; }
.cell-existing { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 10px; background: var(--bg-tint); border-radius: 9px; }
.ce-label { color: var(--ink-faint); font-size: 11px; font-weight: 700; }
.cell-chip { padding: 3px 8px; color: var(--text); font-size: 12px; border: 1px solid var(--border); border-radius: 999px; background: #fff; }
.cell-chip.clash { color: var(--danger); border-color: var(--danger); background: #fff5f4; }
.course-links { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.course-links-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.course-links-head b { font-size: 13px; }
.course-links-head small { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; }
.course-link-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
.link-label { color: var(--ink-soft); font-size: 12px; font-weight: 700; }
.link-empty { margin-top: 6px; color: var(--muted); font-size: 12px; }
.link-list { display: flex; flex-direction: column; gap: 5px; margin: 7px 0; padding-left: 16px; font-size: 12px; }
.link-list li { display: flex; justify-content: space-between; gap: 8px; }
.link-list .done { text-decoration: line-through; opacity: .6; }
.link-list small { color: var(--muted); white-space: nowrap; }
.link-action { color: var(--primary); font-size: 11px; text-decoration: none; }
.link-progress { color: var(--primary); font-size: 11px; font-weight: 700; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 14px; }
.actions .btn-danger { margin-right: auto; }
.cell-add-hint { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; color: var(--ink-soft); font-size: 12px; }
@media (max-width: 560px) { .row, .course-link-columns { grid-template-columns: 1fr; flex-direction: column; } }
</style>
