// 前端云同步：严格手动模式。
// 连接 ≠ 拉取 ≠ 推送：connectCloud() 只做验证和读取云端元数据，
// 业务数据的下行只能由用户点击「从云端拉取」触发，
// 上行只能由用户点击「推送到云端」触发。
// 应用内不存在任何定时器、启动钩子或输入事件触发的自动同步。
import { computed, ref } from 'vue'
import { decryptData, encryptData } from '../utils/crypto.js'
import { raceWithControls, throwIfAborted } from './asyncTask.js'
import { deviceProfile } from './deviceIdentity.js'
import {
  SYNC_DEFAULTS,
  SYNC_KEYS,
  assertValidSyncPayload,
  cloneValue,
  normalizePullKeys,
  pickSyncValues,
  sanitizeSyncPayload,
  validateSyncPayload,
} from './cloudSyncData.js'
import {
  buildSyncManifest,
  SYNC_METADATA_KEY,
  readSyncMetadata,
  removeSupersededTombstones,
  saveSyncBaseline,
  validateSyncManifest,
  validateStableEntityIds,
} from './syncMetadata.js'
import { mergeSyncPayload } from './syncMerge.js'
import { validateAndRepairRelations } from './syncIntegrity.js'

const UNDO_KEY = 'study_life_cloud_pull_undo'
const SYNC_HISTORY_KEY = 'study_life_sync_history'
const LOCAL_TS_KEY = 'study_life_last_local_change'
const SESSION_CODE_KEY = 'study_life_sync_session_code'
export const SYNC_COMMIT_MARKER_KEY = 'study_life_sync_commit_marker'
export const LAST_KNOWN_GOOD_KEY = 'study_life_last_known_good'
const VERIFY_TIMEOUT_MS = 15_000
const SYNC_TIMEOUT_MS = 45_000
const SYNC_CODE_PATTERN = /^\d{6}$/

function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readSyncCommitMarker() {
  const marker = readStoredJson(SYNC_COMMIT_MARKER_KEY)
  return marker && marker.version === 1 && marker.operationId && marker.phase ? marker : null
}

function recoveryStateFromMarker() {
  const marker = readSyncCommitMarker()
  return marker ? { status: 'interrupted', marker, message: '上一次同步可能没有完整完成，正在检查本机恢复数据。' } : { status: 'idle', marker: null, message: '' }
}

function readSessionCode() {
  try {
    const value = sessionStorage.getItem(SESSION_CODE_KEY) || ''
    return SYNC_CODE_PATTERN.test(value) ? value : ''
  } catch {
    return ''
  }
}

export const code = ref(readSessionCode())
// disconnected -> validating -> connected（连接成功后停留，绝不进入 pulling）
export const connectionState = ref('disconnected')
export const syncStatus = ref('idle') // idle | pulling | pushing | restoring | success | error
export const lastError = ref('')
export const lastSyncedAt = ref(null)
export const remoteUpdatedAt = ref(null)
export const cloudExists = ref(false)
export const remoteRevision = ref(readSyncHistory().baseRevision ?? null)
export const cloudMetadata = ref(emptyMetadata())
export const remoteDevice = ref(readSyncHistory().remoteDevice ?? null)
export const lastPushedDevice = ref(readSyncHistory().lastPushedDevice ?? null)
export const localChanged = ref(false)
export const canUndoPull = ref(readUndo() !== null)
export const syncPreview = ref(null)
export const syncRecovery = ref(recoveryStateFromMarker())
const remoteWriteValues = new Map()
let remoteWriteGeneration = 0
let localChangeSequence = 0
let pendingMerge = null

export const isSyncing = computed(() =>
  ['pulling', 'pushing', 'restoring'].includes(syncStatus.value)
)
export const syncRecoveryLocked = computed(() => ['interrupted', 'recovering', 'recovery-required'].includes(syncRecovery.value.status))
export const syncRelationship = computed(() => deriveSyncRelationship({
  exists: cloudExists.value,
  revision: remoteRevision.value,
}, {
  hasBase: readSyncHistory().hasBase === true,
  baseRevision: readSyncHistory().baseRevision ?? null,
  localDirty: localChanged.value,
}))

export function deriveSyncRelationship(metadata, localState) {
  if (!metadata?.exists) return localState?.localDirty ? 'local-changes' : 'empty'
  // 旧云端记录没有 revision 时，不能用时间猜测同步方向。
  if (!localState?.hasBase || metadata.revision === null) return 'unknown'
  if (metadata.revision === localState.baseRevision) return localState.localDirty ? 'local-changes' : 'synced'
  return localState.localDirty ? 'both-changed' : 'cloud-updated'
}

function readLocalChangedAt() {
  try { return localStorage.getItem(LOCAL_TS_KEY) || null } catch { return null }
}
export const lastLocalChangedAt = ref(readLocalChangedAt())

