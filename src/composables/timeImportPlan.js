/**
 * 导入计划（第七步拆分）：批量、事务、可撤销。
 *
 * 【为什么这里敢 `import { clearRecognition } from './recognitionSchemes.js'`】
 * 识别结果与它的导入计划是同一条链上的两级：结果层 `clearRecognition()` 要顺带清掉
 * 计划，计划执行完也要叫结果层清掉自己。两边互相 import 形成循环，但双方都只在
 * **函数被调用时**才读对方的绑定（模块体内没有跨模块读取），所以 ESM 的求值顺序
 * 不会影响这里的任何值。
 *
 * 【为什么 `snapshotTimeConfig` 在 try 之外】拿不到快照就绝不能开始写——
 * 否则导入到一半失败时没有可回滚的原数据，"已恢复原数据"会变成空话。
 */

import { ref } from 'vue'
import { timeConfig } from './store/timeConfig.js'
import { useTaskProgress } from './taskProgress.js'
import { importError, pasteText, showToast } from './timeSettingsShared.js'
import { loadPlanDraft, planCampusId, planSeasonId } from './timePlanDraft.js'
import { clearRecognition, openSchemeDetail, recognitionDraft } from './recognitionSchemes.js'
import { currentRecognitionApi } from './scheduleOcrFlow.js'

export const importPlanOpen = ref(false)
export const importPlan = ref(null)
export const importPlanOverrides = ref({})
export const planDiffExpanded = ref({})
export const importRunning = ref(false)
export const importProgress = useTaskProgress()
export const lastImportResult = ref(null)
export const importPlanScope = ref(null)

export function openImportPlan(scopeSchemeId = null) {
  if (!recognitionDraft.value?.schemes.length) return
  importPlanScope.value = scopeSchemeId
  importPlanOverrides.value = {}
  planDiffExpanded.value = {}
  importPlan.value = currentRecognitionApi()?.buildImportPlan(recognitionDraft.value, timeConfig.value, {}, scopeSchemeId) ?? null
  importPlanOpen.value = true
}

function rebuildPlan() {
  if (!recognitionDraft.value || !importPlan.value) return
  importPlan.value = currentRecognitionApi()?.buildImportPlan(recognitionDraft.value, timeConfig.value, importPlanOverrides.value, importPlanScope.value) ?? null
}

export function setPlanItemAction(item, action) {
  importPlanOverrides.value = { ...importPlanOverrides.value, [item.schemeId]: action }
  rebuildPlan()
}

export function togglePlanDiff(item) {
  planDiffExpanded.value = { ...planDiffExpanded.value, [item.schemeId]: !planDiffExpanded.value[item.schemeId] }
}

export function canReplaceItem(item) {
  return item.targetMode === 'replace'
}

export function canImportItem(item) {
  return item.targetMode !== 'pending'
}

export function createActionLabel(item) {
  return item.targetMode === 'replace' ? '新建副本' : '新建'
}

export function editFromPlan(schemeId) {
  importPlanOpen.value = false
  openSchemeDetail(schemeId)
}

export function closeImportPlan() {
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

export async function confirmImportPlan() {
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
  const snapshot = currentRecognitionApi()?.snapshotTimeConfig(cfg)
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
      currentRecognitionApi().applyImportItem(applied[index], cfg)
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
    currentRecognitionApi()?.restoreTimeConfig(cfg, snapshot)
    const messageText = `导入失败，已恢复原数据：${e?.message ?? '未知错误'}`
    importProgress.fail('save', messageText)
    importRunning.value = false
    importError.value = messageText
  }
}

export function undoLastImport() {
  const result = lastImportResult.value
  if (!result) return
  currentRecognitionApi()?.restoreTimeConfig(timeConfig.value, result.snapshot)
  lastImportResult.value = null
  if (planSeasonId.value && planCampusId.value) loadPlanDraft(planSeasonId.value, planCampusId.value)
  showToast('已撤销本次导入，恢复到导入前状态')
}
