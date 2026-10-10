<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import { appToday } from '../../composables/timeContext.js'
import { useTabKeys } from '../../composables/tabKeys.js'
import { animationsEnabled } from '../../composables/motion.js'
import { MAX_WEEK } from '../../composables/store/utils.js'
import { autoSeasonIdFor, currentCampusId, currentSeasonId, periodIndex, periodLabelById, timeConfig } from '../../composables/store/timeConfig.js'
import {
  courseInWeek, coursesForDate, exceptionAppliesOn, isScheduleDate, isSessionException,
  scheduleExceptionForDate, scheduleExceptionReplacementIndex, sessionExceptionCourseIds,
  validateScheduleException, weekLabel, weekOf,
} from '../../composables/store/schedule.js'

const props = defineProps({
  show: { type: Boolean, required: true },
  exceptions: { type: Array, required: true },
  days: { type: Array, required: true },
  allCourses: { type: Array, default: () => [] },
  initialDate: { type: String, default: '' },
  initialExceptionId: { type: [String, Number], default: '' },
})
const emit = defineEmits(['close', 'submit', 'remove'])

/** @typedef {{ courseId: string, start: string, end: string }} CourseSlot */
/** @type {{ type: string, date: string, endDate: string, sourceWeek: number, sourceDay: number, note: string, courseIds: string[], courseSlots: CourseSlot[] }} */
const form = reactive({ type: 'off', date: '', endDate: '', sourceWeek: 0, sourceDay: 0, note: '', courseIds: [], courseSlots: [] })
const editingId = ref(null)
const error = ref('')
const errorField = ref('')
const errorCourseId = ref('')
const savedMessage = ref('')
const search = ref('')
const listFilter = ref('all')
const dateInput = ref(null)
const endDateInput = ref(null)
const sourceWeekInput = ref(null)
const sourceDayInput = ref(null)
const coursePicker = ref(null)
const slotPicker = ref(null)
const editor = ref(null)
const removedItem = ref(null)
const removeError = ref('')

const TYPE_TABS = Object.freeze([
  { id: 'off', label: '放假 / 停课', hint: '暂停一天或连续几天的常规课程，开始与结束日期都包含在内。' },
  { id: 'makeup', label: '整天调课', hint: '当天整张课表改用指定周次、星期的课程，适合周末补上某天的课。' },
  { id: 'session_off', label: '部分停课', hint: '选择当天要停的课程，可选多门；当天其他课程照常。' },
  { id: 'session_makeup', label: '部分补课', hint: '先选补课日期和课程，再为每门课设置开始、结束节次；当天其他课程照常。' },
])
const typeLabel = (type) => TYPE_TABS.find((tab) => tab.id === type)?.label || '放假 / 停课'
const typeHint = computed(() => TYPE_TABS.find((tab) => tab.id === form.type)?.hint || '')
const dateFieldLabel = computed(() => ({ off: '开始日期', makeup: '调课日期', session_off: '停课日期', session_makeup: '补课日期' })[form.type])
const isSessionType = computed(() => isSessionException(form))
const activeTypeTabId = computed(() => `exceptions-tab-${form.type}`)
const weekOptions = Array.from({ length: MAX_WEEK }, (_, index) => index + 1)
const dateErrorId = computed(() => errorField.value === 'date' ? 'exception-form-error' : undefined)
const endDateErrorId = computed(() => errorField.value === 'endDate' ? 'exception-form-error' : undefined)
const weekErrorId = computed(() => errorField.value === 'sourceWeek' ? 'exception-form-error' : undefined)
const dayErrorId = computed(() => errorField.value === 'sourceDay' ? 'exception-form-error' : undefined)
const courseErrorId = computed(() => errorField.value === 'courseIds' ? 'exception-form-error' : undefined)
const slotErrorId = computed(() => errorField.value === 'courseSlots' ? 'exception-form-error' : undefined)
const periods = computed(() => timeConfig.value.periods)

function setError(message = '', field = '', courseId = '') {
  error.value = message
  errorField.value = message ? field : ''
  errorCourseId.value = message ? courseId : ''
  if (!message || !field) return
  nextTick(() => {
    if (field === 'courseIds') {
      const target = coursePicker.value?.querySelector('input[type="checkbox"]') || coursePicker.value
      target?.focus()
      return
    }
    if (field === 'courseSlots') {
      const rows = Array.from(slotPicker.value?.querySelectorAll('[data-course-id]') || [])
      const row = rows.find((element) => element.dataset.courseId === courseId) || rows[0]
      const target = row?.querySelector('select[aria-invalid="true"]') || row?.querySelector('select') || slotPicker.value
      target?.focus()
      return
    }
    const target = { date: dateInput, endDate: endDateInput, sourceWeek: sourceWeekInput, sourceDay: sourceDayInput }[field]
    target?.value?.focus()
  })
}