function readSyncHistory() {
  try { return JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY)) ?? {} } catch { return {} }
}
function saveSyncHistory() {
  try {
    localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify({
      remoteDevice: remoteDevice.value,
      lastPushedDevice: lastPushedDevice.value,
      hasBase: readSyncHistory().hasBase === true,
      baseRevision: readSyncHistory().baseRevision ?? null,
      localDirty: localChanged.value,
    }))
  } catch {}
}

function saveSyncBase({ hasBase = true, baseRevision = remoteRevision.value, localDirty = localChanged.value } = {}) {
  try {
    const history = readSyncHistory()
    localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify({
      ...history,
      remoteDevice: remoteDevice.value,
      lastPushedDevice: lastPushedDevice.value,
      hasBase,
      baseRevision,
      localDirty,
    }))
  } catch {}
}

function recoveryError(message, cause = null) {
  const error = new Error(message)
  if (cause) error.cause = cause
  return error
}

async function beginSyncCommit({ baseRevision = null, targetRevision = null } = {}) {
  if (syncRecoveryLocked.value) throw recoveryError('同步已暂停，请先完成上一次同步的本地恢复')
  const states = await storedStates(SYNC_KEYS)
  const snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    values: currentStateValues(states),
    syncMetadata: readSyncMetadata(),
    syncHistoryRaw: localStorage.getItem(SYNC_HISTORY_KEY),
    localChangedAtRaw: localStorage.getItem(LOCAL_TS_KEY),
  }
  const operationId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const marker = { version: 1, operationId, startedAt: snapshot.createdAt, phase: 'prepared', baseRevision, targetRevision }
  // 先写安全快照，再写 marker；若快照无法落盘，不开始任何本地提交。
  localStorage.setItem(LAST_KNOWN_GOOD_KEY, JSON.stringify(snapshot))
  localStorage.setItem(SYNC_COMMIT_MARKER_KEY, JSON.stringify(marker))
  syncRecovery.value = { status: 'committing', marker, message: '' }
  return marker
}

function updateSyncCommitMarker(phase, patch = {}) {
  const marker = readSyncCommitMarker()
  if (!marker) throw recoveryError('同步恢复标记丢失，已停止本次同步以保护本地数据')
  const next = { ...marker, ...patch, phase }
  localStorage.setItem(SYNC_COMMIT_MARKER_KEY, JSON.stringify(next))
  syncRecovery.value = { status: 'committing', marker: next, message: '' }
  return next
}

function finishSyncCommit() {
  const marker = updateSyncCommitMarker('completed')
  try { localStorage.removeItem(SYNC_COMMIT_MARKER_KEY) } catch {}
  try { localStorage.removeItem(LAST_KNOWN_GOOD_KEY) } catch {}
  syncRecovery.value = { status: 'idle', marker: null, message: '' }
  return marker
}

function markRecoveryRequired(error) {
  const marker = readSyncCommitMarker()
  if (marker) {
    const next = { ...marker, phase: 'recovery-required', recoveryError: error instanceof Error ? error.message : String(error || '') }
    try { localStorage.setItem(SYNC_COMMIT_MARKER_KEY, JSON.stringify(next)) } catch {}
    syncRecovery.value = { status: 'recovery-required', marker: next, message: '同步写入和自动恢复都未能完成。为避免进一步覆盖，本次同步已停止，并保留了同步前恢复数据。' }
  } else {
    syncRecovery.value = { status: 'recovery-required', marker: null, message: '同步恢复标记不可用，请进入数据管理检查本机数据。' }
  }
}

async function restoreLastKnownGood() {
  const snapshot = readStoredJson(LAST_KNOWN_GOOD_KEY)
  if (!snapshot || snapshot.version !== 1 || !snapshot.values) throw recoveryError('找不到同步前恢复数据')
  const values = validateSyncPayload(snapshot.values)
  const repaired = validateAndRepairRelations(values)
  if (validateStableEntityIds(repaired.values).length) throw recoveryError('同步前恢复数据缺少稳定 ID')
  const { restoreStoredValues } = await import('./store/cloudAccess.js')
  await restoreStoredValues(repaired.values, { markChanged: false })
  localStorage.setItem(SYNC_METADATA_KEY, JSON.stringify(snapshot.syncMetadata || readSyncMetadata()))
  if (snapshot.syncHistoryRaw === null || snapshot.syncHistoryRaw === undefined) localStorage.removeItem(SYNC_HISTORY_KEY)
  else localStorage.setItem(SYNC_HISTORY_KEY, snapshot.syncHistoryRaw)
  if (snapshot.localChangedAtRaw === null || snapshot.localChangedAtRaw === undefined) localStorage.removeItem(LOCAL_TS_KEY)
  else localStorage.setItem(LOCAL_TS_KEY, snapshot.localChangedAtRaw)
  localChanged.value = Boolean(readSyncHistory().localDirty)
  lastLocalChangedAt.value = snapshot.localChangedAtRaw || null
  return snapshot
}

