import { computed, ref, watch } from 'vue'
import { appToday } from '../timeContext.js'
import { defaultReminderMinutes } from '../settingsPolicy.js'
import { isArchived } from '../domain/state.js'
import { announceAlert } from '../liveRegion.js'
import { findUniqueCourseByName } from '../courseLinks.js'
import { eventInputError, validEventDate, validEventTime } from './eventFields.js'
import { findEventConflicts } from './eventConflicts.js'

export function useEventEditor(domain, showNotice) {
  const formOpen = ref(false)
  const editing = ref(null)
  const formError = ref('')
  const formErrorField = ref('')
  const formElement = ref(null)
  const titleInput = ref(null)
  const wheelField = ref('')
  const saveConflict = ref(null)
  const form = ref(emptyForm())
  const courseOptions = computed(() => domain.courses.value.filter((course) => course && !course.deletedAt && !course.tombstone && !isArchived(course)))
  const liveConflicts = computed(() => eventInputError(form.value) ? [] : findEventConflicts(form.value, {
    tasks: domain.tasks.value, events: domain.events.value, courses: domain.courses.value,
  }, editing.value?.id))
  const wheelValue = computed({
    get: () => wheelField.value ? form.value[wheelField.value] : '',
    set: (value) => { if (wheelField.value) form.value[wheelField.value] = value },
  })

  function emptyForm(date = appToday.value) {
    return { title: '', date, time: '', endTime: '', location: '', courseId: '', courseName: '', note: '', reminderEnabled: true, reminderMinutes: defaultReminderMinutes('event') }
  }

  function setFormError(message, field = '') {
    formError.value = message
    formErrorField.value = message ? field : ''
    if (!message) return
    announceAlert(message, { clearAfter: 7000 })
    if (field === 'title') titleInput.value?.focus()
    else if (field) formElement.value?.querySelector(`[data-field="${field}"]`)?.focus()
  }

  watch(() => ({ ...form.value }), (next, previous) => {
    const field = formErrorField.value
    if (field && next[field] !== previous[field]) setFormError('')
  })

  function openCreate(date = appToday.value, source = null) {
    editing.value = null
    form.value = { ...emptyForm(validEventDate(date) ? date : ''), ...(source ? {
      title: `${source.title}（副本）`, time: source.time || '', endTime: source.endTime || '',
      location: source.location || '', courseId: source.courseId || '', courseName: source.courseName || '', note: source.note || '',
      reminderEnabled: source.reminderEnabled !== false, reminderMinutes: defaultReminderMinutes('event', source.reminderMinutes),
    } : {}) }
    setFormError('')
    wheelField.value = ''
    formOpen.value = true
  }

  function openEdit(event) {
    editing.value = event
    form.value = { ...emptyForm(), ...Object.fromEntries(['title', 'date', 'time', 'endTime', 'location', 'courseId', 'courseName', 'note'].map((field) => [field, event[field] || ''])), reminderEnabled: event.reminderEnabled !== false, reminderMinutes: defaultReminderMinutes('event', event.reminderMinutes) }
    setFormError('')
    wheelField.value = ''
    formOpen.value = true
  }

  function closeForm() { formOpen.value = false; wheelField.value = ''; saveConflict.value = null }

  function selectCourse() {
    const course = courseOptions.value.find((course) => String(course.id) === String(form.value.courseId))
    form.value.courseName = course?.name || ''
  }

  function clearTime() { form.value.time = ''; form.value.endTime = ''; wheelField.value = '' }

  function setDuration(minutes) {
    if (!validEventTime(form.value.time)) { setFormError('请先选择开始时间', 'time'); return }
    const total = Number(form.value.time.slice(0, 2)) * 60 + Number(form.value.time.slice(3)) + minutes
    if (total >= 1440) { setFormError('这个时长会跨到次日，请调整开始时间或拆分日程', 'endTime'); return }
    form.value.endTime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  function save() {
    const issue = eventInputError(form.value)
    if (issue) { setFormError(issue.message, issue.field); return }
    const payload = { ...form.value, title: form.value.title.trim(), location: form.value.location.trim(), courseName: form.value.courseName.trim(), note: form.value.note.trim(), reminderMinutes: Number(form.value.reminderMinutes) || 0 }
    // Name-only legacy records retain their text; only an unambiguous match gains an ID.
    if (!payload.courseId) payload.courseId = findUniqueCourseByName(courseOptions.value, payload.courseName)?.id || ''
    const editingId = editing.value?.id ?? null
    const conflicts = liveConflicts.value
    if (conflicts.length) {
      const details = conflicts.slice(0, 5).map((conflict) => {
        const existing = conflict.existing
        return `「${conflict.entityName}」 ${existing.dueTime || existing.time}${existing.endTime ? `–${existing.endTime}` : ''}`
      })
      saveConflict.value = { payload, editingId, message: `与 ${conflicts.length} 条安排时间重叠：\n${details.join('\n')}${conflicts.length > 5 ? '\n还有其他重叠安排。' : ''}\n是否继续保存？` }
      return
    }
    commitSave(payload, editingId)
  }

  function commitSave(payload, editingId) {
    try {
      if (editingId !== null) {
        if (!domain.updateEvent(editingId, payload)) throw new Error('这条日程已被删除，请重新新建')
        showNotice('已保存日程')
      } else {
        domain.createEvent(payload)
        showNotice('已添加日程')
      }
      closeForm()
    } catch (cause) { setFormError(cause?.message || '保存失败，请重试') }
  }

  function confirmConflictSave() {
    const target = saveConflict.value
    saveConflict.value = null
    if (target) commitSave(target.payload, target.editingId)
  }

  return { formOpen, editing, form, formError, formErrorField, formElement, titleInput, wheelField, wheelValue, saveConflict, courseOptions, liveConflicts, openCreate, openEdit, closeForm, selectCourse, clearTime, setDuration, save, confirmConflictSave }
}
