<script setup>
import { defineAsyncComponent, ref, reactive, computed, watch, onBeforeUnmount, onDeactivated } from 'vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { detachCourseRelations } from '../composables/domain/relations.js'
import { appearance } from '../composables/appearance.js'
import {
  useStoredRef,
  todayIndex,
  PALETTE,
  DEFAULT_TIMES,
  MAX_WEEK,
  todayStr,
} from '../composables/store'
import {
  timeConfig,
  campusName,
  seasonName,
  currentCampusId,
  currentSeasonId,
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
  currentWeek,
  scheduleExceptions,
} from '../composables/store/schedule.js'
import { useTaskProgress } from '../composables/taskProgress.js'
import ScheduleGrid from '../components/schedule/ScheduleGrid.vue'
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
let courseImportApi = null
let courseImportTask = null

function loadBatchParser() {
  if (batchParserApi) return Promise.resolve(batchParserApi)
  batchParserTask ??= import('../composables/courseParser.js').then((api) => (batchParserApi = api))
  return batchParserTask
}

function loadCourseImport() {
  if (courseImportApi) return Promise.resolve(courseImportApi)
  courseImportTask ??= import('../composables/courseImport.js').then((api) => (courseImportApi = api))
  return courseImportTask
}

const courses = useStoredRef('sl_courses', [])
const courseTemplates = useStoredRef('sl_course_templates', [])
const tasks = useStoredRef('sl_tasks', [])
const countdowns = useStoredRef('sl_exams', [])
const events = useStoredRef('sl_events', [])
const notes = useStoredRef('sl_quick_notes', [])

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
const selectedCourseIds = ref([])
const templateName = ref('')
const managerMessage = ref('')
const managerError = ref('')
const viewWeek = ref(Math.min(Math.max(currentWeek(), 1), MAX_WEEK))
const mobileView = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week')
const mobileDay = ref(todayIndex())
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
const seasonsForCurrentCampus = computed(() =>
  seasonsForCampus(currentCampusId(), timeConfig.value)
)
const showCampusSwitcher = computed(() => timeConfig.value.campuses.length > 1)
const showSeasonSwitcher = computed(() => seasonsForCurrentCampus.value.length > 1)
const currentAutoStatus = computed(() => autoSeasonStatusFor(currentCampusId(), timeConfig.value))

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
        hint: `${reason}；当前暂用「${seasonName(currentSeasonId()) || '—'}」`,
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
  return courses.value.filter((c) => c.start === periodId || c.end === periodId).length
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
  templateName.value = `${new Date().getFullYear()}年课表`
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

function deleteSelectedCourses() {
  if (!selectedCourses.value.length) return
  if (!window.confirm(`确定删除选中的 ${selectedCourses.value.length} 门课程吗？`)) return
  const ids = new Set(selectedCourseIds.value)
  // 默认只解除关联，保留历史任务、考试、日程与笔记。
  courses.value.filter((course) => ids.has(course.id)).forEach((course) => detachCourseRelations(course, { tasks: tasks.value, milestones: countdowns.value, events: events.value, notes: notes.value }))
  courses.value = courses.value.filter((course) => !ids.has(course.id))
  selectedCourseIds.value = []
  managerMessage.value = '选中的课程已删除'
}

function duplicateSelectedCourses() {
  if (!selectedCourses.value.length) return
  const stamp = Date.now()
  const copies = selectedCourses.value.map((course, index) => ({
    ...JSON.parse(JSON.stringify(course)),
    id: `c${stamp}_copy_${index}`,
  }))
  courses.value.push(...copies)
  selectedCourseIds.value = copies.map((course) => course.id)
  managerMessage.value = `已创建 ${copies.length} 门课程副本，可关闭窗口后逐项调整`
}

