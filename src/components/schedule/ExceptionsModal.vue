<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import { appToday } from '../../composables/timeContext.js'
import { useTabKeys } from '../../composables/tabKeys.js'
import { MAX_WEEK, weekOf } from '../../composables/store'

const props = defineProps({
  show: { type: Boolean, required: true },
  exceptions: { type: Array, required: true },
  days: { type: Array, required: true },
})

const emit = defineEmits(['close', 'submit', 'remove'])

const form = reactive({
  type: 'off',
  date: appToday.value,
  endDate: appToday.value,
  sourceWeek: 0,
  sourceDay: 0,
  note: '',
})
const error = ref('')
const errorField = ref('')
const dateInput = ref(null)
const endDateInput = ref(null)
const editingId = ref(null)

// 单一入口，保证 error 与 errorField 不会各自漂移
//（与 NotesView / LedgerView / EventsView 同一套约定）。
// field 非空表示这是字段校验错误：控件标 aria-invalid，并把焦点移回去。
// 此前「请选择日期 / 结束日期不能早于开始日期」只渲染在表单底部的 <p class="error">，
// 既不关联那两个日期输入框、也没有 role="alert"——读屏用户点保存后完全不知道哪里没过。
function setError(message, field = '') {
  error.value = message
  errorField.value = message ? field : ''
  if (!message || !field) return
  nextTick(() => (field === 'endDate' ? endDateInput.value : dateInput.value)?.focus())
}

const weekOptions = computed(() => Array.from({ length: MAX_WEEK }, (_, index) => index + 1))

/**
 * 当前生效的「安排类型」面板该由哪个 tab 命名。
 *
 * 写成 computed 而不是塞进模板里的三元表达式，有两个原因：
 * 1. 面板是同一个（`.exception-form`），两种类型共用，所以它的 `aria-labelledby`
 *    必须跟着选中的 tab 走；
 * 2. 模板里若写成 `form.type === 'off' ? 'exceptions-tab-off' : …`，
 *    静态悬空引用守卫会把表达式里的 `'off'` 也当成 id 去核对（它提取的是
 *    绑定表达式中的**所有**字符串字面量），从而报出一个假的悬空引用。
 *    挪到 computed 后模板只引用一个标识符，既没有误报，读起来也更清楚。
 */
const activeTypeTabId = computed(() => (form.type === 'off' ? 'exceptions-tab-off' : 'exceptions-tab-makeup'))

// 安排类型的键盘模型（←/→ 在「放假」「补课」之间切换，与点击共用同一个赋值路径）。
const { onKeydown: onTypeTabKeydown, tabIndexFor: typeTabIndex } = useTabKeys({
  keys: ['off', 'makeup'],
  active: () => form.type,
  select: (key) => {
    form.type = key
  },
})

function dayIndexOf(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 0
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
}

function weekTextFor(dateStr) {
  if (!dateStr) return ''
  const week = weekOf(dateStr)
  return week < 1 ? '开学前' : `第 ${week} 周`
}

const makeupPreview = computed(() => {
  if (form.type !== 'makeup') return ''
  const day = props.days[Number(form.sourceDay)] ?? '课'
  const week = form.sourceWeek > 0 ? `第 ${form.sourceWeek} 周` : weekTextFor(form.date)
  return `当天按 ${week} ${day} 的课程显示`
})

function resetForm() {
  const today = appToday.value
  editingId.value = null
  form.type = 'off'
  form.date = today
  form.endDate = today
  form.sourceWeek = 0
  form.sourceDay = dayIndexOf(today)
  form.note = ''
  setError('')
}

watch(() => props.show, (open) => {
  if (open) resetForm()
})

