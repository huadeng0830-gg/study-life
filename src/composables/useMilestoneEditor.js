import { nextTick, ref, useId } from 'vue'
import { addAppDays, appToday } from './timeContext.js'
import { defaultReminderMinutes } from './settingsPolicy.js'
import { defaultExternalExamItems, normalizeExternalExamItems } from './externalExam.js'
import { milestoneInputError } from './milestoneFields.js'
import { createFormIdentityGuard } from './formIdentity.js'

function emptyForm() {
  return {
    name: '', date: '', time: '', location: '', note: '', category: '学习', repeat: 'none', pinned: false,
    courseId: '', reviewProgress: 0, reminderMinutes: '', registerStart: '', registerDeadline: '',
    examDate: '', examTime: '', venue: '', campus: '', seatNo: '', admissionNo: '',
    requiredItems: defaultExternalExamItems(),
  }
}

/** Owns important-date form state, validation, identity and persistence. */
export function useMilestoneEditor({ domain, courses, showToast }) {
  const showForm = ref(false)
  const editingId = ref(null)
  const error = ref('')
  const errorField = ref('')
  const nameInput = ref(null)
  const dateInput = ref(null)
  const form = ref(emptyForm())
  const formId = `milestone-form-${useId()}`
  const formElement = ref(null)
  const newRequiredItemName = ref('')
  const identity = createFormIdentityGuard()
  let identitySnapshot = null

  function openAdd(kind = 'countdown') {
    identitySnapshot = identity.begin()
    editingId.value = null
    error.value = ''
    errorField.value = ''
    form.value = emptyForm()
    if (kind === 'externalExam') form.value.category = '校外考试'
    newRequiredItemName.value = ''
    showForm.value = true
  }

  function openEdit(item) {
    identitySnapshot = identity.begin()
    editingId.value = item.id
    error.value = ''
    errorField.value = ''
    form.value = {
      name: item.name,
      date: item.kind === 'externalExam' ? item.examDate || item.registerDeadline || item.date : item.date,
      time: item.time ?? '',
      location: item.location ?? '',
      note: item.note ?? '',
      category: item.category ?? '其他',
      repeat: item.repeat ?? 'none',
      pinned: Boolean(item.pinned),
      courseId: item.courseId ?? '',
      reviewProgress: Number(item.reviewProgress ?? 0),
      reminderMinutes: String(item.reminderMinutes ?? ''),
      registerStart: item.registerStart ?? '',
      registerDeadline: item.registerDeadline ?? '',
      examDate: item.examDate ?? (item.kind === 'externalExam' ? item.date : ''),
      examTime: item.examTime ?? item.time ?? '',
      venue: item.venue ?? item.location ?? '',
      campus: item.campus ?? '',
      seatNo: item.seatNo ?? '',
      admissionNo: item.admissionNo ?? '',
      requiredItems: item.kind === 'externalExam' ? normalizeExternalExamItems(item.requiredItems) : defaultExternalExamItems(),
    }
    newRequiredItemName.value = ''
    showForm.value = true
  }

  function clearFormError(field) {
    if (errorField.value === field) { error.value = ''; errorField.value = '' }
  }

  function setFormDate(offset) {
    const field = form.value.category === '校外考试' ? 'examDate' : 'date'
    form.value[field] = addAppDays(appToday.value, offset)
    clearFormError(field)
  }

  function addRequiredItem() {
    const name = newRequiredItemName.value.trim()
    if (!name) return
    form.value.requiredItems.push({ name, quantity: 1, unit: '', checked: false })
    newRequiredItemName.value = ''
  }

  function removeRequiredItem(index) {
    form.value.requiredItems.splice(index, 1)
  }

  function save() {
    const isExternalExam = form.value.category === '校外考试'
    const primaryDate = isExternalExam ? (form.value.examDate || form.value.registerDeadline) : form.value.date
    const issue = milestoneInputError({ ...form.value, kind: isExternalExam ? 'externalExam' : 'countdown' })
    if (issue) {
      error.value = issue.message
      errorField.value = issue.field
      void nextTick(() => {
        if (issue.field === 'name') nameInput.value?.focus()
        else if (issue.field === 'date' || issue.field === 'examDate') dateInput.value?.focus()
        else {
          const fieldId = { registerStart: 'external-register-start', registerDeadline: 'external-register-deadline', time: 'exams-time', examTime: 'exams-time', reminder: 'dates-reminder' }[issue.field]
          if (fieldId) formElement.value?.querySelector(`#${fieldId}`)?.focus()
        }
      })
      return
    }
    const reminder = String(form.value.reminderMinutes).trim()
    const isStudyCountdown = form.value.category === '学习'
    const data = {
      name: form.value.name.trim(),
      date: primaryDate,
      time: isExternalExam ? form.value.examTime : form.value.time,
      location: isExternalExam ? form.value.venue.trim() : form.value.location.trim(),
      note: form.value.note.trim(),
      category: form.value.category,
      repeat: isExternalExam ? 'none' : form.value.repeat,
      kind: isExternalExam ? 'externalExam' : form.value.category === '学习' ? 'exam' : 'countdown',
      pinned: form.value.pinned,
      courseId: isStudyCountdown ? form.value.courseId : '',
      courseName: isStudyCountdown ? (courses.value.find((course) => course.id === form.value.courseId)?.name ?? '') : '',
      reviewProgress: isStudyCountdown ? Math.max(0, Math.min(100, Number(form.value.reviewProgress) || 0)) : 0,
      reminderMinutes: defaultReminderMinutes('milestone', reminder),
      ...(isExternalExam ? {
        kind: 'externalExam', registerStart: form.value.registerStart, registerDeadline: form.value.registerDeadline,
        examDate: form.value.examDate, examTime: form.value.examTime, venue: form.value.venue.trim(),
        campus: form.value.campus.trim(), seatNo: form.value.seatNo.trim(), admissionNo: form.value.admissionNo.trim(),
        requiredItems: normalizeExternalExamItems(form.value.requiredItems),
      } : {}),
    }
    try {
      identity.assertCurrent(identitySnapshot)
      if (editingId.value) {
        if (!domain.updateMilestone(editingId.value, data)) {
          error.value = '这条重要日期已不存在，请关闭后重新添加。'
          return
        }
      } else {
        domain.createMilestone({ ...data, createdFrom: 'manual' })
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存失败，请重试；填写的内容仍保留。'
      errorField.value = ''
      return
    }
    showForm.value = false
    showToast(editingId.value ? '重要日期已更新' : '重要日期已添加', { type: 'success' })
  }

  return { showForm, editingId, error, errorField, nameInput, dateInput, form, formId, formElement,
    newRequiredItemName, openAdd, openEdit, save, clearFormError, setFormDate, addRequiredItem, removeRequiredItem }
}