function clearFeedback() {
  setError()
  savedMessage.value = ''
}

function selectType(type) {
  if (form.type === type) return
  form.type = type
  form.courseIds = []
  form.courseSlots = []
  search.value = ''
  if (type === 'off' && (!form.endDate || form.endDate < form.date)) form.endDate = form.date
  clearFeedback()
}
const { onKeydown: onTypeTabKeydown, tabIndexFor: typeTabIndex } = useTabKeys({
  keys: TYPE_TABS.map((tab) => tab.id), active: () => form.type, select: selectType,
})

function dayIndexOf(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return Number.isNaN(day) ? 0 : day === 0 ? 6 : day - 1
}
function weekTextFor(date) {
  if (!isScheduleDate(date)) return '请选择日期'
  const week = weekOf(date)
  return week < 1 ? '开学前' : week > MAX_WEEK ? `第 ${week} 周（学期范围外）` : `第 ${week} 周`
}
const dateHint = computed(() => isScheduleDate(form.date) ? `${props.days[dayIndexOf(form.date)]} · ${weekTextFor(form.date)}` : '')

function resetForm() {
  const date = isScheduleDate(props.initialDate) ? props.initialDate : appToday.value
  editingId.value = null
  Object.assign(form, { type: 'off', date, endDate: date, sourceWeek: 0, sourceDay: dayIndexOf(date), note: '', courseIds: [], courseSlots: [] })
  search.value = ''
  clearFeedback()
}
watch(() => props.show, (open) => {
  if (open) {
    resetForm()
    removedItem.value = null
    removeError.value = ''
    nextTick(() => {
      const item = props.exceptions.find((entry) => entry.id === props.initialExceptionId)
      if (props.show && item) startEdit(item)
    })
  }
}, { immediate: true })
watch(() => form.date, (date, previous) => {
  if (form.type === 'off' && (form.endDate === previous || form.endDate < date)) form.endDate = date
})
function onDateInput() {
  if (isSessionType.value) { form.courseIds = []; form.courseSlots = [] }
  clearFeedback()
}