function clearCurrentSchedule() {
  if (!courses.value.length) return
  if (!window.confirm('确定清空当前全部课程吗？建议先保存为学期模板或导出备份。')) return
  courses.value.forEach((course) => detachCourseRelations(course, { tasks: tasks.value, milestones: countdowns.value, events: events.value, notes: notes.value }))
  courses.value = []
  selectedCourseIds.value = []
  managerMessage.value = '当前课表已清空'
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
  courseTemplates.value.unshift({
    id: 'tpl' + Date.now(),
    name,
    createdAt: new Date().toISOString(),
    courses: JSON.parse(JSON.stringify(courses.value)),
  })
  templateName.value = ''
  managerMessage.value = `“${name}”已保存，可在新学期重新导入`
}

function importCourseTemplate(template) {
  const action = courses.value.length ? '追加到当前课表' : '导入为空课表'
  if (!window.confirm(`确定将“${template.name}”中的 ${template.courses.length} 门课程${action}吗？`)) return
  const stamp = Date.now()
  const copies = template.courses.map((course, index) => ({
    ...JSON.parse(JSON.stringify(course)),
    id: `c${stamp}_tpl_${index}`,
  }))
  beginCourseImport(copies, { source: 'template' })
}

function deleteCourseTemplate(template) {
  if (!window.confirm(`确定删除课表模板“${template.name}”吗？`)) return
  courseTemplates.value = courseTemplates.value.filter((item) => item.id !== template.id)
}

async function openBatchShift() {
  // 在打开批量工具前才加载文本解析器；不会影响课程表首次进入。
  await loadBatchParser()
  batchText.value = ''
  batchError.value = ''
  ocrSummary.value = ''
  message.value = ''
  showBatch.value = true
}


const batchRows = computed(() => {
  if (!batchParserApi) return []
  const lines = batchText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !(index === 0 && /课程.*星期/.test(line)))
    .map(({ line, index }) => batchParserApi.parseBatchLine(line, index + 1, timeConfig, MAX_WEEK))
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
function commitWholeScheduleReplacement() {
  const draft = importDraft.value
  if (!draft || !window.confirm(`确认替换当前整张课表？\n将移除现有 ${courses.value.length} 门课程，仅保留本次导入的 ${draft.items.length} 门课程。`)) return
  commitCourseImport('replace-all')
}
async function commitCourseImport(mode = 'smart') {
  const draft = importDraft.value
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
    courses.value = plan.courses
    // Only accepted import results train the on-device correction memory.
    // OCR suggestions never leave this browser and never alter cloud data by themselves.
    void import('../composables/ocrVocabulary.js').then(({ rememberOcrCourses }) => rememberOcrCourses(plan.courses))
    lastImportUndo.value = { snapshot: draft.snapshot, expiresAt: Date.now() + 30000 }
    const summary = `新增 ${plan.added} 门，替换 ${plan.replaced} 门，跳过 ${plan.skipped} 门${plan.kept ? `，保留冲突 ${plan.kept} 门` : ''}`
    if (draft.source === 'manual') { showForm.value = false; showToast(`课程已保存：${summary}`) }
    else if (draft.source === 'template') { managerMessage.value = `模板导入完成：${summary}` }
    else { batchText.value = ''; batchError.value = ''; message.value = `导入完成：${summary}${draft.reviewCount ? `（${draft.reviewCount} 门建议确认）` : ''}` }
    showImportConflict.value = false
    importDraft.value = null
  } catch (e) {
    courses.value = draft.snapshot
    batchError.value = '写入失败，已自动恢复导入前课表'
  } finally { importCommitBusy.value = false }
}
function undoLastCourseImport() {
  const undo = lastImportUndo.value
  if (!undo || Date.now() > undo.expiresAt) return
courses.value = JSON.parse(JSON.stringify(undo.snapshot))
  lastImportUndo.value = null
  message.value = '已撤销本次导入，课表已恢复'
}

function continueBatchImport() {
  message.value = ''
  batchText.value = ''
  ocrSummary.value = ''
}