export async function recoverInterruptedSync() {
  const marker = readSyncCommitMarker()
  if (!marker) {
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
    return { ok: true, recovered: false }
  }
  if (marker.phase === 'completed') {
    try { localStorage.removeItem(SYNC_COMMIT_MARKER_KEY); localStorage.removeItem(LAST_KNOWN_GOOD_KEY) } catch {}
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
    return { ok: true, recovered: false }
  }
  syncRecovery.value = { status: 'recovering', marker, message: '上一次同步未完整完成，正在恢复同步前数据。' }
  try {
    await restoreLastKnownGood()
    localStorage.removeItem(SYNC_COMMIT_MARKER_KEY)
    localStorage.removeItem(LAST_KNOWN_GOOD_KEY)
    syncRecovery.value = { status: 'recovered', marker, message: '上一次同步未完整完成，为保护本地数据，已恢复同步前快照；未自动拉取或推送。' }
    return { ok: true, recovered: true }
  } catch (error) {
    markRecoveryRequired(error)
    return { ok: false, error }
  }
}

export async function restoreSyncRecovery() {
  if (!readSyncCommitMarker()) return { ok: false, error: recoveryError('暂无可恢复的同步数据') }
  syncRecovery.value = { ...syncRecovery.value, status: 'recovering', message: '正在恢复同步前数据。' }
  try {
    const marker = readSyncCommitMarker()
    await restoreLastKnownGood()
    localStorage.removeItem(SYNC_COMMIT_MARKER_KEY)
    localStorage.removeItem(LAST_KNOWN_GOOD_KEY)
    syncRecovery.value = { status: 'recovered', marker, message: '已恢复同步前数据；未自动拉取或推送。' }
    return { ok: true }
  } catch (error) {
    markRecoveryRequired(error)
    return { ok: false, error }
  }
}

async function abortSyncCommit(error) {
  if (!readSyncCommitMarker()) return
  if (error?.rollbackFailed) {
    markRecoveryRequired(error)
    return
  }
  try {
    await restoreLastKnownGood()
    localStorage.removeItem(SYNC_COMMIT_MARKER_KEY)
    localStorage.removeItem(LAST_KNOWN_GOOD_KEY)
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
  } catch (recoveryError) {
    markRecoveryRequired(recoveryError)
  }
}

function emptyMetadata() {
  return { exists: false, revision: null, updatedAt: null, updatedByDeviceId: null, updatedByDeviceName: null }
}

function applyCloudMetadata(value) {
  const metadata = {
    exists: Boolean(value?.exists),
    revision: Number.isInteger(value?.revision) ? value.revision : null,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    updatedByDeviceId: typeof value?.updatedByDeviceId === 'string' ? value.updatedByDeviceId : null,
    updatedByDeviceName: typeof value?.updatedByDeviceName === 'string' && value.updatedByDeviceName.trim()
      ? value.updatedByDeviceName.trim().slice(0, 30)
      : null,
  }
  cloudMetadata.value = metadata
  cloudExists.value = metadata.exists
  remoteRevision.value = metadata.revision
  remoteUpdatedAt.value = metadata.updatedAt
  remoteDevice.value = metadata.updatedByDeviceName
    ? { id: metadata.updatedByDeviceId || '', name: metadata.updatedByDeviceName, pushedAt: metadata.updatedAt || '' }
    : null
  return metadata
}

function safeDeviceMeta(meta) {
  if (!meta || typeof meta !== 'object' || typeof meta.name !== 'string') return null
  return {
    id: typeof meta.id === 'string' ? meta.id.slice(0, 80) : '',
    name: meta.name.trim().slice(0, 30) || '未知设备',
    pushedAt: typeof meta.pushedAt === 'string' ? meta.pushedAt : '',
  }
}
function unpackSyncPackage(value) {
  if (value?.format === 'study-life-sync' && [2, 3].includes(value.version) && value.values) {
    return { values: value.values, meta: safeDeviceMeta(value.meta), manifest: value.manifest || null }
  }
  return { values: value, meta: safeDeviceMeta(value?.__sync_meta), manifest: null }
}

export function markLocalChanged(key = '', rawValue = undefined) {
  if (key && remoteWriteValues.has(key)) {
    const expected = remoteWriteValues.get(key)
    remoteWriteValues.delete(key)
    // 只抑制“刚应用的远端值”本身；用户紧接着编辑出的不同值必须标记为本机修改。
    if (typeof rawValue === 'string' && rawValue === expected.raw) return
  }
  localChangeSequence += 1
  lastLocalChangedAt.value = new Date().toISOString()
  try { localStorage.setItem(LOCAL_TS_KEY, lastLocalChangedAt.value) } catch {}
  localChanged.value = true
  saveSyncBase({ localDirty: true })
}

const API = {
  verify: '/api/auth/verify',
  pull: '/api/sync/pull',
  push: '/api/sync/push',
}