// 把已有条目回填到表单进入编辑态，避免录错一条只能删了重录。
function startEdit(item) {
  if (!item) return
  editingId.value = item.id
  form.type = item.type === 'makeup' ? 'makeup' : 'off'
  form.date = item.date || appToday.value
  form.endDate = item.endDate || form.date
  form.sourceWeek = Number.isFinite(Number(item.sourceWeek)) && Number(item.sourceWeek) > 0 ? Number(item.sourceWeek) : 0
  form.sourceDay = Number.isFinite(Number(item.sourceDay)) ? Number(item.sourceDay) : dayIndexOf(form.date)
  form.note = item.note || ''
  setError('')
}

function cancelEdit() {
  editingId.value = null
  resetForm()
}

function submit() {
  setError('')
  if (!form.date) {
    setError('请选择日期', 'date')
    return
  }
  const payload = { id: editingId.value || undefined, note: form.note.trim() }
  if (form.type === 'off') {
    if (!form.endDate) {
      setError('请选择结束日期', 'endDate')
      return
    }
    if (form.endDate < form.date) {
      setError('结束日期不能早于开始日期', 'endDate')
      return
    }
    Object.assign(payload, {
      date: form.date,
      endDate: form.endDate === form.date ? null : form.endDate,
      type: 'off',
    })
  } else {
    Object.assign(payload, {
      date: form.date,
      type: 'makeup',
      sourceDay: Number(form.sourceDay),
      sourceWeek: form.sourceWeek > 0 ? Number(form.sourceWeek) : null,
    })
  }
  emit('submit', payload)
  editingId.value = null
  form.note = ''
}

function dateText(item) {
  if (!item) return ''
  if (item.endDate && item.endDate !== item.date) return `${item.date} ~ ${item.endDate}`
  return item.date
}

function exceptionBadge(item) {
  if (!item) return ''
  return item.type === 'makeup' ? '补课' : '放假'
}

function exceptionDetail(item) {
  if (!item) return ''
  if (item.type === 'makeup') {
    const day = props.days[item.sourceDay] ?? '课'
    const week = item.sourceWeek ? `第 ${item.sourceWeek} 周 ` : ''
    return `当天按${week}${day}课表显示`
  }
  return item.endDate && item.endDate !== item.date ? `开始 ${item.date} · 结束 ${item.endDate}` : `${item.date} 全天停课`
}
</script>

<template>
  <Modal v-if="show" :open="show" title="🗓 节假日与补课" wide @close="emit('close')">
    <div class="exception-editor">
      <p class="muted-tip">放假可以设置一段日期范围；补课可以选择某一天按指定周次、星期的课程显示。特殊日期只影响当天，不会改动原来的每周课程。</p>

      <div class="type-tabs" role="tablist" aria-label="安排类型" @keydown="onTypeTabKeydown">
        <button id="exceptions-tab-off" type="button" role="tab" :tabindex="typeTabIndex('off')" :aria-selected="form.type === 'off'" :class="{ on: form.type === 'off' }" @click="form.type = 'off'">📴 放假 / 停课</button>
        <button id="exceptions-tab-makeup" type="button" role="tab" :tabindex="typeTabIndex('makeup')" :aria-selected="form.type === 'makeup'" :class="{ on: form.type === 'makeup' }" @click="form.type = 'makeup'">🔁 补课</button>
      </div>

      <div class="exception-form" role="tabpanel" :aria-labelledby="activeTypeTabId">
        <template v-if="form.type === 'off'">
          <label>开始日期<input ref="dateInput" v-model="form.date" type="date" :aria-invalid="errorField === 'date' || undefined" :aria-describedby="error ? 'exception-form-error' : undefined" @input="setError('')" /></label>
          <label>结束日期<input ref="endDateInput" v-model="form.endDate" type="date" :min="form.date" :aria-invalid="errorField === 'endDate' || undefined" :aria-describedby="error ? 'exception-form-error' : undefined" @input="setError('')" /></label>
        </template>

        <template v-else>
          <label>补课日期<input ref="dateInput" v-model="form.date" type="date" :aria-invalid="errorField === 'date' || undefined" :aria-describedby="error ? 'exception-form-error' : undefined" @input="setError('')" /></label>
          <label>第几周
            <select v-model.number="form.sourceWeek" @change="setError('')">
              <option :value="0">跟随当天（{{ weekTextFor(form.date) }}）</option>
              <option v-for="week in weekOptions" :key="week" :value="week">第 {{ week }} 周</option>
            </select>
          </label>
          <label>周几课表
            <select v-model.number="form.sourceDay">
              <option v-for="(day, index) in days" :key="day" :value="index">{{ day }}</option>
            </select>
          </label>
        </template>
      </div>

      <p v-if="form.type === 'makeup'" class="makeup-preview">💡 {{ makeupPreview }}</p>

      <label class="exception-note">说明<input v-model="form.note" placeholder="例如：国庆放假、周六补周一课程" /></label>

      <p v-if="error" id="exception-form-error" class="error" role="alert">{{ error }}</p>

      <div class="save-row">
        <button v-if="editingId" class="btn btn-ghost" type="button" @click="cancelEdit">取消</button>
        <button class="btn btn-primary" @click="submit">{{ editingId ? '保存修改' : '保存特殊日期' }}</button>
      </div>

      <div class="divider" />

      <template v-if="exceptions.length">
        <div class="exception-list">
          <div v-for="item in exceptions" :key="item.id" class="exception-item" :class="{ editing: editingId === item.id }">
            <div>
              <b>{{ dateText(item) }}</b>
              <span :class="item.type">{{ exceptionBadge(item) }}</span>
              <small>{{ item.note || exceptionDetail(item) }}</small>
            </div>
            <div class="exception-actions">
              <button class="btn btn-sm btn-ghost" type="button" @click="startEdit(item)">编辑</button>
              <button class="btn btn-sm btn-danger" type="button" @click="emit('remove', item.id)">删除</button>
            </div>
          </div>
        </div>
      </template>
      <p v-else class="manager-empty">还没有设置特殊日期。</p>
    </div>
  </Modal>
