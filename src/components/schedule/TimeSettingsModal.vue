<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import TaskProgress from '../TaskProgress.vue'
import { useTaskProgress } from '../../composables/taskProgress.js'
import {
  timeConfig,
  campusName,
  seasonName,
  currentCampusId,
  currentSeasonId,
  periodIndex,
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
  isValidSeasonDate,
  seasonConflicts,
} from '../../composables/store/timeConfig.js'
import { useStoredRef } from '../../composables/store/core.js'
import { useTabKeys } from '../../composables/tabKeys.js'
import { timeImportTab, timeSettingsTab } from '../../composables/modalSections.js'

const props = defineProps({
  show: { type: Boolean, required: true },
  courseCountByPeriodId: { type: Function, required: true },
})

const emit = defineEmits(['close'])

const courses = useStoredRef('sl_courses', [])

const settingError = ref('')
// 分区状态存在 composables/modalSections.js 的模块级 ref 里。这个浮层的父级没有 v-if，
// 实例常驻，原本就已经"跨开关保留"；改成模块级 ref 是为了与外观/本地迁移统一语义。
const settingsTab = timeSettingsTab
// 设置分区的键盘模型。select 走 switchSettingsTab：它会先过草稿守卫，
// 被否决时返回 false，useTabKeys 就不会把焦点移到一个并未选中的 tab 上。
const { onKeydown: onSettingsTabKeydown, tabIndexFor: settingsTabIndex } = useTabKeys({
  keys: ['plans', 'base'],
  active: () => settingsTab.value,
  select: (key) => switchSettingsTab(key),
})
const tabHints = {
  plans: '一次只编辑一个「作息季 × 校区」方案。支持导入、复制与批量平移，修改需点击保存才会生效。',
  base: '管理校区、作息季与节次。删除前会检查影响范围；作息季可设置生效日期与适用校区。',
}
const TAB_ICONS = { plans: '⏰ 作息方案', base: '⚙️ 基础设置' }
function tabLabel(tab) {
  return TAB_ICONS[tab] ?? tab
}

/* ---------- 基础设置：校区 / 作息季 / 节次 ---------- */
const newCampusName = ref('')
const newSeasonName = ref('')
const newSeasonDate = ref('03-01')
const newPeriodLabel = ref('')

function onAddCampus() {
  settingError.value = ''
  if (addCampus(newCampusName.value)) {
    newCampusName.value = ''
    initPlanSelection()
  }
  else settingError.value = '请输入校区名称'
}

// 删除校区 / 作息季的确认文案依赖**确认前**算出的 planCount / isCurrent，
// 所以整段文案在打开对话框之前就定稿存进目标 ref，确认时不再重算。
// 晚算会读到用户已经改过的配置（对话框期间还能从别处改数据），
// 于是"将删除 3 个方案"与真正删掉的对不上。
const removeCampusTarget = ref(null)
const removeSeasonTarget = ref(null)

function onRemoveCampus(id) {
  settingError.value = ''
  const cfg = timeConfig.value
  if (cfg.campuses.length <= 1) { settingError.value = '至少保留一个校区'; return }
  const campus = cfg.campuses.find((c) => c.id === id)
  const planCount = cfg.seasons.filter((s) => seasonAppliesTo(s, id)).length
  const isCurrent = currentCampusId() === id
  const lines = [`确定删除校区「${campus?.name}」？`, `将同时删除 ${planCount} 个作息季在该校区的时间方案。`]
  if (isCurrent) lines.push('该校区是当前查看的校区，删除后会切换到其他校区。')
  removeCampusTarget.value = { id, message: lines.join('\n') }
}

function confirmRemoveCampus() {
  const target = removeCampusTarget.value
  removeCampusTarget.value = null
  if (!target) return
  removeCampus(target.id)
  initPlanSelection()
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
    initPlanSelection()
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
  // 文案同上：确认前定稿，不晚算。
  removeSeasonTarget.value = { id, message: lines.join('\n') }
}

function confirmRemoveSeason() {
  const target = removeSeasonTarget.value
  removeSeasonTarget.value = null
  if (!target) return
  removeSeason(target.id)
  initPlanSelection()
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
  initPlanSelection()
}
const seasonDateConflicts = computed(() => seasonConflicts(timeConfig.value))

function onAddPeriod() {
  settingError.value = ''
  if (addPeriod(newPeriodLabel.value)) {
    newPeriodLabel.value = ''
    loadPlanDraft(planSeasonId.value, planCampusId.value)
  }
  else settingError.value = '请输入节次名称'
}

function onRemovePeriod(id) {
  settingError.value = ''
  const result = removePeriod(id, props.courseCountByPeriodId)
  if (result !== true) {
    settingError.value = result
    return
  }
  loadPlanDraft(planSeasonId.value, planCampusId.value)
}