function showError(msg) {
  syncStatus.value = 'error'
  lastError.value = msg
  return false
}

function showSuccess(message = '') {
  syncStatus.value = 'success'
  lastError.value = message
  window.setTimeout(() => { if (syncStatus.value === 'success') syncStatus.value = 'idle' }, 2600)
  return true
}

function nowText() {
  return new Date().toLocaleString()
}

async function responseError(response, fallback) {
  try {
    const body = await response.json()
    return body.error || fallback
  } catch {
    return fallback
  }
}

function reportProgress(onProgress, step, message, partial = null) {
  onProgress?.({ step, message, partial })
}

async function controlledFetch(url, init = {}, { signal = null, timeoutMs = SYNC_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  return raceWithControls(fetch(url, { ...init, signal: controller.signal }), {
    signal,
    timeoutMs,
    timeoutMessage: '云端请求超时，请检查网络后重试',
    onInterrupt: () => controller.abort(),
  })
}

function readUndo() {
  try {
    const value = JSON.parse(localStorage.getItem(UNDO_KEY))
    return value && value.version === 1 && value.values ? value : null
  } catch {
    return null
  }
}

function saveUndo(values) {
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      values,
    }))
    canUndoPull.value = true
  } catch {
    // 存储空间不足时不阻断同步；格式校验仍会保护本地结构。
  }
}

async function storedStates(keys = SYNC_KEYS) {
  // 让同步入口以独立边界按需加载完整 store；避免直接动态导入 store/index.js 的打包警告。
  const { useStoredRef } = await import('./store/cloudAccess.js')
  return Object.fromEntries(
    keys.map((key) => [key, useStoredRef(key, cloneValue(SYNC_DEFAULTS[key]))])
  )
}

function snapshotStates(states, keys) {
  return Object.fromEntries(keys.map((key) => [key, cloneValue(states[key]?.value)]))
}

function currentStateValues(states) {
  return Object.fromEntries(SYNC_KEYS.map((key) => [key, states[key].value]))
}

async function commitStoredValues(values) {
  const generation = ++remoteWriteGeneration
  const entries = Object.entries(values)
  for (const [key, remoteValue] of entries) {
    const nextValue = cloneValue(remoteValue)
    const nextRaw = JSON.stringify(nextValue)
    remoteWriteValues.set(key, { raw: nextRaw, generation })
  }
  const { restoreStoredValues } = await import('./store/cloudAccess.js')
  // 云端合并提交不是新的用户编辑；提交后的 dirty 状态由调用方按合并结果决定。
  await restoreStoredValues(values, { markChanged: false })
  window.setTimeout(() => {
    for (const [key, marker] of remoteWriteValues) {
      if (marker.generation === generation) remoteWriteValues.delete(key)
    }
  }, 1200)
}

function mergeTombstones(...groups) {
  const result = new Map()
  for (const item of groups.flat()) {
    if (!item?.entityType || item.entityId === undefined) continue
    const key = `${item.entityType}:${item.entityId}`
    const previous = result.get(key)
    if (!previous || String(item.updatedAt || '') >= String(previous.updatedAt || '')) result.set(key, cloneValue(item))
  }
  return [...result.values()]
}

function conflictDisplay(conflict) {
  const fields = ['title', 'name', 'content', 'date', 'dueDate', 'dueTime', 'nextDate', 'status', 'done', 'active', 'archivedAt', 'courseId', 'courseName', 'amount', 'direction', 'billingPeriodKey']
  const local = conflict.local || {}
  const remote = conflict.remote || {}
  return {
    key: conflict.key,
    entityType: conflict.entityType || '',
    entityId: conflict.entityId || conflict.key,
    status: conflict.status,
    reason: conflict.reason || '',
    label: local.title || local.name || remote.title || remote.name || `${conflict.entityType || '设置'} ${conflict.entityId || conflict.key}`,
    fields: fields.filter((field) => local[field] !== undefined || remote[field] !== undefined).map((field) => ({ field, local: local[field], remote: remote[field] })),
  }
}

function buildPreview(merge, remote) {
  return {
    summary: merge.summary,
    conflicts: merge.conflicts.map(conflictDisplay),
    changes: merge.statuses
      .filter((item) => item.status !== 'unchanged')
      .map((item) => ({
        key: item.key,
        entityId: item.entityId || '',
        label: item.label || item.entityId || item.key,
        status: item.status,
      })),
    remoteDevice: remote.meta,
    generatedAt: new Date().toISOString(),
  }
}

