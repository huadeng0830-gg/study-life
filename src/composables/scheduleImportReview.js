import { computed, ref } from 'vue'
import { MAX_WEEK } from './store'
import { periodIndex } from './store/timeConfig.js'

let courseImportApi = null
let courseImportTask = null

function loadCourseImport() {
  if (courseImportApi) return Promise.resolve(courseImportApi)
  courseImportTask ??= import('./courseImport.js').then((api) => (courseImportApi = api))
  return courseImportTask
}

/**
 * 导入审阅 / 冲突决策（从 ScheduleView 拆出）。
 *
 * 任何一条导入路径（手动保存、批量文本、识图、Excel、模板）都先在这里被分类成
 * 「直接添加 / 冲突 / 重复」，由 ImportConflictModal 让用户逐条决定，再统一写回课表。
 *
 * 依赖由宿主注入：批量文本缓冲（batchError / message / clearBatchInput）、
 * 课程编辑器与课程管理器的回执（showForm / managerMessage）、Toast，
 * 以及**必须留在 ScheduleView 里的** `replaceAllTarget`（它是 ConfirmDialog 的绑定目标）。
 */
export function useScheduleImportReview({
  courses,
  domain,
  batchError,
  message,
  clearBatchInput,
  showForm,
  managerMessage,
  replaceAllTarget,
  showToast,
}) {
  const showImportConflict = ref(false)
  const importDraft = ref(null)
  const importCommitBusy = ref(false)
  const lastImportUndo = ref(null)

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

  // 整张替换的确认。
  // 【为什么把 draft 一起快照进 ref】commitCourseImport 开头会**再读一次**
  // importDraft.value 并在为空时静默 return。确认期间用户可以把审阅面板关掉
  // （cancelCourseImportReview 会把 importDraft 置 null），那样点了「替换」却什么都
  // 不会发生。所以这里把 draft 快照进目标 ref，确认时按**显式参数**提交，
  // 不再回读响应式引用；文案也一并定稿（它依赖 courses.value.length）。
  // 【replaceAllTarget 为什么不在本文件】它的 @close/@confirm 绑定必须与
  // ConfirmDialog 字面量同文件（tests/confirmDialogMigration.test.js 逐处对账），
  // 所以 ref 由 ScheduleView 声明后注入进来，这里只负责写入。
  function commitWholeScheduleReplacement() {
    const draft = importDraft.value
    if (!draft) return
    replaceAllTarget.value = {
      draft,
      message: `确认替换当前整张课表？\n将移除现有 ${courses.value.length} 门课程，仅保留本次导入的 ${draft.items.length} 门课程。`,
    }
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
      void import('./ocrVocabulary.js').then(({ rememberOcrCourses }) => rememberOcrCourses(plan.courses))
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

  return {
    showImportConflict,
    importDraft,
    importCommitBusy,
    lastImportUndo,
    importSummary,
    actionableImportItems,
    beginCourseImport,
    setImportDecision,
    cancelCourseImportReview,
    applyAllImportDecisions,
    commitWholeScheduleReplacement,
    commitCourseImport,
    undoLastCourseImport,
  }
}