function periodUseCount(id) {
  return Number(props.courseCountByPeriodId(id)) || 0
}

function onResetTimes() {
  settingError.value = ''
  resetTimesToDefault()
}

/* ---------- 一键生成作息时间 ---------- */
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

/* ---------- 放弃未保存草稿：两阶段确认 ---------- */
// 【为什么不能把守卫改成 async】它的返回值决定"要不要把焦点移到新 tab"：
//   1. useTabKeys 是**同步**判定的（`if (select(key) === false) return`，见
//      composables/tabKeys.js 的注释）。改成异步就会让焦点先跑到一个并未选中的
//      tab 上，与 roving tabindex 的状态自相矛盾；而 tabKeys.js 有多个调用方，
//      不能为了这一处把整个键盘模型改成 await。
//   2. switchPlan 与 tryCloseTimeEditor 原本也是同步消费这个布尔值。
// 所以改成两阶段：现阶段只把"用户想做的事"挂起并立刻返回，真正的动作放到
// ConfirmDialog 的 @confirm 里执行。三个入口（切方案 / 切分区 / 关闭弹窗）问的是
// 同一个问题（是否放弃未保存修改），因此共用一份待确认状态与一个对话框——
// 三个入口各挂一个文案相同的对话框，只会让浮层栈与文案都变成三份。
const pendingDraftAction = ref(null)

// 返回 true = 可以立即继续；false = 已把动作挂起，等用户在对话框里决定。
function guardDraft(action) {
  if (!draftDirty.value) return true
  pendingDraftAction.value = action
  return false
}

function switchPlan(seasonId, campusId) {
  if (planKeyOf(seasonId, campusId) === currentPlanKey.value) return
  if (!guardDraft({ kind: 'plan', seasonId, campusId })) return
  loadPlanDraft(seasonId, campusId)
}

function switchSettingsTab(tab) {
  if (tab === settingsTab.value) return true
  // 返回 false：useTabKeys 因此不会移动焦点（焦点移动改由下面手动补）。
  if (!guardDraft({ kind: 'tab', tab })) return false
  settingsTab.value = tab
  return true
}

