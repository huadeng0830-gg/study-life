import { nextTick, ref } from 'vue'
import { detectTaskEventConflicts, detectTimePlanConflicts, getConflictSummary } from '../conflictDetection.js'
import { normalizeTaskWorkCheckpoint } from './taskWorkProgress.js'
import { normalizeTimeStages, taskDeadlineError, taskRepeatBase, taskTimePlanError } from './taskTimePlan.ts'
import { undoTaskTimeShift } from './taskTimeShift.ts'
import { isValidPlanningDate } from '../planningViews.js'
import { defaultReminderMinutes } from '../settingsPolicy.js'

function emptyForm() {
  return {
    title: '',
    course: '',
    courseId: '',
    dueDate: '',
    dueTime: '',
    /** @type {import('../../types/domain').TaskTimeStage[]} */
    timeStages: [],
    priority: 'normal',
    note: '',
    estimateMinutes: '',
    actualMinutes: '',
    checkpointLastStep: '',
    checkpointBlocker: '',
    checkpointNextStep: '',
    checkpointResources: '',
    repeat: 'none',
    repeatEndDate: '',
    reminderMinutes: '',
  }
}

/** Owns task form state, validation, conflict confirmation, and persistence. */
export function useTaskEditor({ domain, tasks, courses, events, onSaved = (_message, _options = {}) => {} }) {
  const showForm = ref(false)
  const editingId = ref(null)
  const error = ref('')
  const errorField = ref('')
  const titleInput = ref(null)
  const dueDateInput = ref(null)
  const dueTimeInput = ref(null)
  const repeatEndDateInput = ref(null)
  /** @type {import('vue').Ref<HTMLInputElement | null>} */
  const estimateInput = ref(null)
  /** @type {import('vue').Ref<HTMLInputElement | null>} */
  const actualInput = ref(null)
  /** @type {import('vue').Ref<HTMLInputElement | null>} */
  const reminderInput = ref(null)
  const form = ref(emptyForm())
  const deleteTarget = ref(null)
  const saveConflict = ref(null)

  function setFormError(message, field = '') {
    error.value = message
    errorField.value = message ? field : ''
    if (message && field === 'title') nextTick(() => titleInput.value?.focus())
    if (message && field === 'dueDate') nextTick(() => dueDateInput.value?.focus())
    if (message && field === 'dueTime') nextTick(() => dueTimeInput.value?.focus())
    if (message && field === 'repeatEndDate') nextTick(() => repeatEndDateInput.value?.focus())
    if (message && field === 'estimateMinutes') nextTick(() => estimateInput.value?.focus())
    if (message && field === 'actualMinutes') nextTick(() => actualInput.value?.focus())
    if (message && field === 'reminderMinutes') nextTick(() => reminderInput.value?.focus())
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
      timeStages: JSON.parse(JSON.stringify(task.timeStages || [])),
      priority: task.priority ?? 'normal',
      note: task.note ?? '',
      estimateMinutes: task.estimateMinutes ?? '',
      actualMinutes: task.actualMinutes ?? '',
      checkpointLastStep: task.workCheckpoint?.lastStep ?? '',
      checkpointBlocker: task.workCheckpoint?.blocker ?? '',
      checkpointNextStep: task.workCheckpoint?.nextStep ?? '',
      checkpointResources: task.workCheckpoint?.resources?.join('\n') ?? '',
      repeat: task.repeat ?? 'none',
      repeatEndDate: task.repeatEndDate ?? '',
      reminderMinutes: String(task.reminderMinutes ?? ''),
    }
    showForm.value = true
  }

  function commitSave(data, editId) {
    const existing = tasks.value.find((task) => task.id === editId)
    const timing = (task) => JSON.parse(JSON.stringify({ dueDate: task.dueDate || '', dueTime: task.dueTime || '', timeStages: task.timeStages || [] }))
    const before = existing && !existing.done && existing.status !== 'completed' ? timing(existing) : null
    const beforeAnchor = existing?.repeatAnchorDay
    const beforeRepeat = existing?.repeat
    try {
      if (editId && domain.updateTask(editId, data) === null) {
        setFormError('这条待办已不存在，请关闭后重新添加。')
        return
      }
      if (!editId) domain.createTask({ ...data, createdFrom: 'manual' })
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '请检查时间安排。')
      return
    }
    showForm.value = false
    const after = before && existing ? timing(existing) : null
    const afterAnchor = existing?.repeatAnchorDay
    const afterRepeat = existing?.repeat
    if (before && after && JSON.stringify(undoTaskTimeShift(after, before, after)) !== JSON.stringify(after)) {
      onSaved('待办已更新', { actionLabel: '撤销改期', duration: 6000, undoFn: () => {
        const current = tasks.value.find((task) => task.id === editId)
        if (!current) return
        return domain.updateTask(current.id, undoTaskTimeShift(current,
          { ...before, repeat: beforeRepeat, repeatAnchorDay: beforeAnchor },
          { ...after, repeat: afterRepeat, repeatAnchorDay: afterAnchor }))
      } })
    } else onSaved(editId ? '待办已更新' : '待办已添加')
  }

  function save() {
    if (!form.value.title.trim()) {
      setFormError('请填写待办内容', 'title')
      return
    }
    const deadlineError = taskDeadlineError({ dueDate: form.value.dueDate, dueTime: form.value.dueDate ? form.value.dueTime : '' })
    if (deadlineError) { setFormError(deadlineError.message, deadlineError.field); return }
    const timeError = taskTimePlanError(form.value.timeStages)
    if (timeError) { setFormError(timeError.message, timeError.field); return }
    const repeatBase = taskRepeatBase(form.value)
    if (form.value.repeat !== 'none' && !repeatBase.date) {
      setFormError('重复待办需要设置截止日期或阶段日期，完成后才能生成下一期。', 'dueDate')
      return
    }
    if (form.value.repeat !== 'none' && form.value.repeatEndDate && form.value.repeatEndDate < repeatBase.date) {
      setFormError('重复结束日期不能早于本期重复基准日期。', 'repeatEndDate')
      return
    }
    if (form.value.repeat !== 'none' && form.value.repeatEndDate && !isValidPlanningDate(form.value.repeatEndDate)) {
      setFormError('请选择有效的重复结束日期。', 'repeatEndDate')
      return
    }
    const rawEstimateMinutes = String(form.value.estimateMinutes ?? '').trim()
    if (rawEstimateMinutes && (!Number.isFinite(Number(rawEstimateMinutes)) || Number(rawEstimateMinutes) < 0)) {
      setFormError('预计时长需要是大于或等于 0 的分钟数。', 'estimateMinutes')
      return
    }
    const rawReminderMinutes = String(form.value.reminderMinutes ?? '').trim()
    if (rawReminderMinutes && (!Number.isFinite(Number(rawReminderMinutes)) || Number(rawReminderMinutes) < 0)) {
      setFormError('提醒提前量需要是大于或等于 0 的分钟数。', 'reminderMinutes')
      return
    }
    const rawActualMinutes = String(form.value.actualMinutes ?? '').trim()
    const actualMinutes = Number(rawActualMinutes)
    if (rawActualMinutes && (!Number.isFinite(actualMinutes) || actualMinutes < 0)) {
      setFormError('实际用时需要是大于或等于 0 的分钟数。', 'actualMinutes')
      return
    }
    let workCheckpoint
    try {
      workCheckpoint = normalizeTaskWorkCheckpoint({
        lastStep: form.value.checkpointLastStep,
        blocker: form.value.checkpointBlocker,
        nextStep: form.value.checkpointNextStep,
        resources: form.value.checkpointResources,
      })
    } catch (cause) {
      setFormError((cause instanceof Error ? cause.message : '') || '请检查资料链接。')
      return
    }
    setFormError('')
    const linkedCourse = courses.value.find((course) => course.id === form.value.courseId)
    const data = {
      title: form.value.title.trim(),
      course: linkedCourse?.name ?? form.value.course.trim(),
      courseId: linkedCourse?.id ?? '',
      dueDate: form.value.dueDate,
      dueTime: form.value.dueDate ? form.value.dueTime : '',
      priority: form.value.priority,
      note: form.value.note.trim(),
      estimateMinutes: Math.max(0, Number(form.value.estimateMinutes) || 0),
      repeat: form.value.repeat,
      repeatEndDate: form.value.repeat === 'none' ? '' : form.value.repeatEndDate,
    }
    // Snapshot the edit target before a conflict dialog can remain open.
    const editId = editingId.value
    const existingTask = tasks.value.find((task) => task.id === editId)
    if (form.value.timeStages.length || existingTask?.timeStages) data.timeStages = normalizeTimeStages(form.value.timeStages)
    if (rawReminderMinutes || existingTask?.reminderMinutes !== undefined) data.reminderMinutes = defaultReminderMinutes('task', rawReminderMinutes)
    if (rawActualMinutes) data.actualMinutes = Math.round(actualMinutes * 10) / 10
    else if (existingTask?.actualMinutes !== null && existingTask?.actualMinutes !== undefined) data.actualMinutes = null
    if (workCheckpoint) data.workCheckpoint = workCheckpoint
    else if (existingTask?.workCheckpoint) data.workCheckpoint = null

    if (data.dueDate || data.timeStages?.length) {
      const target = { ...data, id: editId || undefined }
      const conflicts = data.timeStages?.length
        ? detectTimePlanConflicts(target, [...tasks.value, ...events.value], 'task')
        : detectTaskEventConflicts(target, [...tasks.value, ...events.value], data.dueDate, 'task')
      const summary = getConflictSummary(conflicts)
      if (summary.hasConflicts) {
        saveConflict.value = { message: `${summary.message}\n${conflicts.map((item) => item.message).join('\n')}\n是否继续保存？`, data, editId }
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
    dueTimeInput,
    repeatEndDateInput,
    estimateInput,
    actualInput,
    reminderInput,
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