/** @typedef {{ id: string | number, name: string, day: number, start?: string, end?: string, room?: string, startWeek?: number, endWeek?: number, weekType?: string }} PickerCourse */
const allCourseList = computed(() => /** @type {PickerCourse[]} */ (props.allCourses).filter((course) => course && course.id != null))
// 编辑停课时先排除原记录，原来被停掉的课才能重新进入选择列表。
const otherExceptions = computed(() => props.exceptions.filter((item) => item && item.id !== editingId.value))
const dateCourses = computed(() => coursesForDate(allCourseList.value, form.date, otherExceptions.value))
const selectableCourses = computed(() => {
  if (form.type === 'session_off') return dateCourses.value
  const onDate = new Set(dateCourses.value.map((course) => String(course.id)))
  const { hidden } = sessionExceptionCourseIds(form.date, otherExceptions.value)
  return allCourseList.value.filter((course) => !onDate.has(String(course.id)) && !hidden.has(String(course.id)))
})
const filteredCourses = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return selectableCourses.value.filter((course) => !query || `${course.name} ${course.room || ''} ${props.days[course.day] || ''}`.toLocaleLowerCase().includes(query))
    .slice().sort((left, right) => left.day - right.day || periodIndex(left.start) - periodIndex(right.start))
})
function courseNameOf(id) {
  return allCourseList.value.find((course) => String(course.id) === String(id))?.name || '已删除或已归档的课程'
}
function courseLabel(course) {
  const start = course.start ? periodLabelById(course.start) : ''
  const end = course.end ? periodLabelById(course.end) : ''
  const periods = start === end ? start : [start, end].filter(Boolean).join('至')
  return [props.days[course.day], periods, weekLabel(course), course.room].filter(Boolean).join(' · ')
}
function defaultSlot(id) {
  const course = allCourseList.value.find((item) => String(item.id) === id)
  return { courseId: id, start: course?.start || '', end: course?.end || '' }
}
function timesForDate(date) {
  const cfg = timeConfig.value
  const campus = currentCampusId()
  const season = cfg.autoSeason && isScheduleDate(date)
    ? autoSeasonIdFor(campus, cfg, new Date(`${date}T12:00:00`)) || currentSeasonId() : currentSeasonId()
  return cfg.times?.[season]?.[campus] || []
}
const selectedDateTimes = computed(() => timesForDate(form.date))
function periodOption(period) {
  const time = selectedDateTimes.value[periodIndex(period.id)]
  return time?.start && time?.end ? `${period.label}（${time.start}–${time.end}）` : `${period.label}（时间未设置）`
}
function slotLabel(slot, date = form.date) {
  if (!slot || periodIndex(slot.start) < 0 || periodIndex(slot.end) < 0) return '请设置补课节次'
  const start = periodLabelById(slot.start)
  const end = periodLabelById(slot.end)
  const label = slot.start === slot.end ? start : `${start}至${end}`
  const times = date === form.date ? selectedDateTimes.value : timesForDate(date)
  const startTime = times[periodIndex(slot.start)]?.start
  const endTime = times[periodIndex(slot.end)]?.end
  return startTime && endTime ? `${label}（${startTime}–${endTime}）` : `${label}（时间未设置）`
}
function setSlotStart(slot, start) {
  const duration = Math.max(0, periodIndex(slot.end) - periodIndex(slot.start))
  slot.start = start
  slot.end = periods.value[Math.min(periods.value.length - 1, periodIndex(start) + duration)]?.id || ''
  clearFeedback()
}
function slotInvalid(slot) {
  return errorField.value === 'courseSlots' && (!errorCourseId.value || errorCourseId.value === slot.courseId)
}
function toggleCourse(id) {
  const key = String(id)
  const index = form.courseIds.indexOf(key)
  if (index >= 0) {
    form.courseIds.splice(index, 1)
    form.courseSlots = form.courseSlots.filter((slot) => slot.courseId !== key)
  } else {
    form.courseIds.push(key)
    if (form.type === 'session_makeup') form.courseSlots.push(defaultSlot(key))
  }
  clearFeedback()
}
function selectVisibleCourses() {
  if (form.type === 'session_makeup') {
    for (const course of filteredCourses.value) {
      const key = String(course.id)
      if (!form.courseIds.includes(key)) form.courseSlots.push(defaultSlot(key))
    }
  }
  form.courseIds = [...new Set([...form.courseIds, ...filteredCourses.value.map((course) => String(course.id))])]
  clearFeedback()
}
function clearSelection() {
  form.courseIds = []
  form.courseSlots = []
  clearFeedback()
}

const payload = computed(() => ({
  id: editingId.value || undefined, date: form.date, type: form.type, note: form.note.trim(),
  ...(form.type === 'off' ? { endDate: form.endDate === form.date ? null : form.endDate } : {}),
  ...(form.type === 'makeup' ? { sourceWeek: form.sourceWeek || null, sourceDay: form.sourceDay } : {}),
  ...(isSessionType.value ? { courseIds: [...form.courseIds] } : {}),
  ...(form.type === 'session_makeup' ? { courseSlots: form.courseIds.map((id) => {
    const slot = form.courseSlots.find((entry) => entry.courseId === id)
    return { courseId: id, start: slot?.start || '', end: slot?.end || '' }
  }) } : {}),
}))
const replacementIndex = computed(() => scheduleExceptionReplacementIndex({ ...payload.value, id: undefined }, otherExceptions.value))
const previewCourses = computed(() => {
  if (validateScheduleException(payload.value)) return []
  const records = otherExceptions.value.filter((_, index) => index !== replacementIndex.value)
  return coursesForDate(allCourseList.value, form.date, [...records, { ...payload.value, id: 'draft', updatedAt: new Date().toISOString() }])
})
const offDays = computed(() => isScheduleDate(form.date) && isScheduleDate(form.endDate) && form.endDate >= form.date
  ? Math.round((Date.parse(`${form.endDate}T00:00:00Z`) - Date.parse(`${form.date}T00:00:00Z`)) / 86400000) + 1 : 0)
const makeupSourceCourses = computed(() => allCourseList.value.filter((course) => course.day === form.sourceDay
  && courseInWeek(course, form.sourceWeek || weekOf(form.date))))