function finishBatchImport() {
  message.value = ''
  showBatch.value = false
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
          { kind: 'timetable', mode: 'auto', signal: controller.signal },
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
      batchOcrProgress.setStep(
        'structure',
        table.needsReview ? 'warning' : 'completed',
        table.needsReview
          ? '表头锚点不足，已保留文字结果供手动确认'
          : `恢复 ${table.courses.length} 门课程的空间归属${vocabularyChanges.length ? `，已应用 ${vocabularyChanges.length} 个本地词库建议` : ''}`,
      )
      batchOcrProgress.setStep('validate', 'running', '正在检查课程字段与行列对应')
      const recognizedText = table.batchText || result.text
      batchText.value = (batchText.value ? batchText.value + '\n' : '') + recognizedText
      summaries.push({ name: file.name, table, result })
      const currentCourses = summaries.reduce((sum, item) => sum + item.table.courses.length, 0)
      const currentReviews = summaries.reduce((sum, item) => sum + item.table.diagnostics.reviewCount, 0)
      batchOcrProgress.setPartial({ 图片: `${summaries.length}/${files.length}`, 课程: currentCourses, 建议确认: currentReviews }, `第 ${index + 1}/${files.length} 张处理完成`)
      if (import.meta.env.DEV) console.log(`[OCR] result: file=${file.name}, confidence=${result.confidence?.toFixed?.(2)}, words=${result.wordCount}, structureScore=${table.diagnostics.score.toFixed(1)}`)
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
  if (lastBatchFiles.length) void runTimetableOCR(lastBatchFiles)
}

function continueBatchResults() {
  batchOcrProgress.reset()
}

const curWeek = computed(() => Math.min(Math.max(currentWeek(), 1), MAX_WEEK))

function goWeek(delta) {
  const next = viewWeek.value + delta
  if (next >= 1 && next <= MAX_WEEK) viewWeek.value = next
}

function saveSemester(value) {
  if (!value) return
  semester.value.start = value
  viewWeek.value = curWeek.value
  showSemester.value = false
}

function semesterPreview() {
  return weekOf(todayStr())
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
  if (!payload?.date) return
  const value = {
    id: `exception-${payload.date}`,
    date: payload.date,
    type: payload.type,
    sourceDay: payload.sourceDay,
    note: payload.note,
    updatedAt: new Date().toISOString(),
  }
  const index = scheduleExceptions.value.findIndex((item) => item.date === value.date)
  if (index >= 0) scheduleExceptions.value[index] = value
  else scheduleExceptions.value.push(value)
}

function removeException(id) {
  scheduleExceptions.value = scheduleExceptions.value.filter((item) => item.id !== id)
}