// ---------- 连接：仅验证访问码 + 读取云端元数据（不下载业务数据） ----------
export async function connectCloud(codeInput, { signal = null } = {}) {
  if (isSyncing.value) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
  if (!SYNC_CODE_PATTERN.test(String(codeInput ?? ''))) {
    connectionState.value = 'disconnected'
    return { ok: false, error: '请输入 6 位数字访问码' }
  }
  connectionState.value = 'validating'
  lastError.value = ''
  try {
    const res = await controlledFetch(API.verify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput }),
    }, { signal, timeoutMs: VERIFY_TIMEOUT_MS })
    if (!res.ok) throw new Error(await responseError(res, '访问码验证失败'))
    const metadata = applyCloudMetadata(await res.json())
    // 仅在验证通过后记住当前空间，不触发任何数据下载或上传。
    code.value = codeInput
    try { sessionStorage.setItem(SESSION_CODE_KEY, codeInput) } catch {}
    // 恢复上次已确认的本地基线；连接本身绝不改变业务数据或“本机已修改”标记。
    localChanged.value = readSyncHistory().localDirty === true
    connectionState.value = 'connected'
    return {
      ok: true,
      ...metadata,
    }
  } catch (error) {
    connectionState.value = 'disconnected'
    code.value = ''
    return { ok: false, error: error instanceof Error ? error.message : '访问码验证失败' }
  }
}

// 已连接后只刷新 revision、更新时间与来源设备，不拉取或上传业务数据。
export async function refreshCloudMetadata({ signal = null } = {}) {
  if (isSyncing.value) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
  if (!SYNC_CODE_PATTERN.test(code.value)) return { ok: false, error: '尚未连接云端，请先输入访问码连接' }
  lastError.value = ''
  try {
    const res = await controlledFetch(API.verify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value }),
    }, { signal, timeoutMs: VERIFY_TIMEOUT_MS })
    if (!res.ok) throw new Error(await responseError(res, '无法刷新云端状态'))
    return { ok: true, ...applyCloudMetadata(await res.json()) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '无法刷新云端状态' }
  }
}

export function disconnectCloud() {
  // 只断开同步空间，不删除本地任何数据。
  code.value = ''
  try { sessionStorage.removeItem(SESSION_CODE_KEY) } catch {}
  applyCloudMetadata(emptyMetadata())
  localChanged.value = false
  lastError.value = ''
  connectionState.value = 'disconnected'
}