const previewText = computed(() => {
  if (form.type === 'off') return offDays.value ? `共 ${offDays.value} 天，暂停常规课程。每周课表保留。` : '请选择放假 / 停课的日期范围。'
  if (form.type === 'makeup') {
    const week = form.sourceWeek > 0 ? `第 ${form.sourceWeek} 周` : weekTextFor(form.date)
    return `${form.date || '所选日期'} 按${week}${props.days[form.sourceDay] || ''}课表上课，保存后当天共 ${previewCourses.value.length} 门课。`
  }
  if (!form.courseIds.length) return '选择课程后，可在这里查看实际生效的安排。'
  if (form.type === 'session_makeup') {
    const details = form.courseSlots.map((slot) => `${courseNameOf(slot.courseId)} · ${slotLabel(slot)}`).join('；')
    return `${form.date} 补课：${details}。保存后当天共 ${previewCourses.value.length} 门课。`
  }
  return `停课：${form.courseIds.map(courseNameOf).join('、')}。保存后当天共 ${previewCourses.value.length} 门课。`
})
const previewWarnings = computed(() => {
  const warnings = []
  if (!editingId.value && replacementIndex.value >= 0) warnings.push(`已有同日的“${typeLabel(otherExceptions.value[replacementIndex.value].type)}”安排，保存将替换它。`)
  const dayException = scheduleExceptionForDate(form.date, otherExceptions.value)
  if (form.type === 'makeup' && dayException?.type === 'off' && dayException.endDate > dayException.date) warnings.push('这一天位于放假范围内，整天调课将优先执行，其余假期日期保留。')
  if (form.type === 'session_makeup' && dayException?.type === 'off') warnings.push('当天已设置放假 / 停课，选中的课程仍按指定节次补上。')
  if (form.type === 'off' && offDays.value) {
    const overrides = otherExceptions.value.filter((item) => (item.type === 'makeup' || item.type === 'session_makeup')
      && item.date >= form.date && item.date <= form.endDate && item !== otherExceptions.value[replacementIndex.value])
    if (overrides.length) warnings.push(`范围内另有 ${overrides.length} 条调课或补课安排，这些安排仍会生效。`)
  }
  if (form.type === 'makeup') {
    if (!makeupSourceCourses.value.length) warnings.push('所选周次与星期没有常规课程，请检查课表周次和单双周设置。')
    if (otherExceptions.value.some((item) => isSessionException(item) && exceptionAppliesOn(item, form.date))) warnings.push('当天已保存的部分停课或补课安排继续生效，预览已包含这些安排。')
  }
  const result = previewCourses.value
  let conflicts = 0
  for (let i = 0; i < result.length; i++) {
    const leftStart = periodIndex(result[i].start)
    const leftEnd = periodIndex(result[i].end)
    if (leftStart < 0 || leftEnd < 0) continue
    for (let j = i + 1; j < result.length; j++) {
      const rightStart = periodIndex(result[j].start)
      const rightEnd = periodIndex(result[j].end)
      if (rightStart >= 0 && rightEnd >= 0 && leftStart <= rightEnd && rightStart <= leftEnd) conflicts++
    }
  }
  if (form.type !== 'off' && conflicts) warnings.push(`保存后当天有 ${conflicts} 组课程节次重叠，请核对补课时间。`)
  return warnings
})

