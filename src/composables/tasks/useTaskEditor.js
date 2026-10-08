import { nextTick, ref } from 'vue'
import { detectTaskEventConflicts, getConflictSummary } from '../conflictDetection.js'

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
    repeatEndDate: '',
  }
}

/** Owns task form state, validation, conflict confirmation, and persistence. */
export function useTaskEditor({ domain, tasks, courses, events }) {
  const showForm = ref(false)
  const editingId = ref(null)
  const error = ref('')
  const errorField = ref('')
  const titleInput = ref(null)
  const dueDateInput = ref(null)
  const repeatEndDateInput = ref(null)
  const form = ref(emptyForm())
  const deleteTarget = ref(null)
  const saveConflict = ref(null)

  function setFormError(message, field = '') {
    error.value = message
    errorField.value = message ? field : ''
    if (message && field === 'title') nextTick(() => titleInput.value?.focus())
    if (message && field === 'dueDate') nextTick(() => dueDateInput.value?.focus())
    if (message && field === 'repeatEndDate') nextTick(() => repeatEndDateInput.value?.focus())
  }

  function clearFormError(field) {
    if (errorField.value === field) setFormError('')
  }

  function openAdd() {
    editingId.value = null
    setFormError('')
    form.value = emptyForm()
    showForm.value = true
  }

  function openEdit(task) {
    editingId.value = task.id
    setFormError('')
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
      repeatEndDate: task.repeatEndDate ?? '',
    }
    showForm.value = true
  }

  function commitSave(data, editId) {
    if (editId) domain.updateTask(editId, data)
    else domain.createTask({ ...data, createdFrom: 'manual' })
    showForm.value = false
  }

  function save() {
    if (!form.value.title.trim()) {
      setFormError('请填写待办内容', 'title')
      return
    }
    if (form.value.repeat !== 'none' && !form.value.dueDate) {
      setFormError('重复待办需要设置截止日期，完成后才能生成下一期。', 'dueDate')
      return
    }
    if (form.value.repeat !== 'none' && form.value.repeatEndDate && form.value.repeatEndDate < form.value.dueDate) {
      setFormError('重复结束日期不能早于本期截止日期。', 'repeatEndDate')
      return
    }
    setFormError('')
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
      repeatEndDate: form.value.repeat === 'none' ? '' : form.value.repeatEndDate,
    }
    // Snapshot the edit target before a conflict dialog can remain open.
    const editId = editingId.value

    if (data.dueDate) {
      const conflicts = detectTaskEventConflicts(data, [...tasks.value, ...events.value], data.dueDate, 'task')
      const summary = getConflictSummary(conflicts)
      if (summary.hasConflicts) {
        saveConflict.value = { message: `${summary.message}\n是否继续保存？`, data, editId }
        return
      }
    }

    commitSave(data, editId)
  }

  function confirmConflictSave() {
    const target = saveConflict.value
    saveConflict.value = null
    if (target) commitSave(target.data, target.editId)
  }

  function remove() {
    const task = tasks.value.find((item) => item.id === editingId.value)
    showForm.value = false
    if (task) deleteTarget.value = task
  }

  return {
    showForm,
    editingId,
    error,
    errorField,
    titleInput,
    dueDateInput,
    repeatEndDateInput,
    form,
    deleteTarget,
    saveConflict,
    openAdd,
    openEdit,
    clearFormError,
    save,
    confirmConflictSave,
    remove,
  }
}
