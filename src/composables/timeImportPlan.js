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

import { ref, watch } from 'vue'
import { timeConfig } from './store/timeConfig.js'
import { useTaskProgress } from './taskProgress.js'
import { importError, pasteText, showToast } from './timeSettingsShared.js'
import { loadPlanDraft, planCampusId, planSeasonId } from './timePlanDraft.js'
import { clearRecognition, openSchemeDetail, recognitionDraft } from './recognitionSchemes.js'
import { currentRecognitionApi } from './scheduleOcrFlow.js'
import { accountDataOwner } from './accountSyncIdentity.js'

export const importPlanOpen = ref(false)
export const importPlan = ref(null)
export const importPlanOverrides = ref({})
export const planDiffExpanded = ref({})
export const importRunning = ref(false)

/**
 * 导入**失败**态：为 true 时计划弹窗留在原地渲染失败原因与出口，而不是切回计划列表。
 *
 * 【为什么不能只看 importError】它是导入与识别共用的暂存（timeSettingsShared.js:38-39）：
 * 上一次 OCR/粘贴解析留下的失败文案可能还挂在那里，而计划弹窗每次打开都会读它——
 * 只看"非空"会让正常打开计划弹窗变成一张莫名其妙的报错页。
 * 【为什么不能只看 importProgress.state.status === 'failed'】下面 confirmImportPlan 的
 * snapshot 守卫"识别引擎未就绪"根本没走到 importProgress.start()，进度状态还是 waiting，
 * 而那条路径今天同样是"用户什么都看不到"（同一个缺陷的第二个入口）。
 */
export const importFailed = ref(false)
export const importProgress = useTaskProgress()
export const lastImportResult = ref(null)
export const importPlanScope = ref(null)
let importPlanContext = null
let accountGeneration = 0
const configFingerprint = (cfg = timeConfig.value) => JSON.stringify(cfg)
const contextIsCurrent = (context) => !context || (context.owner === accountDataOwner.value
  && context.generation === accountGeneration
  && context.config === timeConfig.value && context.fingerprint === configFingerprint())

function rejectChangedPlan() {
  importError.value = '作息已变化，请重新生成导入计划。'
  importFailed.value = true
}

export function openImportPlan(scopeSchemeId = null) {
  if (!recognitionDraft.value?.schemes.length) return
  importFailed.value = false
  importPlanScope.value = scopeSchemeId
  importPlanOverrides.value = {}
  planDiffExpanded.value = {}
  importPlan.value = currentRecognitionApi()?.buildImportPlan(recognitionDraft.value, timeConfig.value, {}, scopeSchemeId) ?? null
  importPlanContext = { owner: accountDataOwner.value, generation: accountGeneration, config: timeConfig.value, fingerprint: configFingerprint() }
  importPlanOpen.value = true
}