function openAdd(day = null, period = null) {
  editingId.value = null
  error.value = ''
  const periods = timeConfig.value.periods
  const fallbackStart = periods[1]?.id ?? periods[0]?.id ?? null
  form.name = ''
  form.teacher = ''
  form.room = ''
  form.campusId = currentCampusId() || ''
  form.travelMinutes = 0
  form.color = PALETTE[courses.value.length % PALETTE.length]
  form.day = day ?? todayIndex()
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

function confirmDeleteCourse() {
  const course = deleteCourseTarget.value
  if (!course) return
  detachCourseRelations(course, { tasks: tasks.value, milestones: countdowns.value, events: events.value, notes: notes.value })
  courses.value = courses.value.filter((item) => item.id !== course.id)
  deleteCourseTarget.value = null
}

function periodOption(id) {
  const label = periodLabelById(id)
  const t = periodRangeById(id)
  return t ? `${label}（${t}）` : label
}

const todayIdx = computed(() => todayIndex())

// OCR Worker 是模块级单例，返回课表时仍可复用已经加载的模型。
</script>

<template>
  <div class="page">
    <div class="head">
      <h2>📅 我的课程表</h2>
      <div class="head-btns">
        <button class="btn btn-ghost" @click="openCourseManager">☷ 批量管理</button>
        <button class="btn btn-ghost" @click="openExceptionManager">🗓 特殊日期</button>
        <button class="btn btn-ghost" @click="showSemester = true">📅 学期设置</button>
        <button class="btn btn-ghost" @click="openTimeSettings">🕐 作息与时间设置</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="seg-group skin-switcher">
        <span class="seg-label">皮肤</span>
        <div class="seg">
          <button :class="{ on: appearance.scheduleSkin === 'classic' }" @click="appearance.scheduleSkin = 'classic'">经典</button>
          <button :class="{ on: appearance.scheduleSkin === 'notebook' }" @click="appearance.scheduleSkin = 'notebook'">笔记</button>
          <button :class="{ on: appearance.scheduleSkin === 'timeline' }" @click="appearance.scheduleSkin = 'timeline'">极简</button>
        </div>
      </div>
      <div v-if="showCampusSwitcher" class="seg-group">
        <span class="seg-label">校区</span>
        <div class="seg">
          <button
            v-for="campus in timeConfig.campuses"
            :key="campus.id"
            :class="{ on: currentCampusId() === campus.id }"
            @click="selectScheduleCampus(campus.id)"
          >
            {{ campus.name }}
          </button>
        </div>
      </div>
      <div v-if="showSeasonSwitcher" class="seg-group">
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
            :class="{ on: !timeConfig.autoSeason && currentSeasonId() === season.id }"
            @click="timeConfig.autoSeason = false; timeConfig.currentSeason = season.id"
          >
            {{ season.name }}
          </button>
        </div>
      </div>
      <div class="seg-group">
        <span class="seg-label">周次</span>
        <div class="seg">
          <button :disabled="viewWeek <= 1" @click="goWeek(-1)">‹</button>
          <button class="wn" :class="{ thisweek: viewWeek === curWeek }">
            第 {{ viewWeek }} 周
          </button>
          <button :disabled="viewWeek >= MAX_WEEK" @click="goWeek(1)">›</button>
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
        <button class="btn btn-ghost" @click="openBatchShift">⇩ 批量录入</button>
        <button class="btn btn-primary" @click="openAdd()">＋ 添加课程</button>
      </div>
    </div>

    <ScheduleGrid
      :courses="courses"
      :schedule-exceptions="scheduleExceptions"
      :semester="semester"
      :view-week="viewWeek"
      :mobile-view="mobileView"
      :mobile-day="mobileDay"
      :current-week="curWeek"
      :appearance="appearance"
      @open-add="openAdd"
      @open-edit="openEdit"
      @mobile-day-change="shiftMobileDay"
    />

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
      @add-another="addAnotherInCell"
    />

    <ConfirmDialog
      :open="Boolean(deleteCourseTarget)"
      title="删除课程"
      :message="`确定删除课程“${deleteCourseTarget?.name || ''}”吗？关联待办和学习倒计时会保留，但将不再关联此课程。`"
      confirm-label="删除课程"
      @close="deleteCourseTarget = null"
      @confirm="confirmDeleteCourse"
    />

    <CourseManagerModal
      :open="showCourseManager"
      :courses="courses"
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
      :progress="batchOcrProgress"
      :summary="ocrSummary"
      :message="message"
      :error="batchError"
      :can-undo="Boolean(lastImportUndo)"
      @close="showBatch = false"
      @update:text="batchText = $event"
      @update:error="batchError = $event"
      @clear="batchText = ''"
      @import="importBatch"
      @upload-image="ocrImage"
      @crop-image="selectCropImage"
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
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.head h2 {
  font-size: 22px;
}
.head-btns {
  display: flex;
  gap: 10px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.seg-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.seg-label {
  font-size: 13px;
  color: var(--muted);
}
.seg {
  display: flex;
  max-width: 100%;
  overflow-x: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
}
.seg button {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--muted);
}
.seg button:disabled {
  opacity: 0.35;
  cursor: default;
}
.seg button.on {
  background: var(--primary);
  color: #fff;
  font-weight: 600;
}
.seg button.wn {
  min-width: 84px;
  font-weight: 700;
  color: var(--text);
}
.seg button.wn.thisweek {
  color: var(--primary);
}
.add-actions {
  display: flex;
  min-width: 0;
  gap: 8px;
  margin-left: auto;
}

.warn-banner {
  background: #fef3c7;
  border: 1px solid #fcd34d;
  color: #92400e;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 14px;
}

.timetable-wrap {
  overflow-x: auto;
  padding: 16px;
}
.timetable {
  display: grid;
  grid-template-columns: 84px repeat(7, minmax(96px, 1fr));
  gap: 5px;
  min-width: 820px;
}
.corner {
  grid-column: 1;
  grid-row: 1;
}
.tt-head {
  grid-row: 1;
  text-align: center;
  padding: 8px 0;
  font-weight: 600;
  color: var(--muted);
  border-radius: 8px;
}
.tt-head.today {
  background: var(--primary-soft);
  color: var(--primary);
}
.today-tag {
  margin-left: 4px;
  font-size: 11px;
  background: var(--primary);
  color: #fff;
  padding: 1px 6px;
  border-radius: 999px;
  vertical-align: 2px;
}
.exception-tag {
  display: block;
  width: fit-content;
  margin: 3px auto 0;
  padding: 1px 5px;
  color: #b13f3f;
  font-size: 9px;
  font-weight: 800;
  border-radius: 5px;
  background: #feecec;
}
.exception-tag.makeup { color: #7a55e8; background: #f1ebff; }
.tt-period {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
  padding: 2px;
}
.tt-period b {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
}
.tt-cell {
  background: #fafbfd;
  border: 1px dashed var(--border);
  border-radius: 8px;
  min-height: 48px;
  cursor: pointer;
  transition: background 0.15s;
}
.tt-cell:hover {
  background: var(--primary-soft);
}
.tt-cell.isToday {
  background: #f6f9ff;
}
.course {
  z-index: 2;
  margin: 2px;
  padding: 6px 8px;
  border-radius: 8px;
  border-left: 4px solid;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1px;
  transition: transform 0.1s;
}
.course:hover {
  transform: scale(1.02);
}
.course.conflict {
  outline: 2px dashed var(--danger);
  outline-offset: -2px;
}
.c-name {
  font-size: 13px;
  font-weight: 600;
}
.c-week {
  font-size: 10px;
  color: var(--primary);
  font-weight: 600;
}
.c-sub {
  font-size: 11px;
  color: var(--muted);
}
.tip {
  color: var(--muted);
  font-size: 13px;
}

/* ---------- 课表皮肤 ---------- */
.skin-notebook {
  border-color: #ddcfab;
  background:
    linear-gradient(90deg, transparent 58px, rgba(218, 94, 94, 0.22) 59px, transparent 60px),
    repeating-linear-gradient(#fffdf7 0 31px, #dce7ef 32px);
  box-shadow: 0 10px 28px rgba(108, 83, 35, 0.09);
}
.skin-notebook .tt-head {
  color: #735f39;
  font-family: 'KaiTi', 'STKaiti', serif;
}
.skin-notebook .tt-cell {
  border-color: rgba(155, 128, 78, 0.32);
  background: rgba(255, 253, 247, 0.52);
}
.skin-notebook .tt-period b,
.skin-notebook .course {
  font-family: 'KaiTi', 'STKaiti', serif;
}
.skin-notebook .course {
  border-left-width: 3px;
  border-radius: 5px 12px 7px 10px;
  box-shadow: 1px 2px 5px rgba(89, 68, 31, 0.1);
}
.skin-timeline {
  border: none;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: none;
}
.skin-timeline .timetable {
  gap: 2px 8px;
}
.skin-timeline .tt-head {
  border-bottom: 2px solid var(--border);
  border-radius: 0;
}
.skin-timeline .tt-cell {
  min-height: 54px;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
}
.skin-timeline .tt-cell.isToday {
  background: color-mix(in srgb, var(--primary) 5%, transparent);
}
.skin-timeline .tt-period {
  padding-right: 9px;
  border-right: 2px solid var(--border);
}
.skin-timeline .course {
  margin: 4px 2px;
  border-left-width: 3px;
  border-radius: 6px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form label {
  font-size: 13px;
  color: var(--muted);
  margin-top: 6px;
}
.form input,
.form select {
  width: 100%;
}
.row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.row > div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.colors {
  display: flex;
  gap: 8px;
  margin: 4px 0;
}
.swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid transparent;
}
.swatch.picked {
  border-color: var(--text);
}
.error {
  color: var(--danger);
  font-size: 13px;
}
.muted-tip {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  background: var(--bg);
  border-radius: 8px;
  padding: 10px 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.actions .btn-danger {
  margin-right: auto;
}

/* ---------- 自动/手动作息提示（主页 toolbar 下） ---------- */
.auto-mode-hint {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
  margin: -6px 0 0;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.5;
}
.auto-mode-hint small { color: var(--ink-faint); font-size: 11px; }
.auto-mode-hint.auto small::before { content: '·'; margin: 0 6px; }
.auto-mode-hint.unavailable { color: #9a6414; }

.mobile-view-switcher { display: none; }
.mobile-day-view { display: none; }
.mobile-day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.mobile-day-head > div { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; min-width: 0; text-align: center; }
.mobile-day-head strong { font-size: 16px; }
.mobile-day-head small { width: 100%; color: var(--danger); font-size: 11px; }
.mobile-today-mark { padding: 2px 7px; color: var(--primary); font-size: 10px; font-weight: 800; border-radius: 999px; background: var(--primary-soft); }
.day-nav { display: grid; place-items: center; width: 44px; height: 44px; color: var(--primary); font-size: 25px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
.day-nav:disabled { color: var(--ink-faint); opacity: .45; }
.mobile-course-list { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
.mobile-course-row { position: relative; display: grid; grid-template-columns: 82px minmax(0, 1fr) 24px; align-items: center; gap: 10px; min-height: 68px; padding: 10px 8px 10px 12px; color: var(--text); text-align: left; border: 1px solid var(--border); border-left: 4px solid var(--course-color); border-radius: 10px; background: var(--bg-tint); }
.mobile-course-row:active { background: var(--primary-soft); }
.mobile-course-time { color: var(--ink-soft); font-size: 11px; font-weight: 700; line-height: 1.4; }
.mobile-course-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mobile-course-main b { overflow: hidden; font-size: 14px; line-height: 1.35; }
.mobile-course-main small { overflow: hidden; color: var(--ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.mobile-course-arrow { color: var(--ink-faint); font-size: 24px; text-align: center; }
.mobile-day-empty { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 24px 4px 6px; color: var(--ink-soft); font-size: 13px; }

@media (max-width: 760px) {
  .head {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .head-btns {
    width: 100%;
    flex-wrap: wrap;
  }

  .head-btns { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }

  .head-btns .btn {
    flex: 0 0 auto;
    min-height: 44px;
    padding-inline: 12px;
  }

  .toolbar {
    align-items: flex-start;
    gap: 12px;
  }

  .seg-group {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
    max-width: 100%;
  }

  .toolbar .seg { max-width: calc(100vw - 40px); }

  .add-actions {
    width: 100%;
    margin-left: 0;
  }

  .add-actions .btn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timetable-wrap {
    padding: 10px;
  }

  .tip {
    line-height: 1.6;
  }

  .manager-head,
  .clear-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .manager-actions,
  .manager-actions .btn,
  .clear-row .btn {
    width: 100%;
  }

  .template-save {
    flex-direction: column;
  }
  .mobile-view-switcher { display: flex; }
  .mobile-day-view { display: block; padding: 12px; }
}

@media (max-width: 520px) {
  .head h2 {
    font-size: 20px;
  }

  .row {
    flex-direction: column;
  }

  .colors {
    flex-wrap: wrap;
  }

.warn-banner {
    line-height: 1.55;
  }

  .it-row { grid-template-columns: 48px minmax(0, 1fr); }
  .import-row { grid-template-columns: minmax(0, 1fr) 86px 12px 86px 24px; gap: 4px; }
  .row-review-detail { align-items: flex-start; flex-direction: column; }
  .detail-row-main { grid-template-columns: minmax(0, 1fr) 92px 12px 92px 24px; gap: 4px; }
  .scheme-card { grid-template-columns: auto minmax(0, 1fr); }
  .scheme-card > .btn-xs { grid-column: 1 / -1; justify-self: end; }
  .overview-foot { flex-wrap: wrap; }
  .mobile-view-switcher { width: 100%; }
  .mobile-view-switcher .seg { flex: 1; }
  .mobile-view-switcher .seg button { flex: 1; }
  .mobile-course-row { grid-template-columns: 76px minmax(0, 1fr) 20px; gap: 8px; }
}

/* ---------- 作息与时间设置 ---------- */
.settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.settings-hint {
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  border-radius: 8px;
  background: var(--bg);
}
.setting-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.setting-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.setting-head h4 {
  font-size: 14px;
}
.setting-note {
  color: var(--muted);
  font-size: 11px;
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.setting-row input {
  flex: 1;
  min-width: 0;
}
.setting-row input.date {
  flex: 0 0 90px;
  text-align: center;
}
.setting-del {
  flex: 0 0 30px;
  height: 30px;
  color: var(--muted);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
}
.setting-del:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.setting-del:disabled {
  opacity: 0.35;
  cursor: default;
}
.setting-add {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.setting-add input {
  flex: 1;
  min-width: 0;
}
.setting-add input.date {
  flex: 0 0 90px;
  text-align: center;
}
.period-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
/* ---------- 一键生成时间 ---------- */
.gen-box {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  background: #fafbfd;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gen-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
}
.gen-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.gen-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}
.gen-item input,
.gen-item select {
  padding: 5px 7px;
  font-size: 12px;
  border-radius: 6px;
}
.gen-item .num {
  width: 62px;
}
.gen-item input[type='time'] {
  width: 96px;
}
.gen-scope {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.gen-scope label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text);
}
.gen-scope .btn {
  margin-left: auto;
  padding: 7px 16px;
}
.gen-tip {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}
.cell-add-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  border-radius: 8px;
  background: var(--bg);
}
.cell-add-hint .btn {
  flex: 0 0 auto;
  padding: 7px 12px;
  font-size: 12px;
}

/* ---------- 设置弹窗标签页 ---------- */
.tab-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
}
.tab-btn.on {
  color: #fff;
  font-weight: 700;
  border-color: var(--primary);
  background: var(--primary);
}
.cell-existing {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.ce-label {
  color: var(--muted);
  font-size: 12px;
}
.cell-chip {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  border-radius: 6px;
  background: var(--primary-soft);
}
.cell-chip.clash {
  color: var(--danger);
  background: #feecec;
}
.course-links {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
}
.course-links-head,
.course-link-columns {
  display: flex;
  gap: 12px;
}
.course-links-head {
  align-items: flex-start;
  justify-content: space-between;
}
.course-links-head b,
.course-links-head small,
.link-label,
.link-list small {
  display: block;
}
.course-links-head small,
.link-empty,
.link-list small {
  color: var(--muted);
  font-size: 12px;
}
.link-progress {
  padding: 4px 7px;
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  border-radius: 999px;
  background: var(--primary-soft);
  white-space: nowrap;
}
.course-link-columns > div {
  min-width: 0;
  flex: 1;
}
.course-link-columns {
  margin-top: 10px;
}
.link-label { font-size: 12px; font-weight: 700; }
.link-empty { margin: 6px 0; }
.link-list { margin: 6px 0; padding: 0; list-style: none; }
.link-list li { padding: 4px 0; overflow: hidden; }
.link-list span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.link-list .done { color: var(--muted); text-decoration: line-through; }
.link-action { color: var(--primary); font-size: 12px; font-weight: 700; text-decoration: none; }
@media (max-width: 520px) {
  .course-link-columns { flex-direction: column; gap: 10px; }
}
</style>
