import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MAX_WEEK } from './store'
import { periodIndex } from './store/timeConfig.js'
import { accountDataOwner } from './accountSyncIdentity.js'

/** 「撤销本次导入」的可撤销窗口。到期后按钮必须一起消失，不能留在界面上。 */
const IMPORT_UNDO_WINDOW_MS = 30000

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
  let accountGeneration = 0

  const courseConflictOptions = computed(() => ({ maxWeek: MAX_WEEK, periodIndex: (id) => periodIndex(id) }))

  /**
   * 「撤销本次导入」的到期收口。
   *
   * 【修的是什么】按钮的可见性就是 `Boolean(lastImportUndo)`（ScheduleView 把它当
   * `can-undo` 传给 BatchImportModal）。原来窗口到期只在**点击时**判断
   * （`Date.now() > undo.expiresAt` 直接 return），而 `lastImportUndo` 从不清空 ——
   * 于是 30 秒后按钮还挂在面板上，点下去什么都不发生，也没有任何提示：
   * 一次彻底静默的失效。这里补一个到期定时器，让按钮和状态一起消失。
   */
  let undoTimer = 0
  function stopUndoTimer() {
    if (!undoTimer) return
    window.clearTimeout(undoTimer)
    undoTimer = 0
  }
  function scheduleUndoExpiry() {
    stopUndoTimer()
    undoTimer = window.setTimeout(() => {
      undoTimer = 0
      lastImportUndo.value = null
    }, IMPORT_UNDO_WINDOW_MS)
  }
  onBeforeUnmount(stopUndoTimer)
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
    const owner = accountDataOwner.value
    const generation = accountGeneration
    const snapshot = JSON.parse(JSON.stringify(courses.value))
    const api = await loadCourseImport()
    if (owner !== accountDataOwner.value || generation !== accountGeneration) return
    if (JSON.stringify(courses.value) !== JSON.stringify(snapshot)) {
      batchError.value = '课表已变化，请重新打开导入审阅后再确认。'
      return
    }
    const existing = meta.existingCourses ?? courses.value
    const items = api.classifyImportItems(incoming, existing, courseConflictOptions.value)
    importDraft.value = {
      source: meta.source || 'batch', reviewCount: meta.reviewCount || 0, editingId: meta.editingId || null, existing,
      owner, generation, snapshot, items,
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
    importCommitBusy.value = true
    let committedFingerprint = ''
    try {
      const api = await loadCourseImport()
      if (draft.owner !== accountDataOwner.value || draft.generation !== accountGeneration) return
      if (JSON.stringify(courses.value) !== JSON.stringify(draft.snapshot)) {
        batchError.value = '课表已变化，请重新打开导入审阅后再确认。'
        return
      }
      const plan = api.buildImportPlan({ existingCourses: draft.existing, items: draft.items, decisions: draft.decisions, mode, options: courseConflictOptions.value })
      if (!plan) { batchError.value = '请先为每一门冲突课程选择处理方式'; return }
      if (plan.unsafe.length) {
        batchError.value = `有 ${new Set(plan.unsafe.map(({ item }) => item.index)).size} 门课程仅部分重叠。为避免误删未冲突的周次或节次，当前只能选择“保留两门”或“跳过”。`
        return
      }
      committedFingerprint = JSON.stringify(plan.courses)
      domain.replaceCourses(plan.courses)
      // Only accepted import results train the on-device correction memory.
      // OCR suggestions never leave this browser and never alter cloud data by themselves.
      void import('./ocrVocabulary.js').then(({ rememberOcrCourses }) => {
        if (draft.owner === accountDataOwner.value && draft.generation === accountGeneration && JSON.stringify(courses.value) === committedFingerprint) rememberOcrCourses(plan.courses)
      })
      lastImportUndo.value = { owner: draft.owner, snapshot: draft.snapshot, committedFingerprint, expiresAt: Date.now() + IMPORT_UNDO_WINDOW_MS }
      scheduleUndoExpiry()
      const summary = `新增 ${plan.added} 门，替换 ${plan.replaced} 门，跳过 ${plan.skipped} 门${plan.kept ? `，保留冲突 ${plan.kept} 门` : ''}`
      if (draft.source === 'manual') { showForm.value = false; showToast(`课程已保存：${summary}`) }
      else if (draft.source === 'template') { managerMessage.value = `模板导入完成：${summary}` }
      else { clearBatchInput(); batchError.value = ''; message.value = `导入完成：${summary}${draft.reviewCount ? `（${draft.reviewCount} 门建议确认）` : ''}` }
      showImportConflict.value = false
      importDraft.value = null
    } catch {
      if (draft.owner !== accountDataOwner.value || draft.generation !== accountGeneration) return
      if (committedFingerprint && JSON.stringify(courses.value) === committedFingerprint) {
        domain.replaceCourses(draft.snapshot)
        batchError.value = '写入失败，已自动恢复导入前课表'
      } else batchError.value = '写入失败，请重试；已保留当前课表。'
    } finally { importCommitBusy.value = false }
  }

  function undoLastCourseImport() {
    const undo = lastImportUndo.value
    // 到期（含定时器还没跑到的那一瞬）都要把状态收干净，别留一个点了没反应的按钮。
    if (!undo || Date.now() > undo.expiresAt) { stopUndoTimer(); lastImportUndo.value = null; return }
    stopUndoTimer()
    if (undo.owner !== accountDataOwner.value || JSON.stringify(courses.value) !== undo.committedFingerprint) {
      lastImportUndo.value = null
      message.value = '课表已有新的编辑，为保护这些改动，本次导入不能整体撤销。'
      return
    }
    domain.replaceCourses(JSON.parse(JSON.stringify(undo.snapshot)))
    lastImportUndo.value = null
    message.value = '已撤销本次导入，课表已恢复'
  }

  watch(accountDataOwner, () => {
    accountGeneration += 1
    cancelCourseImportReview()
    stopUndoTimer()
    lastImportUndo.value = null
  }, { flush: 'sync' })

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
