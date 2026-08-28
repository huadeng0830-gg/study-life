<script setup>
import { defineAsyncComponent, ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import Modal from '../components/Modal.vue'
import { appearance } from '../composables/appearance.js'
import {
  useStoredRef,
  todayIndex,
  PALETTE,
  DEFAULT_TIMES,
  timeConfig,
  campusName,
  seasonName,
  currentCampusId,
  currentSeasonId,
  currentTimes,
  periodIndex,
  periodLabelById,
  periodRangeById,
  addCampus,
  renameCampus,
  removeCampus,
  addSeason,
  renameSeason,
  removeSeason,
  addPeriod,
  renamePeriod,
  removePeriod,
  resetTimesToDefault,
  normalizeTimes,
  seasonAppliesTo,
  seasonsForCampus,
  validCombos,
  autoSeasonIdFor,
  autoSeasonStatusFor,
  isValidSeasonDate,
  seasonConflicts,
  MAX_WEEK,
  semester,
  weekOf,
  currentWeek,
  todayStr,
  weekLabel,
  scheduleExceptions,
  dateForWeekDay,
  scheduleExceptionForDate,
  coursesForDate,
} from '../composables/store.js'
import { useTaskProgress } from '../composables/taskProgress.js'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 课程表的识图、批量解析和导入规则只会在用户主动打开相应工具后使用。
// 保持它们为独立异步模块，普通“查看课程表”不再解析这些大块业务代码。
const TaskProgress = defineAsyncComponent(() => import('../components/TaskProgress.vue'))
let batchParserApi = null
let batchParserTask = null
let courseImportApi = null
let courseImportTask = null
let scheduleParserApi = null
let scheduleParserTask = null
let recognitionApi = null
let recognitionTask = null

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

function loadScheduleParser() {
  if (scheduleParserApi) return Promise.resolve(scheduleParserApi)
  scheduleParserTask ??= import('../composables/scheduleOcrParser.js').then((api) => (scheduleParserApi = api))
  return scheduleParserTask
}

function loadRecognition() {
  if (recognitionApi) return Promise.resolve(recognitionApi)
  recognitionTask ??= import('../composables/scheduleRecognition.js').then((api) => (recognitionApi = api))
  return recognitionTask
}

function schemeDisplayName(...args) { return recognitionApi?.schemeDisplayName(...args) ?? '作息方案' }
function schemeStatus(...args) { return recognitionApi?.schemeStatus(...args) ?? 'pending' }
function targetPendingReasonText(...args) { return recognitionApi?.targetPendingReasonText(...args) ?? '正在准备识别结果' }

const courses = useStoredRef('sl_courses', [])
const courseTemplates = useStoredRef('sl_course_templates', [])

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
const showSemester = ref(false)
const showBatch = ref(false)
const showCourseManager = ref(false)
const showExceptions = ref(false)
const editingId = ref(null)
const error = ref('')
const batchText = ref('')
const batchError = ref('')
const ocrSummary = ref('')
const message = ref('')
const showImportConflict = ref(false)
const importDraft = ref(null)
const importCommitBusy = ref(false)
const lastImportUndo = ref(null)
const scheduleOcrProgress = useTaskProgress()
const batchOcrProgress = useTaskProgress()
let scheduleOcrController = null
let batchOcrController = null
let lastScheduleMode = 'auto'
let lastBatchFiles = []
const selectedCourseIds = ref([])
const templateName = ref('')
const managerMessage = ref('')
const managerError = ref('')
const exceptionError = ref('')
const semStart = ref(semester.value.start)
const viewWeek = ref(Math.min(Math.max(currentWeek(), 1), MAX_WEEK))
const exceptionForm = reactive({ date: todayStr(), type: 'off', sourceDay: 0, note: '' })
const form = reactive({
  name: '',
  teacher: '',
  room: '',
  color: PALETTE[0],
  day: 0,
  start: 1,
  end: 2,
  startWeek: 1,
  endWeek: 16,
  weekType: 'all',
})


// 设置弹窗的临时输入
const newCampusName = ref('')
const newSeasonName = ref('')
const newSeasonDate = ref('03-01')
const newPeriodLabel = ref('')
const settingError = ref('')

function onAddCampus() {
  settingError.value = ''
  if (addCampus(newCampusName.value)) newCampusName.value = ''
  else settingError.value = '请输入校区名称'
}

function onRemoveCampus(id) {
  settingError.value = ''
  const cfg = timeConfig.value
  if (cfg.campuses.length <= 1) { settingError.value = '至少保留一个校区'; return }
  const campus = cfg.campuses.find((c) => c.id === id)
  const planCount = cfg.seasons.filter((s) => seasonAppliesTo(s, id)).length
  const isCurrent = currentCampusId() === id
  const lines = [`确定删除校区「${campus?.name}」？`, `将同时删除 ${planCount} 个作息季在该校区的时间方案。`]
  if (isCurrent) lines.push('该校区是当前查看的校区，删除后会切换到其他校区。')
  if (!window.confirm(lines.join('\n'))) return
  removeCampus(id)
}

function onAddSeason() {
  settingError.value = ''
  if (newSeasonDate.value && !isValidSeasonDate(newSeasonDate.value)) {
    settingError.value = '起始日期格式应为 MM-DD，例如 05-01'
    return
  }
  if (addSeason(newSeasonName.value, newSeasonDate.value)) {
    newSeasonName.value = ''
    newSeasonDate.value = '03-01'
  } else {
    settingError.value = '请输入作息季名称'
  }
}

function onRemoveSeason(id) {
  settingError.value = ''
  const cfg = timeConfig.value
  if (cfg.seasons.length <= 1) { settingError.value = '至少保留一个作息季'; return }
  const season = cfg.seasons.find((s) => s.id === id)
  const campusCount = cfg.campuses.filter((c) => seasonAppliesTo(season, c.id)).length
  const activeId = timeConfig.value.autoSeason ? autoSeasonIdFor(currentCampusId()) : currentSeasonId()
  const lines = [`确定删除作息季「${season?.name}」？`, `将同时删除 ${campusCount} 个校区在该季的时间方案。`]
  if (activeId === id) lines.push('该季是当前生效的作息季，删除后会自动切换到其他作息季。')
  if (!window.confirm(lines.join('\n'))) return
  removeSeason(id)
}

// 作息季适用校区（多校区时显示；空 = 全部适用，兼容旧数据）
function seasonCampusOn(season, campusId) {
  return seasonAppliesTo(season, campusId)
}
function toggleSeasonCampus(season, campusId) {
  const current = Array.isArray(season.campuses) ? [...season.campuses] : timeConfig.value.campuses.map((c) => c.id)
  const idx = current.indexOf(campusId)
  if (idx >= 0) {
    if (current.length <= 1) { settingError.value = '作息季至少需要一个适用校区'; return }
    current.splice(idx, 1)
  } else {
    current.push(campusId)
  }
  season.campuses = current
  settingError.value = ''
}
const seasonDateConflicts = computed(() => seasonConflicts(timeConfig.value))

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

function onAddPeriod() {
  settingError.value = ''
  if (addPeriod(newPeriodLabel.value)) newPeriodLabel.value = ''
  else settingError.value = '请输入节次名称'
}

function onRemovePeriod(id) {
  settingError.value = ''
  const result = removePeriod(id, (periodId) =>
    courses.value.some((c) => c.start === periodId || c.end === periodId)
  )
  if (result !== true) settingError.value = result
}

function onResetTimes() {
  settingError.value = ''
  resetTimesToDefault()
}

function openTimeSettings() {
  const periods = timeConfig.value.periods
  if (!gen.startId || periodIndex(gen.startId) < 0) {
    gen.startId = periods[1]?.id ?? periods[0]?.id ?? null
  }
  if (gen.lunchAfterIdx >= periods.length - 1) gen.lunchAfterIdx = Math.max(1, periods.length - 3)
  if (gen.dinnerAfterIdx >= periods.length - 1) gen.dinnerAfterIdx = Math.max(2, periods.length - 2)
  settingError.value = ''
  settingsTab.value = 'plans'
  showTimeEditor.value = true
}

// ---------- 一键生成作息时间 ----------
const gen = reactive({
  startId: null,
  startTime: '08:00',
  duration: 45,
  breakMin: 10,
  lunchAfterIdx: 4,
  lunchMin: 120,
  dinnerAfterIdx: 8,
  dinnerMin: 60,
  allSeasons: false,
  allCampuses: false,
})

const genStartOptions = computed(() => timeConfig.value.periods)
const genAfterOptions = computed(() => timeConfig.value.periods)

function toMinutes(hhmm) {
  const [h = 0, m = 0] = String(hhmm ?? '').split(':').map(Number)
  return h * 60 + m
}

function toHHMM(minutes) {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/* ==================================================================
   作息方案编辑器：一次只编辑一个「季×校区」组合，草稿模式
   ================================================================== */
const planSeasonId = ref(null)
const planCampusId = ref(null)
const draft = ref([]) // [{start,end}] 与 periods 对齐
const draftDirty = ref(false)

const settingsCombos = computed(() => validCombos(timeConfig.value))

function planKeyOf(seasonId, campusId) {
  return `${seasonId}::${campusId}`
}
const currentPlanKey = computed(() =>
  planSeasonId.value && planCampusId.value ? planKeyOf(planSeasonId.value, planCampusId.value) : ''
)

// 当前编辑季适用于的校区（用于校区选择与适用性开关）
const seasonsForPlanCampus = computed(() =>
  planCampusId.value
    ? timeConfig.value.seasons.filter((s) => seasonAppliesTo(s, planCampusId.value))
    : []
)
const campusesForPlanSeason = computed(() =>
  planSeasonId.value
    ? timeConfig.value.campuses.filter((c) => {
        const season = timeConfig.value.seasons.find((s) => s.id === planSeasonId.value)
        return seasonAppliesTo(season, c.id)
      })
    : []
)

function loadPlanDraft(seasonId, campusId) {
  planSeasonId.value = seasonId
  planCampusId.value = campusId
  const list = timeConfig.value.times[seasonId]?.[campusId] ?? []
  draft.value = timeConfig.value.periods.map((_, i) => ({
    start: list[i]?.start ?? '',
    end: list[i]?.end ?? '',
  }))
  draftDirty.value = false
  batchOpen.value = false
  copyOpen.value = false
  importOpen.value = false
  genPreview.value = null
}

// 打开设置时初始化：优先当前生效组合，否则第一个有效组合
function initPlanSelection() {
  const combos = settingsCombos.value
  if (!combos.length) return
  const activeKey = planKeyOf(currentSeasonId(), currentCampusId())
  const found = combos.find((c) => planKeyOf(c.season, c.campus) === activeKey) ?? combos[0]
  if (planKeyOf(planSeasonId.value, planCampusId.value) !== planKeyOf(found.season, found.campus)) {
    loadPlanDraft(found.season, found.campus)
  }
}

// 切换组合前检查未保存修改
function guardDraft() {
  if (!draftDirty.value) return true
  return window.confirm('当前方案有未保存的修改，确定放弃这些修改吗？')
}

function switchPlan(seasonId, campusId) {
  if (planKeyOf(seasonId, campusId) === currentPlanKey.value) return
  if (!guardDraft()) return
  loadPlanDraft(seasonId, campusId)
}

function markDirty() {
  draftDirty.value = true
}

function saveDraft() {
  if (!planSeasonId.value || !planCampusId.value) return
  if (planHasError.value) {
    settingError.value = '存在时间问题（结束需晚于开始、不能重叠等），请先修正后再保存'
    return
  }
  normalizeTimes(timeConfig.value)
  const list = timeConfig.value.times[planSeasonId.value][planCampusId.value]
  timeConfig.value.periods.forEach((_, i) => {
    if (draft.value[i]) list[i] = { start: draft.value[i].start, end: draft.value[i].end }
  })
  draftDirty.value = false
  settingError.value = ''
  showToast('作息方案已保存')
}

function discardDraft() {
  loadPlanDraft(planSeasonId.value, planCampusId.value)
}

watch(showTimeEditor, (open) => {
  if (open) initPlanSelection()
})

// 关闭弹窗时守卫（确认放弃则重置草稿）
function tryCloseTimeEditor() {
  if (!draftDirty.value) { showTimeEditor.value = false; return }
  if (window.confirm('当前方案有未保存的修改，确定放弃这些修改吗？')) {
    loadPlanDraft(planSeasonId.value, planCampusId.value)
    showTimeEditor.value = false
  }
}

// ---------- 上午/下午/晚上 视觉分组（按开始时间自动划分，不写死节次区间） ----------
const planSections = computed(() => {
  const groups = [
    { key: 'morning', label: '上午', rows: [] },
    { key: 'afternoon', label: '下午', rows: [] },
    { key: 'evening', label: '晚上', rows: [] },
  ]
  timeConfig.value.periods.forEach((period, i) => {
    const row = { period, index: i, ...draft.value[i] }
    const minutes = toMinutes(row.start)
    if (!Number.isFinite(minutes) || minutes < 12 * 60) groups[0].rows.push(row)
    else if (minutes < 18 * 60) groups[1].rows.push(row)
    else groups[2].rows.push(row)
  })
  return groups.filter((g) => g.rows.length)
})

// ---------- 行级错误检查 ----------
function rowError(index) {
  const row = draft.value[index]
  if (!row) return ''
  if (!row.start || !row.end) return '时间尚未设置'
  if (toMinutes(row.end) <= toMinutes(row.start)) return '结束时间需要晚于开始时间'
  const prev = draft.value[index - 1]
  if (index > 0 && prev?.end && toMinutes(row.start) < toMinutes(prev.end)) {
    return `与「${timeConfig.value.periods[index - 1].label}」时间重叠`
  }
  return ''
}
const planHasError = computed(() =>
  draft.value.some((_, i) => rowError(i) !== '')
)

// ---------- 批量调整（±分钟，先预览） ----------
const batchOpen = ref(false)
const batchFrom = ref(0)
const batchTo = ref(0)
const batchDelta = ref(10)
const batchCustom = ref('')
const batchPreview = computed(() => {
  const delta = batchDelta.value === 0 ? Number(batchCustom.value || 0) : Number(batchDelta.value)
  if (!Number.isFinite(delta) || delta === 0) return null
  const rows = []
  for (let i = batchFrom.value; i <= batchTo.value && i < draft.value.length; i++) {
    const row = draft.value[i]
    if (!row?.start || !row?.end) continue
    rows.push({
      index: i,
      label: timeConfig.value.periods[i].label,
      from: `${row.start}–${row.end}`,
      to: `${toHHMM(toMinutes(row.start) + delta)}–${toHHMM(toMinutes(row.end) + delta)}`,
    })
  }
  return rows.length ? { delta, rows } : null
})
function openTimeShift() {
  batchFrom.value = 0
  batchTo.value = Math.max(0, timeConfig.value.periods.length - 1)
  batchDelta.value = 10
  batchCustom.value = ''
  batchOpen.value = true
  copyOpen.value = false
  importOpen.value = false
  genPreview.value = null
}
function applyBatch() {
  const preview = batchPreview.value
  if (!preview) return
  for (const row of preview.rows) {
    const [s, e] = row.to.split('–')
    draft.value[row.index] = { start: s, end: e }
  }
  draftDirty.value = true
  batchOpen.value = false
}

// ---------- 复制已有方案（拷贝进草稿，独立不联动） ----------
const copyOpen = ref(false)
const otherPlans = computed(() =>
  settingsCombos.value.filter((c) => planKeyOf(c.season, c.campus) !== currentPlanKey.value)
)
function toggleCopy() {
  copyOpen.value = !copyOpen.value
  batchOpen.value = false
  importOpen.value = false
  genPreview.value = null
}
function copyFrom(seasonId, campusId) {
  const source = timeConfig.value.times[seasonId]?.[campusId] ?? []
  draft.value = timeConfig.value.periods.map((_, i) => ({
    start: source[i]?.start ?? '',
    end: source[i]?.end ?? '',
  }))
  draftDirty.value = true
  copyOpen.value = false
  showToast(`已复制「${seasonName(seasonId)} · ${campusName(campusId)}」到当前方案（未保存）`)
}

// ---------- 快速生成：预览制（填充空白 / 覆盖 / 取消） ----------
const genPreview = ref(null) // { rows: [{index,label,from,to}], targetKeys: [] }
function previewGenerate() {
  settingError.value = ''
  const cfg = timeConfig.value
  const periods = cfg.periods
  const startIdx = periodIndex(gen.startId ?? periods[1]?.id ?? periods[0]?.id)
  if (startIdx < 0) { settingError.value = '请选择起始节次'; return }
  const lunchIdx = gen.lunchMin > 0 ? gen.lunchAfterIdx : -1
  const dinnerIdx = gen.dinnerMin > 0 ? gen.dinnerAfterIdx : -1
  if (lunchIdx < startIdx || lunchIdx >= periods.length - 1) {
    settingError.value = '午休位置无效（需在起始节次之后、且后面还有节次）'
    return
  }
  if (gen.dinnerMin > 0 && (dinnerIdx < startIdx || dinnerIdx >= periods.length - 1)) {
    settingError.value = '晚休位置无效（需在起始节次之后、且后面还有节次）'
    return
  }
  let cursor = toMinutes(gen.startTime)
  const generated = periods.map((_, i) => {
    if (i < startIdx) return null
    if (i > startIdx) {
      const prev = i - 1
      if (prev === lunchIdx) cursor += gen.lunchMin
      else if (prev === dinnerIdx) cursor += gen.dinnerMin
      else cursor += gen.breakMin
    }
    const start = toHHMM(cursor)
    cursor += Number(gen.duration) || 45
    return { start, end: toHHMM(cursor) }
  })
  const rows = []
  for (let i = startIdx; i < periods.length; i++) {
    if (!generated[i]) continue
    rows.push({
      index: i,
      label: periods[i].label,
      from: draft.value[i] ? `${draft.value[i].start}–${draft.value[i].end}` : '',
      to: `${generated[i].start}–${generated[i].end}`,
      blank: !draft.value[i] || !draft.value[i].start || !draft.value[i].end || (draft.value[i].start === '08:00' && draft.value[i].end === '08:45'),
    })
  }
  genPreview.value = { rows }
}
function applyGenerate(mode) {
  const preview = genPreview.value
  if (!preview) return
  for (const row of preview.rows) {
    if (mode === 'fill' && !row.blank) continue
    const [s, e] = row.to.split('–')
    draft.value[row.index] = { start: s, end: e }
  }
  draftDirty.value = true
  genPreview.value = null
}
function toggleGenPreview() {
  if (genPreview.value) genPreview.value = null
  else previewGenerate()
  copyOpen.value = false
  batchOpen.value = false
  importOpen.value = false
}

/* ---------- 新建 / 导入作息（图片 OCR + 粘贴文本，统一预览确认） ---------- */
const importOpen = ref(false)
const importTab = ref('paste') // paste | image
const pasteText = ref('')
const importError = ref('')
const lastScheduleImage = ref(null)

// ---- 识别暂存层（recognitionDraft）：确认前绝不写入正式作息 ----
const recognitionDraft = ref(null)
const activeSchemeId = ref(null)
const schemeDetailOpen = ref(false)
const detailFilter = ref('all') // all | issues
const importPlanOpen = ref(false)
const importPlan = ref(null)
const importPlanOverrides = ref({})
const planDiffExpanded = ref({})
const importRunning = ref(false)
const importProgress = useTaskProgress()
const lastImportResult = ref(null)

const schemeCount = computed(() => recognitionDraft.value?.schemes.length ?? 0)
const selectedSchemeCount = computed(() =>
  recognitionDraft.value?.schemes.filter((scheme) => scheme.selected).length ?? 0
)
const activeScheme = computed(() =>
  recognitionDraft.value?.schemes.find((scheme) => scheme.id === activeSchemeId.value) ?? null
)
const activeSchemeValidation = computed(() =>
  activeScheme.value && recognitionApi ? recognitionApi.validateSchemeRows(activeScheme.value, timeConfig.value) : null
)
const activeSchemeRows = computed(() => {
  const scheme = activeScheme.value
  if (!scheme) return []
  if (detailFilter.value !== 'issues') return scheme.rows
  const issues = activeSchemeValidation.value?.rowIssues
  if (!issues) return []
  return scheme.rows.filter((row) => issues.has(row.id))
})
const activeSchemeIssueCount = computed(() => activeSchemeValidation.value?.issueRowCount ?? 0)

const SCHEDULE_OCR_STEPS = [
  { id: 'read', label: '解析图片' },
  { id: 'engine', label: 'OCR 识别' },
  { id: 'structure', label: '恢复作息结构' },
  { id: 'extract', label: '发现作息组' },
  { id: 'match', label: '匹配已有配置' },
  { id: 'validate', label: '时间校验' },
  { id: 'preview', label: '等待用户确认' },
]

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

function toggleImport() {
  importOpen.value = !importOpen.value
  batchOpen.value = false
  copyOpen.value = false
  genPreview.value = null
  if (importOpen.value) {
    importError.value = ''
    importTab.value = recognitionDraft.value ? importTab.value : 'paste'
  }
}

// 解析作息文本：行 → {label,start,end}；同时嗅探「夏季时间 / 南校区」等标题
async function parseScheduleText(text) {
  const parser = await loadScheduleParser()
  return parser.parseScheduleOCR(text, {
    campuses: timeConfig.value.campuses,
    seasons: timeConfig.value.seasons,
  })
}

function clearRecognition() {
  recognitionDraft.value = null
  activeSchemeId.value = null
  schemeDetailOpen.value = false
  detailFilter.value = 'all'
  importPlanOpen.value = false
  importPlan.value = null
  importPlanOverrides.value = {}
  planDiffExpanded.value = {}
}

function discardRecognition() {
  clearRecognition()
  pasteText.value = ''
  showToast('已放弃本次识别结果，正式作息未受影响')
}

// 识别结果进入暂存层：此处绝不写入正式作息
async function startRecognition(analysis, sourceName) {
  const api = await loadRecognition()
  const draft = api.buildRecognitionDraft(analysis, timeConfig.value, sourceName)
  recognitionDraft.value = draft
  activeSchemeId.value = draft.schemes[0]?.id ?? null
  schemeDetailOpen.value = false
  detailFilter.value = 'all'
  return draft
}

function countTargetModes(draft) {
  const modes = { replace: 0, create: 0, pending: 0 }
  for (const scheme of draft.schemes) {
    if (scheme.target.mode === 'replace') modes.replace += 1
    else if (scheme.target.mode === 'create') modes.create += 1
    else modes.pending += 1
  }
  return modes
}

function modesText(modes) {
  const parts = []
  if (modes.replace) parts.push(`${modes.replace} 组替换`)
  if (modes.create) parts.push(`${modes.create} 组新建`)
  if (modes.pending) parts.push(`${modes.pending} 组待确认`)
  return parts.join(' / ') || '无匹配'
}

function recognitionTimeText(createdAt) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function runParsePaste() {
  importError.value = ''
  const analysis = await parseScheduleText(pasteText.value)
  if (!analysis.rows.length) {
    importError.value = '没有解析到「节次名称 + 时间段」行，示例：第一节 8:00-8:45'
    return
  }
  const draft = await startRecognition(analysis, '粘贴文本')
  showToast(`识别完成 · 共 ${draft.schemes.length} 组作息（${modesText(countTargetModes(draft))}）`)
}

async function runParseImage(file, mode = 'auto') {
  importError.value = ''
  if (!file) return
  if (scheduleOcrProgress.state.status === 'running') return
  lastScheduleImage.value = file
  lastScheduleMode = mode
  const controller = new AbortController()
  scheduleOcrController = controller
  scheduleOcrProgress.start({
    title: mode === 'accurate' ? '正在精准识别作息表' : '正在识别作息表',
    steps: SCHEDULE_OCR_STEPS,
    cancel: () => controller.abort(),
  })
  scheduleOcrProgress.setStep('read', 'running', `正在读取 ${file.name}`)
  try {
    const onProgress = (event) => handleOcrActivity(scheduleOcrProgress, event, 'structure')
    // The layout-aware engine handles ordinary table images as well. It only
    // compares an enhanced pass when the quality signal warrants it, so the
    // default path gains reliable row/column recovery without always doing a
    // second full-page OCR. Keep the legacy engine as a compatibility fallback.
    let result
    try {
      result = await performAccurateOCR(file, onProgress, {
        kind: 'schedule',
        mode: mode === 'accurate' ? 'accurate' : 'auto',
        signal: controller.signal,
      })
    } catch (accurateError) {
      if (accurateError?.name === 'AbortError') throw accurateError
      scheduleOcrProgress.activity('布局识别暂不可用，正在切换兼容识别')
      result = await performLegacyOCR(file, onProgress, { signal: controller.signal })
    }
    scheduleOcrProgress.setStep('read', 'completed', '图片读取完成')
    scheduleOcrProgress.setStep('engine', 'completed', '识别引擎已就绪')
    scheduleOcrProgress.setStep('structure', 'completed', result.structure?.valid ? '表格网格与行结构已恢复' : '已提取文字位置与结构')
    scheduleOcrProgress.setStep('extract', 'running', '正在解析节次与作息组')
    const parser = await loadScheduleParser()
    const analysis = parser.parseScheduleOCR(result, {
      campuses: timeConfig.value.campuses,
      seasons: timeConfig.value.seasons,
    })
    scheduleOcrProgress.setPartial({
      校区: analysis.campuses?.length || 0,
      作息季: analysis.seasons?.length || 0,
      节次: analysis.rows?.length || 0,
    }, `提取到 ${analysis.rows.length} 个节次`)
    if (!analysis.rows.length) {
      throw new Error('节次时间提取失败：已识别文字，但未能可靠恢复“节次—时间”结构')
    }
    const schemeTotal = analysis.schemes?.length || 1
    scheduleOcrProgress.setStep('extract', 'completed', `发现 ${schemeTotal} 组作息`)
    scheduleOcrProgress.setStep('match', 'running', '正在匹配校区与作息方案')
    const draft = await startRecognition(analysis, file.name)
    scheduleOcrProgress.setStep('match', 'completed', modesText(countTargetModes(draft)))
    scheduleOcrProgress.setStep('validate', 'running', '正在检查时间冲突与缺失')
    const reviewSchemes = draft.schemes.filter((scheme) => schemeStatus(scheme, timeConfig.value) !== 'ready').length
    scheduleOcrProgress.setStep('validate', reviewSchemes ? 'warning' : 'completed', reviewSchemes ? `${reviewSchemes} 组存在待确认项` : '全部通过')
    scheduleOcrProgress.setStep('preview', 'completed', '等待用户确认')
    scheduleOcrProgress.finish(
      reviewSchemes ? `识别完成 · 共 ${draft.schemes.length} 组作息，${reviewSchemes} 组需要确认` : `识别完成 · 共发现 ${draft.schemes.length} 组作息`,
      reviewSchemes ? 'warning' : 'completed',
    )
    if (result.quality?.warnings?.length) importError.value = `图片质量提示：${result.quality.warnings.join('、')}。精准模式已比较原图、增强图和表格行。`
  } catch (e) {
    if (e?.name === 'AbortError') return
    importError.value = e.message ?? '图片识别失败'
    const engineFailed = isOcrEngineFailure(scheduleOcrProgress, importError.value)
    if (!engineFailed) {
      scheduleOcrProgress.setStep('read', 'completed', '图片读取完成')
      scheduleOcrProgress.setStep('engine', 'completed', '识别引擎已启动')
    }
    const extractionStarted = scheduleOcrProgress.state.steps.some((step) => step.id === 'extract' && step.status === 'running')
    scheduleOcrProgress.fail(engineFailed ? 'engine' : extractionStarted ? 'extract' : 'structure', importError.value, { retainedResult: Boolean(recognitionDraft.value?.schemes.length) })
  } finally {
    if (scheduleOcrController === controller) scheduleOcrController = null
  }
}

function onSeasonDateChange(season, value, input) {
  const date = String(value ?? '').trim()
  settingError.value = ''
  if (date && !isValidSeasonDate(date)) {
    settingError.value = '生效日期无效，请使用 MM-DD，例如 05-01'
    if (input) input.value = season.startDate || ''
    return
  }
  renameSeason(season.id, null, date)
}
function onImportImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  void runParseImage(file)
}

/* ---------- 识别结果总览 / 详情编辑 ---------- */

function toggleSchemeSelected(scheme) {
  scheme.selected = !scheme.selected
}

function openSchemeDetail(schemeId) {
  activeSchemeId.value = schemeId
  detailFilter.value = 'all'
  schemeDetailOpen.value = true
}

function closeSchemeDetail() {
  schemeDetailOpen.value = false
}

// 用户调整目标（校区/作息方案/新建名称）后重新推导 replace/create/pending
function updateSchemeTarget(scheme, patch = {}) {
  const cfg = timeConfig.value
  const target = scheme.target
  Object.assign(target, patch)
  if (target.campusId && target.seasonId) {
    const season = cfg.seasons.find((item) => item.id === target.seasonId)
    if (season && !seasonAppliesTo(season, target.campusId)) target.seasonId = ''
  }
  const hasCampus = Boolean(target.campusId) || Boolean(String(target.newCampusName ?? '').trim())
  const hasSeason = Boolean(target.seasonId) || Boolean(String(target.newSeasonName ?? '').trim())
  if (target.seasonId && target.campusId) {
    target.mode = 'replace'
    target.reason = 'ok'
  } else if (hasCampus && hasSeason) {
    target.mode = 'create'
    target.reason = 'manual'
  } else {
    target.mode = 'pending'
    target.reason = hasCampus ? 'no-season' : 'no-campus'
  }
}

function pickSchemeCampus(scheme, campusId) {
  updateSchemeTarget(scheme, { campusId, newCampusName: '' })
}

function pickSchemeSeason(scheme, seasonId) {
  updateSchemeTarget(scheme, { seasonId, newSeasonName: '' })
}

function startNewCampus(scheme) {
  updateSchemeTarget(scheme, { campusId: '', newCampusName: scheme.detectedCampus || '' })
}

function startNewSeason(scheme) {
  updateSchemeTarget(scheme, { seasonId: '', newSeasonName: scheme.detectedSeason || '' })
}

function onSchemeRowInput(row) {
  row.confirmed = true
}

function addSchemeRow(scheme) {
  scheme.rows.push({
    id: `row-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    key: '',
    label: '',
    periodStart: null,
    periodEnd: null,
    start: '',
    end: '',
    confidence: 'low',
    score: 0,
    source: 'manual',
    sourceIssues: [],
    confirmed: false,
  })
}

function removeSchemeRow(scheme, index) {
  scheme.rows.splice(index, 1)
}

function rowIssuesFor(row) {
  return activeSchemeValidation.value?.rowIssues.get(row.id) ?? []
}

function schemeStatusBadge(scheme) {
  const cfg = timeConfig.value
  const status = schemeStatus(scheme, cfg)
  if (status === 'pending') return { icon: '⚠', text: '映射待确认', cls: 'warn' }
  const validation = recognitionApi?.validateSchemeRows(scheme, cfg)
  if (status === 'blocked') return { icon: '⚠', text: `${validation.hardRowCount} 项待处理`, cls: 'warn' }
  if (status === 'review') return { icon: '⚠', text: `${validation.issueRowCount} 项待确认`, cls: 'warn' }
  const label = schemeDisplayName(scheme, cfg)
  return scheme.target.mode === 'replace'
    ? { icon: '✓', text: `替换「${label}」`, cls: 'ok' }
    : { icon: '✓', text: `新建「${label}」`, cls: 'ok' }
}

function schemeReplaceChanged(scheme) {
  if (scheme.target.mode !== 'replace') return 0
  return recognitionApi?.buildReplaceDiff(scheme, timeConfig.value).changedCount ?? 0
}

const activeSchemeForQuick = computed(() => {
  const draft = recognitionDraft.value
  if (!draft?.schemes.length) return null
  return draft.schemes.find((scheme) => scheme.id === activeSchemeId.value) ?? draft.schemes[0]
})

const detailSeasonOptions = computed(() => {
  const scheme = activeScheme.value
  if (!scheme) return []
  return seasonsForCampus(scheme.target.campusId, timeConfig.value)
})

/* ---------- 导入计划（批量、事务、可撤销） ---------- */

function openImportPlan(scopeSchemeId = null) {
  if (!recognitionDraft.value?.schemes.length) return
  importPlanScope.value = scopeSchemeId
  importPlanOverrides.value = {}
  planDiffExpanded.value = {}
  importPlan.value = recognitionApi?.buildImportPlan(recognitionDraft.value, timeConfig.value, {}, scopeSchemeId) ?? null
  importPlanOpen.value = true
}

function rebuildPlan() {
  if (!recognitionDraft.value || !importPlan.value) return
  importPlan.value = recognitionApi?.buildImportPlan(recognitionDraft.value, timeConfig.value, importPlanOverrides.value, importPlanScope.value) ?? null
}

const importPlanScope = ref(null)

function setPlanItemAction(item, action) {
  importPlanOverridesRebuilt.value = true
  importPlanOverrides.value = { ...importPlanOverrides.value, [item.schemeId]: action }
  rebuildPlan()
}

function togglePlanDiff(item) {
  planDiffExpanded.value = { ...planDiffExpanded.value, [item.schemeId]: !planDiffExpanded.value[item.schemeId] }
}

function canReplaceItem(item) {
  return item.targetMode === 'replace'
}

function canImportItem(item) {
  return item.targetMode !== 'pending'
}

function createActionLabel(item) {
  return item.targetMode === 'replace' ? '新建副本' : '新建'
}

function editFromPlan(schemeId) {
  importPlanOpen.value = false
  openSchemeDetail(schemeId)
}

function closeImportPlan() {
  if (importRunning.value) return
  importPlanOpen.value = false
}

function refreshDraftIfAffected(results) {
  if (!planSeasonId.value || !planCampusId.value) return
  const affected = results.some(
    (result) => result.seasonId === planSeasonId.value && result.campusId === planCampusId.value
  )
  if (affected) loadPlanDraft(planSeasonId.value, planCampusId.value)
}

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function confirmImportPlan() {
  const plan = importPlan.value
  if (!plan?.executable || importRunning.value) return
  const cfg = timeConfig.value
  const applied = plan.items.filter((item) => item.action !== 'skip')
  importRunning.value = true
  importProgress.start({
    title: '正在导入作息',
    steps: [
      { id: 'snapshot', label: '创建原数据备份' },
      { id: 'plan', label: '准备导入计划' },
      ...applied.map((item, index) => ({
        id: `apply-${index}`,
        label: `${item.action === 'create' ? '新建' : '更新'} ${index + 1}/${applied.length}：${item.label}`,
      })),
      { id: 'save', label: '保存完成' },
    ],
  })
  const snapshot = recognitionApi?.snapshotTimeConfig(cfg)
  if (!snapshot) return
  try {
    importProgress.setStep('snapshot', 'running')
    await sleep(160)
    importProgress.setStep('snapshot', 'completed')
    importProgress.setStep('plan', 'running')
    await sleep(120)
    importProgress.setStep('plan', 'completed')
    for (let index = 0; index < applied.length; index++) {
      importProgress.setStep(`apply-${index}`, 'running')
      await sleep(140)
      recognitionApi.applyImportItem(applied[index], cfg)
      importProgress.setStep(`apply-${index}`, 'completed')
    }
    cfg.updatedAt = new Date().toISOString()
    importProgress.setStep('save', 'running')
    await sleep(120)
    importProgress.setStep('save', 'completed')
    importProgress.finish(`已成功导入 ${applied.length} 组作息`)
    const replace = applied.filter((item) => item.action === 'replace').length
    const create = applied.length - replace
    lastImportResult.value = { snapshot, count: applied.length, replace, create, at: Date.now() }
    importRunning.value = false
    importPlanOpen.value = false
    clearRecognition()
    pasteText.value = ''
    refreshDraftIfAffected(applied)
    showToast(`✓ 已成功导入 ${applied.length} 组作息（${replace} 替换 / ${create} 新建），如识别有误可撤销`)
  } catch (e) {
    recognitionApi?.restoreTimeConfig(cfg, snapshot)
    const messageText = `导入失败，已恢复原数据：${e?.message ?? '未知错误'}`
    importProgress.fail('save', messageText)
    importRunning.value = false
    importError.value = messageText
  }
}

function undoLastImport() {
  const result = lastImportResult.value
  if (!result) return
  recognitionApi?.restoreTimeConfig(timeConfig.value, result.snapshot)
  lastImportResult.value = null
  if (planSeasonId.value && planCampusId.value) loadPlanDraft(planSeasonId.value, planCampusId.value)
  showToast('已撤销本次导入，恢复到导入前状态')
}

/* ---------- 轻量 toast（设置弹窗内） ---------- */
const settingsToast = ref('')
let settingsToastTimer = 0
function showToast(message) {
  settingsToast.value = message
  window.clearTimeout(settingsToastTimer)
  settingsToastTimer = window.setTimeout(() => { settingsToast.value = '' }, 3200)
}
onBeforeUnmount(() => window.clearTimeout(settingsToastTimer))

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
const formCellCourses = computed(() => {
  if (!showForm.value) return []
  const day = Number(form.day)
  const sIdx = periodIndex(form.start)
  const eIdx = periodIndex(form.end)
  if (sIdx < 0 || eIdx < 0) return []
  const lo = Math.min(sIdx, eIdx)
  const hi = Math.max(sIdx, eIdx)
  return courses.value.filter((c) => {
    if (c.id === editingId.value) return false
    if (c.day !== day) return false
    const cs = periodIndex(c.start)
    const ce = periodIndex(c.end)
    if (cs < 0 || ce < 0) return false
    return Math.min(cs, ce) <= hi && Math.max(cs, ce) >= lo
  })
})

function formOverlapsWith(course) {
  const sw = Number(form.startWeek)
  const ew = Number(form.endWeek)
  const csw = course.startWeek ?? 1
  const cew = course.endWeek ?? MAX_WEEK
  const lo = Math.max(sw, csw)
  const hi = Math.min(ew, cew)
  if (lo > hi) return false
  const ft = form.weekType ?? 'all'
  const ct = course.weekType ?? 'all'
  for (let w = lo; w <= hi; w++) {
    const aOn = ft === 'all' || (ft === 'odd' ? w % 2 === 1 : w % 2 === 0)
    const bOn = ct === 'all' || (ct === 'odd' ? w % 2 === 1 : w % 2 === 0)
    if (aOn && bOn) return true
  }
  return false
}

const formCellClash = computed(() => formCellCourses.value.find((c) => formOverlapsWith(c)))

// ---------- 设置弹窗标签页 ----------
const settingsTab = ref('plans')
const tabHints = {
  plans: '一次只编辑一个「作息季 × 校区」方案。支持导入、复制与批量平移，修改需点击保存才会生效。',
  base: '管理校区、作息季与节次。删除前会检查影响范围；作息季可设置生效日期与适用校区。',
}
const TAB_ICONS = { plans: '⏰ 作息方案', base: '⚙️ 基础设置' }
function tabLabel(tab) {
  return TAB_ICONS[tab] ?? tab
}

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

function retryScheduleAccurate() {
  if (lastScheduleImage.value) void runParseImage(lastScheduleImage.value, 'accurate')
}

function retryScheduleOCR() {
  if (lastScheduleImage.value) void runParseImage(lastScheduleImage.value, lastScheduleMode)
}

function continueScheduleResults() {
  scheduleOcrProgress.reset()
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
function formatConflictWeeks(weeks) {
  if (!weeks?.length) return ''
  const ranges = []; let start = weeks[0]; let previous = weeks[0]
  for (const week of weeks.slice(1)) {
    if (week === previous + 1) previous = week
    else { ranges.push(start === previous ? `${start}` : `${start}-${previous}`); start = previous = week }
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`)
  return ranges.join('、')
}
function formatConflictPeriods(detail) {
  const periods = timeConfig.value.periods.slice(detail.periodStart, detail.periodEnd + 1).map((period) => period.label)
  return periods.length === 1 ? periods[0] : `${periods[0]}至${periods.at(-1)}`
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

function saveSemester() {
  if (!semStart.value) return
  semester.value.start = semStart.value
  viewWeek.value = curWeek.value
  showSemester.value = false
}

function semesterPreview() {
  if (!semStart.value) return ''
  return weekOf(todayStr())
}

const viewDates = computed(() => DAYS.map((_, day) => dateForWeekDay(viewWeek.value, day)))
const viewExceptions = computed(() => viewDates.value.map((date) => scheduleExceptionForDate(date)))
const visibleCourses = computed(() =>
  viewDates.value.flatMap((date) => coursesForDate(courses.value, date))
)

const sortedExceptions = computed(() =>
  [...scheduleExceptions.value].sort((a, b) => a.date.localeCompare(b.date))
)

function courseInstanceKey(course) {
  return `${course.id}-${course.displayDay ?? course.day}`
}

function openExceptionManager() {
  exceptionForm.date = todayStr()
  exceptionForm.type = 'off'
  exceptionForm.sourceDay = 0
  exceptionForm.note = ''
  exceptionError.value = ''
  showExceptions.value = true
}

function saveException() {
  if (!exceptionForm.date) {
    exceptionError.value = '请选择特殊日期'
    return
  }
  const value = {
    id: `exception-${exceptionForm.date}`,
    date: exceptionForm.date,
    type: exceptionForm.type,
    sourceDay: exceptionForm.type === 'makeup' ? Number(exceptionForm.sourceDay) : null,
    note: exceptionForm.note.trim(),
    updatedAt: new Date().toISOString(),
  }
  const index = scheduleExceptions.value.findIndex((item) => item.date === value.date)
  if (index >= 0) scheduleExceptions.value[index] = value
  else scheduleExceptions.value.push(value)
  exceptionError.value = ''
  exceptionForm.note = ''
}

function removeException(id) {
  scheduleExceptions.value = scheduleExceptions.value.filter((item) => item.id !== id)
}

function exceptionLabel(item) {
  if (!item) return ''
  return item.type === 'makeup' ? `补${DAYS[item.sourceDay] ?? '课'}` : '停课'
}

const conflictIds = computed(() => {
  const ids = new Set()
  const list = visibleCourses.value
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const aStart = periodIndex(a.start)
      const aEnd = periodIndex(a.end)
      const bStart = periodIndex(b.start)
      const bEnd = periodIndex(b.end)
      if (
        a.displayDay === b.displayDay &&
        aStart >= 0 && aEnd >= 0 && bStart >= 0 && bEnd >= 0 &&
        aStart <= bEnd &&
        bStart <= aEnd
      ) {
        ids.add(courseInstanceKey(a))
        ids.add(courseInstanceKey(b))
      }
    }
  }
  return ids
})

const conflictCount = computed(() => {
  let count = 0
  const list = visibleCourses.value
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const aStart = periodIndex(a.start)
      const aEnd = periodIndex(a.end)
      const bStart = periodIndex(b.start)
      const bEnd = periodIndex(b.end)
      if (
        a.displayDay === b.displayDay &&
        aStart >= 0 && aEnd >= 0 && bStart >= 0 && bEnd >= 0 &&
        aStart <= bEnd &&
        bStart <= aEnd
      ) {
        count++
      }
    }
  }
  return count
})

