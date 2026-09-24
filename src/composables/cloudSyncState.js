// 云同步共享状态、持久化、恢复、快照与操作锁：space / transfer 的唯一事实来源。
import { computed, ref } from 'vue'
import { setLocalChangedHandler } from './store/core.js'
import {
  SYNC_DEFAULTS,
  SYNC_KEYS,
  cloneValue,
  hasMeaningfulLocalData,
  validateSyncPayload,
} from './cloudSyncData.js'
import {
  buildEntityManifest,
  mergeRestoreMarkers,
  SYNC_METADATA_KEY,
  syncMetadataStorageKey,
  readSyncMetadata,
  removeSupersededTombstones,
  saveSyncBaseline,
  syncKeyForEntityType,
  validateStableEntityIds,
} from './syncMetadata.js'
import { RETIRED_SYNC_KEYS } from './retiredData.js'
import { validateAndRepairRelations } from './syncIntegrity.js'
import {
  isSyncSpaceBound,
  normalizeSyncSpaceId,
  saveSyncSpaceSettings,
  syncSpaceBootstrapPending,
  syncSpaceSettings,
} from './syncSpace.js'

/** 跨模块可变运行时状态（非响应式）；feature 模块只经由本对象读写。 */
export const runtime = {
  remoteWriteValues: new Map(),
  remoteWriteGeneration: 0,
  localChangeSequence: 0,
  pendingMerge: null,
  syncOperation: null,
  syncGeneration: 0,
  activeAbortControllers: new Set(),
}

export const UNDO_KEY = 'study_life_cloud_pull_undo'
export const SYNC_HISTORY_KEY = 'study_life_sync_history'
export const LOCAL_TS_KEY = 'study_life_last_local_change'
export const SESSION_CODE_KEY = 'study_life_sync_session_code'
export const SYNC_DIRTY_SIGNAL_KEY = 'study_life_sync_dirty_signal'
export const SYNC_COMMIT_MARKER_KEY = 'study_life_sync_commit_marker'
export const LAST_KNOWN_GOOD_KEY = 'study_life_last_known_good'
export const VERIFY_TIMEOUT_MS = 15_000
export const SYNC_TIMEOUT_MS = 45_000
export const SYNC_CODE_PATTERN = /^\d{6}$/

// 所有同步运行时元数据按空间隔离。仅在旧版手动访问码模式下使用原 key；
// 这些 key 不会进入业务 envelope，也不会把 secret 放进 key 名称。
export function syncStorageKey(key, spaceId = syncSpaceSettings.value?.spaceId) {
  const normalized = normalizeSyncSpaceId(spaceId)
  if (!normalized) return key
  if (key === SYNC_METADATA_KEY) return syncMetadataStorageKey(normalized)
  return `${key}:${encodeURIComponent(normalized)}`
}

export function syncUndoStorageKey(spaceId = syncSpaceSettings.value?.spaceId) {
  return syncStorageKey(UNDO_KEY, spaceId)
}

export function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function readSyncCommitMarker() {
  const marker = readStoredJson(syncStorageKey(SYNC_COMMIT_MARKER_KEY))
  return marker && marker.version === 1 && marker.operationId && marker.phase ? marker : null
}

export function recoveryStateFromMarker() {
  const marker = readSyncCommitMarker()
  return marker ? { status: 'interrupted', marker, message: '上一次同步可能没有完整完成，正在检查本机恢复数据。' } : { status: 'idle', marker: null, message: '' }
}

