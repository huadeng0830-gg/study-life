import { computed, ref } from 'vue'
import { appToday } from './timeContext.js'

/**
 * 课程批量管理（从 ScheduleView 拆出）：勾选、复制、批量删除、学期模板。
 *
 * 三个确认框（批量删除 / 导入模板 / 删除模板）的 ConfirmDialog 字面量必须留在
 * ScheduleView 里，所以 `coursesRemovalTarget` / `importTemplateTarget` /
 * `deleteTemplateTarget` 由宿主声明后注入，本模块只负责把“确认之前”的快照写进去。
 */
export function useScheduleCourseManager({
  domain,
  courses,
  courseTemplateCommands,
  coursesRemovalTarget,
  importTemplateTarget,
  deleteTemplateTarget,
}) {
  const showCourseManager = ref(false)
  const selectedCourseIds = ref([])
  const templateName = ref('')
  const managerMessage = ref('')
  const managerError = ref('')

  // 表单中当前格子里的其他课程（用于提示与重叠检测）
  const selectedCourses = computed(() =>
    courses.value.filter((course) => selectedCourseIds.value.includes(course.id)),
  )
  const allCoursesSelected = computed(() =>
    courses.value.length > 0 && selectedCourseIds.value.length === courses.value.length,
  )

  function openCourseManager() {
    selectedCourseIds.value = []
    managerMessage.value = ''
    managerError.value = ''
    templateName.value = `${Number(appToday.value.slice(0, 4))}年课表`
    showCourseManager.value = true
  }

  function toggleCourseSelection(id) {
    selectedCourseIds.value = selectedCourseIds.value.includes(id)
      ? selectedCourseIds.value.filter((value) => value !== id)
      : [...selectedCourseIds.value, id]
  }

  function toggleAllCourses() {
    selectedCourseIds.value = allCoursesSelected.value
      ? []
      : courses.value.map((course) => course.id)
  }

  // 批量删除课程与清空课表共用一个确认框：两者形状完全一样——都是「把确认前快照下来的
  // 一批课程 id 从当前课表里删掉」，只有文案不同。拆成两个对话框会把同一段
  // 「快照 → 删除 → 清空选中」的收尾逻辑抄两遍。
  // 【为什么快照一定要在弹确认之前】对话框打开期间用户仍然可以继续勾选课程，
  // 确认后才去读 selectedCourseIds 会把「提示里说的 N 门」和「真正删掉的」变成两回事，
  // 并连带删掉当时根本没在提示里出现过的课程。
  function requestCoursesRemoval(target) {
    coursesRemovalTarget.value = target
  }

  function deleteSelectedCourses() {
    const ids = selectedCourses.value.map((course) => course.id)
    if (!ids.length) return
    requestCoursesRemoval({
      ids,
      message: `确定删除选中的 ${ids.length} 门课程吗？`,
      confirmLabel: '删除课程',
      doneMessage: '选中的课程已删除',
    })
  }

  function clearCurrentSchedule() {
    const ids = courses.value.map((course) => course.id)
    if (!ids.length) return
    requestCoursesRemoval({
      ids,
      message: '确定清空当前全部课程吗？建议先保存为学期模板或导出备份。',
      confirmLabel: '清空课表',
      doneMessage: '当前课表已清空',
    })
  }

  function duplicateSelectedCourses() {
    if (!selectedCourses.value.length) return
    const copies = selectedCourses.value.map((course) => domain.createCourse({ ...course, createdFrom: 'course-duplicate' }))
    selectedCourseIds.value = copies.map((course) => course.id)
    managerMessage.value = `已创建 ${copies.length} 门课程副本，可关闭窗口后逐项调整`
  }

  function saveCourseTemplate() {
    managerError.value = ''
    const name = templateName.value.trim()
    if (!name) {
      managerError.value = '请填写模板名称'
      return
    }
    if (!courses.value.length) {
      managerError.value = '当前没有课程可以保存'
      return
    }
    courseTemplateCommands.saveTemplate({ name, courses: courses.value })
    templateName.value = ''
    managerMessage.value = `“${name}”已保存，可在新学期重新导入`
  }

  function importCourseTemplate(template) {
    // 文案里的 action（追加 / 导入为空课表）依赖 courses.value.length，必须在弹确认
    // 之前定稿：确认期间课程数还可能变化，晚算会让提示与实际导入行为对不上。
    const action = courses.value.length ? '追加到当前课表' : '导入为空课表'
    importTemplateTarget.value = {
      courses: template.courses,
      message: `确定将“${template.name}”中的 ${template.courses.length} 门课程${action}吗？`,
    }
  }

  function deleteCourseTemplate(template) {
    deleteTemplateTarget.value = template
  }

  return {
    showCourseManager,
    selectedCourseIds,
    selectedCourses,
    templateName,
    managerMessage,
    managerError,
    openCourseManager,
    toggleCourseSelection,
    toggleAllCourses,
    deleteSelectedCourses,
    clearCurrentSchedule,
    duplicateSelectedCourses,
    saveCourseTemplate,
    importCourseTemplate,
    deleteCourseTemplate,
  }
}