</template>

<style scoped>
.exception-editor { display: flex; flex-direction: column; gap: 13px; }
.muted-tip {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-12);
  line-height: 1.6;
}
.type-tabs { display: flex; gap: 8px; }
.type-tabs button {
  flex: 1;
  padding: 9px 12px;
  color: var(--muted);
  font-size: var(--fs-13);
  font-weight: var(--fw-700);
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--card);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard);
}
.type-tabs button.on {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft);
}
.exception-form {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: end;
  gap: 10px;
}
.exception-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--muted);
  font-size: var(--fs-11);
}
.exception-form input, .exception-form select { width: 100%; }
.exception-note { grid-column: 1 / -1; }
.exception-note input { margin-top: 0; }
.makeup-preview { margin: -4px 0 0; color: var(--primary); font-size: var(--fs-12); }
.error { margin: 0; color: var(--danger); font-size: var(--fs-12); }
.save-row { display: flex; justify-content: flex-end; }
.divider { height: 1px; background: var(--border); }
.exception-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 310px;
  overflow-y: auto;
}
.exception-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-10);
  background: var(--card);
}
.exception-item>div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}
.exception-item b { font-size: var(--fs-12); }
.exception-item span {
  padding: 3px 6px;
  color: #b13f3f;
  font-size: var(--fs-9);
  font-weight: var(--fw-800);
  border-radius: var(--radius-5);
  background: #feecec;
}
.exception-item span.makeup { color: #6b3fd4; background: #f1ebff; }
.exception-item small { width: 100%; color: var(--muted); font-size: var(--fs-10); }
.exception-item.editing { border-color: var(--primary); background: var(--primary-soft); }
.exception-actions { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.manager-empty { margin: 0; color: var(--muted); font-size: var(--fs-13); text-align: center; padding: 10px 0; }

@media (max-width: 760px) {
  .exception-form { grid-template-columns: 1fr 1fr; }
  .exception-note { grid-column: 1 / -1; }
}

@media (max-width: 520px) {
  .exception-form { grid-template-columns: 1fr; }
  .type-tabs { flex-direction: column; }
}
</style>