export function readSessionCode() {
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
export const syncErrorKind = ref('')
export const syncRetryAfterMs = ref(null)
export const lastCheckedAt = ref(readSyncHistory().lastCheckedAt ?? null)
export const lastSyncedAt = ref(readSyncHistory().lastSyncedAt ?? null)
export const remoteUpdatedAt = ref(null)
export const cloudExists = ref(false)
export const remoteRevision = ref(readSyncHistory().baseRevision ?? null)
export const cloudMetadata = ref(emptyMetadata())
export const remoteDevice = ref(readSyncHistory().remoteDevice ?? null)
export const lastPushedDevice = ref(readSyncHistory().lastPushedDevice ?? null)
export const localChanged = ref(false)
export const bootstrapHasMeaningfulLocalData = ref(false)
export const canUndoPull = ref(readUndo() !== null)
export const syncPreview = ref(null)
export const syncRecovery = ref(recoveryStateFromMarker())
const syncCalibrationVersion = ref(0)

export const isSyncing = computed(() =>
  ['pulling', 'pushing', 'restoring'].includes(syncStatus.value)
)
export const syncRecoveryLocked = computed(() => ['interrupted', 'recovering', 'recovery-required'].includes(syncRecovery.value.status))
export const syncCalibrationRequired = computed(() => {
  syncCalibrationVersion.value
  if (!isSyncSpaceBound.value || syncSpaceBootstrapPending.value) return false
  const metadata = readSyncMetadata()
  return metadata.hasBaseline === true && metadata.baseRemoteRevision === null
})
export const syncRelationship = computed(() => syncSpaceBootstrapPending.value
  ? 'bootstrap-pending'
  : syncCalibrationRequired.value
    ? 'calibration-required'
  : deriveSyncRelationship({
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

export function readLocalChangedAt() {
  try { return localStorage.getItem(syncStorageKey(LOCAL_TS_KEY)) || null } catch { return null }
}
export const lastLocalChangedAt = ref(readLocalChangedAt())

export function readSyncHistory() {
  try { return JSON.parse(localStorage.getItem(syncStorageKey(SYNC_HISTORY_KEY))) ?? {} } catch { return {} }
}
export function saveSyncHistory() {
  try {
    localStorage.setItem(syncStorageKey(SYNC_HISTORY_KEY), JSON.stringify({
      remoteDevice: remoteDevice.value,
      lastPushedDevice: lastPushedDevice.value,
      lastSyncedAt: lastSyncedAt.value,
      lastCheckedAt: lastCheckedAt.value,
      spaceId: syncSpaceSettings.value?.spaceId || null,
      hasBase: readSyncHistory().hasBase === true,
      baseRevision: readSyncHistory().baseRevision ?? null,
      localDirty: localChanged.value,
    }))
  } catch {}
}

export function saveSyncBase({ hasBase = true, baseRevision = remoteRevision.value, localDirty = localChanged.value } = {}) {
  try {
    const history = readSyncHistory()
    localStorage.setItem(syncStorageKey(SYNC_HISTORY_KEY), JSON.stringify({
      ...history,
      remoteDevice: remoteDevice.value,
      lastPushedDevice: lastPushedDevice.value,
      lastSyncedAt: lastSyncedAt.value,
      lastCheckedAt: lastCheckedAt.value,
      spaceId: syncSpaceSettings.value?.spaceId || null,
      hasBase,
      baseRevision,
      localDirty,
    }))
  } catch {}
}

export function clearSyncError() {
  syncErrorKind.value = ''
  syncRetryAfterMs.value = null
}

export function syncKindForStatus(status, code = '') {
  if (code === 'COORDINATOR_VERSION_MISMATCH' || status === 426) return 'version-mismatch'
  if (status === 401) return 'credential-invalid'
  if (status === 403) return 'permission-denied'
  if (status === 409) return 'cas-conflict'
  if (status === 429) return 'rate-limited'
  if (status === 413) return 'payload-too-large'
  if (status >= 400 && status < 500) return 'invalid-request'
  return 'error'
}

export function applySyncError(error) {
  const status = Number(error?.status) || 0
  const kind = error?.syncKind || syncKindForStatus(status, error?.code)
  syncErrorKind.value = kind
  syncRetryAfterMs.value = kind === 'rate-limited' ? (Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null) : null
  if (kind === 'credential-invalid') connectionState.value = 'credential-invalid'
  if (kind === 'permission-denied') connectionState.value = 'permission-denied'
  return kind
}

export function recoveryError(message, cause = null) {
  const error = new Error(message)
  if (cause) error.cause = cause
  return error
}

export async function beginSyncCommit({ baseRevision = null, targetRevision = null, operation = null } = {}) {
  if (syncRecoveryLocked.value) throw recoveryError('同步已暂停，请先完成上一次同步的本地恢复')
  if (operation) assertSyncOperation(operation)
  const states = await storedStates(SYNC_KEYS)
  if (operation) assertSyncOperation(operation)
  const storageSpaceId = operation?.spaceId || undefined
  const snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    values: currentStateValues(states),
    syncMetadata: readSyncMetadata(),
    syncHistoryRaw: localStorage.getItem(syncStorageKey(SYNC_HISTORY_KEY, storageSpaceId)),
    localChangedAtRaw: localStorage.getItem(syncStorageKey(LOCAL_TS_KEY, storageSpaceId)),
  }
  if (operation) assertSyncOperation(operation)
  const operationId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const marker = { version: 1, operationId, startedAt: snapshot.createdAt, phase: 'prepared', baseRevision, targetRevision }
  // 先写安全快照，再写 marker；若快照无法落盘，不开始任何本地提交。
  localStorage.setItem(syncStorageKey(LAST_KNOWN_GOOD_KEY, storageSpaceId), JSON.stringify(snapshot))
  localStorage.setItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY, storageSpaceId), JSON.stringify(marker))
  syncRecovery.value = { status: 'committing', marker, message: '' }
  return marker
}

export function updateSyncCommitMarker(phase, patch = {}) {
  const marker = readSyncCommitMarker()
  if (!marker) throw recoveryError('同步恢复标记丢失，已停止本次同步以保护本地数据')
  const next = { ...marker, ...patch, phase }
  localStorage.setItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY), JSON.stringify(next))
  syncRecovery.value = { status: 'committing', marker: next, message: '' }
  return next
}