function startEdit(item) {
  editingId.value = item.id
  const date = item.date || appToday.value
  Object.assign(form, { type: TYPE_TABS.some((tab) => tab.id === item.type) ? item.type : 'off', date, endDate: item.endDate || date,
    sourceWeek: Number(item.sourceWeek) || 0, sourceDay: item.sourceDay == null ? dayIndexOf(date) : Number(item.sourceDay),
    note: item.note || '', courseIds: Array.isArray(item.courseIds) ? item.courseIds.map(String) : [] })
  form.courseSlots = form.type === 'session_makeup' ? form.courseIds.map((id) => {
    if (item.courseSlots == null) return defaultSlot(id)
    const slot = Array.isArray(item.courseSlots) ? item.courseSlots.find((entry) => String(entry?.courseId) === id) : null
    return { courseId: id, start: slot?.start || '', end: slot?.end || '' }
  }) : []
  search.value = ''
  clearFeedback()
  nextTick(() => {
    editor.value?.scrollIntoView?.({ block: 'nearest', behavior: animationsEnabled() ? 'smooth' : 'auto' })
    dateInput.value?.focus({ preventScroll: true })
  })
}
function removeItem(item) {
  if (editingId.value === item.id) resetForm()
  removedItem.value = { ...item, courseIds: item.courseIds ? [...item.courseIds] : null,
    courseSlots: Array.isArray(item.courseSlots) ? item.courseSlots.map((slot) => ({ ...slot })) : item.courseSlots }
  removeError.value = ''
  emit('remove', item.id)
}
function undoRemove() {
  const item = removedItem.value
  if (!item) return
  if (!isSessionException(item) && scheduleExceptionReplacementIndex({ ...item, id: undefined }, props.exceptions) >= 0) {
    removeError.value = '该日期已有新安排，请先检查，避免覆盖。'
    return
  }
  emit('submit', item)
  removedItem.value = null
  removeError.value = ''
}
function submit() {
  clearFeedback()
  if (form.type === 'off' && !form.endDate) { setError('请选择结束日期', 'endDate'); return }
  const problem = validateScheduleException(payload.value)
  if (problem) { setError(problem.message, problem.field, problem.courseId); return }
  if (form.type === 'makeup' && !form.sourceWeek && (weekOf(form.date) < 1 || weekOf(form.date) > MAX_WEEK)) {
    setError('该日期在学期范围外，请指定要采用的课表周次', 'sourceWeek'); return
  }
  if (editingId.value && replacementIndex.value >= 0 && !isSessionType.value) {
    setError('目标日期已有整天安排，请编辑该安排或选择其他日期', 'date'); return
  }
  if (isSessionType.value) {
    const allowed = new Set(selectableCourses.value.map((course) => String(course.id)))
    if (form.courseIds.some((id) => !allowed.has(id))) {
      setError('部分课程已删除、已安排上课或停课，请重新选择可用课程', 'courseIds'); return
    }
  }
  const wasEditing = Boolean(editingId.value)
  emit('submit', payload.value)
  editingId.value = null
  form.note = ''
  form.courseIds = []
  form.courseSlots = []
  search.value = ''
  savedMessage.value = wasEditing ? '已保存修改，课程表已更新。' : '已添加课程调整，课程表已更新。'
}

const filteredExceptions = computed(() => props.exceptions.filter((item) => {
  const endDate = item.endDate || item.date
  return listFilter.value === 'all' || (listFilter.value === 'upcoming' ? endDate >= appToday.value : endDate < appToday.value)
}))
function dateText(item) {
  return item.endDate && item.endDate !== item.date ? `${item.date} 至 ${item.endDate}` : `${item.date} ${props.days[dayIndexOf(item.date)] || ''}`
}
function exceptionDetail(item) {
  if (isSessionException(item)) {
    const names = (Array.isArray(item.courseIds) ? item.courseIds : []).map(courseNameOf).join('、') || '未选择课程'
    if (item.type === 'session_off') return `停课：${names}，其他课程照常`
    const details = (Array.isArray(item.courseIds) ? item.courseIds : []).map((id) => {
      const slot = item.courseSlots == null ? defaultSlot(String(id))
        : Array.isArray(item.courseSlots) ? item.courseSlots.find((entry) => String(entry?.courseId) === String(id)) : null
      return `${courseNameOf(id)} · ${slotLabel(slot, item.date)}`
    }).join('；') || '未选择课程'
    return `补课：${details}${item.courseSlots == null ? ' · 沿用原节次' : ''}`
  }
  if (item.type === 'makeup') return `按${item.sourceWeek ? `第 ${item.sourceWeek} 周` : weekTextFor(item.date)}${props.days[item.sourceDay] || ''}课表上课`
  return '暂停常规课程；已设置的单日调课与部分补课仍生效'
}
</script>