function rebuildPlan() {
  if (!recognitionDraft.value || !importPlan.value) return
  if (!contextIsCurrent(importPlanContext)) { rejectChangedPlan(); return }
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
  // 退出失败态：下一次打开回到计划列表。importError 刻意**不**清——
  // 关闭之后下层弹窗（TimeSettingsModal 的 role="alert" 那行）仍要把失败原因显示给用户，
  // 那正是"返回"这条出口的落点。
  importFailed.value = false
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
  if (!contextIsCurrent(importPlanContext)) { rejectChangedPlan(); return }
  // 新一轮尝试：清掉上一轮的失败态与错误文案。"重试导入"这个出口每点一次都会走到这里，
  // 不清 importError 的话，即使重试成功，下层弹窗仍会挂着上一次的「导入失败，已恢复原数据」。
  importFailed.value = false
  importError.value = ''
  const cfg = timeConfig.value
  const owner = accountDataOwner.value
  const generation = accountGeneration
  let expectedFingerprint = configFingerprint(cfg)
  const assertCurrent = () => {
    if (owner === accountDataOwner.value && generation === accountGeneration && cfg === timeConfig.value && expectedFingerprint === configFingerprint(cfg)) return
    const error = new Error('作息已变化，为保护最新配置已停止导入，请重新生成计划。')
    error.name = 'TimeImportChangedError'
    throw error
  }
  const applied = plan.items.filter((item) => item.action !== 'skip')
  // 守卫必须在置 importRunning 之前。
  // 原来先置 true 再取快照、取不到就 `return` —— 于是 importRunning 永远停在 true：
  // closeImportPlan() 第一行就是 `if (importRunning.value) return`，弹窗再也关不掉，
  // 用户只能看着一个永远转不完的「正在导入作息」。只差一次动态 import 失败就会踩中。
  const api = currentRecognitionApi()
  const snapshot = api?.snapshotTimeConfig(cfg)
  if (!snapshot) {
    importError.value = '识别引擎未就绪，请重新识别后再导入。'
    // 这条早退同样要留在当前弹窗里报错：它没经过 importProgress，只在计划弹窗里
    // 渲染错误态这一条路（见 importFailed 的注释）。
    importFailed.value = true
    return
  }
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
  try {
    importProgress.setStep('snapshot', 'running')
    await sleep(160)
    assertCurrent()
    importProgress.setStep('snapshot', 'completed')
    importProgress.setStep('plan', 'running')
    await sleep(120)
    assertCurrent()
    importProgress.setStep('plan', 'completed')
    for (let index = 0; index < applied.length; index++) {
      importProgress.setStep(`apply-${index}`, 'running')
      await sleep(140)
      assertCurrent()
      api.applyImportItem(applied[index], cfg)
      expectedFingerprint = configFingerprint(cfg)
      importProgress.setStep(`apply-${index}`, 'completed')
    }
    cfg.updatedAt = new Date().toISOString()
    expectedFingerprint = configFingerprint(cfg)
    importProgress.setStep('save', 'running')
    await sleep(120)
    assertCurrent()
    importProgress.setStep('save', 'completed')
    importProgress.finish(`已成功导入 ${applied.length} 组作息`)
    const replace = applied.filter((item) => item.action === 'replace').length
    const create = applied.length - replace
    lastImportResult.value = { owner, fingerprint: expectedFingerprint, snapshot, count: applied.length, replace, create, at: Date.now() }
    importRunning.value = false
    importPlanOpen.value = false
    clearRecognition()
    pasteText.value = ''
    refreshDraftIfAffected(applied)
    showToast(`✓ 已成功导入 ${applied.length} 组作息（${replace} 替换 / ${create} 新建），如识别有误可撤销`)
  } catch (e) {
    if (owner !== accountDataOwner.value || generation !== accountGeneration) return
    const changed = e?.name === 'TimeImportChangedError'
    const canRestore = !changed && cfg === timeConfig.value
    if (canRestore) currentRecognitionApi()?.restoreTimeConfig(cfg, snapshot)
    const messageText = changed ? e.message : `导入失败，${canRestore ? '已恢复原数据' : '已保留最新配置'}：${e?.message ?? '未知错误'}`
    importProgress.fail('save', messageText)
    importRunning.value = false
    importError.value = messageText
    // 失败**不能**表现为"回到计划列表"：原来只把 importRunning 置回 false，
    // 计划弹窗立刻切回列表视图，而 importError 唯一的渲染点在下层弹窗（被盖住）——
    // 用户看到的是"点确认 → 闪一下 → 又回到列表"，无从判断成没成。
    // 置失败态后计划弹窗原地渲染原因与出口（重试 / 返回计划列表）。
    importFailed.value = true
  } finally {
    importRunning.value = false
  }
}

export function undoLastImport() {
  const result = lastImportResult.value
  if (!result) return
  if (result.owner !== accountDataOwner.value || result.fingerprint !== configFingerprint()) {
    lastImportResult.value = null
    importError.value = '作息已有新的编辑，为保护这些改动，本次导入不能整体撤销。'
    showToast(importError.value)
    return
  }
  currentRecognitionApi()?.restoreTimeConfig(timeConfig.value, result.snapshot)
  lastImportResult.value = null
  if (planSeasonId.value && planCampusId.value) loadPlanDraft(planSeasonId.value, planCampusId.value)
  showToast('已撤销本次导入，恢复到导入前状态')
}

watch(accountDataOwner, () => {
  accountGeneration += 1
  importPlanContext = null
  lastImportResult.value = null
  clearRecognition()
  importError.value = ''
  importFailed.value = false
  importProgress.reset()
}, { flush: 'sync' })
