<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
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

// 标记颜色的色块按钮把「颜色」完全交给 background 表达，元素里一个字都没有。
// 读屏用户听到的是一串无名按钮，只能靠试。这里给 PALETTE 里的每个色值配一个
// 中文名，让色块能被念出来；值不在表里时回退成原始色值，至少不是空的。
// 不复用 theme.js 的 THEMES：那是主题色（绿是 #0ea271），与课程标记色不是同一套。
const COLOR_NAMES = {
  '#456fe8': '蓝色',
  '#10b981': '绿色',
  '#f59e0b': '琥珀色',
  '#ef4444': '红色',
  '#8b5cf6': '紫色',
  '#ec4899': '粉色',
  '#14b8a6': '青色',
  '#f97316': '橙色',
}
const colorName = (hex) => COLOR_NAMES[hex] || hex
const draft = reactive({})
const error = reactive({ message: '', field: '' })
const nameInput = ref(null)

// 单一入口，保证 error.message 与 error.field 不会各自漂移
//（与 NotesView / LedgerView / EventsView 同一套约定）。
// field 非空表示这是字段校验错误：控件标 aria-invalid，并把焦点移回去。
// 补这套的原因是：此前「请填写课程名称」只渲染在表单最底部的 <p class="error">，
// 既不关联到 #course-name、也没有 role="alert"——读屏用户点保存后什么都听不到。
function setError(message, field = '') {
  error.message = message
  error.field = message ? field : ''
  if (message && field === 'name') nextTick(() => nameInput.value?.focus())
}

function syncDraft() {
  Object.assign(draft, JSON.parse(JSON.stringify(props.form)))
  setError('')
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
    setError('请填写课程名称', 'name')
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
      <label for="course-name">课程名称 *</label>
      <input
          id="course-name"
          ref="nameInput"
          v-model="draft.name"
          :aria-invalid="error.field === 'name' || undefined"
          :aria-describedby="error.message ? 'course-editor-error' : undefined"
          placeholder="例如：高等数学"
        />

      <label for="course-teacher">任课老师</label>
      <input id="course-teacher" v-model="draft.teacher" placeholder="选填" />

      <label for="course-room">上课地点</label>
      <input id="course-room" v-model="draft.room" placeholder="例如：教学楼 A201" />

      <div class="row">
        <div><label for="course-campus">校区</label><select id="course-campus" v-model="draft.campusId"><option value="">跟随当前校区</option><option v-for="campus in timeConfig.campuses" :key="campus.id" :value="campus.id">{{ campus.name }}</option></select></div>
        <div><label for="course-travel-minutes">提前出发（分钟）</label><input id="course-travel-minutes" v-model.number="draft.travelMinutes" type="number" min="0" max="180" inputmode="numeric" placeholder="选填" /></div>
      </div>

      <div class="row">
        <div><label for="course-day">星期</label><select id="course-day" v-model.number="draft.day"><option v-for="(day, index) in DAYS" :key="day" :value="index">{{ day }}</option></select></div>
        <div><label for="course-start">开始</label><select id="course-start" v-model="draft.start"><option v-for="period in timeConfig.periods" :key="period.id" :value="period.id">{{ periodOption(period.id) }}</option></select></div>
        <div><label for="course-end">结束</label><select id="course-end" v-model="draft.end"><option v-for="period in timeConfig.periods" :key="period.id" :value="period.id">{{ periodOption(period.id) }}</option></select></div>
      </div>

      <div class="row">
        <div><label for="course-start-week">开始周</label><select id="course-start-week" v-model.number="draft.startWeek" :aria-describedby="formCellClash ? 'course-week-clash' : undefined"><option v-for="week in MAX_WEEK" :key="week" :value="week">第{{ week }}周</option></select></div>
        <div><label for="course-end-week">结束周</label><select id="course-end-week" v-model.number="draft.endWeek" :aria-describedby="formCellClash ? 'course-week-clash' : undefined"><option v-for="week in MAX_WEEK" :key="week" :value="week">第{{ week }}周</option></select></div>
        <div><label for="course-week-type">上课周类型</label><select id="course-week-type" v-model="draft.weekType"><option value="all">每周上</option><option value="odd">单周上</option><option value="even">双周上</option></select></div>
      </div>

      <div v-if="formCellCourses.length" class="cell-existing">
        <span class="ce-label">此格已有：</span>
        <span v-for="course in formCellCourses" :key="course.id" class="cell-chip" :class="{ clash: overlaps(course) }">{{ course.name }}（{{ weekLabel(course) }}）</span>
      </div>
      <!-- 周次冲突是随着开始/结束周的选择实时出现的，用 role="alert" 让它一出现就被念出来，
             并让两个周次下拉框通过 aria-describedby 指向它——否则读屏用户只看到两个「正常」的下拉框。 -->
      <p v-if="formCellClash" id="course-week-clash" class="error" role="alert">⚠️ 周次与「{{ formCellClash.name }}」重叠，请调整开始/结束周，否则两门课会叠在一起</p>

      <section v-if="editingId" class="course-links" aria-label="课程关联事项">
        <div class="course-links-head"><div><b>关联事项</b><small>删除课程只会解除关联，待办和重要日期会保留。</small></div><span v-if="linkedReviewProgress !== null" class="link-progress">复习 {{ linkedReviewProgress }}%</span></div>
        <div class="course-link-columns">
          <div><span class="link-label">待办 {{ linkedTasks.length }}</span><p v-if="!linkedTasks.length" class="link-empty">暂无关联待办</p><ul v-else class="link-list"><li v-for="task in linkedTasks.slice(0, 3)" :key="task.id"><span :class="{ done: taskStatus(task) === 'completed' }">{{ task.title }}</span><small>{{ taskStatus(task) === 'completed' ? '已完成' : (task.date || '未安排日期') }}</small></li></ul><div class="link-actions"><RouterLink class="link-action" to="/tasks">管理待办 →</RouterLink><button type="button" class="link-action" @click="emit('add-homework')">添加作业</button></div></div>
          <div><span class="link-label">学习类重要日期 {{ linkedCountdowns.length }}</span><p v-if="!linkedCountdowns.length" class="link-empty">暂无关联学习类重要日期</p><ul v-else class="link-list"><li v-for="item in linkedCountdowns.slice(0, 3)" :key="item.id"><span>{{ item.name }}</span><small>{{ item.date }} · 复习 {{ item.reviewProgress || 0 }}%</small></li></ul><RouterLink class="link-action" to="/exams">管理重要日期 →</RouterLink></div>
        </div>
      </section>

      <label>标记颜色</label>
      <div class="colors"><button v-for="color in PALETTE" :key="color" type="button" class="swatch" :style="{ background: color }" :class="{ picked: draft.color === color }" :aria-label="`标记颜色 ${colorName(color)}`" :aria-pressed="draft.color === color" @click="draft.color = color"></button></div>
      <p v-if="error.message" id="course-editor-error" class="error" role="alert">{{ error.message }}</p>
      <div class="actions"><button v-if="editingId" class="btn btn-ghost" @click="emit('archive', editingCourse)">{{ isArchived(editingCourse) ? '恢复课程' : '归档课程' }}</button><button v-if="editingId" class="btn btn-danger" @click="requestDelete">删除课程</button><button class="btn btn-primary" @click="save">保存</button></div>
      <p v-if="editingId" class="cell-add-hint">同一格子可以放不同周次的课（如 1-6 周上 A、7-16 周上 B） <button class="btn btn-ghost" @click="emit('add-another')">＋ 在此格添加另一门课</button></p>
    </div>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 8px; }