export function finishSyncCommit() {
  const marker = updateSyncCommitMarker('completed')
  try { localStorage.removeItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY)) } catch {}
  try { localStorage.removeItem(syncStorageKey(LAST_KNOWN_GOOD_KEY)) } catch {}
  syncRecovery.value = { status: 'idle', marker: null, message: '' }
  return marker
}

function markRecoveryRequired(error) {
  const marker = readSyncCommitMarker()
  if (marker) {
    const next = { ...marker, phase: 'recovery-required', recoveryError: error instanceof Error ? error.message : String(error || '') }
    try { localStorage.setItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY), JSON.stringify(next)) } catch {}
    syncRecovery.value = { status: 'recovery-required', marker: next, message: '同步写入和自动恢复都未能完成。为避免进一步覆盖，本次同步已停止，并保留了同步前恢复数据。' }
  } else {
    syncRecovery.value = { status: 'recovery-required', marker: null, message: '同步恢复标记不可用，请进入数据管理检查本机数据。' }
  }
}

async function restoreLastKnownGood() {
  const snapshot = readStoredJson(syncStorageKey(LAST_KNOWN_GOOD_KEY))
  if (!snapshot || snapshot.version !== 1 || !snapshot.values) throw recoveryError('找不到同步前恢复数据')
  const values = validateSyncPayload(snapshot.values)
  const repaired = validateAndRepairRelations(values)
  if (validateStableEntityIds(repaired.values).length) throw recoveryError('同步前恢复数据缺少稳定 ID')
  const { restoreStoredValues } = await import('./store/cloudAccess.js')
  await restoreStoredValues(repaired.values, { markChanged: false })
  localStorage.setItem(syncStorageKey(SYNC_METADATA_KEY), JSON.stringify(snapshot.syncMetadata || readSyncMetadata()))
  if (snapshot.syncHistoryRaw === null || snapshot.syncHistoryRaw === undefined) localStorage.removeItem(syncStorageKey(SYNC_HISTORY_KEY))
  else localStorage.setItem(syncStorageKey(SYNC_HISTORY_KEY), snapshot.syncHistoryRaw)
  if (snapshot.localChangedAtRaw === null || snapshot.localChangedAtRaw === undefined) localStorage.removeItem(syncStorageKey(LOCAL_TS_KEY))
  else localStorage.setItem(syncStorageKey(LOCAL_TS_KEY), snapshot.localChangedAtRaw)
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
    try { localStorage.removeItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY)); localStorage.removeItem(syncStorageKey(LAST_KNOWN_GOOD_KEY)) } catch {}
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
    return { ok: true, recovered: false }
  }
  syncRecovery.value = { status: 'recovering', marker, message: '上一次同步未完整完成，正在恢复同步前数据。' }
  try {
    await restoreLastKnownGood()
    localStorage.removeItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY))
    localStorage.removeItem(syncStorageKey(LAST_KNOWN_GOOD_KEY))
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
    localStorage.removeItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY))
    localStorage.removeItem(syncStorageKey(LAST_KNOWN_GOOD_KEY))
    syncRecovery.value = { status: 'recovered', marker, message: '已恢复同步前数据；未自动拉取或推送。' }
    return { ok: true }
  } catch (error) {
    markRecoveryRequired(error)
    return { ok: false, error }
  }
}