<template>
  <Modal v-if="show" :open="show" title="🗓 课程调整" wide @close="emit('close')">
    <div class="exception-editor">
      <p class="muted-tip">设置放假、调课与补课，只影响指定日期，保留原来的每周课表。</p>
      <form ref="editor" class="exception-entry" novalidate @submit.prevent="submit">
        <div class="section-title"><h4>{{ editingId ? '编辑安排' : '添加安排' }}</h4><span v-if="editingId" class="editing-hint">正在编辑已有安排</span></div>
        <div class="type-tabs" role="tablist" aria-label="安排类型" @keydown="onTypeTabKeydown">
          <button v-for="tab in TYPE_TABS" :id="`exceptions-tab-${tab.id}`" :key="tab.id" type="button" role="tab"
            aria-controls="exceptions-type-panel" :tabindex="typeTabIndex(tab.id)" :aria-selected="form.type === tab.id"
            :class="{ on: form.type === tab.id }" @click="selectType(tab.id)">{{ tab.label }}</button>
        </div>
        <div id="exceptions-type-panel" class="exception-form" role="tabpanel" :aria-labelledby="activeTypeTabId">
          <p class="type-hint">{{ typeHint }}</p>
          <div class="date-fields" :class="{ 'three-fields': form.type === 'makeup' }">
            <label>{{ dateFieldLabel }}
              <input ref="dateInput" v-model="form.date" type="date" :aria-invalid="errorField === 'date' || undefined" :aria-describedby="dateErrorId" @input="onDateInput" />
              <small>{{ dateHint }}</small>
            </label>
            <label v-if="form.type === 'off'">结束日期
              <input ref="endDateInput" v-model="form.endDate" type="date" :min="form.date" :aria-invalid="errorField === 'endDate' || undefined" :aria-describedby="endDateErrorId" @input="clearFeedback" />
              <small>只停一天时，与开始日期相同</small>
            </label>
            <template v-if="form.type === 'makeup'">
              <label>采用哪一周的课表
                <select ref="sourceWeekInput" v-model.number="form.sourceWeek" :aria-invalid="errorField === 'sourceWeek' || undefined" :aria-describedby="weekErrorId" @change="clearFeedback">
                  <option :value="0">跟随当天（{{ weekTextFor(form.date) }}）</option>
                  <option v-for="week in weekOptions" :key="week" :value="week">第 {{ week }} 周</option>
                </select>
                <small>单双周按此周次计算</small>
              </label>
              <label>采用星期几的课表
                <select ref="sourceDayInput" v-model.number="form.sourceDay" :aria-invalid="errorField === 'sourceDay' || undefined" :aria-describedby="dayErrorId" @change="clearFeedback">
                  <option v-for="(day, index) in days" :key="day" :value="index">{{ day }}</option>
                </select>
                <small>保留课程原节次</small>
              </label>
            </template>
          </div>
          <fieldset v-if="isSessionType" ref="coursePicker" class="course-picker" tabindex="-1" :aria-invalid="errorField === 'courseIds' || undefined" :aria-describedby="courseErrorId">
            <legend>{{ form.type === 'session_off' ? '选择要停课的课程' : '选择要补课的课程' }} · 已选 {{ form.courseIds.length }} 门</legend>
            <p v-if="!allCourseList.length" class="picker-empty">还没有课程，请先在课程表中添加课程。</p>
            <p v-else-if="!selectableCourses.length" class="picker-empty">{{ form.type === 'session_off' ? '当天没有可停课的课程。请检查日期，或编辑已有停课安排。' : '没有可补课的课程。当天已上课或已停课的课程不会重复安排。' }}</p>
            <template v-else>
              <div class="picker-tools">
                <input v-if="selectableCourses.length > 6" v-model="search" type="search" aria-label="搜索可选课程" placeholder="搜索课程、教室或星期" />
                <span class="picker-count">可选 {{ selectableCourses.length }} 门</span>
                <button type="button" class="btn btn-sm btn-ghost" :disabled="!filteredCourses.length" @click="selectVisibleCourses">{{ search.trim() ? '选择搜索结果' : '全选' }}</button>
                <button type="button" class="btn btn-sm btn-ghost" :disabled="!form.courseIds.length" @click="clearSelection">清空选择</button>
              </div>
              <div class="course-options">
                <label v-for="course in filteredCourses" :key="course.id" class="course-option" :class="{ selected: form.courseIds.includes(String(course.id)) }">
                  <input type="checkbox" :checked="form.courseIds.includes(String(course.id))" @change="toggleCourse(course.id)" />
                  <span><b>{{ course.name }}</b><small>{{ courseLabel(course) }}</small></span>
                </label>
              </div>
              <p v-if="!filteredCourses.length" class="picker-empty">没有匹配的课程，试试其他关键词。</p>
            </template>
          </fieldset>
          <fieldset v-if="form.type === 'session_makeup' && form.courseSlots.length" ref="slotPicker" class="course-picker slot-picker" tabindex="-1"
            :aria-invalid="errorField === 'courseSlots' || undefined" :aria-describedby="slotErrorId">
            <legend>设置补课节次</legend>
            <p class="muted-tip">默认带入原节次，可按通知修改；每门课分别安排。时间按补课日期对应的作息显示。</p>
            <div v-for="slot in form.courseSlots" :key="slot.courseId" class="makeup-slot" :data-course-id="slot.courseId">
              <b>{{ courseNameOf(slot.courseId) }}</b>
              <div class="date-fields slot-fields">
                <label>开始节次
                  <select :value="slot.start" :aria-label="`${courseNameOf(slot.courseId)}补课开始节次`" :aria-invalid="slotInvalid(slot) || undefined" :aria-describedby="slotInvalid(slot) ? slotErrorId : undefined"
                    @change="setSlotStart(slot, $event.target.value)">
                    <option value="" disabled>请选择开始节次</option>
                    <option v-for="period in periods" :key="period.id" :value="period.id">{{ periodOption(period) }}</option>
                  </select>
                </label>
                <label>结束节次
                  <select v-model="slot.end" :aria-label="`${courseNameOf(slot.courseId)}补课结束节次`" :aria-invalid="slotInvalid(slot) || undefined" :aria-describedby="slotInvalid(slot) ? slotErrorId : undefined" @change="clearFeedback">
                    <option value="" disabled>请选择结束节次</option>
                    <option v-for="period in periods" :key="period.id" :value="period.id" :disabled="periodIndex(period.id) < periodIndex(slot.start)">{{ periodOption(period) }}</option>
                  </select>
                </label>
              </div>
              <small class="slot-summary">{{ form.date }} · {{ slotLabel(slot) }}</small>
            </div>
          </fieldset>
          <div class="arrangement-preview">
            <b>生效预览</b><p>{{ previewText }}</p>
            <p v-for="warning in previewWarnings" :key="warning" class="preview-warning">{{ warning }}</p>
          </div>
          <label class="exception-note">备注（可选）<input v-model="form.note" placeholder="例如：假期安排、教师调课通知" @input="clearFeedback" /></label>
          <p v-if="error" id="exception-form-error" class="error" role="alert">{{ error }}</p>
          <p v-if="savedMessage" class="save-feedback" role="status">{{ savedMessage }}</p>
          <div class="save-row">
            <button v-if="editingId" class="btn btn-ghost" type="button" @click="resetForm">取消编辑</button>
            <button class="btn btn-primary" type="submit">{{ editingId ? '保存修改' : '添加安排' }}</button>
          </div>
        </div>
      </form>
      <section class="saved-arrangements" aria-label="已保存的课程调整">
        <div class="section-title list-heading">
          <h4>已保存安排 <span class="record-count">{{ exceptions.length }}</span></h4>
          <select v-model="listFilter" aria-label="筛选已保存安排"><option value="all">全部安排</option><option value="upcoming">今天及以后</option><option value="past">已结束</option></select>
        </div>
        <div v-if="removedItem" class="remove-feedback" role="status">
          <span>已删除 {{ dateText(removedItem) }} 的安排</span>
          <button type="button" class="btn btn-sm btn-ghost" @click="undoRemove">撤销删除</button>
        </div>
        <p v-if="removeError" class="error" role="alert">{{ removeError }}</p>
        <div v-if="filteredExceptions.length" class="exception-list">
          <div v-for="item in filteredExceptions" :key="item.id" class="exception-item" :class="{ editing: editingId === item.id }">
            <div class="exception-content">
              <div class="exception-title"><b>{{ dateText(item) }}</b><span class="exception-badge" :class="item.type">{{ typeLabel(item.type) }}</span></div>
              <p class="exception-detail">{{ exceptionDetail(item) }}</p>
              <p v-if="item.note" class="exception-note-text">备注：{{ item.note }}</p>
            </div>
            <div class="exception-actions">
              <button class="btn btn-sm btn-ghost" type="button" :aria-label="`编辑 ${dateText(item)} 的${typeLabel(item.type)}安排`" @click="startEdit(item)">编辑</button>
              <button class="btn btn-sm btn-danger" type="button" :aria-label="`删除 ${dateText(item)} 的${typeLabel(item.type)}安排`" @click="removeItem(item)">删除</button>
            </div>
          </div>
        </div>
        <p v-else class="manager-empty">{{ exceptions.length ? '没有符合筛选条件的安排。' : '还没有课程调整。遇到放假或调课时，在上方添加即可。' }}</p>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.exception-editor, .exception-entry, .exception-form, .saved-arrangements { display: flex; flex-direction: column; gap: 11px; min-width: 0; }