// ---------- 拉取：仅可由 UI 的「从云端拉取」按钮调用 ----------
// keys：本次要拉取的 sl_* 键子集；null/undefined 保持全量向后兼容。
export async function pullFromCloud({ signal = null, onProgress = null, keys = null, previewOnly = false } = {}) {
  if (isSyncing.value) return false
  if (!SYNC_CODE_PATTERN.test(code.value)) return showError('尚未连接云端，请先输入访问码连接')
  const pullKeys = normalizePullKeys(keys)
  if (!pullKeys.length) return showSuccess('未选择要拉取的数据模块，本地数据未发生变化')
  syncStatus.value = 'pulling'
  lastError.value = ''
  if (syncRecoveryLocked.value) return showError(syncRecovery.value.message || '同步已暂停，请先完成本地恢复')
  let commitStarted = false

  try {
    reportProgress(onProgress, 'request', '正在请求云端版本')
    const res = await controlledFetch(API.pull, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value }),
    }, { signal })
    if (!res.ok) throw new Error(await responseError(res, '拉取失败'))
    const response = await res.json()
    const { data } = response
    const metadata = applyCloudMetadata({ ...response, exists: response.exists ?? Boolean(data) })

    if (!data) {
      return showSuccess('云端暂无数据，本地数据未发生变化')
    }

    throwIfAborted(signal)
    reportProgress(onProgress, 'decrypt', '云端数据已收到，正在本机解密')
    const remote = unpackSyncPackage(await decryptData(data, code.value))
    throwIfAborted(signal)
    reportProgress(onProgress, 'validate', '正在校验数据结构与兼容性')
    if (remote.manifest) {
      const manifestIssues = validateSyncManifest(remote.values, remote.manifest)
      if (manifestIssues.length) throw new Error('云端 manifest 与数据内容不一致，本地数据未发生变化')
    }
    // 只对选中键做解密后校验，未勾选模块的云端值直接忽略、本地保持原样。
    const { values: validated, invalidKeys } = sanitizeSyncPayload(pickSyncValues(remote.values, pullKeys))
    if (!Object.keys(validated).length && invalidKeys.length) {
      throw new Error('云端数据全部为旧版异常格式，本地数据未发生变化')
    }
    throwIfAborted(signal)
    const states = await storedStates(SYNC_KEYS)
    const localValues = currentStateValues(states)
    const localMetadata = readSyncMetadata()
    const merge = mergeSyncPayload({
      baseManifest: localMetadata.hasBaseline ? localMetadata.baseline : null,
      localValues,
      remoteValues: validated,
      localTombstones: localMetadata.tombstones,
      remoteTombstones: remote.manifest?.tombstones || [],
      keys: Object.keys(validated),
      // 旧版加密包没有 manifest，升级后的首次拉取保持旧行为：以云端值填充本地。
      legacy: !remote.manifest || !localMetadata.hasBaseline,
    })
    syncPreview.value = buildPreview(merge, remote)
    const structuralConflicts = merge.conflicts.filter((conflict) => ['local-entity-id-invalid', 'remote-entity-id-invalid'].includes(conflict.reason))
    if (structuralConflicts.length) {
      syncPreview.value = { ...syncPreview.value, conflicts: [] }
      return showError('发现缺少稳定 ID 的同步记录，本次未应用；请先修复数据后重试')
    }
    if (merge.conflicts.length) {
      pendingMerge = { merge, localValues, remoteValues: validated, pullKeys: Object.keys(validated), remoteTombstones: remote.manifest?.tombstones || [], localTombstones: localMetadata.tombstones, localChanged: localChanged.value, metadata }
      return showError(`发现 ${merge.conflicts.length} 个需要确认的同步冲突`)
    }
    if (previewOnly) {
      pendingMerge = { merge, localValues, remoteValues: validated, pullKeys: Object.keys(validated), remoteTombstones: remote.manifest?.tombstones || [], localTombstones: localMetadata.tombstones, localChanged: localChanged.value, metadata }
      return showSuccess('已生成同步预览，本地数据未发生变化')
    }
    // 先创建本机安全快照，再以 store 的可回滚事务提交合并结果。
    reportProgress(onProgress, 'apply', '已创建拉取前快照，正在应用可用数据', { 数据模块: Object.keys(validated).length, 冲突: merge.conflicts.length, 修复关系: merge.summary.repairedRelations })
    await beginSyncCommit({ baseRevision: localMetadata.baseRemoteRevision, targetRevision: metadata.revision })
    commitStarted = true
    saveUndo(snapshotStates(states, pullKeys))
    updateSyncCommitMarker('writing-business')
    await commitStoredValues(pickSyncValues(merge.values, pullKeys))
    pendingMerge = null
    const tombstones = removeSupersededTombstones(
      merge.values,
      mergeTombstones(localMetadata.tombstones, remote.manifest?.tombstones || [])
    )
    const baselineValues = { ...localValues, ...validated }
    updateSyncCommitMarker('writing-metadata')
    saveSyncBaseline(baselineValues, { remoteRevision: metadata.revision, tombstones })

    // 新版来源以服务端 metadata 为准；旧加密包只作为兼容显示回退。
    if (!metadata.updatedByDeviceName && remote.meta) remoteDevice.value = remote.meta
    lastSyncedAt.value = new Date().toISOString()
    // 首次完整拉取的明确意图是用云端建立本机基线；不能把拉取前的
    // 默认值/设备初始化写入误判为拉取后的本机修改。
    const adoptedAsInitialBaseline = !localMetadata.hasBaseline && pullKeys.length === SYNC_KEYS.length
    const localDirty = adoptedAsInitialBaseline
      ? false
      : localChanged.value || merge.statuses.some((item) => item.status === 'local-only-change')
    localChanged.value = localDirty
    updateSyncCommitMarker('updating-base')
    saveSyncBase({ hasBase: true, baseRevision: metadata.revision, localDirty })
    saveSyncHistory()
    finishSyncCommit()
    return showSuccess(
      invalidKeys.length
        ? `已合并可用数据，并跳过 ${invalidKeys.length} 项旧版异常设置 · ${nowText()}`
        : `已从云端拉取 ${nowText()}，可撤销本次拉取`
    )
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (commitStarted) await abortSyncCommit(error)
      syncStatus.value = 'idle'
      lastError.value = ''
      return false
    }
    if (commitStarted) await abortSyncCommit(error)
    return showError(syncRecovery.value.status === 'recovery-required'
      ? syncRecovery.value.message
      : error instanceof Error ? `${error.message}（本地数据未发生变化）` : `拉取失败 ${nowText()}，本地数据未发生变化`)
  }
}

export async function previewCloudMerge(options = {}) {
  return pullFromCloud({ ...options, previewOnly: true })
}