export async function abortSyncCommit(error) {
  if (!readSyncCommitMarker()) return
  if (error?.rollbackFailed) {
    markRecoveryRequired(error)
    return
  }
  try {
    await restoreLastKnownGood()
    localStorage.removeItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY))
    localStorage.removeItem(syncStorageKey(LAST_KNOWN_GOOD_KEY))
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
  } catch (recoveryError) {
    markRecoveryRequired(recoveryError)
  }
}

export function emptyMetadata() {
  return { exists: false, revision: null, updatedAt: null, updatedByDeviceId: null, updatedByDeviceName: null, devices: [] }
}

export function applyCloudMetadata(value) {
  const knownDevices = Array.isArray(cloudMetadata.value?.devices) ? cloudMetadata.value.devices : []
  const metadata = {
    exists: Boolean(value?.exists),
    revision: Number.isInteger(value?.revision) ? value.revision : null,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    updatedByDeviceId: typeof value?.updatedByDeviceId === 'string' ? value.updatedByDeviceId : null,
    updatedByDeviceName: typeof value?.updatedByDeviceName === 'string' && value.updatedByDeviceName.trim()
      ? value.updatedByDeviceName.trim().slice(0, 30)
      : null,
    devices: Array.isArray(value?.devices)
      ? value.devices.filter((device) => device && typeof device.id === 'string' && typeof device.name === 'string').map((device) => ({ id: device.id.slice(0, 80), name: device.name.trim().slice(0, 30), platform: typeof device.platform === 'string' ? device.platform.slice(0, 20) : '', lastSeenAt: device.lastSeenAt || null }))
      : knownDevices,
  }
  cloudMetadata.value = metadata
  cloudExists.value = metadata.exists
  remoteRevision.value = metadata.revision
  remoteUpdatedAt.value = metadata.updatedAt
  remoteDevice.value = metadata.updatedByDeviceName
    ? { id: metadata.updatedByDeviceId || '', name: metadata.updatedByDeviceName, pushedAt: metadata.updatedAt || '' }
    : null
  syncCalibrationVersion.value += 1
  return metadata
}

export function recordCloudCheck() {
  lastCheckedAt.value = new Date().toISOString()
  saveSyncHistory()
}