function openAdd(day = null, period = null) {
  editingId.value = null
  error.value = ''
  const periods = timeConfig.value.periods
  const fallbackStart = periods[1]?.id ?? periods[0]?.id ?? null
  form.name = ''
  form.teacher = ''
  form.room = ''
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

function save() {
  if (!form.name.trim()) {
    error.value = '请填写课程名称'
    return
  }
  let s = form.start
  let e = form.end
  if (periodIndex(e) < periodIndex(s)) [s, e] = [e, s]
  let sw = Number(form.startWeek)
  let ew = Number(form.endWeek)
  if (ew < sw) [sw, ew] = [ew, sw]
  const data = {
    name: form.name.trim(),
    teacher: form.teacher.trim(),
    room: form.room.trim(),
    color: form.color,
    day: Number(form.day),
    start: s,
    end: e,
    startWeek: sw,
    endWeek: ew,
    weekType: form.weekType,
  }
  const id = editingId.value || `c${Date.now()}`
  const existing = editingId.value ? courses.value.filter((course) => course.id !== editingId.value) : courses.value
  beginCourseImport([{ id, ...data }], { source: 'manual', editingId: editingId.value, existingCourses: existing })
}

function remove() {
  courses.value = courses.value.filter((c) => c.id !== editingId.value)
  showForm.value = false
}

function periodOption(id) {
  const label = periodLabelById(id)
  const t = periodRangeById(id)
  return t ? `${label}（${t}）` : label
}

function coursePeriodText(course) {
  const start = periodLabelById(course.start)
  const end = periodLabelById(course.end)
  return course.start === course.end ? start : `${start}至${end}`
}

function templateDate(value) {
  return new Date(value).toLocaleDateString('zh-CN')
}

const todayIdx = computed(() => todayIndex())

// 只取消当前页面任务；OCR Worker 是模块级单例，跨路由复用，避免每次返回课表都重新加载模型。
onBeforeUnmount(() => {
  scheduleOcrController?.abort()
  batchOcrController?.abort()
})
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

    <div v-if="conflictIds.size > 0" class="warn-banner">
      ⚠️ 第 {{ viewWeek }} 周有 {{ conflictCount }} 组课程时间冲突（红框标出），请检查周次设置
    </div>

    <div class="card timetable-wrap" :class="`skin-${appearance.scheduleSkin}`">
      <div class="timetable">
        <div class="corner"></div>
        <div
          v-for="(d, i) in DAYS"
          :key="d"
          class="tt-head"
          :class="{ today: i === todayIdx && viewWeek === curWeek }"
        >
          {{ d }}<span v-if="i === todayIdx && viewWeek === curWeek" class="today-tag">今天</span><span v-if="viewExceptions[i]" class="exception-tag" :class="viewExceptions[i].type">{{ exceptionLabel(viewExceptions[i]) }}</span>
        </div>

        <template v-for="(row, ri) in timeConfig.periods" :key="row.id">
          <div class="tt-period" :style="{ gridRow: ri + 2 }">
            <b>{{ row.label }}</b>
            <span>{{ periodRangeById(row.id) }}</span>
          </div>
          <div
            v-for="(d, i) in DAYS"
            :key="d + row.id"
            class="tt-cell"
            :class="{ isToday: i === todayIdx && viewWeek === curWeek }"
            :style="{ gridColumn: i + 2, gridRow: ri + 2 }"
            @click="openAdd(i, row.id)"
          ></div>
        </template>

        <div
          v-for="c in visibleCourses"
          :key="courseInstanceKey(c)"
          class="course"
          :class="{ conflict: conflictIds.has(courseInstanceKey(c)) }"
          :style="{
            gridColumn: c.displayDay + 2,
            gridRow: `${periodIndex(c.start) + 2} / ${periodIndex(c.end) + 3}`,
            background: c.color + '18',
            borderLeftColor: c.color,
          }"
          @click="openEdit(c)"
        >
          <span class="c-name">{{ c.name }}</span>
          <span class="c-week">{{ weekLabel(c) }}</span>
          <span v-if="c.room" class="c-sub">@{{ c.room }}</span>
        </div>
      </div>
    </div>

    <p class="tip">
      💡 正在查看：{{ campusName(currentCampusId()) }} ·
      {{ seasonName(currentSeasonId()) }}<template v-if="showSeasonSwitcher && timeConfig.autoSeason && currentAutoStatus.available">（自动）</template> ·
      第 {{ viewWeek }} 周的课程；
      点击空白格子快速添加，点击课程卡片可编辑
    </p>

    <Modal :open="showForm" :title="editingId ? '编辑课程' : '添加课程'" @close="showForm = false">
      <div class="form">
        <label>课程名称 *</label>
        <input v-model="form.name" placeholder="例如：高等数学" />

        <label>任课老师</label>
        <input v-model="form.teacher" placeholder="选填" />

        <label>上课地点</label>
        <input v-model="form.room" placeholder="例如：教学楼 A201" />

        <div class="row">
          <div>
            <label>星期</label>
            <select v-model.number="form.day">
              <option v-for="(d, i) in DAYS" :key="d" :value="i">{{ d }}</option>
            </select>
          </div>
          <div>
            <label>开始</label>
            <select v-model="form.start">
              <option v-for="row in timeConfig.periods" :key="row.id" :value="row.id">
                {{ periodOption(row.id) }}
              </option>
            </select>
          </div>
          <div>
            <label>结束</label>
            <select v-model="form.end">
              <option v-for="row in timeConfig.periods" :key="row.id" :value="row.id">
                {{ periodOption(row.id) }}
              </option>
            </select>
          </div>
        </div>

        <div class="row">
          <div>
            <label>开始周</label>
            <select v-model.number="form.startWeek">
              <option v-for="w in MAX_WEEK" :key="w" :value="w">第{{ w }}周</option>
            </select>
          </div>
          <div>
            <label>结束周</label>
            <select v-model.number="form.endWeek">
              <option v-for="w in MAX_WEEK" :key="w" :value="w">第{{ w }}周</option>
            </select>
          </div>
          <div>
            <label>上课周类型</label>
            <select v-model="form.weekType">
              <option value="all">每周上</option>
              <option value="odd">单周上</option>
              <option value="even">双周上</option>
            </select>
          </div>
        </div>

        <div v-if="formCellCourses.length" class="cell-existing">
          <span class="ce-label">此格已有：</span>
          <span
            v-for="c in formCellCourses"
            :key="c.id"
            class="cell-chip"
            :class="{ clash: formOverlapsWith(c) }"
          >{{ c.name }}（{{ weekLabel(c) }}）</span>
        </div>
        <p v-if="formCellClash" class="error">
          ⚠️ 周次与「{{ formCellClash.name }}」重叠，请调整开始/结束周，否则两门课会叠在一起
        </p>

        <label>标记颜色</label>
        <div class="colors">
          <button
            v-for="color in PALETTE"
            :key="color"
            class="swatch"
            :style="{ background: color }"
            :class="{ picked: form.color === color }"
            @click="form.color = color"
          ></button>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="actions">
          <button v-if="editingId" class="btn btn-danger" @click="remove">删除课程</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
        <p v-if="editingId" class="cell-add-hint">
          同一格子可以放不同周次的课（如 1-6 周上 A、7-16 周上 B）
          <button class="btn btn-ghost" @click="addAnotherInCell">＋ 在此格添加另一门课</button>
        </p>
      </div>
    </Modal>

    <Modal :open="showCourseManager" title="课程批量管理" wide @close="showCourseManager = false">
      <div class="course-manager">
        <section class="manager-section">
          <div class="manager-head">
            <div>
              <h4>当前课程</h4>
              <span>共 {{ courses.length }} 门，已选择 {{ selectedCourses.length }} 门</span>
            </div>
            <div class="manager-actions">
              <button class="btn btn-ghost" :disabled="!courses.length" @click="toggleAllCourses">
                {{ allCoursesSelected ? '取消全选' : '全选' }}
              </button>
              <button class="btn btn-ghost" :disabled="!selectedCourses.length" @click="duplicateSelectedCourses">
                创建副本
              </button>
              <button class="btn btn-danger" :disabled="!selectedCourses.length" @click="deleteSelectedCourses">
                删除选中
              </button>
            </div>
          </div>

          <div v-if="courses.length" class="manager-table-scroll">
            <table class="manager-table">
              <thead>
                <tr><th></th><th>课程</th><th>星期</th><th>节次</th><th>周次</th><th>地点</th><th>教师</th></tr>
              </thead>
              <tbody>
                <tr v-for="course in courses" :key="course.id" :class="{ selected: selectedCourseIds.includes(course.id) }">
                  <td>
                    <input
                      type="checkbox"
                      :checked="selectedCourseIds.includes(course.id)"
                      :aria-label="`选择课程 ${course.name}`"
                      @change="toggleCourseSelection(course.id)"
                    />
                  </td>
                  <td><b>{{ course.name }}</b></td>
                  <td>{{ DAYS[course.day] }}</td>
                  <td>{{ coursePeriodText(course) }}</td>
                  <td>{{ weekLabel(course) }}</td>
                  <td>{{ course.room || '—' }}</td>
                  <td>{{ course.teacher || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="manager-empty">当前还没有课程，可以批量录入或从下方模板导入。</p>

          <div class="clear-row">
            <span>清空前建议先保存课表模板或导出完整备份。</span>
            <button class="btn btn-danger" :disabled="!courses.length" @click="clearCurrentSchedule">清空全部课程</button>
          </div>
        </section>

        <section class="manager-section template-section">
          <div class="manager-head">
            <div>
              <h4>学期课表模板</h4>
              <span>保存当前整张课表，新学期可一键重新导入。</span>
            </div>
          </div>

          <div class="template-save">
            <input v-model="templateName" placeholder="例如：2026 秋季学期" @input="managerError = ''" />
            <button class="btn btn-primary" @click="saveCourseTemplate">保存当前课表</button>
          </div>

          <div v-if="courseTemplates.length" class="template-list">
            <div v-for="template in courseTemplates" :key="template.id" class="template-item">
              <div>
                <b>{{ template.name }}</b>
                <span>{{ template.courses.length }} 门课程 · {{ templateDate(template.createdAt) }}</span>
              </div>
              <div>
                <button class="btn btn-ghost" @click="importCourseTemplate(template)">导入</button>
                <button class="template-delete" aria-label="删除模板" @click="deleteCourseTemplate(template)">✕</button>
              </div>
            </div>
          </div>
          <p v-else class="manager-empty compact">还没有保存过学期课表模板。</p>
        </section>

        <p v-if="managerMessage" class="manager-success">{{ managerMessage }}</p>
        <p v-if="managerError" class="error">{{ managerError }}</p>
      </div>
    </Modal>

    <Modal :open="showBatch" title="批量录入课程" wide @close="showBatch = false">
      <div class="batch-import">
        <div class="batch-help">
          <b>方式一：粘贴文字</b>（字段顺序不限，分隔符随意）
          <span>每行一门课，自动识别"周一/星期三"、节次"1-2节/第3节"、周次"1-16周/全学期"、单双周、地点、教师。支持 Tab/逗号/空格/中文标点混用。</span>
        </div>

        <div class="batch-help">
          <b>方式二：上传教务系统课表截图/照片</b>
          <span>会读取文字在表格中的位置，自动还原星期、节次、周次、教室和教师。图片不上传服务器，本地完成。</span>
        </div>

        <div class="batch-input-row">
          <textarea
            v-model="batchText"
            rows="7"
            placeholder="高等数学 周一 1-2节 1-16周 A201 张老师&#10;大学英语,星期三,3-4,1-16,单周,B305,李老师"
            @input="batchError = ''"
            @keydown.stop
            @click.stop
            class="batch-textarea"
          ></textarea>
          <div class="batch-image-upload" @click.stop>
            <label class="file-button" for="batch-ocr-input" :class="{ busy: batchOcrProgress.state.status === 'running' }">
              <input id="batch-ocr-input" type="file" accept="image/*" multiple :disabled="batchOcrProgress.state.status === 'running'" @change="ocrImage" hidden />
              <span v-if="batchOcrProgress.state.status === 'running'">🔄 {{ batchOcrProgress.state.latestActivity }}</span>
              <span v-else>📷 上传图片识别</span>
            </label>
            <p class="ocr-hint">支持一次选择多张 PNG/JPG/WebP；长截图会保留小字清晰度，结果逐张追加且不会覆盖已修改内容</p>
            <p v-if="ocrSummary" class="ocr-result-hint">{{ ocrSummary }}</p>
          </div>
        </div>

        <TaskProgress
          :task="batchOcrProgress.state"
          :elapsed-seconds="batchOcrProgress.elapsedSeconds.value"
          :activity-age-seconds="batchOcrProgress.activityAgeSeconds.value"
          :stalled="batchOcrProgress.isStalled.value"
          @cancel="batchOcrProgress.cancel"
          @retry="retryBatchOCR"
          @continue="continueBatchResults"
          @wait="batchOcrProgress.continueWaiting"
        />

        <div v-if="batchRows.length" class="batch-preview-wrap">
          <div class="batch-summary">
            <b>导入预览</b>
            <span class="ok-text">{{ validBatchCount }} 行可导入</span>
            <span v-if="invalidBatchCount" class="error-text">{{ invalidBatchCount }} 行需修改</span>
            <span v-if="needsReviewCount" class="warning-text">{{ needsReviewCount }} 行需要确认</span>
          </div>
          <div class="batch-table-scroll batch-desktop-preview">
            <table class="batch-table">
              <thead>
                <tr>
                  <th>行</th><th>课程</th><th>星期</th><th>节次</th><th>周次</th><th>类型</th><th>地点</th><th>教师</th>
                </tr>
              </thead>
              <tbody>
<template v-for="row in batchRows" :key="row.sourceIndex">
                   <tr :class="{ invalid: row.error, needsReview: row.needsReview }">
                     <td>{{ row.sourceIndex }}</td>
                     <td>{{ row.data?.name || (row.cells && row.cells[0]) || '—' }}</td>
                     <td>{{ row.data ? DAYS[row.data.day] : (row.cells && row.cells[1]) || '—' }}</td>
                     <td>{{ row.data ? coursePeriodText(row.data) : (row.cells && row.cells[2]) || '—' }}</td>
                     <td>{{ row.data ? `${row.data.startWeek}-${row.data.endWeek}` : (row.cells && row.cells[3]) || '—' }}</td>
                     <td>{{ row.data ? ({ all: '每周', odd: '单周', even: '双周' }[row.data.weekType]) : (row.cells && row.cells[4]) || '—' }}</td>
                     <td>{{ row.data?.room || (row.cells && row.cells[5]) || '—' }}</td>
                     <td>{{ row.data?.teacher || (row.cells && row.cells[6]) || '—' }}</td>
                   </tr>
                   <tr v-if="row.error" class="batch-error-row">
                     <td></td><td colspan="7">
                       <div class="error-message">
                         <span class="error-icon">⚠️</span>
                         <span>{{ row.error }}</span>
                       </div>
                     </td>
                   </tr>
                   <tr v-if="row.needsReview && !row.error" class="batch-review-row">
                     <td></td><td colspan="7">
                       <div class="review-message">
                         <span class="review-icon">ℹ️</span>
                         <span>置信度: {{ (row.confidence.score * 100).toFixed(0) }}% (建议确认)</span>
                       </div>
                     </td>
                   </tr>
                 </template>
              </tbody>
            </table>
          </div>
          <div class="batch-mobile-preview">
            <article
              v-for="row in batchRows"
              :key="`mobile-${row.sourceIndex}`"
              class="batch-mobile-card"
              :class="{ invalid: row.error, needsReview: row.needsReview }"
            >
              <div class="batch-mobile-head">
                <span>第 {{ row.sourceIndex }} 行</span>
                <b>{{ row.data?.name || row.cells?.[0] || '未识别课程' }}</b>
                <em v-if="row.error">需修改</em><em v-else-if="row.needsReview">请确认</em><em v-else class="ok">可导入</em>
              </div>
              <dl v-if="row.data">
                <div><dt>星期</dt><dd>{{ DAYS[row.data.day] }}</dd></div>
                <div><dt>节次</dt><dd>{{ coursePeriodText(row.data) }}</dd></div>
                <div><dt>周次</dt><dd>{{ row.data.startWeek }}-{{ row.data.endWeek }}周 · {{ { all: '每周', odd: '单周', even: '双周' }[row.data.weekType] }}</dd></div>
                <div><dt>地点</dt><dd>{{ row.data.room || '—' }}</dd></div>
                <div><dt>教师</dt><dd>{{ row.data.teacher || '—' }}</dd></div>
              </dl>
              <p v-if="row.error">⚠️ {{ row.error }}</p>
              <p v-else-if="row.needsReview">ℹ️ 识别结果建议人工确认</p>
            </article>
          </div>
        </div>

        <p v-if="batchError && !(batchOcrProgress.state.active && batchOcrProgress.state.visible)" class="error">{{ batchError }}</p>
        <div v-if="message" class="batch-success">
          <b>✓ {{ message }}</b>
          <span>课程已经保存在本机，可以继续录入或返回课表检查。</span>
          <div><button v-if="lastImportUndo" class="btn btn-ghost" @click="undoLastCourseImport">撤销本次导入</button><button class="btn btn-ghost" @click="continueBatchImport">继续录入</button><button class="btn btn-primary" @click="finishBatchImport">完成并查看课表</button></div>
        </div>
        <div v-else class="actions">
          <button class="btn btn-ghost" @click="batchText = ''">清空</button>
          <button class="btn btn-primary" :disabled="!validBatchCount || invalidBatchCount" @click="importBatch">
            导入 {{ validBatchCount }} 门课程
          </button>
        </div>
      </div>
    </Modal>

    <Modal :open="showImportConflict" title="课程导入冲突处理" wide @close="cancelCourseImportReview">
      <div v-if="importDraft" class="import-conflict-review">
        <p class="import-conflict-summary">
          导入检查完成：本次 {{ importSummary.total }} 门课程，<b>{{ importSummary.direct }} 门可直接导入</b>，
          <b v-if="importSummary.conflicts">{{ importSummary.conflicts }} 门存在真实时间冲突</b><b v-if="importSummary.duplicates">{{ importSummary.duplicates }} 门疑似重复</b>。
        </p>
        <div class="import-conflict-actions">
          <button class="btn btn-primary" @click="applyAllImportDecisions('replace')">一键替换 {{ importSummary.conflicts }} 门冲突项</button>
          <button class="btn" @click="applyAllImportDecisions('keep')">全部保留两门</button>
          <button class="btn" @click="applyAllImportDecisions('skip')">全部跳过冲突项</button>
        </div>
        <div class="conflict-item-list">
          <article v-for="item in actionableImportItems" :key="item.index" class="conflict-item">
            <b>{{ item.type === 'duplicate' ? '疑似重复课程' : '时间冲突' }}</b>
            <p>新课程：{{ item.course.name }} · {{ DAYS[item.course.day] }} · {{ coursePeriodText(item.course) }} · {{ weekLabel(item.course) }}</p>
            <div v-for="match in item.matches" :key="match.existing.id" class="conflict-match">
              当前课程：{{ match.existing.name }} · {{ DAYS[match.existing.day] }} · {{ coursePeriodText(match.existing) }} · {{ weekLabel(match.existing) }}
              <small>实际冲突：第{{ formatConflictWeeks(match.detail.weeks) }}周 · {{ formatConflictPeriods(match.detail) }}</small>
            </div>
            <select :value="importDraft.decisions[item.index] || ''" @change="setImportDecision(item.index, $event.target.value)">
              <option value="" disabled>请选择处理方式</option>
              <option value="replace">替换原课程</option>
              <option value="keep">两门都保留</option>
              <option value="skip">跳过新课程</option>
            </select>
          </article>
        </div>
        <p v-if="batchError" class="error">{{ batchError }}</p>
        <div class="import-conflict-footer">
          <button class="btn btn-ghost" @click="cancelCourseImportReview">取消</button>
          <button class="btn btn-primary" :disabled="importCommitBusy" @click="commitCourseImport">确认导入</button>
        </div>
        <div class="replace-all-schedule">
          <b>高级操作</b><span>替换当前整张课表会移除原有全部课程，与“替换冲突项”不同。</span>
          <button class="btn btn-danger" :disabled="importCommitBusy" @click="commitWholeScheduleReplacement">替换当前整张课表</button>
        </div>
      </div>
    </Modal>

    <Modal :open="showExceptions" title="🗓 节假日与补课" wide @close="showExceptions = false">
      <div class="exception-editor">
        <p class="muted-tip">特殊日期只影响指定的一天，不会修改原来的每周课程。补课可以让某天临时按照指定星期显示课程。</p>
        <div class="exception-form">
          <label>日期<input v-model="exceptionForm.date" type="date" @input="exceptionError = ''" /></label>
          <label>安排<select v-model="exceptionForm.type"><option value="off">停课 / 放假</option><option value="makeup">补课</option></select></label>
          <label v-if="exceptionForm.type === 'makeup'">按照<select v-model.number="exceptionForm.sourceDay"><option v-for="(day, index) in DAYS" :key="day" :value="index">{{ day }}课表</option></select></label>
          <label class="exception-note">说明<input v-model="exceptionForm.note" placeholder="例如：国庆放假、周六补周一课程" /></label>
          <button class="btn btn-primary" @click="saveException">保存特殊日期</button>
        </div>
        <p v-if="exceptionError" class="error">{{ exceptionError }}</p>
        <div v-if="sortedExceptions.length" class="exception-list">
          <div v-for="item in sortedExceptions" :key="item.id" class="exception-item">
            <div><b>{{ item.date }}</b><span :class="item.type">{{ exceptionLabel(item) }}</span><small>{{ item.note || (item.type === 'makeup' ? `当天按照${DAYS[item.sourceDay]}课表` : '当天课程暂停') }}</small></div>
            <button class="btn btn-danger" @click="removeException(item.id)">删除</button>
          </div>
        </div>
        <p v-else class="manager-empty">还没有设置特殊日期。</p>
      </div>
    </Modal>

    <Modal :open="showSemester" title="📅 学期设置" @close="showSemester = false">
      <div class="form">
        <label>本学期第一周的周一日期 *</label>
        <input v-model="semStart" type="date" />
        <p class="muted-tip">
          设置后自动计算当前周次。例如 9月1日开学（周一），今天若在开学后第 3 周内，则显示「第 3 周」。
          <template v-if="semesterPreview()">
            当前设置下今天是<b> 第 {{ semesterPreview() }} 周</b>。
          </template>
        </p>
        <div class="actions">
          <button class="btn btn-primary" @click="saveSemester">保存</button>
        </div>
      </div>
    </Modal>

    <Modal :open="showTimeEditor" title="🕐 作息与时间设置" @close="tryCloseTimeEditor">
      <div class="settings">
        <div class="tab-bar" role="tablist">
          <button
            v-for="(hint, tab) in tabHints"
            :key="tab"
            type="button"
            class="tab-btn"
            :class="{ on: settingsTab === tab }"
            @click="settingsTab = tab"
          >{{ tabLabel(tab) }}</button>
        </div>
        <p class="settings-hint">{{ tabHints[settingsTab] }}</p>
        <p v-if="settingError" class="error">{{ settingError }}</p>
        <Transition name="toast">
          <p v-if="settingsToast" class="settings-toast">✓ {{ settingsToast }}</p>
        </Transition>

        <!-- ============ 作息方案 ============ -->
        <section v-show="settingsTab === 'plans'" class="setting-section plan-section">
          <!-- 方案选择器：按复杂度自动简化 -->
          <div v-if="timeConfig.campuses.length > 1 || seasonsForPlanCampus.length > 1" class="plan-picker">
            <div v-if="timeConfig.campuses.length > 1" class="plan-picker-row">
              <span class="pp-label">校区</span>
              <div class="seg">
                <button
                  v-for="campus in timeConfig.campuses"
                  :key="campus.id"
                  :class="{ on: planCampusId === campus.id }"
                  @click="switchPlan(planSeasonId, campus.id)"
                >{{ campus.name }}</button>
              </div>
            </div>
            <div v-if="seasonsForPlanCampus.length > 1" class="plan-picker-row">
              <span class="pp-label">作息季</span>
              <div class="seg">
                <button
                  v-for="season in seasonsForPlanCampus"
                  :key="season.id"
                  :class="{ on: planSeasonId === season.id }"
                  @click="switchPlan(season.id, planCampusId)"
                >{{ season.name }}</button>
              </div>
            </div>
          </div>

          <!-- 方案标题 + 工具条 -->
          <div class="plan-head">
            <b class="plan-title">{{ seasonName(planSeasonId) }} · {{ campusName(planCampusId) }}</b>
            <span v-if="draftDirty" class="dirty-dot">● 有未保存修改</span>
          </div>
          <div class="plan-tools">
            <button class="btn btn-sm btn-ghost" @click="toggleImport">＋ 新建 / 导入</button>
            <button v-if="otherPlans.length" class="btn btn-sm" @click="toggleCopy">⧉ 复制已有方案</button>
            <button class="btn btn-sm" @click="openTimeShift">± 批量调整</button>
            <button class="btn btn-sm" @click="onResetTimes">↺ 恢复默认</button>
          </div>

          <!-- 导入结果横幅（独立于导入面板，导入后仍可撤销） -->
          <div v-if="lastImportResult" class="import-result-banner">
            <span>✓ 已成功导入 {{ lastImportResult.count }} 组作息（{{ lastImportResult.replace }} 替换 / {{ lastImportResult.create }} 新建）</span>
            <button class="btn btn-xs" @click="undoLastImport">撤销本次导入</button>
          </div>

          <!-- 复制方案面板 -->
          <div v-if="copyOpen" class="tool-panel">
            <div class="tool-panel-title">从哪个方案复制？（复制后两套方案互相独立）</div>
            <div class="copy-list">
              <button
                v-for="plan in otherPlans"
                :key="plan.season + plan.campus"
                class="copy-item"
                @click="copyFrom(plan.season, plan.campus)"
              >{{ plan.seasonName }} · {{ plan.campusName }}</button>
            </div>
          </div>

          <!-- 批量调整面板（先预览） -->
          <div v-if="batchOpen" class="tool-panel">
            <div class="tool-panel-title">批量调整时间（先预览，确认后应用到草稿）</div>
            <div class="batch-controls">
              <select v-model.number="batchFrom">
                <option v-for="(p, i) in timeConfig.periods" :key="p.id" :value="i">{{ p.label }}</option>
              </select>
              <i>至</i>
              <select v-model.number="batchTo">
                <option v-for="(p, i) in timeConfig.periods" :key="p.id" :value="i">{{ p.label }}</option>
              </select>
              <select v-model.number="batchDelta">
                <option :value="-30">−30 分钟</option>
                <option :value="-15">−15 分钟</option>
                <option :value="-10">−10 分钟</option>
                <option :value="-5">−5 分钟</option>
                <option :value="5">+5 分钟</option>
                <option :value="10">+10 分钟</option>
                <option :value="15">+15 分钟</option>
                <option :value="30">+30 分钟</option>
                <option :value="0">自定义</option>
              </select>
              <input
                v-if="batchDelta === 0"
                v-model="batchCustom"
                class="num"
                type="number"
                placeholder="±分钟"
              />
            </div>
            <div v-if="batchPreview" class="diff-list">
              <div v-for="row in batchPreview.rows" :key="row.index" class="diff-row">
                <span class="diff-label">{{ row.label }}</span>
                <s>{{ row.from }}</s>
                <i>→</i>
                <b>{{ row.to }}</b>
              </div>
              <button class="btn btn-primary btn-sm apply-btn" @click="applyBatch">应用 {{ batchPreview.rows.length }} 行</button>
            </div>
            <p v-else class="tool-tip">选择范围与调整幅度后自动预览。</p>
          </div>

          <!-- 快速生成（保留，改为预览制） -->
          <div class="gen-box">
            <button type="button" class="gen-title as-btn" @click="toggleGenPreview">
              ⚡ 快速生成时间（辅助填充）<i>{{ genPreview ? '▴' : '▾' }}</i>
            </button>
            <div v-show="genPreview !== null || true" class="gen-body" v-if="1">
              <div class="gen-grid">
                <label class="gen-item">
                  <span>从</span>
                  <select v-model="gen.startId">
                    <option v-for="p in genStartOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
                  </select>
                  <span>开始</span>
                </label>
                <label class="gen-item">
                  <input v-model="gen.startTime" type="time" />
                  <span>上课</span>
                </label>
                <label class="gen-item">
                  <span>每节</span>
                  <input v-model.number="gen.duration" type="number" min="20" max="90" class="num" />
                  <span>分钟</span>
                </label>
                <label class="gen-item">
                  <span>节间休息</span>
                  <input v-model.number="gen.breakMin" type="number" min="0" max="60" class="num" />
                  <span>分钟</span>
                </label>
                <label class="gen-item">
                  <span>午休：第</span>
                  <select v-model.number="gen.lunchAfterIdx" class="num">
                    <option v-for="(p, i) in genAfterOptions" :key="p.id" :value="i" :disabled="i >= timeConfig.periods.length - 1">{{ p.label }}</option>
                  </select>
                  <span>后</span>
                  <input v-model.number="gen.lunchMin" type="number" min="0" max="300" class="num" />
                  <span>分钟（0=不休）</span>
                </label>
                <label class="gen-item">
                  <span>晚休：第</span>
                  <select v-model.number="gen.dinnerAfterIdx" class="num">
                    <option v-for="(p, i) in genAfterOptions" :key="p.id" :value="i" :disabled="i >= timeConfig.periods.length - 1">{{ p.label }}</option>
                  </select>
                  <span>后</span>
                  <input v-model.number="gen.dinnerMin" type="number" min="0" max="300" class="num" />
                  <span>分钟（0=不休）</span>
                </label>
              </div>
              <button class="btn btn-sm btn-ghost" @click="toggleGenPreview">{{ genPreview ? '收起预览' : '生成预览' }}</button>

              <!-- 生成预览：取消 / 填充空白 / 覆盖 -->
              <div v-if="genPreview" class="diff-list">
                <p class="tool-tip">预览：从「{{ timeConfig.periods[genPreview.rows[0]?.index ?? 0]?.label }}」起共 {{ genPreview.rows.length }} 节。生成只是辅助填充，生成后仍可逐节修改。</p>
                <div v-for="row in genPreview.rows" :key="row.index" class="diff-row">
                  <span class="diff-label">{{ row.label }}</span>
                  <s>{{ row.from }}</s>
                  <i>→</i>
                  <b>{{ row.to }}</b>
                </div>
                <div class="gen-apply-row">
                  <button class="btn btn-sm" @click="genPreview = null">取消</button>
                  <button class="btn btn-sm" @click="applyGenerate('fill')">填充空白节次</button>
                  <button class="btn btn-sm btn-primary" @click="applyGenerate('all')">覆盖当前方案</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 新建 / 导入 -->
          <div v-if="importOpen" class="tool-panel import-panel">
            <div class="tool-panel-title">新建 / 导入作息</div>
            <div class="seg import-tabs">
              <button :class="{ on: importTab === 'paste' }" @click="importTab = 'paste'">📋 粘贴时间表</button>
              <button :class="{ on: importTab === 'image' }" @click="importTab = 'image'">📷 从图片识别</button>
            </div>

            <div v-if="importTab === 'paste'">
              <textarea
                v-model="pasteText"
                class="paste-area"
                rows="6"
                placeholder="粘贴学校官网或通知里的作息时间，每行一条：&#10;第一节 8:00-8:45&#10;第二节 8:55-9:40&#10;夏季时间 / 南校区 等标题会被自动识别"
              />
              <button class="btn btn-sm btn-ghost" @click="runParsePaste">解析预览</button>
            </div>

            <div v-else class="image-import">
              <label class="file-button" for="schedule-import-image" :class="{ busy: scheduleOcrProgress.state.status === 'running' }">
                <span v-if="scheduleOcrProgress.state.status === 'running'">🔄 {{ scheduleOcrProgress.state.latestActivity }}</span>
                <span v-else>📷 上传学校官方作息表图片</span>
                <input id="schedule-import-image" type="file" accept="image/*" :disabled="scheduleOcrProgress.state.status === 'running'" @change="onImportImage" />
              </label>
              <p class="tool-tip">识别结果先进入暂存区，确认导入计划前不会修改正式作息。</p>
              <button v-if="lastScheduleImage && importError" class="btn btn-sm btn-ghost accurate-retry" @click="retryScheduleAccurate">
                使用精准模式重新识别
              </button>
            </div>

            <TaskProgress
              :task="scheduleOcrProgress.state"
              :elapsed-seconds="scheduleOcrProgress.elapsedSeconds.value"
              :activity-age-seconds="scheduleOcrProgress.activityAgeSeconds.value"
              :stalled="scheduleOcrProgress.isStalled.value"
              compact
              @cancel="scheduleOcrProgress.cancel"
              @retry="retryScheduleOCR"
              @continue="continueScheduleResults"
              @wait="scheduleOcrProgress.continueWaiting"
            />

            <p v-if="importError && !(scheduleOcrProgress.state.active && scheduleOcrProgress.state.visible)" class="error">{{ importError }}</p>

            <!-- 第一级：识别结果总览（多组作息、自动匹配、批量导入） -->
            <div v-if="recognitionDraft" class="recognition-overview">
              <div class="overview-head">
                <div class="tool-panel-title">识别结果总览 · 共发现 {{ schemeCount }} 组作息</div>
                <button class="btn btn-xs btn-ghost" @click="discardRecognition">放弃识别</button>
              </div>
              <p v-if="recognitionDraft.sourceName" class="detected-title">
                来源：{{ recognitionDraft.sourceName }}
                <template v-if="!recognitionDraft.sourceName.includes('粘贴')">
                  · {{ recognitionTimeText(recognitionDraft.createdAt) }}
                </template>
              </p>
              <div class="scheme-cards">
                <div
                  v-for="scheme in recognitionDraft.schemes"
                  :key="scheme.id"
                  class="scheme-card"
                  :class="{ off: !scheme.selected, active: scheme.id === activeSchemeId }"
                >
                  <label class="scheme-check" :title="scheme.selected ? '取消勾选' : '勾选后参与批量导入'">
                    <input type="checkbox" :checked="scheme.selected" @change="toggleSchemeSelected(scheme)" />
                  </label>
                  <div class="scheme-card-main" @click="openSchemeDetail(scheme.id)">
                    <div class="scheme-card-title">{{ schemeDisplayName(scheme, timeConfig) }} · {{ scheme.rows.length }}节</div>
                    <div class="scheme-card-status" :class="schemeStatusBadge(scheme).cls">
                      {{ schemeStatusBadge(scheme).icon }} {{ schemeStatusBadge(scheme).text }}
                      <span v-if="scheme.target.mode === 'replace' && schemeReplaceChanged(scheme)">（{{ schemeReplaceChanged(scheme) }} 项时间变化）</span>
                    </div>
                  </div>
                  <button class="btn btn-xs" @click.stop="openSchemeDetail(scheme.id)">查看 / 编辑</button>
                </div>
              </div>

              <div class="import-foot overview-foot">
                <button class="btn btn-sm btn-ghost" @click="discardRecognition">放弃</button>
                <button class="btn btn-sm" :disabled="!activeSchemeForQuick" @click="openImportPlan(activeSchemeForQuick.id)">仅导入当前组</button>
                <button class="btn btn-sm btn-primary" :disabled="!selectedSchemeCount" @click="openImportPlan()">
                  导入选中的 {{ selectedSchemeCount }} 组作息
                </button>
              </div>
            </div>
          </div>

          <!-- 时间编辑列表：上午/下午/晚上 自动分组 -->
          <div class="plan-list">
            <div v-for="section in planSections" :key="section.key" class="plan-section-group">
              <div class="section-label">{{ section.label }}</div>
              <div
                v-for="row in section.rows"
                :key="row.period.id"
                class="plan-row"
                :class="{ 'has-error': rowError(row.index) }"
              >
                <span class="plan-row-label">{{ row.period.label }}</span>
                <div class="plan-row-times">
                  <input
                    type="time"
                    v-model="draft[row.index].start"
                    @input="markDirty"
                  />
                  <i>—</i>
                  <input
                    type="time"
                    v-model="draft[row.index].end"
                    @input="markDirty"
                  />
                </div>
                <span v-if="rowError(row.index)" class="plan-row-error">{{ rowError(row.index) }}</span>
              </div>
            </div>
            <p v-if="planHasError" class="plan-error-tip">存在时间问题，保存前请先修正。</p>
          </div>
        </section>

        <!-- ============ 基础设置 ============ -->
        <template v-if="settingsTab === 'base'">
          <section class="setting-section">
            <div class="setting-head">
              <h4>🏫 校区（{{ timeConfig.campuses.length }}）</h4>
            </div>
            <div v-for="campus in timeConfig.campuses" :key="campus.id" class="setting-row">
              <input
                :value="campus.name"
                @change="renameCampus(campus.id, $event.target.value)"
              />
              <button
                class="setting-del"
                :disabled="timeConfig.campuses.length <= 1"
                title="删除校区"
                @click="onRemoveCampus(campus.id)"
              >✕</button>
            </div>
            <div class="setting-add">
              <input v-model="newCampusName" placeholder="新校区名称，例如：东校区" @keyup.enter="onAddCampus" />
              <button class="btn btn-ghost" @click="onAddCampus">＋ 添加</button>
            </div>
          </section>

          <section class="setting-section">
            <div class="setting-head">
              <h4>☀️ 作息季（{{ timeConfig.seasons.length }}）</h4>
              <span class="setting-note">按起始日期自动切换；同一天开始会无法判断先后</span>
            </div>
            <p v-if="seasonDateConflicts.length" class="error conflict-tip">
              ⚠ 生效日期冲突：{{ seasonDateConflicts.map((c) => `${c.campusName} · ${c.date}（${c.names.join(' / ')}）`).join('；') }} —— 对应校区的自动模式无法判断先后，请调整日期。
            </p>
            <div v-for="season in timeConfig.seasons" :key="season.id" class="season-block">
              <div class="setting-row season">
                <input
                  class="grow"
                  :value="season.name"
                  @change="renameSeason(season.id, $event.target.value, null)"
                />
                <input
                  class="date"
                  :class="{ invalid: !isValidSeasonDate(season.startDate) }"
                  :value="season.startDate"
                  placeholder="05-01"
                  @blur="onSeasonDateChange(season, $event.target.value, $event.target)"
                />
                <button
                  class="setting-del"
                  :disabled="timeConfig.seasons.length <= 1"
                  title="删除作息季"
                  @click="onRemoveSeason(season.id)"
                >✕</button>
              </div>
              <small v-if="!isValidSeasonDate(season.startDate)" class="season-date-warning">
                未配置有效生效日期；适用校区存在多个作息季时，自动模式将不可用。
              </small>
              <div v-if="timeConfig.campuses.length > 1" class="season-scope">
                <span class="scope-label">适用校区</span>
                <button
                  v-for="campus in timeConfig.campuses"
                  :key="campus.id"
                  class="chip"
                  :class="{ on: seasonCampusOn(season, campus.id) }"
                  @click="toggleSeasonCampus(season, campus.id)"
                >{{ campus.name }}</button>
                <small class="scope-note">不勾选的校区不会使用该作息季（时间方案保留但不再参与自动切换）</small>
              </div>
            </div>
            <div class="setting-add">
              <input v-model="newSeasonName" class="grow" placeholder="新作息季名称，例如：春季时间" @keyup.enter="onAddSeason" />
              <input v-model="newSeasonDate" class="date" placeholder="03-01" />
              <button class="btn btn-ghost" @click="onAddSeason">＋ 添加</button>
            </div>
          </section>

          <section class="setting-section">
            <div class="setting-head">
              <h4>📋 节次（{{ timeConfig.periods.length }}）</h4>
              <span class="setting-note">被课程占用的节次无法删除</span>
            </div>
            <div class="period-grid">
              <div v-for="period in timeConfig.periods" :key="period.id" class="setting-row">
                <input
                  :value="period.label"
                  @change="renamePeriod(period.id, $event.target.value)"
                />
                <button
                  class="setting-del"
                  :disabled="timeConfig.periods.length <= 1"
                  title="删除节次"
                  @click="onRemovePeriod(period.id)"
                >✕</button>
              </div>
            </div>
            <div class="setting-add">
              <input v-model="newPeriodLabel" placeholder="新节次名称，例如：第十三节课" @keyup.enter="onAddPeriod" />
              <button class="btn btn-ghost" @click="onAddPeriod">＋ 添加</button>
            </div>
          </section>
        </template>

        <!-- 底部操作栏：草稿模式 -->
        <div class="draft-bar" :class="{ sticky: draftDirty }">
          <span v-if="draftDirty" class="dirty-dot">● 有未保存修改</span>
          <button v-if="draftDirty" class="btn" @click="discardDraft">放弃修改</button>
          <button v-else class="btn btn-ghost" @click="onResetTimes">恢复默认时间</button>
          <button v-if="draftDirty" class="btn btn-primary" :disabled="planHasError" @click="saveDraft">保存</button>
          <button v-else class="btn btn-primary" @click="tryCloseTimeEditor">完成</button>
        </div>
      </div>
    </Modal>

    <!-- 第二级：某一组识别结果的详细编辑（大弹窗，底部固定操作栏） -->
    <Modal
      :open="schemeDetailOpen && !!activeScheme"
      :title="activeScheme ? `编辑识别结果 · ${schemeDisplayName(activeScheme, timeConfig)}` : '编辑识别结果'"
      wide
      @close="closeSchemeDetail"
    >
      <template v-if="activeScheme">
        <div class="detail-target">
          <div class="it-row">
            <span>校区</span>
            <div class="choice-chips">
              <button
                v-for="campus in timeConfig.campuses"
                :key="campus.id"
                :class="{ on: activeScheme.target.campusId === campus.id }"
                @click="pickSchemeCampus(activeScheme, campus.id)"
              >{{ campus.name }}</button>
              <button
                :class="{ on: !activeScheme.target.campusId }"
                title="导入为新校区"
                @click="startNewCampus(activeScheme)"
              >＋ 新校区</button>
            </div>
          </div>
          <div v-if="!activeScheme.target.campusId" class="it-row">
            <span>新校区名</span>
            <input
              class="grow"
              :value="activeScheme.target.newCampusName"
              :placeholder="activeScheme.detectedCampus || '例如：东校区'"
              @input="updateSchemeTarget(activeScheme, { newCampusName: $event.target.value })"
            />
          </div>
          <div class="it-row">
            <span>作息方案</span>
            <div class="choice-chips">
              <button
                v-for="season in detailSeasonOptions"
                :key="season.id"
                :class="{ on: activeScheme.target.seasonId === season.id }"
                @click="pickSchemeSeason(activeScheme, season.id)"
              >{{ season.name }}</button>
              <button
                :class="{ on: !activeScheme.target.seasonId }"
                title="导入为新作息方案"
                @click="startNewSeason(activeScheme)"
              >＋ 新方案</button>
            </div>
          </div>
          <div v-if="!activeScheme.target.seasonId" class="it-row">
            <span>新方案名</span>
            <input
              class="grow"
              :value="activeScheme.target.newSeasonName"
              :placeholder="activeScheme.detectedSeason || '例如：夏季时间'"
              @input="updateSchemeTarget(activeScheme, { newSeasonName: $event.target.value })"
            />
          </div>
          <p v-if="activeScheme.target.mode === 'pending'" class="assignment-message missing">
            ⚠ {{ targetPendingReasonText(activeScheme) }}
          </p>
          <p v-else-if="activeScheme.target.mode === 'replace'" class="assignment-message">
            ✓ 将替换「{{ schemeDisplayName(activeScheme, timeConfig) }}」的现有作息
          </p>
          <p v-else class="assignment-message matched">
            ✓ 将新建「{{ schemeDisplayName(activeScheme, timeConfig) }}」并写入识别结果
          </p>
        </div>

        <div class="seg detail-tabs">
          <button :class="{ on: detailFilter === 'all' }" @click="detailFilter = 'all'">全部 {{ activeScheme.rows.length }}</button>
          <button :class="{ on: detailFilter === 'issues' }" @click="detailFilter = 'issues'">
            异常 {{ activeSchemeIssueCount }}
          </button>
        </div>

        <div class="detail-rows">
          <div
            v-for="(row, index) in activeSchemeRows"
            :key="row.id"
            class="detail-row"
            :class="{ issue: rowIssuesFor(row).length }"
          >
            <div class="detail-row-main">
              <input v-model="row.label" class="grow" placeholder="节次名称" @input="onSchemeRowInput(row)" />
              <input v-model="row.start" type="time" @input="onSchemeRowInput(row)" />
              <i>—</i>
              <input v-model="row.end" type="time" @input="onSchemeRowInput(row)" />
              <button class="setting-del" title="删除该行" @click="removeSchemeRow(activeScheme, index)">✕</button>
            </div>
            <div v-if="rowIssuesFor(row).length" class="detail-row-issues">
              <span v-for="issue in rowIssuesFor(row)" :key="issue.message">⚠ {{ issue.message }}</span>
              <button
                v-if="rowIssuesFor(row).every((issue) => !issue.blocking)"
                class="btn btn-xs"
                @click="row.confirmed = true"
              >确认无误</button>
            </div>
          </div>
          <p v-if="!activeSchemeRows.length" class="tool-tip">没有待处理的异常项，可以直接返回总览进行导入。</p>
        </div>
        <button class="btn btn-sm btn-ghost" @click="addSchemeRow(activeScheme)">＋ 加一行</button>
      </template>

      <template #foot>
        <div v-if="activeScheme" class="detail-foot">
          <button class="btn" @click="closeSchemeDetail">返回总览</button>
          <button class="btn btn-primary" @click="closeSchemeDetail(); openImportPlan(activeScheme.id)">仅导入这一组</button>
        </div>
      </template>
    </Modal>

    <!-- 第三级：导入计划确认 / 执行进度 -->
    <Modal
      :open="importPlanOpen"
      :title="importRunning ? '正在导入' : '本次导入计划'"
      medium
      @close="closeImportPlan"
    >
      <template v-if="!importRunning && importPlan">
        <p class="plan-summary">
          共 {{ importPlan.summary.total }} 组作息 ·
          <b class="ok-text">{{ importPlan.summary.replace }} 组替换</b> ·
          <b class="ok-text">{{ importPlan.summary.create }} 组新建</b> ·
          {{ importPlan.summary.skip }} 组跳过
          <b v-if="importPlan.summary.blocked" class="warning-text">· {{ importPlan.summary.blocked }} 组待处理</b>
        </p>
        <p class="tool-tip">默认按推荐方案执行；替换不会与旧作息合并，而是整体覆盖。</p>
        <div class="plan-items">
          <div
            v-for="item in importPlan.items"
            :key="item.schemeId"
            class="plan-item"
            :class="{ blocked: item.action !== 'skip' && item.blockers.length }"
          >
            <div class="plan-item-head">
              <b class="plan-item-label">{{ item.label }}</b>
              <select class="plan-action" :value="item.action" @change="setPlanItemAction(item, $event.target.value)">
                <option v-if="canReplaceItem(item)" value="replace">替换已有</option>
                <option v-if="canImportItem(item)" value="create">{{ createActionLabel(item) }}</option>
                <option value="skip">跳过</option>
              </select>
            </div>
            <template v-if="item.action !== 'skip'">
              <p v-if="item.diff" class="plan-diff-summary">
                原有 {{ item.diff.oldCount }} 节 → 新识别 {{ item.diff.mappedCount }} 节 · 共 {{ item.diff.changedCount }} 项时间变化
                <button
                  v-if="item.diff.changedCount"
                  class="btn btn-xs btn-ghost"
                  @click="togglePlanDiff(item)"
                >{{ planDiffExpanded[item.schemeId] ? '收起变化' : '查看变化' }}</button>
              </p>
              <div v-if="item.diff && planDiffExpanded[item.schemeId]" class="plan-diff-list">
                <div v-for="change in item.diff.changes" :key="'c' + change.index" class="diff-row">
                  <span class="diff-label">{{ change.label }}</span>
                  <s>{{ change.from }}</s>
                  <i>→</i>
                  <b>{{ change.to }}</b>
                </div>
                <div v-for="addedRow in item.diff.added" :key="'a' + addedRow.index" class="diff-row">
                  <span class="diff-label">{{ addedRow.label }}</span>
                  <s>（原为空）</s>
                  <i>→</i>
                  <b>{{ addedRow.to }}</b>
                </div>
              </div>
              <p v-for="warning in item.warnings" :key="warning" class="plan-warning">⚠ {{ warning }}</p>
              <template v-if="item.blockers.length">
                <p v-for="blocker in item.blockers" :key="blocker" class="plan-blocker">✕ {{ blocker }}</p>
                <button class="btn btn-xs" @click="editFromPlan(item.schemeId)">去处理</button>
              </template>
            </template>
            <p v-else class="plan-skip-note">已跳过，不写入任何数据</p>
          </div>
        </div>
        <div class="plan-foot">
          <button class="btn" @click="closeImportPlan">取消</button>
          <button class="btn btn-primary" :disabled="!importPlan.executable" @click="confirmImportPlan">
            确认并导入（{{ importPlan.summary.replace + importPlan.summary.create }} 组）
          </button>
        </div>
      </template>
      <template v-else>
        <TaskProgress
          :task="importProgress.state"
          :elapsed-seconds="importProgress.elapsedSeconds.value"
          :activity-age-seconds="importProgress.activityAgeSeconds.value"
          :stalled="importProgress.isStalled.value"
          compact
        />
      </template>
    </Modal>
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

/* ---------- 作息方案编辑器（替换旧超宽表格） ---------- */
.plan-picker { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-tint); }
.plan-picker-row { display: flex; align-items: center; gap: 10px; }
.plan-picker-row .seg { flex-wrap: wrap; overflow-x: visible; }
.pp-label { flex: 0 0 44px; color: var(--ink-faint); font-size: 11.5px; font-weight: 700; }
.plan-head { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.plan-title { font-size: 15px; font-weight: 800; }
.dirty-dot { color: #b86b16; font-size: 11.5px; font-weight: 700; }
.plan-tools { display: flex; flex-wrap: wrap; gap: 7px; }
.plan-tools .btn-sm { padding: 6px 11px; font-size: 12px; }
.tool-panel {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 11px;
  background: var(--bg-tint);
}
.tool-panel-title { color: var(--ink-soft); font-size: 12px; font-weight: 700; }
.tool-tip { margin: 0; color: var(--ink-faint); font-size: 11px; line-height: 1.5; }
.copy-list { display: flex; flex-wrap: wrap; gap: 7px; }
.copy-item { padding: 7px 12px; font-size: 12.5px; border: 1px solid var(--border); border-radius: 9px; background: #fff; cursor: pointer; transition: border-color .14s, color .14s, background .14s; }
.copy-item:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.batch-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.batch-controls select, .batch-controls input { width: auto; min-width: 0; }
.batch-controls i { color: var(--ink-faint); font-size: 11px; }
.diff-list { display: flex; flex-direction: column; gap: 5px; max-height: 240px; overflow-y: auto; }
.diff-row { display: flex; align-items: center; gap: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
.diff-label { flex: 0 0 76px; overflow: hidden; color: var(--text); white-space: nowrap; text-overflow: ellipsis; }
.diff-row s { color: var(--ink-faint); }
.diff-row i { color: var(--primary); font-style: normal; }
.diff-row b { color: var(--primary); font-weight: 700; }
.apply-btn { align-self: flex-start; }
.gen-apply-row { display: flex; gap: 8px; flex-wrap: wrap; }
.gen-title.as-btn { width: 100%; text-align: left; background: none; border: none; cursor: pointer; font-size: 13px; font-weight: 750; color: var(--text); padding: 0; display: flex; justify-content: space-between; align-items: center; }
.gen-title.as-btn:hover { color: var(--primary); }
.gen-title.as-btn i { font-style: normal; color: var(--ink-faint); font-size: 11px; }
.paste-area { width: 100%; resize: vertical; font-family: inherit; line-height: 1.55; }
.image-import { display: flex; flex-direction: column; gap: 8px; }
.import-tabs { align-self: flex-start; }
.import-preview { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
.import-review-summary { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 10px; border-radius: 9px; background: var(--bg-tint); font-size: 12px; font-weight: 700; }
.scheme-picker { display: flex; flex-direction: column; gap: 7px; color: var(--ink-faint); font-size: 11.5px; }
.scheme-list { display: flex; flex-wrap: wrap; gap: 7px; }
.scheme-list button, .choice-chips button { padding: 7px 11px; border: 1px solid var(--border); border-radius: 999px; background: #fff; color: var(--ink-soft); font-size: 12px; cursor: pointer; }
.scheme-list button.on, .choice-chips button.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); font-weight: 700; }
.scheme-list button.imported { border-color: #9dd8c5; color: #08785a; }
.import-targets { display: flex; flex-direction: column; gap: 8px; }
.import-target-title { font-size: 12px; font-weight: 800; color: var(--text); }
.it-row { display: grid; grid-template-columns: 54px minmax(0,1fr); align-items: center; gap: 8px; }
.it-row > span { color: var(--ink-faint); font-size: 11.5px; font-weight: 700; }
.choice-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.bound-value { font-size: 12.5px; }
.detected-title { margin: 2px 0 0; color: var(--ink-faint); font-size: 11px; }
.assignment-message { margin: 0; padding: 8px 10px; border-radius: 8px; background: #e7f8f1; color: #08785a; font-size: 11.5px; line-height: 1.5; }
.assignment-message.missing { background: #fff9e9; color: #9a6414; }
.assignment-message.error { background: #fff0f0; color: var(--danger); }
.import-rows { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
.import-row-wrap { padding: 3px; border-radius: 9px; }
.import-row-wrap.review { padding: 7px; border: 1px solid #efd59d; background: #fff9e9; }
.import-row { display: grid; grid-template-columns: minmax(0,1fr) 96px 14px 96px 26px; align-items: center; gap: 6px; }
.import-row i { color: var(--muted); font-style: normal; text-align: center; }
.import-row input[type='time'] { padding: 6px 6px; font-size: 12.5px; }
.row-review-detail { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; color: #9a6414; font-size: 11px; line-height: 1.45; }
.btn-xs { flex: 0 0 auto; padding: 4px 8px; font-size: 10.5px; }
.import-foot { display: flex; justify-content: space-between; gap: 8px; }

/* ---------- 识别结果总览（第一级） ---------- */
.recognition-overview { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
.overview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.scheme-cards { display: flex; flex-direction: column; gap: 7px; }
.scheme-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: #fff;
  transition: opacity .15s ease;
}
.scheme-card.off { opacity: .55; }
.scheme-card.active { border-color: var(--primary); }
.scheme-check { display: flex; align-items: center; }
.scheme-check input { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
.scheme-card-main { min-width: 0; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.scheme-card-title { font-size: 13px; font-weight: 750; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scheme-card-status { font-size: 11.5px; line-height: 1.4; }
.scheme-card-status.ok { color: #08785a; }
.scheme-card-status.warn { color: #9a6414; }
.import-result-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 11px;
  border-radius: 9px;
  background: #e7f8f1;
  color: #08785a;
  font-size: 12px;
  font-weight: 700;
}
.overview-foot { align-items: center; }
.overview-foot .btn-primary { margin-left: auto; }

/* ---------- 详情编辑（第二级） ---------- */
.detail-target { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-tint); }
.assignment-message.matched { background: #eef4ff; color: #2456b8; }
.detail-tabs { align-self: flex-start; }
.detail-tabs button { padding: 7px 14px; }
.detail-rows { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow-y: auto; padding-right: 2px; }
.detail-row { padding: 4px 6px; border-radius: 9px; }
.detail-row.issue { padding: 7px; border: 1px solid #efd59d; background: #fff9e9; }
.detail-row-main { display: grid; grid-template-columns: minmax(0, 1fr) 110px 14px 110px 26px; align-items: center; gap: 6px; }
.detail-row-main i { color: var(--muted); font-style: normal; text-align: center; }
.detail-row-main input[type='time'] { padding: 6px; font-size: 12.5px; }
.detail-row-issues { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; color: #9a6414; font-size: 11px; line-height: 1.45; }
.detail-foot { display: flex; justify-content: space-between; gap: 10px; }
.detail-foot .btn-primary { margin-left: auto; }

/* ---------- 导入计划（第三级） ---------- */
.plan-summary { margin: 0 0 4px; font-size: 13px; color: var(--text); }
.plan-summary b.ok-text { color: #08785a; }
.plan-summary b.warning-text { color: #9a6414; }
.plan-items { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow-y: auto; padding-right: 2px; }
.plan-item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; background: #fff; }
.plan-item.blocked { border-color: #e5b4b4; background: #fffafa; }
.plan-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.plan-item-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-action { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 8px; background: #fff; color: var(--text); }
.plan-diff-summary { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--ink-soft); font-size: 11.5px; }
.plan-diff-list { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--bg-tint); }
.plan-warning { margin: 0; color: #9a6414; font-size: 11.5px; }
.plan-blocker { margin: 0; color: var(--danger); font-size: 11.5px; font-weight: 700; }
.plan-skip-note { margin: 0; color: var(--ink-faint); font-size: 11.5px; }
.plan-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }

/* 时间行：上午/下午/晚上分组 */
.plan-list { display: flex; flex-direction: column; gap: 14px; }
.section-label { color: var(--ink-faint); font-size: 11px; font-weight: 800; letter-spacing: .06em; margin-bottom: 6px; }
.plan-section-group { display: flex; flex-direction: column; gap: 6px; }
.plan-row {
  display: grid;
  grid-template-columns: minmax(88px, 132px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 10px;
}
.plan-row:nth-child(odd) { background: var(--bg-tint); }
.plan-row.has-error { background: #fff7f0; box-shadow: inset 2px 0 0 var(--danger); }
.plan-row-label { overflow: hidden; font-size: 13px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.plan-row-times { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.plan-row-times input[type='time'] { width: 104px; padding: 6px 7px; font-size: 13px; border-radius: 8px; }
.plan-row-times i { color: var(--muted); font-style: normal; }
.plan-row-error { color: var(--danger); font-size: 11px; }
.plan-error-tip { margin: 4px 0 0; color: var(--danger); font-size: 11.5px; }

/* 草稿操作栏 */
.draft-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.draft-bar.sticky {
  position: sticky;
  bottom: 0;
  z-index: 3;
  margin-top: 18px;
  padding: 10px 2px 4px;
  background: linear-gradient(180deg, rgba(255,255,255,0), #fff 34%);
}
.settings-toast {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0;
  padding: 7px 12px;
  color: #07805d;
  font-size: 12px;
  border-radius: 8px;
  background: #e7f8f1;
}
.toast-enter-active, .toast-leave-active { transition: opacity .2s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; }

/* 季适用校区 chips */
.season-block + .season-block { margin-top: 12px; }
.season-scope { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 2px 0 2px 6px; }
.scope-label { color: var(--ink-faint); font-size: 11px; font-weight: 700; }
.scope-note { flex-basis: 100%; color: var(--ink-faint); font-size: 10.5px; }
.conflict-tip { margin: 0 0 8px; }
.season-date-warning { display: block; margin: 4px 0 0 6px; color: #9a6414; font-size: 10.5px; }
.setting-row input.invalid { border-color: #e4b85b; background: #fffaf0; }

.course-manager {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.manager-section {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
}
.manager-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
  border-bottom: 1px solid var(--border);
  background: #fafbfd;
}
.manager-head h4 {
  font-size: 14px;
}
.manager-head span {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 11px;
}
.manager-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.manager-actions .btn,
.clear-row .btn,
.template-item .btn {
  padding: 7px 11px;
  font-size: 12px;
}
.manager-table-scroll {
  max-height: 280px;
  overflow: auto;
}
.manager-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 12px;
}
.manager-table th,
.manager-table td {
  padding: 9px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
}
.manager-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  background: #fff;
}
.manager-table tr.selected td {
  background: var(--primary-soft);
}
.manager-table input {
  accent-color: var(--primary);
}
.manager-empty {
  padding: 30px 14px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.manager-empty.compact {
  padding: 18px 14px;
}
.clear-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  color: var(--muted);
  font-size: 11px;
  background: #fffafa;
}
.template-save {
  display: flex;
  gap: 8px;
  padding: 12px 14px;
}
.template-save input {
  flex: 1;
  min-width: 0;
}
.template-list {
  border-top: 1px solid var(--border);
}
.template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.template-item:last-child {
  border-bottom: none;
}
.template-item > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.template-item span {
  color: var(--muted);
  font-size: 11px;
}
.template-item > div:last-child {
  display: flex;
  align-items: center;
  gap: 6px;
}
.template-delete {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--muted);
  border: none;
  border-radius: 7px;
  background: transparent;
}
.template-delete:hover {
  color: var(--danger);
  background: #feecec;
}
.manager-success {
  color: #07805d;
  font-size: 13px;
}

.batch-import {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.import-conflict-review { display: flex; flex-direction: column; gap: 12px; }
.import-conflict-summary { margin: 0; line-height: 1.65; color: var(--ink-soft); }
.import-conflict-summary b { margin-left: 4px; color: var(--text); }
.import-conflict-actions, .import-conflict-footer { display: flex; flex-wrap: wrap; gap: 8px; }
.conflict-item-list { display: flex; max-height: 42vh; flex-direction: column; gap: 9px; overflow: auto; }
.conflict-item { padding: 12px; border: 1px solid #efd59d; border-radius: 10px; background: #fffaf0; }
.conflict-item > b { color: #9a6414; font-size: 12px; }
.conflict-item p { margin: 7px 0; font-size: 12px; line-height: 1.5; }
.conflict-item select { width: 100%; margin-top: 8px; }
.conflict-match { padding: 7px 9px; border-radius: 7px; background: rgba(255,255,255,.72); color: var(--ink-soft); font-size: 11.5px; line-height: 1.5; }
.conflict-match small { display: block; color: #9a6414; font-weight: 700; }
.replace-all-schedule { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--ink-faint); font-size: 11.5px; }
.replace-all-schedule b { color: var(--text); }
.replace-all-schedule span { flex: 1 1 240px; }
.batch-help {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
  border-radius: 10px;
  background: var(--primary-soft);
}
.batch-help b {
  color: var(--text);
}
.batch-columns {
  display: grid;
  grid-template-columns: 1.25fr repeat(3, 0.7fr) 1fr 0.9fr 0.9fr;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}
.batch-columns span {
  padding: 5px 4px;
  border-radius: 6px;
  background: var(--bg);
}
.batch-preview-wrap {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.batch-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  background: #fafbfd;
}

.batch-table {
  width: 100%;
  border-collapse: collapse;
}

.batch-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 500;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}

.batch-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.batch-table tr.invalid td {
  background: #fff0f0;
  color: #d32f2f;
}

.batch-table tr.needsReview td {
  background: #fff8e1;
  color: #f57c00;
}

.batch-table tr.invalid td:first-child {
  background: #ffebee;
}

.batch-table tr.needsReview td:first-child {
  background: #fff8e1;
}

.batch-error-row {
  background: #fff0f0;
  color: #d32f2f;
}

.batch-error-row td {
  padding: 6px 12px;
  font-size: 12px;
}

.batch-review-row {
  background: #fff8e1;
  color: #f57c00;
}

.batch-review-row td {
  padding: 6px 12px;
  font-size: 12px;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 6px;
}

.error-icon {
  font-size: 14px;
}

.review-message {
  display: flex;
  align-items: center;
  gap: 6px;
}

.review-icon {
  font-size: 14px;
}

.file-button.busy {
  pointer-events: none;
  opacity: 0.7;
}

.ocr-hint {
  font-size: 11px;
  color: var(--muted);
  margin-top: 6px;
}

.batch-table-scroll {
  max-height: 300px;
  overflow-y: auto;
}
.ocr-result-hint {
  margin: 2px 0 0;
  padding: 8px 10px;
  color: #08785a;
  font-size: 11px;
  line-height: 1.55;
  border: 1px solid #b8e5d7;
  border-radius: 8px;
  background: #effbf7;
}
.batch-mobile-preview { display: none; }
.batch-success {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  color: #08785a;
  border: 1px solid #a7e3d2;
  border-radius: 12px;
  background: #effbf7;
}
.batch-success span { color: var(--muted); font-size: 12px; line-height: 1.55; }
.batch-success>div { display: flex; justify-content: flex-end; gap: 8px; }

.batch-table-scroll::-webkit-scrollbar {
  width: 6px;
}

.batch-table-scroll::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.batch-table-scroll::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.batch-table-scroll::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
.ok-text {
  color: #07805d;
}
.error-text {
  color: var(--danger);
}
.batch-table-scroll {
  max-height: 260px;
  overflow: auto;
}
.batch-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 12px;
}
.batch-table th,
.batch-table td {
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
}
.batch-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  background: #fff;
}
.batch-table tr.invalid td {
  color: var(--danger);
  background: #fff7f7;
}
.batch-error-row td {
  padding-top: 2px;
  color: var(--danger);
  background: #fff7f7;
}
.exception-editor { display: flex; flex-direction: column; gap: 13px; }
.exception-form { display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; gap: 9px; }
.exception-form label { display: flex; flex-direction: column; gap: 6px; color: var(--muted); font-size: 11px; }
.exception-form input, .exception-form select { width: 100%; }
.exception-note { grid-column: 1 / 3; }
.exception-list { display: flex; flex-direction: column; gap: 7px; max-height: 310px; overflow-y: auto; }
.exception-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
.exception-item>div { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; min-width: 0; }
.exception-item b { font-size: 12px; }
.exception-item span { padding: 3px 6px; color: #b13f3f; font-size: 9px; font-weight: 800; border-radius: 5px; background: #feecec; }
.exception-item span.makeup { color: #7a55e8; background: #f1ebff; }
.exception-item small { width: 100%; color: var(--muted); font-size: 10px; }

@media (max-width: 760px) {
  .exception-form { grid-template-columns: 1fr 1fr; }
  .exception-note { grid-column: 1 / -1; }
  .exception-form>.btn { grid-column: 1 / -1; }
  .head {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .head-btns {
    width: 100%;
    flex-wrap: wrap;
  }

  .head-btns .btn {
    flex: 1;
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

  .batch-summary { flex-wrap: wrap; gap: 6px 10px; }
  .batch-desktop-preview { display: none; }
  .batch-mobile-preview { display: flex; flex-direction: column; gap: 8px; padding: 9px; }
  .batch-mobile-card { padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
  .batch-mobile-card.invalid { border-color: #f3b7b7; background: #fff7f7; }
  .batch-mobile-card.needsReview:not(.invalid) { border-color: #f1d38b; background: #fffbef; }
  .batch-mobile-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 7px; }
  .batch-mobile-head span { color: var(--muted); font-size: 10px; }
  .batch-mobile-head b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .batch-mobile-head em { padding: 2px 5px; color: var(--danger); font-size: 9px; font-style: normal; border-radius: 5px; background: #feecec; }
  .batch-mobile-head em.ok { color: #08785a; background: #e8f8f2; }
  .batch-mobile-card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin: 9px 0 0; }
  .batch-mobile-card dl>div { min-width: 0; }
  .batch-mobile-card dt { color: var(--muted); font-size: 9px; }
  .batch-mobile-card dd { overflow: hidden; margin: 1px 0 0; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .batch-mobile-card p { margin: 8px 0 0; color: var(--danger); font-size: 10px; line-height: 1.5; }
  .import-conflict-actions .btn { width: 100%; }
  .replace-all-schedule { align-items: flex-start; flex-direction: column; }
  .batch-success>div { display: grid; grid-template-columns: 1fr 1fr; }
  .it-row { grid-template-columns: 48px minmax(0, 1fr); }
  .import-row { grid-template-columns: minmax(0, 1fr) 86px 12px 86px 24px; gap: 4px; }
  .row-review-detail { align-items: flex-start; flex-direction: column; }
  .detail-row-main { grid-template-columns: minmax(0, 1fr) 92px 12px 92px 24px; gap: 4px; }
  .scheme-card { grid-template-columns: auto minmax(0, 1fr); }
  .scheme-card > .btn-xs { grid-column: 1 / -1; justify-self: end; }
  .overview-foot { flex-wrap: wrap; }
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

/* ---------- 批量录入 ---------- */
.batch-input-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.batch-input-row textarea {
  width: 100%;
  min-height: 148px;
  resize: vertical;
  line-height: 1.6;
  z-index: 2;
  pointer-events: auto;
  position: relative;
}
.batch-textarea {
  box-sizing: border-box;
}
.batch-image-upload {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-self: flex-start;
  z-index: 1;
}
.batch-image-upload .file-button {
  display: inline-flex;
  align-items: center;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.batch-image-upload .file-button input {
  display: none;
}
.ocr-hint {
  color: var(--muted);
  font-size: 11px;
  margin: 0;
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
</style>