export async function resolvePendingMerge(decisions = {}) {
  if (isSyncing.value) return false
  if (syncRecoveryLocked.value) return showError(syncRecovery.value.message || '同步已暂停，请先完成本地恢复')
  if (!pendingMerge?.merge?.conflicts?.length) return showError('暂无待处理的同步冲突')
  const unresolved = pendingMerge.merge.conflicts.filter((conflict) => {
    const key = `${conflict.key}:${conflict.entityId || conflict.key}`
    return !decisions[key] && !decisions[conflict.key]
  })
  if (unresolved.length) return showError(`仍有 ${unresolved.length} 个冲突未选择处理方式`)
  syncStatus.value = 'restoring'
  let commitStarted = false
  try {
    const merge = { ...pendingMerge.merge, values: cloneValue(pendingMerge.merge.values) }
    const restoredTombstones = new Set()
    for (const conflict of merge.conflicts) {
      const decision = decisions[`${conflict.key}:${conflict.entityId || conflict.key}`] || decisions[conflict.key]
      if (!conflict.entityType) {
        if (decision === 'remote') merge.values[conflict.key] = cloneValue(conflict.remote)
        else if (decision === 'local') merge.values[conflict.key] = cloneValue(conflict.local)
        continue
      }
      const list = Array.isArray(merge.values[conflict.key]) ? merge.values[conflict.key] : []
      const id = String(conflict.entityId)
      const chosen = decision === 'remote' ? conflict.remote : decision === 'local' || decision === 'restore-local' ? conflict.local : undefined
      const filtered = conflict.reason === 'same-bill-period-different-fact'
        ? list.filter((item) => `${item?.billId || ''}:${item?.billingPeriodKey || ''}` !== id)
        : list.filter((item) => String(item?.id || '') !== id)
      if (chosen !== undefined) filtered.push(cloneValue(chosen))
      merge.values[conflict.key] = filtered
      if (decision === 'local' || decision === 'remote' || decision === 'restore-local') restoredTombstones.add(`${conflict.entityType}:${id}`)
    }
    const repaired = validateAndRepairRelations(merge.values)
    const invalidIds = validateStableEntityIds(repaired.values)
    if (invalidIds.length) throw new Error('冲突决策产生了缺少稳定 ID 的同步记录')
    merge.values = repaired.values
    const states = await storedStates(SYNC_KEYS)
    await beginSyncCommit({ baseRevision: pendingMerge.metadata.revision, targetRevision: pendingMerge.metadata.revision })
    commitStarted = true
    saveUndo(snapshotStates(states, pendingMerge.pullKeys))
    updateSyncCommitMarker('writing-business')
    await commitStoredValues(pickSyncValues(merge.values, pendingMerge.pullKeys))
    const tombstones = mergeTombstones(pendingMerge.localTombstones, pendingMerge.remoteTombstones).filter((item) => !restoredTombstones.has(`${item.entityType}:${item.entityId}`))
    // Base 必须记录“冲突选择后的最终值”，否则选择保留本机时下一次同步会把
    // 远端旧值误当成 Base，导致同一冲突再次出现。
    const baselineValues = { ...pendingMerge.localValues, ...pendingMerge.remoteValues, ...merge.values }
    updateSyncCommitMarker('writing-metadata')
    saveSyncBaseline(baselineValues, { remoteRevision: pendingMerge.metadata.revision, tombstones })
    lastSyncedAt.value = new Date().toISOString()
    const keptLocalValue = pendingMerge.localChanged || Object.values(decisions).some((decision) => ['local', 'restore-local'].includes(decision))
    localChanged.value = keptLocalValue
    updateSyncCommitMarker('updating-base')
    saveSyncBase({ hasBase: true, baseRevision: pendingMerge.metadata.revision, localDirty: keptLocalValue })
    saveSyncHistory()
    finishSyncCommit()
    pendingMerge = null
    syncPreview.value = { ...syncPreview.value, conflicts: [], resolved: true }
    return showSuccess(`已按你的选择完成冲突合并 · ${nowText()}`)
  } catch (error) {
    if (commitStarted) await abortSyncCommit(error)
    return showError(syncRecovery.value.status === 'recovery-required'
      ? syncRecovery.value.message
      : error instanceof Error ? `${error.message}（本地数据未发生变化）` : '冲突提交失败（本地数据未发生变化）')
  }
}