function safeDeviceMeta(meta) {
  if (!meta || typeof meta !== 'object' || typeof meta.name !== 'string') return null
  return {
    id: typeof meta.id === 'string' ? meta.id.slice(0, 80) : '',
    name: meta.name.trim().slice(0, 30) || '未知设备',
    pushedAt: typeof meta.pushedAt === 'string' ? meta.pushedAt : '',
  }
}
export function unpackSyncPackage(value) {
  if (value?.format === 'study-life-sync') {
    if (![2, 3].includes(value.version) || !value.values) throw new Error('此同步数据版本暂不支持，本地数据未发生变化')
    return { values: value.values, meta: safeDeviceMeta(value.meta), manifest: value.manifest || null }
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'format')) {
    throw new Error('此同步数据格式暂不支持，本地数据未发生变化')
  }
  if (!isLegacyPayloadShape(value)) throw new Error('此同步数据格式无法识别，本地数据未发生变化')
  return { values: value, meta: safeDeviceMeta(value?.__sync_meta), manifest: null }
}

function isLegacyPayloadShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  // 旧版包允许空对象和设备显示元数据，但业务字段必须来自当前同步键；
  // 任意未知 wrapper 不能因为“没有 format”就降级成 legacy payload。
  const businessKeys = keys.filter((key) => key !== '__sync_meta')
  return keys.length === 0 || (
    keys.every((key) => SYNC_KEYS.includes(key) || RETIRED_SYNC_KEYS.includes(key) || key === '__sync_meta')
    && (businessKeys.some((key) => SYNC_KEYS.includes(key)) || businessKeys.every((key) => RETIRED_SYNC_KEYS.includes(key)))
  )
}

export function markLocalChanged(key = '', rawValue = undefined) {
  // 防止 runtime/UI 代码误用这个底层信号把非同步键带入 Push；无 key 的调用
  // 仍保留给批量导入/删除等已完成同步业务写入的兼容入口。
  if (key && !SYNC_KEYS.includes(key)) return
  if (key && runtime.remoteWriteValues.has(key)) {
    const expected = runtime.remoteWriteValues.get(key)
    runtime.remoteWriteValues.delete(key)
    // 只抑制“刚应用的远端值”本身；用户紧接着编辑出的不同值必须标记为本机修改。
    if (typeof rawValue === 'string' && rawValue === expected.raw) return
  }
  runtime.localChangeSequence += 1
  lastLocalChangedAt.value = new Date().toISOString()
  try { localStorage.setItem(syncStorageKey(LOCAL_TS_KEY), lastLocalChangedAt.value) } catch {}
  localChanged.value = true
  saveSyncBase({ localDirty: true })
  try { localStorage.setItem(syncStorageKey(SYNC_DIRTY_SIGNAL_KEY), `${Date.now()}-${runtime.localChangeSequence}`) } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('study-life:sync-dirty', { detail: { key } }))
}

// 存储层写盘后经 core 的钩子回调到这里；core 不再静态依赖 cloudSync，
// 避免 timeConfig 等业务 chunk 被整张同步图拖大。
setLocalChangedHandler(markLocalChanged)

// ---------- 操作锁与鉴权 ----------
export function activeAuth() {
  if (isSyncSpaceBound.value) {
    return { spaceId: syncSpaceSettings.value.spaceId, deviceCredential: syncSpaceSettings.value.deviceCredential }
  }
  if (SYNC_CODE_PATTERN.test(code.value)) return { code: code.value }
  return null
}

export function beginSyncOperation(operation) {
  if (runtime.syncOperation) return null
  const auth = activeAuth()
  if (!auth) return null
  runtime.syncOperation = {
    id: `sync-op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    generation: runtime.syncGeneration,
    auth: { ...auth },
    spaceId: auth.spaceId || '',
    encryptionSecret: activeEncryptionSecret(),
  }
  return runtime.syncOperation
}

// 连接/重新校准本身不携带业务 payload，但仍必须占用同一把空间级锁，
// 防止验证响应与正在进行的 Pull/Push 交叉提交到不同的身份状态。
export function beginControlOperation(operation) {
  if (runtime.syncOperation) return null
  runtime.syncOperation = {
    id: `sync-control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    generation: runtime.syncGeneration,
    auth: null,
    spaceId: syncSpaceSettings.value?.spaceId || '',
  }
  return runtime.syncOperation
}

