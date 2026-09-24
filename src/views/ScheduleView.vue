<script setup>
import { defineAsyncComponent, ref, reactive, computed, watch, onBeforeUnmount, onDeactivated, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { useCourseTemplateCommands } from '../composables/courseTemplates.js'
import { appearance } from '../composables/appearance.js'
import {
  useStoredRef,
  PALETTE,
  DEFAULT_TIMES,
  MAX_WEEK,
} from '../composables/store'
import {
  timeConfig,
  campusName,
  seasonName,
  courseUsesPeriod,
  currentTimes,
  periodIndex,
  periodLabelById,
  periodRangeById,
  seasonsForCampus,
  autoSeasonStatusFor,
} from '../composables/store/timeConfig.js'
import {
  semester,
  weekOf,
  dateForWeekDay,
  scheduleExceptions,
  upsertScheduleException,
  removeScheduleException,
} from '../composables/store/schedule.js'
import { useTaskProgress } from '../composables/taskProgress.js'
import { schedulePolicy } from '../composables/settingsPolicy.js'
import { isArchived } from '../composables/domain/state.js'
import { appToday, currentDayIndex, currentWeek as appCurrentWeek } from '../composables/timeContext.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'
import QuickRecordPanel from '../components/QuickRecordPanel.vue'
import ScheduleGrid from '../components/schedule/ScheduleGrid.vue'
import Toast from '../components/Toast.vue'
// 弹窗一律按需加载：仅“查看课程表”不再下载作息设置、批量录入等大体量模块，
// 打开课程表更快，内存占用更小（这些弹窗只有在真正点开时才会加载）。
const CourseEditorModal = defineAsyncComponent(() => import('../components/schedule/CourseEditorModal.vue'))
const CourseManagerModal = defineAsyncComponent(() => import('../components/schedule/CourseManagerModal.vue'))
const BatchImportModal = defineAsyncComponent(() => import('../components/schedule/BatchImportModal.vue'))
const ImageCropModal = defineAsyncComponent(() => import('../components/schedule/ImageCropModal.vue'))
const ImportConflictModal = defineAsyncComponent(() => import('../components/schedule/ImportConflictModal.vue'))
const ExceptionsModal = defineAsyncComponent(() => import('../components/schedule/ExceptionsModal.vue'))
const SemesterModal = defineAsyncComponent(() => import('../components/schedule/SemesterModal.vue'))
const TimeSettingsModal = defineAsyncComponent(() => import('../components/schedule/TimeSettingsModal.vue'))

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 课程表的识图、批量解析和导入规则只会在用户主动打开相应工具后使用。
// 保持它们为独立异步模块，普通“查看课程表”不再解析这些大块业务代码。
const TaskProgress = defineAsyncComponent(() => import('../components/TaskProgress.vue'))
let batchParserApi = null
let batchParserTask = null
const batchParserReady = ref(false)
let courseImportApi = null
let courseImportTask = null

function loadBatchParser() {
  if (batchParserApi) return Promise.resolve(batchParserApi)
  batchParserTask ??= import('../composables/courseParser.js').then((api) => {
    batchParserApi = api
    batchParserReady.value = true
    return api
  })
  return batchParserTask
}

function loadCourseImport() {
  if (courseImportApi) return Promise.resolve(courseImportApi)
  courseImportTask ??= import('../composables/courseImport.js').then((api) => (courseImportApi = api))
  return courseImportTask
}

const domain = useDomainCommands()
const { courses, tasks, milestones: countdowns, events, notes } = domain
const showArchivedCourses = ref(false)
const visibleCourses = computed(() => showArchivedCourses.value ? courses.value : courses.value.filter((course) => !isArchived(course)))
const courseTemplateCommands = useCourseTemplateCommands()
const { templates: courseTemplates } = courseTemplateCommands
const route = useRoute()
const router = useRouter()
const focusedCourseId = ref('')
const focusMessage = ref('')
let focusHandled = ''
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })
const scheduleNote = useStoredRef('sl_schedule_note', '')
const scheduleNoteEl = ref(null)
const quickHomeworkCourse = ref(null)

function saveScheduleNote() {
  // 备注内容已通过 useStoredRef 自动保存
}