.link-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.link-actions .link-action { padding: 0; color: var(--primary); font: inherit; background: transparent; border: 0; cursor: pointer; }
.form label { color: var(--muted); font-size: var(--fs-13); margin-top: 6px; }
.form input, .form select { width: 100%; }
.row { display: flex; gap: 10px; margin-top: 6px; }
.row > div { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.colors { display: flex; gap: 8px; margin: 4px 0; }
.swatch { width: 28px; height: 28px; border: 3px solid transparent; border-radius: var(--radius-circle); }
.swatch.picked { border-color: var(--text); }
.error { color: var(--danger); font-size: var(--fs-13); }
.cell-existing { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 10px; background: var(--bg-tint); border-radius: var(--radius-9); }
.ce-label { color: var(--ink-faint); font-size: var(--fs-11); font-weight: var(--fw-700); }
.cell-chip { padding: 3px 8px; color: var(--text); font-size: var(--fs-12); border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--card); }
.cell-chip.clash { color: var(--danger); border-color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--card)); }
.course-links { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.course-links-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.course-links-head b { font-size: var(--fs-13); }
.course-links-head small { display: block; margin-top: 3px; color: var(--muted); font-size: var(--fs-11); }
.course-link-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
.link-label { color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); }
.link-empty { margin-top: 6px; color: var(--muted); font-size: var(--fs-12); }
.link-list { display: flex; flex-direction: column; gap: 5px; margin: 7px 0; padding-left: 16px; font-size: var(--fs-12); }
.link-list li { display: flex; justify-content: space-between; gap: 8px; }
.link-list .done { text-decoration: line-through; opacity: .6; }
.link-list small { color: var(--muted); white-space: nowrap; }
.link-action { color: var(--primary); font-size: var(--fs-11); text-decoration: none; }
.link-progress { color: var(--primary); font-size: var(--fs-11); font-weight: var(--fw-700); }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 14px; }
.actions .btn-danger { margin-right: auto; }
.cell-add-hint { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; color: var(--ink-soft); font-size: var(--fs-12); }
@media (max-width: 520px) { .row, .course-link-columns { grid-template-columns: 1fr; flex-direction: column; } }
</style>