export function staleSyncOperation() {
  const error = new Error('同步请求已失效，未写入当前空间')
  error.code = 'SYNC_OPERATION_STALE'
  return error
}

export function assertSyncOperation(operation) {
  const current = activeAuth()
  if (
    !operation
    || runtime.syncOperation !== operation
    || operation.generation !== runtime.syncGeneration
    || JSON.stringify(current || null) !== JSON.stringify(operation.auth)
  ) throw staleSyncOperation()
}

export function assertSyncGeneration(operation) {
  if (!operation || runtime.syncOperation !== operation || operation.generation !== runtime.syncGeneration) throw staleSyncOperation()
}

export function isStaleSyncOperationError(error) {
  return error?.code === 'SYNC_OPERATION_STALE'
}

export function finishSyncOperation(operation) {
  if (runtime.syncOperation === operation) runtime.syncOperation = null
}

export function activeEncryptionSecret() {
  return isSyncSpaceBound.value ? syncSpaceSettings.value.payloadKey : code.value
}

export function hasSyncAuth() {
  return Boolean(activeAuth())
}

export function showError(msg, error = null) {
  if (error) applySyncError(error)
  syncStatus.value = 'error'
  lastError.value = msg
  return false
}

export function showSuccess(message = '', { quiet = false } = {}) {
  clearSyncError()
  syncStatus.value = 'success'
  if (!quiet) lastError.value = message
  window.setTimeout(() => { if (syncStatus.value === 'success') syncStatus.value = 'idle' }, 2600)
  return true
}

export function nowText() {
  return new Date().toLocaleString()
}

// ---------- 快照 / undo / 合并辅助 ----------
export function readUndo() {
  try {
    const value = JSON.parse(localStorage.getItem(syncUndoStorageKey()))
    return value && value.version === 1 && value.values ? value : null
  } catch {
    return null
  }
}

export function saveUndo(values) {
  try {
    localStorage.setItem(syncUndoStorageKey(), JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      values,
    }))
    canUndoPull.value = true
  } catch {
    // 存储空间不足时不阻断同步；格式校验仍会保护本地结构。
  }
}

export async function storedStates(keys = SYNC_KEYS) {
  // 让同步入口以独立边界按需加载完整 store；避免直接动态导入 store/index.js 的打包警告。
  const { useStoredRef } = await import('./store/cloudAccess.js')
  return Object.fromEntries(
    keys.map((key) => [key, useStoredRef(key, cloneValue(SYNC_DEFAULTS[key]))])
  )
}

export function snapshotStates(states, keys) {
  return Object.fromEntries(keys.map((key) => [key, cloneValue(states[key]?.value)]))
}

export function currentStateValues(states) {
  return Object.fromEntries(SYNC_KEYS.map((key) => [key, states[key].value]))
}

export function metadataListFingerprint(items = []) {
  return JSON.stringify([...items].sort((left, right) => (
    `${left?.entityType || ''}:${left?.entityId || ''}:${left?.tombstoneId || left?.operationId || ''}`
      .localeCompare(`${right?.entityType || ''}:${right?.entityId || ''}:${right?.tombstoneId || right?.operationId || ''}`)
  )))
}

export function syncPayloadMatchesBaseline(payload, metadata) {
  if (!metadata?.hasBaseline) return false
  const current = buildEntityManifest(payload)
  if (JSON.stringify({ entities: current.entities, singletons: current.singletons }) !== JSON.stringify(metadata.baseline || { entities: {}, singletons: {} })) return false
  if (metadata.baselineTombstones && metadataListFingerprint(metadata.tombstones) !== metadataListFingerprint(metadata.baselineTombstones)) return false
  if (metadata.baselineRestoreMarkers && metadataListFingerprint(metadata.restoreMarkers) !== metadataListFingerprint(metadata.baselineRestoreMarkers)) return false
  return true
}