// ---------- 推送：仅可由 UI 的「推送到云端」按钮调用 ----------
export async function pushToCloud({ signal = null, onProgress = null } = {}) {
  if (isSyncing.value) return false
  if (!SYNC_CODE_PATTERN.test(code.value)) return showError('尚未连接云端，请先输入访问码连接')
  if (syncRecoveryLocked.value) return showError(syncRecovery.value.message || '同步已暂停，请先完成本地恢复')
  // 已建立基线且本机没有新修改时，重复点击不应制造空 revision；
  // 若云端已有新版本，仍交给用户先拉取/预览，而不是用旧快照覆盖它。
  if (cloudExists.value && remoteRevision.value !== null && readSyncHistory().hasBase && !localChanged.value) {
    return showSuccess('没有需要推送的更改')
  }

  syncStatus.value = 'pushing'
  lastError.value = ''
  let commitStarted = false

  try {
    reportProgress(onProgress, 'collect', '正在收集本机可同步数据')
    const { flushStoredWrites, useStoredRef } = await import('./store/cloudAccess.js')
    flushStoredWrites()
    const states = Object.fromEntries(
      SYNC_KEYS.map((key) => [key, useStoredRef(key, cloneValue(SYNC_DEFAULTS[key]))])
    )
    const payload = currentStateValues(states)
    assertValidSyncPayload(payload)
    const invalidIds = validateStableEntityIds(payload)
    if (invalidIds.length) throw new Error(`本机存在 ${invalidIds.length} 条缺少稳定 ID 的同步记录，请先修复后再推送`)
    // push 端会原子比较 expectedRevision；不再先发一次重复 verify 请求。
    const knownRevision = remoteRevision.value
    const pushStartedAtSequence = localChangeSequence
    reportProgress(onProgress, 'check', '已记录当前云端版本，提交时将原子校验')
    const meta = {
      id: deviceProfile.value.id,
      name: deviceProfile.value.name,
      pushedAt: new Date().toISOString(),
    }
    const syncMetadata = readSyncMetadata()
    const manifest = buildSyncManifest(payload, { tombstones: syncMetadata.tombstones, deviceId: meta.id, schemaVersion: 3 })
    await beginSyncCommit({ baseRevision: readSyncHistory().baseRevision ?? null, targetRevision: null })
    commitStarted = true
    // 新版使用带 manifest 的 envelope；旧版客户端仍可读取其中的 values。
    throwIfAborted(signal)
    reportProgress(onProgress, 'encrypt', '正在本机加密同步数据', { 数据模块: Object.keys(payload).length })
    const encrypted = await encryptData({ format: 'study-life-sync', version: 3, values: payload, manifest, meta }, code.value)
    throwIfAborted(signal)

    reportProgress(onProgress, 'upload', '加密完成，正在上传云端')
    const res = await controlledFetch(API.push, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.value,
        data: encrypted,
        expectedRevision: knownRevision,
        deviceId: meta.id,
        deviceName: meta.name,
      }),
    }, { signal })

    const response = await res.json()
    if (!res.ok) {
      if (response.conflict) applyCloudMetadata(response)
      throw new Error(response.error || '推送失败')
    }
    reportProgress(onProgress, 'confirm', '云端已确认接收新版本')
    const metadata = applyCloudMetadata({ ...response, exists: true })
    lastPushedDevice.value = { ...meta, pushedAt: metadata.updatedAt }
    lastSyncedAt.value = new Date().toISOString()
    const changedDuringPush = localChangeSequence !== pushStartedAtSequence
    localChanged.value = changedDuringPush
    updateSyncCommitMarker('writing-metadata', { targetRevision: metadata.revision })
    saveSyncBaseline(payload, { remoteRevision: metadata.revision, tombstones: syncMetadata.tombstones })
    updateSyncCommitMarker('updating-base')
    saveSyncBase({ hasBase: true, baseRevision: metadata.revision, localDirty: changedDuringPush })
    saveSyncHistory()
    finishSyncCommit()
    return showSuccess(`已推送到云端 ${nowText()}`)
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (commitStarted) await abortSyncCommit(error)
      syncStatus.value = 'idle'
      lastError.value = ''
      return false
    }
    if (commitStarted) await abortSyncCommit(error)
    return showError(syncRecovery.value.status === 'recovery-required'
      ? syncRecovery.value.message
      : error instanceof Error ? `${error.message}（云端数据未发生变化）` : `推送失败 ${nowText()}，云端数据未发生变化`)
  }
}

export async function undoLastPull() {
  if (isSyncing.value) return false
  if (syncRecoveryLocked.value) return showError(syncRecovery.value.message || '同步已暂停，请先完成本地恢复')
  const undo = readUndo()
  if (!undo) return showError('暂无可撤销的拉取记录')
  syncStatus.value = 'restoring'
  let commitStarted = false
  try {
    const values = validateSyncPayload(undo.values)
    await beginSyncCommit({ baseRevision: readSyncHistory().baseRevision ?? null, targetRevision: readSyncHistory().baseRevision ?? null })
    commitStarted = true
    updateSyncCommitMarker('writing-business')
    await commitStoredValues(values)
    updateSyncCommitMarker('writing-metadata')
    localStorage.removeItem(UNDO_KEY)
    canUndoPull.value = false
    localChanged.value = true
    updateSyncCommitMarker('updating-base')
    saveSyncBase({ hasBase: true, baseRevision: readSyncHistory().baseRevision ?? null, localDirty: true })
    saveSyncHistory()
    finishSyncCommit()
    return showSuccess(`已恢复到拉取前的本机数据 · ${nowText()}`)
  } catch (error) {
    if (commitStarted) await abortSyncCommit(error)
    return showError(error instanceof Error ? error.message : '撤销失败')
  } finally {
    if (syncStatus.value === 'restoring') syncStatus.value = 'idle'
  }
}

export function useCloudSync() {
  return {
    code,
    connectionState,
    isSyncing,
    syncStatus,
    lastError,
    lastSyncedAt,
    lastLocalChangedAt,
    remoteUpdatedAt,
    cloudExists,
    remoteDevice,
    lastPushedDevice,
    localChanged,
    canUndoPull,
    syncPreview,
    pullFromCloud,
    previewCloudMerge,
    resolvePendingMerge,
    pushToCloud,
    undoLastPull,
    connectCloud,
    refreshCloudMetadata,
    disconnectCloud,
    markLocalChanged,
  }
}
