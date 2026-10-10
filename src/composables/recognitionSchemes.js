/**
 * 识别结果暂存层（第六步拆分）：确认前绝不写入正式作息。
 *
 * 【总览 + 详情共用一份状态】"识别结果总览"（第一级卡片）与"某一组的详情编辑"
 * （第二级弹窗）读写的是同一个 `recognitionDraft`：详情里改的目标、改的行、手动加的行，
 * 返回总览后必须还在。所以这些状态与函数只能是**模块级单例**，不能按组件各持一份。
 *
 * 【为什么 importPlan* 的复位写在这里】`clearRecognition()` 是"丢掉整份识别结果"的
 * 唯一入口（放弃识别、导入成功后各调一次）；导入计划是这份结果的下一级视图，
 * 结果没了计划自然也要清空——复位逻辑跟着"谁拥有清空语义"走，而不是散在调用方。
 */

import { computed, ref } from 'vue'
import { timeConfig, seasonAppliesTo, seasonsForCampus } from './store/timeConfig.js'
import { pasteText, showToast } from './timeSettingsShared.js'
import { currentRecognitionApi, loadRecognition, schemeDisplayName, schemeStatus } from './scheduleOcrFlow.js'
import { importPlan, importPlanOpen, importPlanOverrides, planDiffExpanded } from './timeImportPlan.js'
import { accountDataOwner } from './accountSyncIdentity.js'

// ---- 识别暂存层（recognitionDraft）：确认前绝不写入正式作息 ----
export const recognitionDraft = ref(null)
export const activeSchemeId = ref(null)
export const schemeDetailOpen = ref(false)
export const detailFilter = ref('all') // all | issues
let recognitionGeneration = 0

export const schemeCount = computed(() => recognitionDraft.value?.schemes.length ?? 0)

export const selectedSchemeCount = computed(() =>
  recognitionDraft.value?.schemes.filter((scheme) => scheme.selected).length ?? 0
)

export const activeScheme = computed(() =>
  recognitionDraft.value?.schemes.find((scheme) => scheme.id === activeSchemeId.value) ?? null
)

export const activeSchemeValidation = computed(() => {
  const api = currentRecognitionApi()
  return activeScheme.value && api ? api.validateSchemeRows(activeScheme.value, timeConfig.value) : null
})

export const activeSchemeRows = computed(() => {
  const scheme = activeScheme.value
  if (!scheme) return []
  if (detailFilter.value !== 'issues') return scheme.rows
  const issues = activeSchemeValidation.value?.rowIssues
  if (!issues) return []
  return scheme.rows.filter((row) => issues.has(row.id))
})

export const activeSchemeIssueCount = computed(() => activeSchemeValidation.value?.issueRowCount ?? 0)

export function clearRecognition() {
  recognitionGeneration += 1
  recognitionDraft.value = null
  activeSchemeId.value = null
  schemeDetailOpen.value = false
  detailFilter.value = 'all'
  importPlanOpen.value = false
  importPlan.value = null
  importPlanOverrides.value = {}
  planDiffExpanded.value = {}
}

export function discardRecognition() {
  clearRecognition()
  pasteText.value = ''
  showToast('已放弃本次识别结果，正式作息未受影响')
}

// 从解析开始就拥有一次识别会话；取消、换号或新请求都会使其失效。
export function beginRecognitionSession() {
  const generation = ++recognitionGeneration
  const owner = accountDataOwner.value
  return () => generation === recognitionGeneration && owner === accountDataOwner.value
}

// 识别结果进入暂存层：此处绝不写入正式作息
export async function startRecognition(analysis, sourceName, { isCurrent = () => true, session } = {}) {
  if (!isCurrent() || (session && !session())) return null
  const activeSession = session ?? beginRecognitionSession()
  const api = await loadRecognition()
  if (!activeSession() || !isCurrent()) return null
  const value = api.buildRecognitionDraft(analysis, timeConfig.value, sourceName)
  recognitionDraft.value = value
  activeSchemeId.value = value.schemes[0]?.id ?? null
  schemeDetailOpen.value = false
  detailFilter.value = 'all'
  return value
}