export async function commitStoredValues(values, operation = null) {
  if (operation) assertSyncOperation(operation)
  const generation = ++runtime.remoteWriteGeneration
  const entries = Object.entries(values)
  for (const [key, remoteValue] of entries) {
    // 远端值已经来自解密后的独立快照；这里只需记录写入抑制所需的
    // canonical raw，不再先深拷贝一次再由 restoreStoredValues 二次序列化。
    const nextRaw = JSON.stringify(remoteValue)
    runtime.remoteWriteValues.set(key, { raw: nextRaw, generation })
  }
  const { restoreStoredValues } = await import('./store/cloudAccess.js')
  if (operation) assertSyncOperation(operation)
  // 云端合并提交不是新的用户编辑；提交后的 dirty 状态由调用方按合并结果决定。
  await restoreStoredValues(values, { markChanged: false })
  if (operation) assertSyncOperation(operation)
  window.setTimeout(() => {
    for (const [key, marker] of runtime.remoteWriteValues) {
      if (marker.generation === generation) runtime.remoteWriteValues.delete(key)
    }
  }, 1200)
}

export function mergeTombstones(...groups) {
  const grouped = new Map()
  for (const item of groups.flat()) {
    if (!item?.entityType || item.entityId === undefined) continue
    const key = `${item.entityType}:${item.entityId}`
    const items = grouped.get(key) || []
    if (!items.some((existing) => existing.tombstoneId && existing.tombstoneId === item.tombstoneId)) items.push(item)
    grouped.set(key, items)
  }
  return [...grouped.values()].map((items) => {
    const baseHashes = new Set(items.map((item) => item.baseHash).filter(Boolean))
    const selected = items.find((item) => item.baseHash) || items[0]
    // 多个互不相同的删除因果无法靠客户端时间排序；清空 baseHash 后，
    // 任何仍存在的实体都会进入 delete-update-conflict，而不是被静默删除。
    return baseHashes.size > 1 ? { ...cloneValue(selected), baseHash: '', ambiguous: true } : cloneValue(selected)
  })
}

export function removeRestoredTombstones(tombstones, restoreMarkers) {
  const restored = new Set(restoreMarkers.map((item) => `${item.entityType}:${item.entityId}:${item.tombstoneId}`))
  return tombstones.filter((item) => !item.tombstoneId || !restored.has(`${item.entityType}:${item.entityId}:${item.tombstoneId}`))
}

export function metadataForPull(items, pullKeys) {
  const selected = new Set(pullKeys)
  return (Array.isArray(items) ? items : []).filter((item) => selected.has(syncKeyForEntityType(item?.entityType)))
}

export function conflictDisplay(conflict) {
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

export function buildPreview(merge, remote) {
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

// ---------- 本机快照与空间运行时清理 ----------
export function finishSyncSpaceBootstrap() {
  if (!syncSpaceBootstrapPending.value) return
  saveSyncSpaceSettings({ ...syncSpaceSettings.value, autoSyncEnabled: false, bootstrapPending: false })
  bootstrapHasMeaningfulLocalData.value = false
}

export async function localSyncSnapshot() {
  const { flushStoredWrites } = await import('./store/cloudAccess.js')
  flushStoredWrites()
  const states = await storedStates(SYNC_KEYS)
  return { states, values: currentStateValues(states) }
}

export function clearSyncRuntime(spaceId) {
  for (const key of [SYNC_METADATA_KEY, SYNC_HISTORY_KEY, LOCAL_TS_KEY, SYNC_DIRTY_SIGNAL_KEY, UNDO_KEY, SYNC_COMMIT_MARKER_KEY, LAST_KNOWN_GOOD_KEY]) {
    try { localStorage.removeItem(syncStorageKey(key, spaceId)) } catch {}
  }
}