.muted-tip, .type-hint, .picker-empty { margin: 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.65; }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.section-title h4 { margin: 0; color: var(--text); font-size: var(--fs-13); }
.editing-hint, .record-count, .picker-count { color: var(--muted); font-size: var(--fs-11); }
.type-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.type-tabs button { min-height: 42px; padding: 9px 10px; color: var(--muted); font-size: var(--fs-13); font-weight: var(--fw-700); border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--card); cursor: pointer; }
.type-tabs button.on { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
.date-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; }
.date-fields.three-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.date-fields label, .exception-note { display: flex; flex-direction: column; gap: 6px; min-width: 0; color: var(--muted); font-size: var(--fs-12); }
.date-fields input, .date-fields select, .exception-note input { width: 100%; min-width: 0; box-sizing: border-box; }
.date-fields small { min-height: 18px; font-size: var(--fs-11); line-height: 1.5; }
.course-picker { display: flex; flex-direction: column; gap: 10px; min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-10); }
.course-picker[aria-invalid='true'] { border-color: var(--danger); }
.course-picker legend { padding: 0 5px; color: var(--text); font-size: var(--fs-12); font-weight: var(--fw-700); }
.picker-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.picker-tools input { flex: 1 1 180px; min-width: 0; }
.picker-count { margin-right: auto; }
.course-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; max-height: 250px; overflow-y: auto; padding: 2px; }
.course-option { display: flex; align-items: flex-start; gap: 9px; padding: 10px; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg-tint); cursor: pointer; }
.course-option:hover, .course-option.selected { border-color: var(--primary); }
.course-option.selected { background: var(--primary-soft); }
.course-option input { flex: 0 0 18px; width: 18px; min-width: 18px; min-height: 18px; margin: 2px 0 0; accent-color: var(--primary); }
.course-option > span { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.course-option b { color: var(--text); font-size: var(--fs-12); }
.course-option small { color: var(--muted); font-size: var(--fs-11); line-height: 1.5; }
.makeup-slot { display: grid; gap: 8px; min-width: 0; padding: 12px; background: var(--bg-tint); border-radius: var(--radius-8); }
.makeup-slot > b { color: var(--text); font-size: var(--fs-12); overflow-wrap: anywhere; }
.slot-summary { color: var(--muted); font-size: var(--fs-11); line-height: 1.6; overflow-wrap: anywhere; }
.arrangement-preview { padding: 12px 14px; border-radius: var(--radius-10); background: var(--primary-soft); color: var(--text); font-size: var(--fs-12); line-height: 1.65; overflow-wrap: anywhere; }
.arrangement-preview b { color: var(--primary); }
.arrangement-preview p { margin: 5px 0 0; }
.arrangement-preview .preview-warning { color: var(--warning); }
.error { margin: 0; color: var(--danger); font-size: var(--fs-12); }
.save-feedback { margin: 0; color: var(--success); font-size: var(--fs-12); }
.remove-feedback { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-radius: var(--radius-8); background: var(--bg-tint); color: var(--text); font-size: var(--fs-12); }
.save-row { display: flex; justify-content: flex-end; gap: 8px; }
.saved-arrangements { border-top: 1px solid var(--border); padding-top: 16px; }
.list-heading select { width: auto; max-width: 160px; font-size: var(--fs-12); }
.exception-list { display: flex; flex-direction: column; gap: 8px; max-height: 310px; overflow-y: auto; padding: 2px; }
.exception-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--card); }
.exception-content { min-width: 0; }
.exception-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.exception-title b { color: var(--text); font-size: var(--fs-12); }
.exception-badge { padding: 2px 6px; border-radius: var(--radius-5); font-size: var(--fs-10); color: var(--danger); background: var(--danger-soft); }
.exception-badge.makeup { color: var(--primary); background: var(--primary-soft); }
.exception-badge.session_off { color: var(--ink-soft); background: var(--bg-tint); }
.exception-badge.session_makeup { color: var(--success); background: color-mix(in srgb, var(--success) 10%, var(--card)); }
.exception-detail, .exception-note-text { margin: 5px 0 0; color: var(--muted); font-size: var(--fs-11); line-height: 1.6; overflow-wrap: anywhere; }
.exception-item.editing { border-color: var(--primary); background: var(--primary-soft); }
.exception-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.manager-empty { margin: 0; padding: 12px 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.65; text-align: center; }
@media (max-width: 760px) { .date-fields.three-fields { grid-template-columns: 1fr 1fr; } .date-fields.three-fields label:first-child { grid-column: 1 / -1; } }
@media (max-width: 520px) {
  .type-tabs { grid-template-columns: 1fr 1fr; }
  .date-fields, .date-fields.three-fields, .course-options { grid-template-columns: 1fr; }
  .exception-item { flex-direction: column; align-items: stretch; gap: 8px; }
  .exception-actions { justify-content: flex-end; }
  .exception-actions button { min-height: 40px; }
  .save-row { flex-wrap: wrap; }
  .save-row .btn-primary { flex: 1; }
}
</style>
