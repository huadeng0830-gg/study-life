import { reactive, ref } from 'vue'
import { PALETTE, MAX_WEEK } from './store'
import {
  timeConfig,
  periodIndex,
  periodLabelById,
  periodRangeById,
} from './store/timeConfig.js'
import { currentDayIndex } from './timeContext.js'
import { isArchived } from './domain/state.js'

/**
 * 课程编辑表单（从 ScheduleView 拆出）：添加 / 编辑 / 归档 / 删除入口，
 * 以及「在此格添加另一门课」和关联作业的快捷记录。
 *
 * `deleteCourseTarget` 由宿主注入——它的 ConfirmDialog 字面量在 ScheduleView 里。
 * `beginCourseImport` 也是注入的惰性委托（导入审阅 composable 晚于本模块实例化）。
 */
export function useScheduleCourseForm({
  courses,
  domain,
  countdowns,
  settingsSchedule,
  beginCourseImport,
  deleteCourseTarget,
  managerMessage,
}) {
  const showForm = ref(false)
  const editingId = ref(null)
  const error = ref('')
  const quickHomeworkCourse = ref(null)
  const form = reactive({
    name: '',
    teacher: '',
    room: '',
    campusId: '',
    travelMinutes: 0,
    color: PALETTE[0],
    day: 0,
    start: 1,
    end: 2,
    startWeek: 1,
    endWeek: 16,
    weekType: 'all',
  })

  function openHomeworkForCourse() {
    const course = courses.value.find((item) => item.id === editingId.value)
    if (!course) return
    showForm.value = false
    quickHomeworkCourse.value = course
  }

  function closeHomeworkRecord() {
    quickHomeworkCourse.value = null
  }

  function onHomeworkSaved(payload) {
    managerMessage.value = payload.message
    closeHomeworkRecord()
  }

  // 在当前编辑课程的时间格子里，追加另一门不同周次的课程
  function addAnotherInCell() {
    const day = Number(form.day)
    const start = form.start
    const startIdx = periodIndex(start)
    // 正在编辑的课程本身也算"已有课程"，新课程的周次从它之后顺延
    const existing = courses.value.filter((c) => {
      if (c.day !== day) return false
      const s = periodIndex(c.start)
      const e = periodIndex(c.end)
      if (s < 0 || e < 0) return false
      return Math.min(s, e) <= startIdx && Math.max(s, e) >= startIdx
    })
    openAdd(day, start)
    if (existing.length) {
      const maxEnd = Math.max(...existing.map((c) => c.endWeek ?? MAX_WEEK))
      if (maxEnd < MAX_WEEK) {
        form.startWeek = maxEnd + 1
        form.endWeek = MAX_WEEK
      }
    }
  }

  function openAdd(day = null, period = null) {
    editingId.value = null
    error.value = ''
    const periods = timeConfig.value.periods
    const fallbackStart = periods[1]?.id ?? periods[0]?.id ?? null
    form.name = ''
    form.teacher = ''
    form.room = ''
    form.campusId = settingsSchedule.value.campusId || ''
    form.travelMinutes = 0
    form.color = PALETTE[courses.value.length % PALETTE.length]
    form.day = day ?? currentDayIndex.value
    form.start = period ?? fallbackStart
    const startIdx = periodIndex(form.start)
    form.end = period ? (periods[startIdx + 1]?.id ?? period) : (periods[startIdx + 1]?.id ?? fallbackStart)
    form.startWeek = 1
    form.endWeek = 16
    form.weekType = 'all'
    showForm.value = true
  }

  function openEdit(c) {
    editingId.value = c.id
    error.value = ''
    Object.assign(form, {
      ...c,
      startWeek: c.startWeek ?? 1,
      endWeek: c.endWeek ?? MAX_WEEK,
      weekType: c.weekType ?? 'all',
    })
    showForm.value = true
  }

  function linkedStudyProgress(courseId) {
    const values = countdowns.value
      .filter((item) => item.category === '学习' && item.courseId === courseId)
      .map((item) => Number(item.reviewProgress))
      .filter((value) => Number.isFinite(value))
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
  }

  function saveCourseFromEditor(payload) {
    error.value = ''
    const existing = payload.editingId
      ? courses.value.filter((course) => course.id !== payload.editingId)
      : courses.value
    beginCourseImport([{ id: payload.id, ...payload.data }], {
      source: 'manual',
      editingId: payload.editingId,
      existingCourses: existing,
    })
  }

  function removeCourseFromEditor(course) {
    showForm.value = false
    if (course) deleteCourseTarget.value = course
  }

  function archiveCourseFromEditor(course) {
    if (!course) return
    if (isArchived(course)) domain.restoreCourse(course.id)
    else domain.archiveCourse(course.id)
    showForm.value = false
  }

  function periodOption(id) {
    const label = periodLabelById(id)
    const t = periodRangeById(id)
    return t ? `${label}（${t}）` : label
  }

  return {
    form,
    showForm,
    editingId,
    error,
    quickHomeworkCourse,
    openAdd,
    openEdit,
    addAnotherInCell,
    saveCourseFromEditor,
    removeCourseFromEditor,
    archiveCourseFromEditor,
    linkedStudyProgress,
    periodOption,
    openHomeworkForCourse,
    closeHomeworkRecord,
    onHomeworkSaved,
  }
}