function resizeScheduleNote() {
  const element = scheduleNoteEl.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(Math.max(element.scrollHeight, 38), 180)}px`
}

onMounted(resizeScheduleNote)

// OCR 引擎、版面解析和本地纠错词典只在用户真正选择图片后才下载。
// 普通查看/编辑课程表不再为这些重模块付出初始化成本。
async function performAccurateOCR(...args) {
  const module = await import('../composables/ocrPipeline.js')
  return module.performOCR(...args)
}

async function performLegacyOCR(...args) {
  const module = await import('../composables/ocrService.js')
  return module.performOCR(...args)
}

async function extractTimetable(result) {
  const parser = await import('../composables/timetableLayoutParser.js')
  const columnTable = parser.parseTimetableColumns(result.columns, timeConfig, MAX_WEEK)
  const layoutTable = parser.parseTimetableLayout(result.layout, timeConfig, MAX_WEEK)
  return { table: parser.selectBestTimetableExtraction(columnTable, layoutTable), toBatchLine: parser.toBatchLine }
}

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

async function extractExcelTimetable(file) {
  const [xlsxModule, parser] = await Promise.all([
    import('@e965/xlsx'),
    import('../composables/excelTimetableParser.js'),
  ])
  const XLSX = xlsxModule.default || xlsxModule
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellText: true, cellDates: false })
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false }),
  }))
  return parser.extractExcelTimetable(sheets)
}

async function applyTimetableVocabulary(table) {
  const { applyOcrVocabulary } = await import('../composables/ocrVocabulary.js')
  const changes = []
  table.courses = table.courses.map((course) => {
    const adjusted = applyOcrVocabulary(course, courses.value)
    changes.push(...adjusted.changes)
    return adjusted.course
  })
  return changes
}
const showForm = ref(false)
const showScheduleSettings = ref(false)
const showTimeEditor = ref(false)
const timeSettingsRef = ref(null)
const showSemester = ref(false)
const showBatch = ref(false)
const showCourseManager = ref(false)
const showExceptions = ref(false)
const editingId = ref(null)
const error = ref('')
const batchText = ref('')
const batchError = ref('')
const ocrSummary = ref('')
const batchReviewMetadata = ref({})
const batchReviewByLine = ref({})
const cropImageFile = ref(null)
const showImageCropper = ref(false)
const message = ref('')
const showImportConflict = ref(false)
const importDraft = ref(null)
const importCommitBusy = ref(false)
const lastImportUndo = ref(null)
const batchOcrProgress = useTaskProgress()
let batchOcrController = null
let lastBatchFiles = []
let retryableImport = null
const selectedCourseIds = ref([])
const templateName = ref('')
const managerMessage = ref('')
const managerError = ref('')
const clampViewWeek = (week) => Math.min(Math.max(week, 0), MAX_WEEK)
const viewWeek = ref(clampViewWeek(appCurrentWeek.value))
const mobileView = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week')
const mobileDay = ref(currentDayIndex.value)
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


// 当前生效季在当前校区的有效选择（供主页作息按钮渲染）
const settingsSchedule = computed(() => schedulePolicy())
const seasonsForCurrentCampus = computed(() =>
  seasonsForCampus(settingsSchedule.value.campusId, timeConfig.value)
)
const showCampusSwitcher = computed(() => timeConfig.value.campuses.length > 1)
const showSeasonSwitcher = computed(() => seasonsForCurrentCampus.value.length > 1)
const currentAutoStatus = computed(() => autoSeasonStatusFor(settingsSchedule.value.campusId, timeConfig.value))

function selectScheduleCampus(campusId) {
  timeConfig.value.currentCampus = campusId
  if (timeConfig.value.autoSeason) return
  const available = seasonsForCampus(campusId, timeConfig.value)
  if (!available.some((season) => season.id === timeConfig.value.currentSeason)) {
    timeConfig.value.currentSeason = available[0]?.id ?? null
  }
}

function enableAutoSeason() {
  if (currentAutoStatus.value.available) timeConfig.value.autoSeason = true
}

const autoModeInfo = computed(() => {
  if (!showSeasonSwitcher.value) return null
  if (timeConfig.value.autoSeason) {
    const status = currentAutoStatus.value
    if (!status.available) {
      const reason = status.reason === 'missing-date'
        ? `请完善「${status.missing.map((season) => season.name).join(' / ')}」的生效日期`
        : status.reason === 'date-conflict'
          ? '当前校区存在相同生效日期，请在基础设置中调整'
          : '当前校区没有可用作息季'
      return {
        mode: 'unavailable',
        text: '自动模式暂不可用',
        hint: `${reason}；当前暂用「${seasonName(settingsSchedule.value.seasonId) || '—'}」`,
      }
    }
    return {
      mode: 'auto',
      text: `自动模式 · 当前使用「${seasonName(status.seasonId) || '—'}」`,
      hint: '根据作息季生效日期自动选择',
    }
  }
  const manual = timeConfig.value.seasons.find((s) => s.id === timeConfig.value.currentSeason)
  return {
    mode: 'manual',
    text: `当前手动使用「${manual?.name ?? '—'}」`,
    hint: '自动切换暂时关闭，点击「自动」恢复',
  }
})

function openTimeSettings() {
  showTimeEditor.value = true
}

function courseCountByPeriodId(periodId) {
  const activeCount = courses.value.filter((course) =>
    courseUsesPeriod(course, periodId, timeConfig.value.periods)
  ).length
  const templateCount = courseTemplates.value.reduce((count, template) =>
    count + (template.courses ?? []).filter((course) =>
      courseUsesPeriod(course, periodId, timeConfig.value.periods)
    ).length,
  0)
  return activeCount + templateCount
}

function stopBackgroundWork() {
  // KeepAlive 离开页面不会卸载组件；此时主动取消 OCR，避免它继续占用新页面的 CPU。
  timeSettingsRef.value?.stopBackgroundWork()
  if (batchOcrProgress.state.status === 'running') void batchOcrProgress.cancel()
  else batchOcrController?.abort()
}

onDeactivated(stopBackgroundWork)
onBeforeUnmount(stopBackgroundWork)

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

// 表单中当前格子里的其他课程（用于提示与重叠检测）
const selectedCourses = computed(() =>
  courses.value.filter((course) => selectedCourseIds.value.includes(course.id))
)
const allCoursesSelected = computed(() =>
  courses.value.length > 0 && selectedCourseIds.value.length === courses.value.length
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
const coursesRemovalTarget = ref(null) // { ids: string[], message, confirmLabel, doneMessage }

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

function confirmCoursesRemoval() {
  const target = coursesRemovalTarget.value
  coursesRemovalTarget.value = null
  if (!target) return
  // 默认只解除关联，保留历史任务、考试、日程与笔记。
  for (const id of target.ids) domain.deleteCourse(id)
  selectedCourseIds.value = []
  managerMessage.value = target.doneMessage
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

// 模板导入 / 模板删除的确认由子 Modal（CourseManagerModal）的 emit 驱动，确认框会叠成
// 第三层浮层；叠加顺序、Escape 只关最上层、取消后的焦点归还都由 Modal.vue 现有的
// isTopOverlay + 焦点还原机制负责，这里不需要额外处理。
const importTemplateTarget = ref(null)
const deleteTemplateTarget = ref(null)

function importCourseTemplate(template) {
  // 文案里的 action（追加 / 导入为空课表）依赖 courses.value.length，必须在弹确认
  // 之前定稿：确认期间课程数还可能变化，晚算会让提示与实际导入行为对不上。
  const action = courses.value.length ? '追加到当前课表' : '导入为空课表'
  importTemplateTarget.value = {
    courses: template.courses,
    message: `确定将“${template.name}”中的 ${template.courses.length} 门课程${action}吗？`,
  }
}

function confirmImportCourseTemplate() {
  const target = importTemplateTarget.value
  importTemplateTarget.value = null
  if (!target) return
  const stamp = Date.now()
  const copies = target.courses.map((course, index) => ({
    ...JSON.parse(JSON.stringify(course)),
    id: `c${stamp}_tpl_${index}`,
  }))
  beginCourseImport(copies, { source: 'template' })
}

function deleteCourseTemplate(template) {
  deleteTemplateTarget.value = template
}

function confirmDeleteCourseTemplate() {
  const target = deleteTemplateTarget.value
  deleteTemplateTarget.value = null
  if (!target) return
  courseTemplateCommands.deleteTemplate(target.id)
}

async function openBatchShift() {
  // 在打开批量工具前才加载文本解析器；不会影响课程表首次进入。
  await loadBatchParser()
  batchText.value = ''
  batchError.value = ''
  ocrSummary.value = ''
  batchReviewMetadata.value = {}
  batchReviewByLine.value = {}
  message.value = ''
  showBatch.value = true
}

function batchCourseKey(course) {
  if (!course) return ''
  return [course.name, course.day, course.start, course.end, course.startWeek, course.endWeek, course.weekType, course.room || '', course.teacher || ''].join('|')
}

function rememberCourseReviews(items, lineOffset = 0) {
  const next = { ...batchReviewMetadata.value }
  const nextByLine = { ...batchReviewByLine.value }
  for (const [index, course] of (items || []).entries()) {
    const confidence = Number(course.confidence) || 0
    if (!course.needsReview && confidence >= 70) continue
    const reasons = [...(course.reviewReasons || [])]
    if (confidence < 70) reasons.push(`OCR 文字置信度 ${Math.round(confidence)}%`)
    const reviewReasons = reasons.length ? reasons : ['OCR 结构识别结果需要核对']
    next[batchCourseKey(course)] = reviewReasons
    nextByLine[lineOffset + index + 1] = reviewReasons
  }
  batchReviewMetadata.value = next
  batchReviewByLine.value = nextByLine
}

function clearBatchInput() {
  batchText.value = ''
  batchReviewMetadata.value = {}
  batchReviewByLine.value = {}
}

function batchPeriodNumber(periodId) {
  if (!batchParserApi) return null
  return batchParserApi.numberedPeriodOptions(timeConfig.value.periods)
    .find((period) => period.id === periodId)?.number ?? null
}

const batchPeriodOptions = computed(() => {
  // batchParserApi 不是响应式变量，必须显式依赖 ready 标记；否则首次计算得到
  // 空数组后会被 computed 缓存，解析器加载完成也不会刷新节次下拉。
  if (!batchParserReady.value || !batchParserApi) return []
  return batchParserApi.numberedPeriodOptions(timeConfig.value.periods)
})

function replaceBatchRow({ sourceIndex, data }) {
  const startPeriod = batchPeriodNumber(data.start)
  const endPeriod = batchPeriodNumber(data.end)
  if (!startPeriod || !endPeriod || startPeriod > endPeriod) {
    batchError.value = '开始节次不能晚于结束节次'
    return
  }
  const weekType = data.weekType === 'odd' ? '\t单周' : data.weekType === 'even' ? '\t双周' : ''
  const room = data.room ? `\t地点:${data.room}` : ''
  const teacher = data.teacher ? `\t教师:${data.teacher}` : ''
  const replacement = `${data.name}\t${DAYS[data.day]}\t${startPeriod}-${endPeriod}节\t${data.startWeek}-${data.endWeek}周${weekType}${room}${teacher}`
  const lines = batchText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (sourceIndex < 1 || sourceIndex > lines.length) return
  lines[sourceIndex - 1] = replacement
  batchText.value = lines.join('\n')
  const remainingByLine = { ...batchReviewByLine.value }
  delete remainingByLine[sourceIndex]
  batchReviewByLine.value = remainingByLine
  batchError.value = ''
}


const batchRows = computed(() => {
  // The parser is lazy-loaded. This reactive flag makes an already-open modal
  // recalculate as soon as the module is ready instead of being stuck at 0.
  if (!batchParserReady.value || !batchParserApi) return []
  const lines = batchText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !(index === 0 && /课程.*星期/.test(line)))
    .map(({ line, index }) => {
      const row = batchParserApi.parseBatchLine(line, index + 1, timeConfig, MAX_WEEK)
      const reasons = batchReviewByLine.value[row.sourceIndex]
        || (row.data ? batchReviewMetadata.value[batchCourseKey(row.data)] : null)
      return reasons
        ? { ...row, needsReview: true, reviewReasons: [...new Set([...(row.reviewReasons || []), ...reasons])] }
        : row
    })
})

const validBatchCount = computed(() => batchRows.value.filter((row) => row.data).length)
const invalidBatchCount = computed(() => batchRows.value.filter((row) => row.error).length)
const needsReviewCount = computed(() => batchRows.value.filter((row) => row.needsReview).length)

function importBatch() {
  batchError.value = ''
  if (!batchRows.value.length) {
    batchError.value = '请先粘贴课程表内容'
    return
  }
  if (invalidBatchCount.value) {
    batchError.value = '请先修正预览中标红的内容'
    return
  }

  const stamp = Date.now()
  const incoming = batchRows.value
    .filter((row) => row.data)
    .map((row, index) => ({
      id: `c${stamp}_${index}`,
      color: PALETTE[(courses.value.length + index) % PALETTE.length],
      ...row.data,
    }))
  beginCourseImport(incoming, { source: 'batch', reviewCount: needsReviewCount.value })
}

const courseConflictOptions = computed(() => ({ maxWeek: MAX_WEEK, periodIndex: (id) => periodIndex(id) }))
const importSummary = computed(() => {
  const items = importDraft.value?.items || []
  return {
    total: items.length,
    direct: items.filter((item) => item.type === 'direct').length,
    conflicts: items.filter((item) => item.type === 'conflict').length,
    duplicates: items.filter((item) => item.type === 'duplicate').length,
  }
})
const deleteCourseTarget = ref(null)

const actionableImportItems = computed(() => (importDraft.value?.items || []).filter((item) => item.type !== 'direct'))

async function beginCourseImport(incoming, meta = {}) {
  const api = await loadCourseImport()
  const existing = meta.existingCourses ?? courses.value
  const items = api.classifyImportItems(incoming, existing, courseConflictOptions.value)
  importDraft.value = {
    source: meta.source || 'batch', reviewCount: meta.reviewCount || 0, editingId: meta.editingId || null, existing,
    snapshot: JSON.parse(JSON.stringify(courses.value)), items,
    decisions: Object.fromEntries(items.filter((item) => item.type === 'direct').map((item) => [item.index, 'add'])),
  }
  if (!items.some((item) => item.type !== 'direct')) { void commitCourseImport(); return }
  showImportConflict.value = true
}

function setImportDecision(index, decision) { if (importDraft.value) importDraft.value.decisions[index] = decision }
function cancelCourseImportReview() { showImportConflict.value = false; importDraft.value = null; batchError.value = '' }
function applyAllImportDecisions(action) {
  const draft = importDraft.value
  if (!draft) return
  for (const item of draft.items) {
    if (item.type === 'direct') continue
    if (action === 'replace') draft.decisions[item.index] = item.type === 'duplicate' ? 'skip' : 'replace'
    if (action === 'keep') draft.decisions[item.index] = 'keep'
    if (action === 'skip') draft.decisions[item.index] = 'skip'
  }
}
// 整张替换的确认。
// 【为什么把 draft 一起快照进 ref】commitCourseImport 开头会**再读一次**
// importDraft.value 并在为空时静默 return。确认期间用户可以把审阅面板关掉
// （cancelCourseImportReview 会把 importDraft 置 null），那样点了「替换」却什么都
// 不会发生。所以这里把 draft 快照进目标 ref，确认时按**显式参数**提交，
// 不再回读响应式引用；文案也一并定稿（它依赖 courses.value.length）。
const replaceAllTarget = ref(null) // { draft, message }

function commitWholeScheduleReplacement() {
  const draft = importDraft.value
  if (!draft) return
  replaceAllTarget.value = {
    draft,
    message: `确认替换当前整张课表？\n将移除现有 ${courses.value.length} 门课程，仅保留本次导入的 ${draft.items.length} 门课程。`,
  }
}

function confirmWholeScheduleReplacement() {
  const target = replaceAllTarget.value
  replaceAllTarget.value = null
  if (!target) return
  void commitCourseImport('replace-all', target.draft)
}

async function commitCourseImport(mode = 'smart', draftOverride = null) {
  // draftOverride：整张替换的确认路径显式传入确认前快照的 draft（见上）。
  const draft = draftOverride || importDraft.value
  if (!draft || importCommitBusy.value) return
  const api = await loadCourseImport()
  const plan = api.buildImportPlan({ existingCourses: draft.existing, items: draft.items, decisions: draft.decisions, mode, options: courseConflictOptions.value })
  if (!plan) { batchError.value = '请先为每一门冲突课程选择处理方式'; return }
  if (plan.unsafe.length) {
    batchError.value = `有 ${new Set(plan.unsafe.map(({ item }) => item.index)).size} 门课程仅部分重叠。为避免误删未冲突的周次或节次，当前只能选择“保留两门”或“跳过”。`
    return
  }
  importCommitBusy.value = true
  try {
    domain.replaceCourses(plan.courses)
    // Only accepted import results train the on-device correction memory.
    // OCR suggestions never leave this browser and never alter cloud data by themselves.
    void import('../composables/ocrVocabulary.js').then(({ rememberOcrCourses }) => rememberOcrCourses(plan.courses))
    lastImportUndo.value = { snapshot: draft.snapshot, expiresAt: Date.now() + 30000 }
    const summary = `新增 ${plan.added} 门，替换 ${plan.replaced} 门，跳过 ${plan.skipped} 门${plan.kept ? `，保留冲突 ${plan.kept} 门` : ''}`
    if (draft.source === 'manual') { showForm.value = false; showToast(`课程已保存：${summary}`) }
    else if (draft.source === 'template') { managerMessage.value = `模板导入完成：${summary}` }
    else { clearBatchInput(); batchError.value = ''; message.value = `导入完成：${summary}${draft.reviewCount ? `（${draft.reviewCount} 门建议确认）` : ''}` }
    showImportConflict.value = false
    importDraft.value = null
  } catch (e) {
    domain.replaceCourses(draft.snapshot)
    batchError.value = '写入失败，已自动恢复导入前课表'
  } finally { importCommitBusy.value = false }
}
function undoLastCourseImport() {
  const undo = lastImportUndo.value
  if (!undo || Date.now() > undo.expiresAt) return
  domain.replaceCourses(JSON.parse(JSON.stringify(undo.snapshot)))
  lastImportUndo.value = null
  message.value = '已撤销本次导入，课表已恢复'
}

function continueBatchImport() {
  message.value = ''
  clearBatchInput()
  ocrSummary.value = ''
}

function finishBatchImport() {
  message.value = ''
  showBatch.value = false
}

// OCR 进度步骤与事件映射，仅服务于“批量识图课程表”流程。
const TIMETABLE_OCR_STEPS = [
  { id: 'read', label: '读取图片队列' },
  { id: 'engine', label: '准备识别引擎' },
  { id: 'recognize', label: '识别课程文字' },
  { id: 'structure', label: '恢复星期与节次结构' },
  { id: 'validate', label: '校验课程字段' },
  { id: 'preview', label: '生成导入预览' },
]

function handleOcrActivity(progress, event, recognizeStep = 'structure') {
  const stage = String(event?.stage || '').replace(/\.\.\./g, '…')
  if (!stage) return
  if (/检查图片|处理图片/.test(stage)) progress.setStep('read', 'running', stage)
  else if (/初始化|加载|模型|内核|接口|就绪/.test(stage)) {
    progress.setStep('read', 'completed', '图片读取完成')
    progress.setStep('engine', 'running', stage)
  } else if (/识别|核对|分列/.test(stage)) {
    progress.setStep('engine', 'completed', '识别引擎已就绪')
    progress.setStep(recognizeStep, 'running', stage)
  } else progress.activity(stage)
}

function isOcrEngineFailure(progress, message) {
  if (/未识别到文字|图片(?:尺寸)?太小|图片格式|请选择图片/.test(message)) return false
  const engineStep = progress.state.steps.find((step) => step.id === 'engine')
  return engineStep?.status === 'running'
    || /初始化|语言模型|OCR 内核|Worker|Failed to fetch|NetworkError|script load|动态导入/i.test(message)
}

function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}

async function ocrImage(event) {
  const files = [...(event.target.files || [])]
  if (!files.length) return
  if (files.some((file) => !file.type.startsWith('image/'))) {
    batchError.value = '请选择图片文件'
    return
  }
  event.target.value = ''
  await runTimetableOCR(files)
}

function selectCropImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file?.type?.startsWith('image/')) { batchError.value = '请选择一张图片文件'; return }
  cropImageFile.value = file
  showImageCropper.value = true
}

const EXCEL_IMPORT_STEPS = [
  { id: 'read', label: '读取 Excel 文件' },
  { id: 'sheets', label: '识别工作表结构' },
  { id: 'structure', label: '还原课程字段与星期列' },
  { id: 'preview', label: '生成可编辑导入预览' },
]

function isExcelFile(file) {
  return /\.(?:xlsx|xls|xlsm|xlsb|csv|ods)$/i.test(file?.name || '')
}

async function importExcel(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !isExcelFile(file)) {
    batchError.value = '请选择 Excel、CSV 或 ODS 课程表文件'
    return
  }
  await runExcelImport(file)
}

async function runExcelImport(file) {
  if (batchOcrProgress.state.status === 'running') return
  let cancelled = false
  retryableImport = { type: 'excel', file }
  batchError.value = ''
  batchOcrProgress.start({
    title: '正在读取 Excel 课程表',
    steps: EXCEL_IMPORT_STEPS,
    cancel: () => { cancelled = true },
  })
  try {
    batchOcrProgress.setStep('read', 'running', `正在读取 ${file.name}`)
    const extracted = await extractExcelTimetable(file)
    if (cancelled) return
    batchOcrProgress.setStep('read', 'completed', '文件已在本机读取，未上传服务器')
    batchOcrProgress.setStep('sheets', 'running', '正在识别课程清单或星期表格')
    if (!extracted.count) throw new Error('没有找到可识别的课程清单或星期表头，请确认文件包含课程名称、星期和节次')
    batchOcrProgress.setStep('sheets', 'completed', `已识别工作表“${extracted.sheetName}”的${extracted.mode === 'grid' ? '星期表格' : '课程清单'}`)
    batchOcrProgress.setStep('structure', 'running', '正在还原课程字段、周次与节次')
    let importText = extracted.batchText
    let table = null
    if (extracted.columns?.length) {
      const structured = await extractTimetable({ columns: extracted.columns, layout: null })
      table = structured.table
      importText = table.batchText
      const lineOffset = batchText.value.split(/\r?\n/).filter((line) => line.trim()).length
      rememberCourseReviews(table.courses, lineOffset)
    }
    if (!importText.trim()) throw new Error('已读到课表，但未能还原课程的周次或节次；请检查单元格是否包含“1-16周”和“1-2节”')
    await loadBatchParser()
    const parsed = importText.split(/\r?\n/)
      .map((line, index) => batchParserApi.parseBatchLine(line, index + 1, timeConfig, MAX_WEEK))
    const validCount = parsed.filter((row) => row.data).length
    if (!validCount) throw new Error('已读取 Excel，但课程字段不完整。请检查预览中是否包含星期和节次')
    batchText.value = (batchText.value ? `${batchText.value}\n` : '') + importText
    const reviewCount = Math.max(parsed.filter((row) => row.needsReview).length, table?.diagnostics.reviewCount || 0)
    const label = extracted.mode === 'grid' ? '星期表格' : '课程清单'
    ocrSummary.value = `已从 Excel 工作表“${extracted.sheetName}”识别 ${validCount} 门课程（${label}），结果已放入预览，确认后才会写入课表。${reviewCount ? `其中 ${reviewCount} 门建议确认。` : ''}`
    batchOcrProgress.setStep('structure', reviewCount ? 'warning' : 'completed', `已还原 ${validCount} 门课程${reviewCount ? '，部分建议确认' : ''}`)
    batchOcrProgress.setStep('preview', 'running', '正在生成可编辑导入预览')
    batchOcrProgress.setPartial({ 工作表: extracted.sheetName, 课程: validCount, 格式: label }, 'Excel 解析完成')
    batchOcrProgress.setStep('preview', 'completed', '导入预览已生成，尚未写入课表')
    batchOcrProgress.finish('Excel 课程表已解析，请确认预览', reviewCount ? 'warning' : 'completed')
  } catch (error) {
    if (cancelled) return
    const message = error?.message || 'Excel 课程表读取失败，请检查文件格式后重试'
    batchError.value = message
    batchOcrProgress.fail('structure', message, { retry: true })
  }
}

async function recognizeCroppedImage(file) {
  showImageCropper.value = false
  cropImageFile.value = null
  if (!file) return
  batchError.value = ''
  ocrSummary.value = '已按框选区域裁切图片，正在重新识别。'
  await runTimetableOCR([file])
}

async function runTimetableOCR(files) {
  if (!files.length) return
  if (batchOcrProgress.state.status === 'running') return
  lastBatchFiles = files
  retryableImport = { type: 'image', files }
  const controller = new AbortController()
  batchOcrController = controller
  batchOcrProgress.start({
    title: files.length > 1 ? `正在识别 ${files.length} 张课程表` : '正在识别课程表',
    steps: TIMETABLE_OCR_STEPS,
    cancel: () => controller.abort(),
  })
  batchOcrProgress.setStep('read', 'running', `已选择 ${files.length} 张图片`)

  const summaries = []
  const failures = []
  try {
    for (const [index, file] of files.entries()) {
      if (controller.signal.aborted) break
      try {
      ocrSummary.value = files.length > 1 ? `正在识别第 ${index + 1}/${files.length} 张：${file.name}` : ''
      batchOcrProgress.setStep('read', 'completed', `图片队列已读取，共 ${files.length} 张`)
      batchOcrProgress.activity(`开始处理第 ${index + 1}/${files.length} 张：${file.name}`)
      let result
      try {
        result = await performAccurateOCR(
          file,
          (event) => handleOcrActivity(batchOcrProgress, event, 'recognize'),
          { kind: 'timetable', mode: 'accurate', signal: controller.signal },
        )
      } catch (accurateError) {
        if (accurateError?.name === 'AbortError') throw accurateError
        if (import.meta.env.DEV) console.warn('[OCR] 精准课表识别降级为兼容模式', accurateError)
        batchOcrProgress.activity('精准识别不可用，正在切换兼容引擎')
        result = await performLegacyOCR(
          file,
          (event) => handleOcrActivity(batchOcrProgress, event, 'recognize'),
          { signal: controller.signal },
        )
      }
      batchOcrProgress.setStep('engine', 'completed', '识别引擎已就绪')
      batchOcrProgress.setStep('recognize', 'completed', `第 ${index + 1}/${files.length} 张文字识别完成`)
      batchOcrProgress.setStep('structure', 'running', '正在分析文字区域、表头与单元格关系')
      const { table, toBatchLine } = await extractTimetable(result)
      const vocabularyChanges = await applyTimetableVocabulary(table)
      if (vocabularyChanges.length) table.batchText = table.courses.map(toBatchLine).join('\n')
      const lineOffset = batchText.value.split(/\r?\n/).filter((line) => line.trim()).length
      rememberCourseReviews(table.courses, lineOffset)
      batchOcrProgress.setStep(
        'structure',
        table.needsReview ? 'warning' : 'completed',
        table.needsReview
          ? '存在待确认的表头或字段，已保留可编辑结果供手动确认'
          : `恢复 ${table.courses.length} 门课程的空间归属${vocabularyChanges.length ? `，已应用 ${vocabularyChanges.length} 个本地词库建议` : ''}`,
      )
      batchOcrProgress.setStep('validate', 'running', '正在检查课程字段与行列对应')
      const recognizedText = table.batchText || result.text
      batchText.value = (batchText.value ? batchText.value + '\n' : '') + recognizedText
      summaries.push({ name: file.name, table, result })
      const currentCourses = summaries.reduce((sum, item) => sum + item.table.courses.length, 0)
      const currentReviews = summaries.reduce((sum, item) => sum + item.table.diagnostics.reviewCount, 0)
      batchOcrProgress.setPartial({ 图片: `${summaries.length}/${files.length}`, 课程: currentCourses, 建议确认: currentReviews }, `第 ${index + 1}/${files.length} 张处理完成`)
      } catch (e) {
        if (e?.name === 'AbortError') return
        failures.push(`${file.name}：${e.message}`)
        batchOcrProgress.activity(`第 ${index + 1}/${files.length} 张失败，已保留此前结果`)
      }
    }
    if (!summaries.length && failures.length) {
      batchError.value = `图片识别失败：${failures.join('；')}`
      const engineFailed = isOcrEngineFailure(batchOcrProgress, failures.join('；'))
      if (!engineFailed) batchOcrProgress.setStep('engine', 'completed', '识别引擎已启动')
      batchOcrProgress.fail(engineFailed ? 'engine' : 'recognize', batchError.value, { retry: true })
      return
    }
    batchOcrProgress.setStep('validate', failures.length ? 'warning' : 'completed', failures.length ? `${failures.length} 张图片需要重试` : '课程字段与结构检查完成')
    batchOcrProgress.setStep('preview', 'running', '正在生成可编辑导入预览')
    const courseCount = summaries.reduce((sum, item) => sum + item.table.courses.length, 0)
    const reviewCount = summaries.reduce((sum, item) => sum + item.table.diagnostics.reviewCount, 0)
    ocrSummary.value = courseCount
      ? `已从 ${summaries.length} 张图片恢复 ${courseCount} 门课程${reviewCount ? `，其中 ${reviewCount} 门建议确认` : ''}。请检查预览后再导入。`
      : '已提取图片文字，但没有可靠恢复表格位置。可裁剪到课表区域后重试，或在文本框补充星期与节次。'
    batchError.value = failures.length ? `部分图片未识别：${failures.join('；')}` : ''
    batchOcrProgress.setStep('preview', 'completed', '导入预览已生成，尚未写入课表')
    batchOcrProgress.finish(
      failures.length ? `已保留 ${summaries.length} 张图片的结果，${failures.length} 张需要重试` : '全部图片识别完成，请确认预览',
      failures.length || reviewCount ? 'warning' : 'completed',
    )
  } finally {
    if (batchOcrController === controller) batchOcrController = null
  }
}

function retryBatchOCR() {
  if (retryableImport?.type === 'excel') void runExcelImport(retryableImport.file)
  else if (lastBatchFiles.length) void runTimetableOCR(lastBatchFiles)
}

function continueBatchResults() {
  batchOcrProgress.reset()
}

const curWeek = computed(() => clampViewWeek(appCurrentWeek.value))

function goWeek(delta) {
  const next = viewWeek.value + delta
  if (next >= 0 && next <= MAX_WEEK) viewWeek.value = next
}

function saveSemester(value) {
  if (!value) return
  semester.value.start = value
  viewWeek.value = curWeek.value
  showSemester.value = false
}

function semesterPreview() {
  return weekOf(appToday.value)
}

function shiftMobileDay(delta) {
  const next = mobileDay.value + delta
  if (next >= 0 && next <= 6) mobileDay.value = next
}

const sortedExceptions = computed(() =>
  [...scheduleExceptions.value].sort((a, b) => a.date.localeCompare(b.date))
)

function openExceptionManager() {
  showExceptions.value = true
}

function saveException(payload) {
  upsertScheduleException(payload)
}

function removeException(id) {
  removeScheduleException(id)
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

function confirmDeleteCourse() {
  const course = deleteCourseTarget.value
  if (!course) return
  domain.deleteCourse(course.id)
  deleteCourseTarget.value = null
}

function periodOption(id) {
  const label = periodLabelById(id)
  const t = periodRangeById(id)
  return t ? `${label}（${t}）` : label
}

const todayIdx = currentDayIndex

function weekdayIndex(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 6 : day - 1
}

async function focusRouteCourse() {
  const { id, date } = readFocusQuery(route)
  if (!id || focusHandled === id) return
  focusHandled = id
  const course = courses.value.find((item) => String(item.id) === id)
  if (!course) {
    focusMessage.value = '这门课程可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
    return
  }
  showArchivedCourses.value = isArchived(course)
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : dateForWeekDay(clampViewWeek(appCurrentWeek.value), course.day)
  viewWeek.value = clampViewWeek(weekOf(targetDate))
  mobileDay.value = weekdayIndex(targetDate)
  focusedCourseId.value = id
  await nextTick()
  const element = await focusElementWhenReady(id, { date: targetDate }) || await focusElementWhenReady(id)
  if (!element) focusMessage.value = '这门课程可能已删除或已移动。'
  await clearFocusFromRoute(router, route)
}

watch(
  () => [route.query.focus, route.query.date, courses.value.length, viewWeek.value, mobileDay.value],
  () => { void focusRouteCourse() },
  { immediate: true }
)

// OCR Worker 是模块级单例，返回课表时仍可复用已经加载的模型。
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="page-title">课程表</h1>
      <div class="head-btns">
        <button class="btn btn-ghost" :aria-expanded="showArchivedCourses" @click="showArchivedCourses = !showArchivedCourses">{{ showArchivedCourses ? '返回当前课程' : '历史课程' }}</button>
        <button class="btn btn-ghost" :aria-expanded="showScheduleSettings" @click="showScheduleSettings = !showScheduleSettings">{{ showScheduleSettings ? '收起设置' : '更多设置' }}</button>
      </div>
    </div>

    <section v-if="showScheduleSettings" class="schedule-settings" aria-label="课程表设置">
      <div><h2>课程</h2><button class="btn btn-ghost" @click="openCourseManager">☷ 批量管理</button><button class="btn btn-ghost" @click="openBatchShift">⇩ 导入课程表</button></div>
      <div><h2>时间与日期</h2><button class="btn btn-ghost" @click="showSemester = true">📅 学期</button><button class="btn btn-ghost" @click="openTimeSettings">🕐 作息与节次</button><button class="btn btn-ghost" @click="openExceptionManager">🗓 特殊日期</button></div>
      <div><h2>显示</h2><button class="btn btn-ghost" @click="mobileView = mobileView === 'day' ? 'week' : 'day'">{{ mobileView === 'day' ? '切换整周视图' : '切换单日视图' }}</button></div>
    </section>

    <div class="toolbar">
      <div class="seg-group skin-switcher">
        <span class="seg-label">皮肤</span>
        <div class="seg">
          <button :class="{ on: appearance.scheduleSkin === 'classic' }" @click="appearance.scheduleSkin = 'classic'">经典</button>
          <button :class="{ on: appearance.scheduleSkin === 'notebook' }" @click="appearance.scheduleSkin = 'notebook'">笔记</button>
          <button :class="{ on: appearance.scheduleSkin === 'timeline' }" @click="appearance.scheduleSkin = 'timeline'">极简</button>
        </div>
      </div>
      <div v-if="showCampusSwitcher" class="seg-group schedule-campus">
        <span class="seg-label">校区</span>
        <div class="seg">
          <button
            v-for="campus in timeConfig.campuses"
            :key="campus.id"
            :class="{ on: settingsSchedule.campusId === campus.id }"
            @click="selectScheduleCampus(campus.id)"
          >
            {{ campus.name }}
          </button>
        </div>
      </div>
      <div v-if="showSeasonSwitcher" class="seg-group schedule-season">
        <span class="seg-label">作息</span>
        <div class="seg">
          <button
            :class="{ on: timeConfig.autoSeason && currentAutoStatus.available }"
            :disabled="!currentAutoStatus.available"
            :title="currentAutoStatus.available ? '根据当前日期自动选择' : '完善生效日期并解决冲突后可用'"
            @click="enableAutoSeason"
          >
            自动
          </button>
          <button
            v-for="season in seasonsForCurrentCampus"
            :key="season.id"
            :class="{ on: !timeConfig.autoSeason && settingsSchedule.seasonId === season.id }"
            @click="timeConfig.autoSeason = false; timeConfig.currentSeason = season.id"
          >
            {{ season.name }}
          </button>
        </div>
      </div>
      <div class="seg-group">
        <span class="seg-label">周次</span>
        <!-- 翻周按钮内部只有「‹」「›」，读屏会把它念成符号，方向信息完全丢失，所以用
             aria-label 说清是上一周还是下一周；符号本身保持可见，不需要 aria-hidden。
             .seg button 的命中区在手机上偏小，一并标记 tap-target 由粗指针样式放大。 -->
        <div class="seg">
          <button class="tap-target" aria-label="上一周" :disabled="viewWeek <= 0" @click="goWeek(-1)">‹</button>
          <!-- 周次本身不是一个动作，只是把「现在在第几周」显示在两个翻周按钮中间。
               它原来写成一个 button 元素，于是变成一个按下去什么都不会发生的 Tab
               停靠点，读屏也会念「第 5 周 按钮」暗示可以点。这里改成非交互的 span：
               它不该出现在 Tab 顺序里，也不该被当成控件。 -->
          <span class="wn" :class="{ thisweek: viewWeek === curWeek }" aria-live="polite">
            {{ viewWeek < 1 ? '开学前' : `第 ${viewWeek} 周` }}
          </span>
          <button class="tap-target" aria-label="下一周" :disabled="viewWeek >= MAX_WEEK" @click="goWeek(1)">›</button>
        </div>
        <button v-if="viewWeek !== curWeek" class="btn btn-ghost" @click="viewWeek = curWeek">
          回到本周
        </button>
      </div>

      <div class="seg-group mobile-view-switcher">
        <span class="seg-label">视图</span>
        <div class="seg">
          <button :class="{ on: mobileView === 'day' }" @click="mobileView = 'day'">单日</button>
          <button :class="{ on: mobileView === 'week' }" @click="mobileView = 'week'">整周</button>
        </div>
      </div>

      <!-- 自动/手动作息模式提示（仅在多作息季时出现） -->
      <p v-if="autoModeInfo" class="auto-mode-hint" :class="autoModeInfo.mode">
        <template v-if="autoModeInfo.mode === 'auto'">⏱ {{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
        <template v-else-if="autoModeInfo.mode === 'unavailable'">⚠ {{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
        <template v-else>✋ {{ autoModeInfo.text }}<small>{{ autoModeInfo.hint }}</small></template>
      </p>

      <div class="add-actions">
        <button class="btn btn-primary" @click="openAdd()">＋ 添加课程</button>
      </div>
    </div>

    <p v-if="focusMessage" class="notice-success" role="status">{{ focusMessage }}</p>

    <ScheduleGrid
      :courses="visibleCourses"
      :view-week="viewWeek"
      :mobile-view="mobileView"
      :mobile-day="mobileDay"
      :current-week="curWeek"
      :current-day-index="todayIdx"
      :focused-course-id="focusedCourseId"
      :appearance="appearance"
      @open-add="openAdd"
      @open-edit="openEdit"
      @mobile-day-change="shiftMobileDay"
    />

    <div class="schedule-note">
      <textarea
        ref="scheduleNoteEl"
        v-model="scheduleNote"
        rows="1"
        aria-label="课程表备注"
        placeholder="📝 课程表备注..."
        class="schedule-note-input"
        @input="resizeScheduleNote"
        @blur="saveScheduleNote"
      ></textarea>
    </div>

    <CourseEditorModal
      :open="showForm"
      :editing-id="editingId"
      :form="form"
      :courses="courses"
      :time-config="timeConfig"
      :linked-tasks="editingId ? tasks.filter((task) => task.courseId === editingId) : []"
      :linked-countdowns="editingId ? countdowns.filter((item) => item.category === '学习' && item.courseId === editingId) : []"
      :linked-review-progress="editingId ? linkedStudyProgress(editingId) : null"
      @close="showForm = false"
      @save="saveCourseFromEditor"
      @delete="removeCourseFromEditor"
      @archive="archiveCourseFromEditor"
      @add-another="addAnotherInCell"
      @add-homework="openHomeworkForCourse"
    />

    <QuickRecordPanel
      v-if="quickHomeworkCourse"
      :open="Boolean(quickHomeworkCourse)"
      :context="{ preferredType: 'homework', courseId: quickHomeworkCourse.id, courseName: quickHomeworkCourse.name }"
      @saved="onHomeworkSaved"
      @close="closeHomeworkRecord"
    />

    <ConfirmDialog
      :open="Boolean(deleteCourseTarget)"
      title="删除课程"
      :message="`确定删除课程“${deleteCourseTarget?.name || ''}”吗？关联待办和重要日期会保留，但将不再关联此课程。`"
      confirm-label="删除课程"
      @close="deleteCourseTarget = null"
      @confirm="confirmDeleteCourse"
    />

    <!-- 下面四个都由子 Modal（课程管理器 / 导入冲突审阅）的 emit 驱动，会叠在那一层之上，
         所以一律 v-if 随目标挂载：锚点在打开这一刻才创建，才排得到浮层栈顶端
         （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
    <ConfirmDialog
      v-if="coursesRemovalTarget"
      :open="Boolean(coursesRemovalTarget)"
      title="删除课程"
      :message="coursesRemovalTarget?.message || ''"
      :confirm-label="coursesRemovalTarget?.confirmLabel || '删除'"
      @close="coursesRemovalTarget = null"
      @confirm="confirmCoursesRemoval"
    />

    <ConfirmDialog
      v-if="importTemplateTarget"
      :open="Boolean(importTemplateTarget)"
      title="导入课表模板"
      :message="importTemplateTarget?.message || ''"
      confirm-label="导入"
      @close="importTemplateTarget = null"
      @confirm="confirmImportCourseTemplate"
    />

    <ConfirmDialog
      v-if="deleteTemplateTarget"
      :open="Boolean(deleteTemplateTarget)"
      title="删除课表模板"
      :message="`确定删除课表模板“${deleteTemplateTarget?.name || ''}”吗？`"
      confirm-label="删除模板"
      @close="deleteTemplateTarget = null"
      @confirm="confirmDeleteCourseTemplate"
    />

    <ConfirmDialog
      v-if="replaceAllTarget"
      :open="Boolean(replaceAllTarget)"
      title="替换整张课表"
      :message="replaceAllTarget?.message || ''"
      confirm-label="确认替换"
      @close="replaceAllTarget = null"
      @confirm="confirmWholeScheduleReplacement"
    />

    <CourseManagerModal
      :open="showCourseManager"
      :courses="visibleCourses"
      :templates="courseTemplates"
      :selected-ids="selectedCourseIds"
      :template-name="templateName"
      :message="managerMessage"
      :error="managerError"
      @close="showCourseManager = false"
      @toggle-all="toggleAllCourses"
      @toggle-course="toggleCourseSelection"
      @duplicate="duplicateSelectedCourses"
      @delete-selected="deleteSelectedCourses"
      @clear="clearCurrentSchedule"
      @update:template-name="templateName = $event; managerError = ''"
      @save-template="saveCourseTemplate"
      @import-template="importCourseTemplate"
      @delete-template="deleteCourseTemplate"
    />

    <BatchImportModal
      :show="showBatch"
      :text="batchText"
      :rows="batchRows"
      :valid-count="validBatchCount"
      :invalid-count="invalidBatchCount"
      :review-count="needsReviewCount"
      :days="DAYS"
      :periods="batchPeriodOptions"
      :max-week="MAX_WEEK"
      :progress="batchOcrProgress"
      :summary="ocrSummary"
      :message="message"
      :error="batchError"
      :can-undo="Boolean(lastImportUndo)"
      @close="showBatch = false"
      @update:text="batchText = $event"
      @update:error="batchError = $event"
      @clear="clearBatchInput"
      @replace-row="replaceBatchRow"
      @import="importBatch"
      @upload-image="ocrImage"
      @crop-image="selectCropImage"
      @upload-excel="importExcel"
      @cancel-progress="batchOcrProgress.cancel()"
      @retry-progress="retryBatchOCR"
      @continue-progress="continueBatchResults"
      @wait-progress="batchOcrProgress.continueWaiting()"
      @undo="undoLastCourseImport"
      @continue-import="continueBatchImport"
      @finish-import="finishBatchImport"
    />

    <ImageCropModal :show="showImageCropper" :file="cropImageFile" @close="showImageCropper = false; cropImageFile = null" @confirm="recognizeCroppedImage" />

    <ImportConflictModal
      :show="showImportConflict"
      :draft="importDraft"
      :summary="importSummary"
      :actionable="actionableImportItems"
      :days="DAYS"
      :periods="timeConfig.periods"
      :busy="importCommitBusy"
      :error="batchError"
      @close="cancelCourseImportReview"
      @decision="setImportDecision"
      @decisions="applyAllImportDecisions"
      @commit="commitCourseImport()"
      @replace-all="commitWholeScheduleReplacement"
    />

<ExceptionsModal
      :show="showExceptions"
      :exceptions="sortedExceptions"
      :days="DAYS"
      @close="showExceptions = false"
      @submit="saveException"
      @remove="removeException"
    />

    <SemesterModal
      :show="showSemester"
      :start-date="semester.start"
      :preview-week="semesterPreview()"
      @close="showSemester = false"
      @save="saveSemester"
    />

    <TimeSettingsModal
      ref="timeSettingsRef"
      :show="showTimeEditor"
      :course-count-by-period-id="courseCountByPeriodId"
      @close="showTimeEditor = false"
    />

    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :view-fn="toast.viewFn" :duration="toast.duration" @action="() => {}" @close="toast.open = false" />
  </div>
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
.timetable {
  grid-template-columns:84px repeat(7,minmax(96px,1fr));
  gap:5px;
  min-width:820px;
  display:grid}
.course.conflict {
  outline:2px dashed var(--danger);
  outline-offset:-2px}

/* `.skin-*` 是 ScheduleGrid 动态拼出来的类（` :class="`skin-${appearance.scheduleSkin}`" `），
   不是死类。第三十七轮的死类清理正是把这类动态前缀当成了没人用，误删了 6 个文件约 259 条规则；
   这一族规则是在用构建产物恢复时一并搬进来的，**别在没有比对 ScheduleGrid 的定义之前删它们**。
   另外本文件里 `.skin-notebook` 一族出现了两次、声明逐字相同（记在 §4 第 23 条待清理）。 */
.skin-notebook {
  background:linear-gradient(90deg,#0000 58px,#da5e5e38 59px,#0000 60px),repeating-linear-gradient(#fffdf7 0 31px,#dce7ef 32px);
  border-color:#ddcfab;
  box-shadow:0 10px 28px #6c532317}
.page {
  flex-direction:column;
  gap:16px;
  display:flex}
.head {
  justify-content:space-between;
  align-items:center;
  display:flex}
.head h2 {
  font-size:22px}
.head-btns {
  gap:10px;
  display:flex}
.schedule-settings {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:12px;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px;
  padding:14px;
  display:grid}
.schedule-settings>div {
  flex-wrap:wrap;
  align-items:center;
  gap:7px;
  min-width:0;
  display:flex}
.schedule-settings h2 {
  width:100%;
  color:var(--ink-faint);
  letter-spacing:.04em;
  font-size:11px}
.schedule-settings .btn {
  padding:7px 10px;
  font-size:12px}
.toolbar {
  flex-wrap:wrap;
  align-items:center;
  gap:16px;
  display:flex}
.seg-group {
  align-items:center;
  gap:8px;
  min-width:0;
  display:flex}
.seg-label {
  color:var(--muted);
  font-size:13px}
.seg {
  background:var(--card);
  border:1px solid var(--border);
  border-radius:10px;
  max-width:100%;
  padding:3px;
  display:flex;
  overflow-x:auto}
.seg button {
  color:var(--muted);
  background:0 0;
  border:none;
  border-radius:8px;
  flex:none;
  padding:7px 14px;
  font-size:14px}
.seg button:disabled {
  opacity:.35;
  cursor:default}
.seg button.on {
  background:var(--primary);
  color:var(--on-primary,#fff);
  font-weight:600}
.seg .wn {
  min-width:84px;
  color:var(--text);
  border-radius:8px;
  flex:none;
  place-items:center;
  padding:7px 14px;
  font-size:14px;
  font-weight:700;
  display:grid}
.seg .wn.thisweek {
  color:var(--primary)}
.add-actions {
  gap:8px;
  min-width:0;
  margin-left:auto;
  display:flex}
.exception-tag.makeup {
  color:#6a45c4;
  background:#f1ebff}
/* 这一条**必须**排在上一条之后，位置别再挪。两者特异性相同（都是 0,2,0）、都设 background，
   所以顺序直接决定"笔记本皮肤下悬停或今天是格用哪个底色"。第五十一轮做同值规则去重时，
   后出现的那份 `.skin-notebook` 一族被删掉，顺序因此翻转；这里把这一条移回它最后一次出现的
   位置，恢复去重前的级联结果。改位置前先看 tests/cssRules.test.js 里的顺序判据。 */







.form {
  flex-direction:column;
  gap:8px;
  display:flex}
.form label {
  color:var(--muted);
  margin-top:6px;
  font-size:13px}
.form input,.form select {
  width:100%}
.row {
  gap:10px;
  margin-top:6px;
  display:flex}
.row>div {
  flex-direction:column;
  flex:1;
  gap:8px;
  display:flex}
.colors {
  gap:8px;
  margin:4px 0;
  display:flex}
.swatch {
  border:3px solid #0000;
  border-radius:50%;
  width:28px;
  height:28px}

.error {
  color:var(--danger);
  font-size:13px}
.muted-tip {
  color:var(--muted);
  background:var(--bg);
  border-radius:8px;
  padding:10px 12px;
  font-size:13px;
  line-height:1.6}

.auto-mode-hint {
  color:var(--ink-soft);
  flex-wrap:wrap;
  align-items:baseline;
  gap:10px;
  margin:-6px 0 0;
  font-size:12px;
  line-height:1.5;
  display:flex}
.auto-mode-hint small {
  color:var(--ink-faint);
  font-size:11px}
.auto-mode-hint.auto small:before {
  content:"·";
  margin:0 6px}
.auto-mode-hint.unavailable {
  color:var(--warning)}
.mobile-view-switcher {
  display:none}
@media (max-width:760px) {
  .skin-switcher,.schedule-campus,.schedule-season {
  display:none}
.schedule-settings {
  grid-template-columns:1fr;
  gap:11px}
.head {
  flex-direction:column;
  align-items:flex-start;
  gap:12px}
.head-btns {
  flex-wrap:nowrap;
  width:100%;
  padding-bottom:2px;
  overflow-x:auto}
.head-btns .btn {
  flex:none;
  min-height:44px;
  padding-inline-start:12px;
  padding-inline-end:12px}
.toolbar {
  align-items:flex-start;
  gap:12px}
.seg-group {
  flex-direction:column;
  align-items:flex-start;
  gap:5px;
  max-width:100%}
.toolbar .seg {
  max-width:calc(100vw - 40px)}
.add-actions {
  width:100%;
  margin-left:0}
.add-actions .btn {
  text-overflow:ellipsis;
  white-space:nowrap;
  flex:1;
  min-width:0;
  overflow:hidden}
.manager-head,.clear-row {
  flex-direction:column;
  align-items:flex-start}
.manager-actions,.manager-actions .btn,.clear-row .btn {
  width:100%}

.mobile-view-switcher {
  display:flex}
}
@media (max-width:520px) {
  .head h2 {
  font-size:20px}
.row {
  flex-direction:column}
.colors {
  flex-wrap:wrap}





.scheme-card>.btn-xs {
  grid-column:1/-1;
  justify-self:end}

.mobile-view-switcher {
  width:100%}
.mobile-view-switcher .seg,.mobile-view-switcher .seg button {
  flex:1}
}
.settings {
  flex-direction:column;
  gap:18px;
  display:flex}
.settings-hint {
  color:var(--muted);
  background:var(--bg);
  border-radius:8px;
  padding:10px 12px;
  font-size:12px;
  line-height:1.6}
.setting-section {
  flex-direction:column;
  gap:8px;
  display:flex}
.setting-head {
  flex-wrap:wrap;
  align-items:baseline;
  gap:10px;
  display:flex}


.setting-row {
  align-items:center;
  gap:8px;
  display:flex}

.setting-row input.date {
  text-align:center;
  flex:0 0 90px}
.setting-add {
  gap:8px;
  margin-top:2px;
  display:flex}

.setting-add input.date {
  text-align:center;
  flex:0 0 90px}
.period-grid {
  grid-template-columns:1fr 1fr;
  gap:8px;
  display:grid}
.gen-box {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:10px;
  flex-direction:column;
  gap:10px;
  padding:12px 14px;
  display:flex}
.gen-title {
  color:var(--primary);
  font-size:13px;
  font-weight:700}
.gen-grid {
  flex-wrap:wrap;
  gap:8px 16px;
  display:flex}
.gen-item {
  color:var(--muted);
  align-items:center;
  gap:5px;
  font-size:12px;
  display:flex}
.gen-item input,.gen-item select {
  border-radius:6px;
  padding:5px 7px;
  font-size:12px}

.gen-item input[type=time] {
  width:96px}




.cell-add-hint {
  color:var(--muted);
  background:var(--bg);
  border-radius:8px;
  flex-wrap:wrap;
  justify-content:space-between;
  align-items:center;
  gap:10px;
  margin-top:12px;
  padding:10px 12px;
  font-size:12px;
  line-height:1.6;
  display:flex}
.cell-add-hint .btn {
  flex:none;
  padding:7px 12px;
  font-size:12px}
.tab-bar {
  flex-wrap:wrap;
  gap:6px;
  display:flex}
.tab-btn {
  color:var(--muted);
  border:1px solid var(--border);
  background:var(--card);
  border-radius:9px;
  padding:8px 14px;
  font-size:13px}
.tab-btn.on {
  color:var(--on-primary,#fff);
  border-color:var(--primary);
  background:var(--primary);
  font-weight:700}
.cell-existing {
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
  margin-top:8px;
  display:flex}
.ce-label {
  color:var(--muted);
  font-size:12px}
.cell-chip {
  color:var(--primary);
  background:var(--primary-soft);
  border-radius:6px;
  padding:4px 8px;
  font-size:11px;
  font-weight:600}
.cell-chip.clash {
  color:var(--danger);
  background:color-mix(in srgb, var(--danger) 12%, var(--card))}
.course-links {
  border:1px solid var(--border);
  background:var(--bg);
  border-radius:10px;
  margin-top:14px;
  padding:12px}
.course-links-head,.course-link-columns {
  gap:12px;
  display:flex}
.course-links-head {
  justify-content:space-between;
  align-items:flex-start}
.course-links-head b,.course-links-head small,.link-label,.link-list small {
  display:block}
.course-links-head small,.link-empty,.link-list small {
  color:var(--muted);
  font-size:12px}
.link-progress {
  color:var(--primary);
  background:var(--primary-soft);
  white-space:nowrap;
  border-radius:999px;
  padding:4px 7px;
  font-size:12px;
  font-weight:700}
.course-link-columns>div {
  flex:1;
  min-width:0}
.course-link-columns {
  margin-top:10px}
.link-label {
  font-size:12px;
  font-weight:700}
.link-empty {
  margin:6px 0}
.link-list {
  margin:6px 0;
  padding:0;
  list-style:none}
.link-list li {
  padding:4px 0;
  overflow:hidden}
.link-list span {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:12px;
  display:block;
  overflow:hidden}
.link-list .done {
  color:var(--muted);
  text-decoration:line-through}
.link-action {
  color:var(--primary);
  font-size:12px;
  font-weight:700;
  text-decoration:none}
@media (max-width:520px) {
  .course-link-columns {
  flex-direction:column;
  gap:10px}
}
.schedule-note {
  margin-top:8px}
.schedule-note-input {
  border:1px solid var(--border);
  background:var(--card);
  width:100%;
  min-height:38px;
  max-height:180px;
  color:var(--text);
  resize:vertical;
  -webkit-overflow-scrolling:touch;
  touch-action:pan-y;
  transition:border-color var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard);
  border-radius:10px;
  padding:10px 14px;
  font-size:14px;
  line-height:1.55;
  overflow-y:auto}
/* 不再写 outline:none：scoped 类选择器的特异性会压过全局 :focus-visible 焦点环。
   鼠标点击的默认 UA 环由全局 input:focus 样式（style.css 已统一处理）。 */
.schedule-note-input:focus {
  border-color:var(--primary);
  box-shadow:0 0 0 3px var(--primary-soft)}
.schedule-note-input::placeholder {
  color:var(--muted)}

</style>