export function countTargetModes(draftValue) {
  const modes = { replace: 0, create: 0, pending: 0 }
  for (const scheme of draftValue.schemes) {
    if (scheme.target.mode === 'replace') modes.replace += 1
    else if (scheme.target.mode === 'create') modes.create += 1
    else modes.pending += 1
  }
  return modes
}

export function modesText(modes) {
  const parts = []
  if (modes.replace) parts.push(`${modes.replace} 组替换`)
  if (modes.create) parts.push(`${modes.create} 组新建`)
  if (modes.pending) parts.push(`${modes.pending} 组待确认`)
  return parts.join(' / ') || '无匹配'
}

export function recognitionTimeText(createdAt) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/* ---------- 识别结果总览 / 详情编辑 ---------- */

export function toggleSchemeSelected(scheme) {
  scheme.selected = !scheme.selected
}

export function openSchemeDetail(schemeId) {
  activeSchemeId.value = schemeId
  detailFilter.value = 'all'
  schemeDetailOpen.value = true
}

export function closeSchemeDetail() {
  schemeDetailOpen.value = false
}

// 用户调整目标（校区/作息方案/新建名称）后重新推导 replace/create/pending
export function updateSchemeTarget(scheme, patch = {}) {
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

export function pickSchemeCampus(scheme, campusId) {
  updateSchemeTarget(scheme, { campusId, newCampusName: '' })
}

export function pickSchemeSeason(scheme, seasonId) {
  updateSchemeTarget(scheme, { seasonId, newSeasonName: '' })
}

export function startNewCampus(scheme) {
  updateSchemeTarget(scheme, { campusId: '', newCampusName: scheme.detectedCampus || '' })
}

export function startNewSeason(scheme) {
  updateSchemeTarget(scheme, { seasonId: '', newSeasonName: scheme.detectedSeason || '' })
}

export function onSchemeRowInput(row) {
  row.confirmed = true
}

export function addSchemeRow(scheme) {
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

export function removeSchemeRow(scheme, index) {
  scheme.rows.splice(index, 1)
}

export function rowIssuesFor(row) {
  return activeSchemeValidation.value?.rowIssues.get(row.id) ?? []
}

export function schemeStatusBadge(scheme) {
  const cfg = timeConfig.value
  const status = schemeStatus(scheme, cfg)
  if (status === 'pending') return { icon: '⚠', text: '映射待确认', cls: 'warn' }
  const validation = currentRecognitionApi()?.validateSchemeRows(scheme, cfg)
  if (status === 'blocked') return { icon: '⚠', text: `${validation.hardRowCount} 项待处理`, cls: 'warn' }
  if (status === 'review') return { icon: '⚠', text: `${validation.issueRowCount} 项待确认`, cls: 'warn' }
  const label = schemeDisplayName(scheme, cfg)
  return scheme.target.mode === 'replace'
    ? { icon: '✓', text: `替换「${label}」`, cls: 'ok' }
    : { icon: '✓', text: `新建「${label}」`, cls: 'ok' }
}

export function schemeReplaceChanged(scheme) {
  if (scheme.target.mode !== 'replace') return 0
  return currentRecognitionApi()?.buildReplaceDiff(scheme, timeConfig.value).changedCount ?? 0
}

export const activeSchemeForQuick = computed(() => {
  const draftValue = recognitionDraft.value
  if (!draftValue?.schemes.length) return null
  return draftValue.schemes.find((scheme) => scheme.id === activeSchemeId.value) ?? draftValue.schemes[0]
})

export const detailSeasonOptions = computed(() => {
  const scheme = activeScheme.value
  if (!scheme) return []
  return seasonsForCampus(scheme.target.campusId, timeConfig.value)
})