/** 用户确认放弃：按挂起的动作继续执行。 */
function confirmDiscardDraft() {
  const action = pendingDraftAction.value
  pendingDraftAction.value = null
  if (!action) return
  if (action.kind === 'plan') {
    loadPlanDraft(action.seasonId, action.campusId)
    return
  }
  if (action.kind === 'tab') {
    // 与改造前一致：确认放弃后先把草稿复位，再切分区。
    if (draftDirty.value) discardDraft()
    settingsTab.value = action.tab
    // useTabKeys 因为 select 返回 false 而没有移动焦点，这里必须手动补上，
    // 否则焦点会停在一个并未选中的 tab 上。用 nextTick 是因为 ConfirmDialog
    // 关闭时 Modal 会先把焦点还给它的 previousFocus（就是原来那个 tab 按钮），
    // 同步 focus 会被那一步覆盖掉。
    nextTick(() => {
      document.getElementById(`time-settings-tab-${action.tab}`)?.focus?.()
    })
    return
  }
  if (action.kind === 'close') {
    // 顺序不能反：先按原样复位草稿，再关闭（改造前 loadPlanDraft 就在 emit('close') 之前）。
    loadPlanDraft(planSeasonId.value, planCampusId.value)
    emit('close')
  }
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

// 这里曾有一个 `openTimeSettings()`：它做的是「按当前 periods 修正 gen.startId /
// lunchAfterIdx / dinnerAfterIdx、清 settingError、并把 settingsTab 复位成 plans」。
// 初始化已经搬进下面那个 watcher（所以它早就**零引用**），而「打开时把分区复位」正是
// 分区持久化改造要删掉的行为（见 composables/modalSections.js 与其静态棘轮），
// 所以整个函数一并删除：它从未被调用，删除不可能改变任何运行时行为。

// 打开设置时初始化（watcher 本体在下面 importOpen/importTab 声明之后）

// 关闭弹窗时守卫（确认放弃才复位草稿并关闭）。
// 【取消时必须什么都不做】Modal 的 close 有 4 个来源（Esc / 遮罩点击 / ✕ / 抽屉下拖），
// 全是**同步 emit**、不会 await 处理器。所以这里既不清草稿也不 emit('close')——
// 一旦在挂起前就动了草稿，用户点「继续编辑」回来会发现改动已经没了。
function tryCloseTimeEditor() {
  if (!draftDirty.value) { emit('close'); return }
  pendingDraftAction.value = { kind: 'close' }
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
const genPreview = ref(null) // { rows: [{index,label,from,to}] }
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
const importTab = timeImportTab // paste | image
const { onKeydown: onImportTabKeydown, tabIndexFor: importTabIndex } = useTabKeys({
  keys: ['paste', 'image'],
  active: () => importTab.value,
  select: (key) => {
    importTab.value = key
  },
})
const pasteText = ref('')

/**
 * 打开设置时初始化：优先当前生效组合，否则第一个有效组合。
 *
 * 【为什么这个 watcher 单独放在这里，而不跟其它 watch 排在一起】
 * 它必须是 `immediate`：组件以 `v-if` 方式首次挂载时 `props.show` 已经是 true，
 * 普通 watch 不会在首次执行，草稿数组就会是空的，模板里的时间输入框访问
 * `draft[index]` 时直接报错。而 `immediate` 的回调是在 setup 期间**同步**跑的，
 * `initPlanSelection()` → `loadPlanDraft()` 会去写 `batchOpen` / `copyOpen` /
 * `genPreview` / `importOpen` 这几个 ref —— 它们都声明在本行之上几百行。
 * 之前这个 watcher 放在文件靠上的位置（紧随 `initPlanSelection` 之后），
 * 于是 `props.show` 一开始就是 true 的挂载路径会抛
 * `ReferenceError: Cannot access 'batchOpen' before initialization`，组件连挂载都完不成。
 * 移到这些声明**之后**，既保住"首次渲染前完成初始化"，又不再踩暂时性死区。
 */
watch(() => props.show, (open) => {
  if (open) initPlanSelection()
}, { immediate: true })
const importError = ref('')
const lastScheduleImage = ref(null)

// OCR 引擎只在用户真正选择图片后才下载
async function performAccurateOCR(...args) {
  const module = await import('../../composables/ocrPipeline.js')
  return module.performOCR(...args)
}

async function performLegacyOCR(...args) {
  const module = await import('../../composables/ocrService.js')
  return module.performOCR(...args)
}

const scheduleOcrProgress = useTaskProgress()
let scheduleOcrController = null
let lastScheduleMode = 'auto'

// 识别解析器和识别 API 只在需要时加载
let scheduleParserApi = null
let scheduleParserTask = null
let recognitionApi = null
let recognitionTask = null

function loadScheduleParser() {
  if (scheduleParserApi) return Promise.resolve(scheduleParserApi)
  scheduleParserTask ??= import('../../composables/scheduleOcrParser.js').then((api) => (scheduleParserApi = api))
  return scheduleParserTask
}

function loadRecognition() {
  if (recognitionApi) return Promise.resolve(recognitionApi)
  recognitionTask ??= import('../../composables/scheduleRecognition.js').then((api) => (recognitionApi = api))
  return recognitionTask
}

function schemeDisplayName(...args) { return recognitionApi?.schemeDisplayName(...args) ?? '作息方案' }
function schemeStatus(...args) { return recognitionApi?.schemeStatus(...args) ?? 'pending' }
function targetPendingReasonText(...args) { return recognitionApi?.targetPendingReasonText(...args) ?? '正在准备识别结果' }

const SCHEDULE_OCR_STEPS = [
  { id: 'read', label: '解析图片' },
  { id: 'engine', label: 'OCR 识别' },
  { id: 'structure', label: '恢复作息结构' },
  { id: 'extract', label: '发现作息组' },
  { id: 'match', label: '匹配已有配置' },
  { id: 'validate', label: '时间校验' },
  { id: 'preview', label: '等待用户确认' },
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
    // 不再把导入方式重置为"粘贴"：与主分区一致，记住上次用的方式（见 modalSections.js）。
    // 原来那行是 `importTab.value = recognitionDraft.value ? importTab.value : 'paste'`，
    // 即"有识别草稿时保留、否则重置"；现在两种情况都保留，语义只增不减。
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
const importPlanScope = ref(null)

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

function countTargetModes(draftValue) {
  const modes = { replace: 0, create: 0, pending: 0 }
  for (const scheme of draftValue.schemes) {
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
  const draftValue = await startRecognition(analysis, '粘贴文本')
  showToast(`识别完成 · 共 ${draftValue.schemes.length} 组作息（${modesText(countTargetModes(draftValue))}）`)
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
    // 布局感知引擎能处理普通表格图片；只在质量信号需要时才比较增强效果，
    // 兼容引擎保留为回退方案。
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
    const draftValue = await startRecognition(analysis, file.name)
    scheduleOcrProgress.setStep('match', 'completed', modesText(countTargetModes(draftValue)))
    scheduleOcrProgress.setStep('validate', 'running', '正在检查时间冲突与缺失')
    const reviewSchemes = draftValue.schemes.filter((scheme) => schemeStatus(scheme, timeConfig.value) !== 'ready').length
    scheduleOcrProgress.setStep('validate', reviewSchemes ? 'warning' : 'completed', reviewSchemes ? `${reviewSchemes} 组存在待确认项` : '全部通过')
    scheduleOcrProgress.setStep('preview', 'completed', '等待用户确认')
    scheduleOcrProgress.finish(
      reviewSchemes ? `识别完成 · 共 ${draftValue.schemes.length} 组作息，${reviewSchemes} 组需要确认` : `识别完成 · 共发现 ${draftValue.schemes.length} 组作息`,
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

function onImportImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  void runParseImage(file)
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
  const draftValue = recognitionDraft.value
  if (!draftValue?.schemes.length) return null
  return draftValue.schemes.find((scheme) => scheme.id === activeSchemeId.value) ?? draftValue.schemes[0]
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

function setPlanItemAction(item, action) {
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

// KeepAlive 离开页面不会卸载组件；主动取消 OCR 避免占用 CPU。
function stopBackgroundWork() {
  window.clearTimeout(settingsToastTimer)
  if (scheduleOcrProgress.state.status === 'running') void scheduleOcrProgress.cancel()
  else scheduleOcrController?.abort()
}

onBeforeUnmount(stopBackgroundWork)

defineExpose({ stopBackgroundWork })
</script>

<template>
  <Modal v-if="show" :open="show" title="🕐 作息与时间设置" @close="tryCloseTimeEditor">
    <div class="settings">
      <!-- 同页另两个 tablist（AppearanceSettings 的「个性化设置分区」、LocalTransfer 的
           「二维码迁移方式」）都带 aria-label，只有这里漏了；tablist 没有名称时读屏
           只念「标签页列表」，说不出这是在切什么分区。 -->
      <div class="tab-bar" role="tablist" aria-label="设置分区" @keydown="onSettingsTabKeydown">
        <!-- 这里原本是 v-for="(hint, tab) in tabHints"，id 只能动态生成。
             改成两个显式按钮是为了让 id 变成**静态**的：两个面板要用
             aria-labelledby 指回各自的 tab，而静态悬空引用守卫只认静态 id——
             动态 id 会让这条引用在守卫眼里"找不到该 id"，关系就失去校验。
             代价是多了两行重复标记；分区是固定的两个（作息方案 / 基础设置），
             提示文字仍由 tabHints 提供。 -->
        <button
          id="time-settings-tab-plans"
          type="button"
          :tabindex="settingsTabIndex('plans')"
          class="tab-btn"
          role="tab"
          :aria-selected="settingsTab === 'plans'"
          :class="{ on: settingsTab === 'plans' }"
          @click="switchSettingsTab('plans')"
        >{{ tabLabel('plans') }}</button>
        <button
          id="time-settings-tab-base"
          type="button"
          :tabindex="settingsTabIndex('base')"
          class="tab-btn"
          role="tab"
          :aria-selected="settingsTab === 'base'"
          :class="{ on: settingsTab === 'base' }"
          @click="switchSettingsTab('base')"
        >{{ tabLabel('base') }}</button>
      </div>
      <p class="settings-hint">{{ tabHints[settingsTab] }}</p>
      <p v-if="settingError" class="error" role="alert">{{ settingError }}</p>
      <Transition name="toast">
        <p v-if="settingsToast" class="settings-toast">✓ {{ settingsToast }}</p>
      </Transition>

      <!-- OCR 进度与导入错误刻意放在**标签区之外**，与上面的 settingError 同级。
           原因：这两块原来住在 `v-show="settingsTab === 'plans'"` 的作息方案区里，
           而 OCR 要跑好几秒，用户几乎一定会切到别的标签页等。一旦切走，这个区就是
           display:none——里面的元素**根本不在无障碍树里**，于是进度看不到、
           失败与「图片质量提示」也听不到（role="alert" 在 display:none 子树里不会播报）。
           提到区外之后两个问题一起消失：切到任何标签页都能继续看到进度、听到结果。 -->
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

      <p v-if="importError && !(scheduleOcrProgress.state.active && scheduleOcrProgress.state.visible)" class="error" role="alert">{{ importError }}</p>

      <!-- ============ 作息方案 ============ -->
      <section v-show="settingsTab === 'plans'" id="time-settings-panel-plans" role="tabpanel" aria-labelledby="time-settings-tab-plans" class="setting-section plan-section">
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
            <select v-model.number="batchFrom" aria-label="批量调整起始节次">
              <option v-for="(p, i) in timeConfig.periods" :key="p.id" :value="i">{{ p.label }}</option>
            </select>
            <i>至</i>
            <select v-model.number="batchTo" aria-label="批量调整结束节次">
              <option v-for="(p, i) in timeConfig.periods" :key="p.id" :value="i">{{ p.label }}</option>
            </select>
            <select v-model.number="batchDelta" aria-label="批量调整偏移量">
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
              aria-label="批量调整自定义分钟数"
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
          <!-- 生成控件始终可见：这里曾是 `v-show="genPreview !== null || true"` + `v-if="1"`，
               两个条件都恒真，等于没写——而且比没写更糟，因为它看起来像在门控
               （预览部分由下面独立的 `v-if="genPreview"` 负责）。别再把条件加回来。 -->
          <div class="gen-body">
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
          <div class="seg import-tabs" role="tablist" aria-label="作息导入方式" @keydown="onImportTabKeydown">
            <button id="time-import-tab-paste" role="tab" :tabindex="importTabIndex('paste')" :aria-selected="importTab === 'paste'" :class="{ on: importTab === 'paste' }" @click="importTab = 'paste'">📋 粘贴时间表</button>
            <button id="time-import-tab-image" role="tab" :tabindex="importTabIndex('image')" :aria-selected="importTab === 'image'" :class="{ on: importTab === 'image' }" @click="importTab = 'image'">📷 从图片识别</button>
          </div>

          <div v-if="importTab === 'paste'" role="tabpanel" aria-labelledby="time-import-tab-paste">
            <textarea
              v-model="pasteText"
              class="paste-area"
              rows="6"
              aria-label="粘贴作息时间"
              placeholder="粘贴学校官网或通知里的作息时间，每行一条：&#10;第一节 8:00-8:45&#10;第二节 8:55-9:40&#10;夏季时间 / 南校区 等标题会被自动识别"
            />
            <button class="btn btn-sm btn-ghost" @click="runParsePaste">解析预览</button>
          </div>

          <div v-else class="image-import" role="tabpanel" aria-labelledby="time-import-tab-image">
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
                  :aria-label="`${row.period.label} 开始时间`"
                  @input="markDirty"
                />
                <i>—</i>
                <input
                  type="time"
                  v-model="draft[row.index].end"
                  :aria-label="`${row.period.label} 结束时间`"
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
      <div v-if="settingsTab === 'base'" id="time-settings-panel-base" role="tabpanel" aria-labelledby="time-settings-tab-base" class="settings-panel">
        <section class="setting-section">
          <div class="setting-head">
            <h4>🏫 校区（{{ timeConfig.campuses.length }}）</h4>
          </div>
          <div v-for="campus in timeConfig.campuses" :key="campus.id" class="setting-row">
            <input
              :value="campus.name"
              :aria-label="`校区名称：${campus.name}`"
              @change="renameCampus(campus.id, $event.target.value)"
            />
            <button
              class="setting-del"
              :disabled="timeConfig.campuses.length <= 1"
              aria-label="删除校区"
              title="删除校区"
              @click="onRemoveCampus(campus.id)"
            >✕</button>
          </div>
          <div class="setting-add">
            <input v-model="newCampusName" aria-label="新校区名称" placeholder="新校区名称，例如：东校区" @keyup.enter="onAddCampus" />
            <button class="btn btn-ghost" @click="onAddCampus">＋ 添加</button>
          </div>
        </section>

        <section class="setting-section">
          <div class="setting-head">
            <h4>☀️ 作息季（{{ timeConfig.seasons.length }}）</h4>
            <span class="setting-note">按起始日期自动切换；同一天开始会无法判断先后</span>
          </div>
          <p v-if="seasonDateConflicts.length" class="error conflict-tip" role="alert">
            ⚠ 生效日期冲突：{{ seasonDateConflicts.map((c) => `${c.campusName} · ${c.date}（${c.names.join(' / ')}）`).join('；') }} —— 对应校区的自动模式无法判断先后，请调整日期。
          </p>
          <div v-for="season in timeConfig.seasons" :key="season.id" class="season-block">
            <div class="setting-row season">
              <input
                class="grow"
                :value="season.name"
                :aria-label="`作息季名称：${season.name}`"
                @change="renameSeason(season.id, $event.target.value, null)"
              />
              <input
                class="date"
                :class="{ invalid: !isValidSeasonDate(season.startDate) }"
                :value="season.startDate"
                :aria-label="`作息季生效日期（MM-DD）：${season.name}`"
                placeholder="05-01"
                @blur="onSeasonDateChange(season, $event.target.value, $event.target)"
              />
              <button
                class="setting-del"
                :disabled="timeConfig.seasons.length <= 1"
                aria-label="删除作息季"
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
            <input v-model="newSeasonName" class="grow" aria-label="新作息季名称" placeholder="新作息季名称，例如：春季时间" @keyup.enter="onAddSeason" />
            <input v-model="newSeasonDate" class="date" aria-label="新作息季生效日期（MM-DD）" placeholder="03-01" />
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
                :aria-label="`节次名称：${period.label}`"
                @change="renamePeriod(period.id, $event.target.value)"
              />
              <small v-if="periodUseCount(period.id)" class="period-use-count">
                {{ periodUseCount(period.id) }} 门占用
              </small>
              <button
                class="setting-del"
                :disabled="timeConfig.periods.length <= 1 || periodUseCount(period.id) > 0"
                aria-label="删除节次"
                :title="periodUseCount(period.id) ? `有 ${periodUseCount(period.id)} 门课程或模板课程占用` : '删除节次'"
                @click="onRemovePeriod(period.id)"
              >✕</button>
            </div>
          </div>
          <div class="setting-add">
            <input v-model="newPeriodLabel" aria-label="新节次名称" placeholder="新节次名称，例如：第十三节课" @keyup.enter="onAddPeriod" />
            <button class="btn btn-ghost" @click="onAddPeriod">＋ 添加</button>
          </div>
        </section>
      </div>

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
    v-if="schemeDetailOpen && !!activeScheme"
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
            aria-label="新校区名"
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
            aria-label="新方案名"
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

      <div class="seg detail-tabs" role="group" aria-label="作息识别结果筛选">
        <button :aria-pressed="detailFilter === 'all'" :class="{ on: detailFilter === 'all' }" @click="detailFilter = 'all'">全部 {{ activeScheme.rows.length }}</button>
        <button :aria-pressed="detailFilter === 'issues'" :class="{ on: detailFilter === 'issues' }" @click="detailFilter = 'issues'">
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
            <input v-model="row.label" class="grow" aria-label="节次名称" placeholder="节次名称" @input="onSchemeRowInput(row)" />
            <input v-model="row.start" aria-label="开始时间" type="time" @input="onSchemeRowInput(row)" />
            <i>—</i>
            <input v-model="row.end" aria-label="结束时间" type="time" @input="onSchemeRowInput(row)" />
            <button class="setting-del" aria-label="删除该行" title="删除该行" @click="removeSchemeRow(activeScheme, index)">✕</button>
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
    v-if="importPlanOpen"
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
            <select class="plan-action" :value="item.action" :aria-label="`${item.label} 的处理方式`" @change="setPlanItemAction(item, $event.target.value)">
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

  <!-- 确认框与上面三个 Modal 平级：ConfirmDialog 自己 Teleport 到 body，
       所以始终叠在最上层，Escape 只会关掉它（Modal.vue 的 isTopOverlay 机制）。 -->
  <!-- 这三个确认框都叠在本组件自己的设置弹窗（`<Modal v-if="show">`）之上，
       所以一律 v-if 随目标挂载：本组件在 `show` 还是 false 时就已挂载，若那时就建好
       Teleport 锚点，后打开的设置弹窗会排到它后面并把它盖住
       （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
  <ConfirmDialog
    v-if="pendingDraftAction"
    :open="Boolean(pendingDraftAction)"
    title="放弃未保存的修改"
    message="当前方案有未保存的修改，确定放弃这些修改吗？"
    confirm-label="放弃修改"
    cancel-label="继续编辑"
    @close="pendingDraftAction = null"
    @confirm="confirmDiscardDraft"
  />

  <ConfirmDialog
    v-if="removeCampusTarget"
    :open="Boolean(removeCampusTarget)"
    title="删除校区"
    :message="removeCampusTarget?.message || ''"
    confirm-label="删除校区"
    @close="removeCampusTarget = null"
    @confirm="confirmRemoveCampus"
  />

  <ConfirmDialog
    v-if="removeSeasonTarget"
    :open="Boolean(removeSeasonTarget)"
    title="删除作息季"
    :message="removeSeasonTarget?.message || ''"
    confirm-label="删除作息季"
    @close="removeSeasonTarget = null"
    @confirm="confirmRemoveSeason"
  />
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
/* base 面板的包裹层必须复制 .settings 的纵向排布与间距：
   原来三个 section 是 .settings 的直接子元素，靠它的 gap 分隔；
   换成包裹层后若不复制，间距会从 18px 变成 0。 */
.settings-panel {
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
/* 校验失败的输入框：琥珀色底/边同样是写死的，而输入框文字是 var(--text)——
   深色主题下 #fffaf0 白底会让输入内容掉到 1.15:1。 */
.setting-row input.invalid {
  border-color: color-mix(in srgb, var(--warning) 35%, var(--card));
  background: color-mix(in srgb, var(--warning) 10%, var(--card));
}
.setting-del {
  flex: 0 0 30px;
  height: 30px;
  color: var(--muted);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--card);
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
.period-use-count {
  flex: 0 0 auto;
  /* 这一行没有自己的底色，落在 Modal 的 var(--card) 上：写死的 #9a6414 在深色只有 3.18:1。 */
  color: var(--warning);
  font-size: 10.5px;
  white-space: nowrap;
}
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
  background: var(--card);
}
.tab-btn.on {
  color: var(--on-primary, #fff);
  font-weight: 700;
  border-color: var(--primary);
  background: var(--primary);
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
.settings-toast {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0;
  padding: 7px 12px;
  /* 自动保存提示是「绿字 + 写死浅绿底」成对写法，只改字会让深色主题下的 #e7f8f1
     白条配上亮绿字（约 1.7:1），所以底一起从 --card 混出来。改前浅/深都是 4.49:1
     （本身就差一点不到 AA），改后浅 4.88、深 6.72:1。 */
  color: var(--success);
  font-size: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--success) 10%, var(--card));
}
.toast-enter-active, .toast-leave-active { transition: opacity var(--dur-base) var(--ease-standard); }
.toast-enter-from, .toast-leave-to { opacity: 0; }

/* ---------- 作息方案编辑器 ---------- */
.plan-picker { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-tint); }
.plan-picker-row { display: flex; align-items: center; gap: 10px; }
.plan-picker-row .seg { flex-wrap: wrap; overflow-x: visible; }
.pp-label { flex: 0 0 44px; color: var(--ink-faint); font-size: 11.5px; font-weight: 700; }
.plan-head { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.plan-title { font-size: 15px; font-weight: 800; }
/* 「有未保存改动」的小圆点是琥珀语义，落在 var(--card) 上：
   写死的 #b86b16 在深色卡片上只有 3.36:1。 */
.dirty-dot { color: var(--warning); font-size: 11.5px; font-weight: 700; }
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
.copy-item { padding: 7px 12px; font-size: 12.5px; border: 1px solid var(--border); border-radius: 9px; background: var(--card); cursor: pointer; transition: border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
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
.gen-box {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--bg-tint);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gen-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
}
.gen-title.as-btn { width: 100%; text-align: left; background: none; border: none; cursor: pointer; font-size: 13px; font-weight: 750; color: var(--text); padding: 0; display: flex; justify-content: space-between; align-items: center; }
.gen-title.as-btn:hover { color: var(--primary); }
.gen-title.as-btn i { font-style: normal; color: var(--ink-faint); font-size: 11px; }
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
.paste-area { width: 100%; resize: vertical; font-family: inherit; line-height: 1.55; }
.image-import { display: flex; flex-direction: column; gap: 8px; }
.import-tabs { align-self: flex-start; }
.file-button {
  display: inline-flex;
  align-items: center;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--primary);
  color: var(--on-primary, #fff);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.file-button input { display: none; }
.file-button.busy {
  pointer-events: none;
  opacity: 0.7;
}
.seg {
  display: flex;
  max-width: 100%;
  overflow-x: auto;
  background: var(--card);
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
  color: var(--on-primary, #fff);
  font-weight: 600;
}
/* 导入结果横幅：绿字 + 写死浅绿底成对写法，底一起从 --card 混出来。 */
.import-result-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 11px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--success) 10%, var(--card));
  color: var(--success);
  font-size: 12px;
  font-weight: 700;
}
.btn-xs { flex: 0 0 auto; padding: 4px 8px; font-size: 10.5px; }

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
  background: var(--card);
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.scheme-card.off { opacity: .55; }
.scheme-card.active { border-color: var(--primary); }
.scheme-check { display: flex; align-items: center; }
.scheme-check input { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
.scheme-card-main { min-width: 0; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.scheme-card-title { font-size: 13px; font-weight: 750; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scheme-card-status { font-size: 11.5px; line-height: 1.4; }
/* .ok / .warn 是同一组状态色（都在 .scheme-card 的 var(--card) 上），一起换成令牌：
   写死的 #08785a / #9a6414 在深色卡片上分别只有 2.91 / 3.18:1。 */
.scheme-card-status.ok { color: var(--success); }
.scheme-card-status.warn { color: var(--warning); }
.detected-title { margin: 2px 0 0; color: var(--ink-faint); font-size: 11px; }
.import-foot { display: flex; justify-content: space-between; gap: 8px; }
.overview-foot { align-items: center; }
.overview-foot .btn-primary { margin-left: auto; }

/* ---------- 详情编辑（第二级） ---------- */
.detail-target { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-tint); }
/* 三种（命中 / 缺失 / 不适用）提示原本只有一条跟主题走；这里把另外两条也成对迁移：
   底色一起从 --card 混出来，深色下才不是两条白条配亮色字。 */
.assignment-message { margin: 0; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--success) 10%, var(--card)); color: var(--success); font-size: 11.5px; line-height: 1.5; }
.assignment-message.missing { background: color-mix(in srgb, var(--warning) 10%, var(--card)); color: var(--warning); }
.assignment-message.matched { background: #eef4ff; color: #2456b8; }
.detail-tabs { align-self: flex-start; }
.detail-tabs button { padding: 7px 14px; }
.detail-rows { display: flex; flex-direction: column; gap: 6px; max-height: 46vh;max-height:46dvh; overflow-y: auto; padding-right: 2px; }
.detail-row { padding: 4px 6px; border-radius: 9px; }
/* 异常行的底/边是写死的琥珀浅色，行内的琥珀文字要跟着令牌走，底就必须一起迁移。
   这里刻意只用 6% 而不是 Toast 那套 10%：这一行里还有 var(--muted) 的间隔箭头，
   10% 混合底会让它在浅色掉到 4.34:1（10% 深底同理 4.31:1）；实测 6% 是同时保住
   琥珀文字（浅 5.44 / 深 7.32）与灰箭头（浅 4.58 / 深 4.69）的最大比例。 */
.detail-row.issue { padding: 7px; border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--card)); background: color-mix(in srgb, var(--warning) 6%, var(--card)); }
.detail-row-main { display: grid; grid-template-columns: minmax(0, 1fr) 110px 14px 110px 26px; align-items: center; gap: 6px; }
.detail-row-main i { color: var(--muted); font-style: normal; text-align: center; }
.detail-row-main input[type='time'] { padding: 6px; font-size: 12.5px; }
.detail-row-issues { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; color: var(--warning); font-size: 11px; line-height: 1.45; }
.detail-foot { display: flex; justify-content: space-between; gap: 10px; }
.detail-foot .btn-primary { margin-left: auto; }
.it-row { display: grid; grid-template-columns: 54px minmax(0,1fr); align-items: center; gap: 8px; }
.it-row > span { color: var(--ink-faint); font-size: 11.5px; font-weight: 700; }
.choice-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.choice-chips button { padding: 7px 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--card); color: var(--ink-soft); font-size: 12px; cursor: pointer; }
.choice-chips button.on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); font-weight: 700; }
.grow { min-width: 0; flex: 1; }

/* ---------- 导入计划（第三级） ---------- */
.plan-summary { margin: 0 0 4px; font-size: 13px; color: var(--text); }
/* .ok-text / .warning-text 是同一句汇总里的状态对，一起换成令牌
   （写死的 #08785a / #9a6414 在深色卡片上只有 2.91 / 3.18:1）。 */
.plan-summary b.ok-text { color: var(--success); }
.plan-summary b.warning-text { color: var(--warning); }
.plan-items { display: flex; flex-direction: column; gap: 8px; max-height: 46vh;max-height:46dvh; overflow-y: auto; padding-right: 2px; }
.plan-item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 11px; background: var(--card); }
/* 原来写死 #e5b4b4 / #fffafa：深色主题下整个 .plan-item 会变成一块白底，
   而它的兄弟条目用的是 var(--card)，同一个列表里两种底色。改成从 --danger 混出来，
   两个主题都跟着主题走。 */
.plan-item.blocked { border-color: color-mix(in srgb, var(--danger) 30%, var(--card)); background: color-mix(in srgb, var(--danger) 8%, var(--card)); }
.plan-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.plan-item-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-action { padding: 5px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); }
.plan-diff-summary { margin: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--ink-soft); font-size: 11.5px; }
.plan-diff-list { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--bg-tint); }
.plan-warning { margin: 0; color: var(--warning); font-size: 11.5px; }
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
  /* 淡出终点必须跟着主题走：写死 #fff 会在深色主题下铺出一条白条。
   起点保持显式「白色全透明」，避免个别引擎在 transparent 上做非预乘插值时
   插出灰带。 */
background: linear-gradient(180deg, rgba(255, 255, 255, 0), var(--card) 34%);
}

/* 季适用校区 chips */
.season-block + .season-block { margin-top: 12px; }
.season-scope { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 2px 0 2px 6px; }
.scope-label { color: var(--ink-faint); font-size: 11px; font-weight: 700; }
.scope-note { flex-basis: 100%; color: var(--ink-faint); font-size: 10.5px; }
.conflict-tip { margin: 0 0 8px; }
.season-date-warning { display: block; margin: 4px 0 0 6px; color: var(--warning); font-size: 10.5px; }

@media (max-width: 520px) {
  .it-row { grid-template-columns: 48px minmax(0, 1fr); }
  .detail-row-main { grid-template-columns: minmax(0, 1fr) 92px 12px 92px 24px; gap: 4px; }
  .scheme-card { grid-template-columns: auto minmax(0, 1fr); }
  .scheme-card > .btn-xs { grid-column: 1 / -1; justify-self: end; }
  .overview-foot { flex-wrap: wrap; }
}
</style>
