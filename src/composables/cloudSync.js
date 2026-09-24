// 前端云同步协议：旧访问码继续保持手动模式；新版 SyncSpace 由
// AutoSyncCoordinator 调度同一套 pull/merge/push/CAS 管线。此模块不直接改业务实体。
import { computed, ref } from 'vue'
import { decryptData, encryptData } from '../utils/crypto.js'
import { raceWithControls, throwIfAborted } from './asyncTask.js'
import { deviceProfile } from './deviceIdentity.js'
import { parseRetryAfterMs } from './syncErrors.js'
import {
  SYNC_DEFAULTS,
  SYNC_KEYS,
  assertValidSyncPayload,
  cloneValue,
  hasMeaningfulLocalData,
  normalizePullKeys,
  pickSyncValues,
  sanitizeSyncPayload,
  validateSyncPayload,
  validateLocalSyncData,
} from './cloudSyncData.js'
import {
  buildEntityManifest,
  buildSyncManifest,
  mergeRestoreMarkers,
  recordRestoreMarker,
  SYNC_METADATA_KEY,
  syncMetadataStorageKey,
  readSyncMetadata,
  removeSupersededTombstones,
  saveSyncBaseline,
  syncKeyForEntityType,
  validateSyncManifest,
  validateStableEntityIds,
} from './syncMetadata.js'
import { RETIRED_SYNC_KEYS } from './retiredData.js'
import { SYNC_DATA_SCHEMA_VERSION } from '../../sync-protocol.js'
import { mergeSyncPayload } from './syncMerge.js'
import { validateAndRepairRelations } from './syncIntegrity.js'
import {
  autoSyncEnabled,
  clearSyncSpaceSettings,
  hashSecret,
  isSyncSpaceBound,
  normalizeSyncSpaceId,
  parsePairingPayload,
  randomSecret,
  randomSyncSpaceId,
  recoveryText,
  saveSyncSpaceSettings,
  setAutoSyncEnabled,
  syncSpaceBootstrapPending,
  syncSpaceSettings,
} from './syncSpace.js'

const UNDO_KEY = 'study_life_cloud_pull_undo'
const SYNC_HISTORY_KEY = 'study_life_sync_history'
const LOCAL_TS_KEY = 'study_life_last_local_change'
const SESSION_CODE_KEY = 'study_life_sync_session_code'
export const SYNC_DIRTY_SIGNAL_KEY = 'study_life_sync_dirty_signal'
export const SYNC_COMMIT_MARKER_KEY = 'study_life_sync_commit_marker'
export const LAST_KNOWN_GOOD_KEY = 'study_life_last_known_good'
const VERIFY_TIMEOUT_MS = 15_000
const SYNC_TIMEOUT_MS = 45_000
const SYNC_CODE_PATTERN = /^\d{6}$/

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

function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readSyncCommitMarker() {
  const marker = readStoredJson(syncStorageKey(SYNC_COMMIT_MARKER_KEY))
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
const remoteWriteValues = new Map()
let remoteWriteGeneration = 0
let localChangeSequence = 0
let pendingMerge = null
let syncOperation = null
let syncGeneration = 0
const activeAbortControllers = new Set()
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

function readLocalChangedAt() {
  try { return localStorage.getItem(syncStorageKey(LOCAL_TS_KEY)) || null } catch { return null }
}
export const lastLocalChangedAt = ref(readLocalChangedAt())

function readSyncHistory() {
  try { return JSON.parse(localStorage.getItem(syncStorageKey(SYNC_HISTORY_KEY))) ?? {} } catch { return {} }
}
function saveSyncHistory() {
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

function saveSyncBase({ hasBase = true, baseRevision = remoteRevision.value, localDirty = localChanged.value } = {}) {
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

function applySyncError(error) {
  const status = Number(error?.status) || 0
  const kind = error?.syncKind || syncKindForStatus(status, error?.code)
  syncErrorKind.value = kind
  syncRetryAfterMs.value = kind === 'rate-limited' ? (Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null) : null
  if (kind === 'credential-invalid') connectionState.value = 'credential-invalid'
  if (kind === 'permission-denied') connectionState.value = 'permission-denied'
  return kind
}

function recoveryError(message, cause = null) {
  const error = new Error(message)
  if (cause) error.cause = cause
  return error
}

async function beginSyncCommit({ baseRevision = null, targetRevision = null, operation = null } = {}) {
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

function updateSyncCommitMarker(phase, patch = {}) {
  const marker = readSyncCommitMarker()
  if (!marker) throw recoveryError('同步恢复标记丢失，已停止本次同步以保护本地数据')
  const next = { ...marker, ...patch, phase }
  localStorage.setItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY), JSON.stringify(next))
  syncRecovery.value = { status: 'committing', marker: next, message: '' }
  return next
}

function finishSyncCommit() {
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

async function abortSyncCommit(error) {
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

function emptyMetadata() {
  return { exists: false, revision: null, updatedAt: null, updatedByDeviceId: null, updatedByDeviceName: null, devices: [] }
}

function applyCloudMetadata(value) {
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

function recordCloudCheck() {
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
function unpackSyncPackage(value) {
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
  if (key && remoteWriteValues.has(key)) {
    const expected = remoteWriteValues.get(key)
    remoteWriteValues.delete(key)
    // 只抑制“刚应用的远端值”本身；用户紧接着编辑出的不同值必须标记为本机修改。
    if (typeof rawValue === 'string' && rawValue === expected.raw) return
  }
  localChangeSequence += 1
  lastLocalChangedAt.value = new Date().toISOString()
  try { localStorage.setItem(syncStorageKey(LOCAL_TS_KEY), lastLocalChangedAt.value) } catch {}
  localChanged.value = true
  saveSyncBase({ localDirty: true })
  try { localStorage.setItem(syncStorageKey(SYNC_DIRTY_SIGNAL_KEY), `${Date.now()}-${localChangeSequence}`) } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('study-life:sync-dirty', { detail: { key } }))
}

const API = {
  verify: '/api/auth/verify',
  spaceVerify: '/api/sync/space/verify',
  spaceRevision: '/api/sync/space/revision',
  spaceCreate: '/api/sync/space/create',
  spaceRecover: '/api/sync/space/recover',
  pairCreate: '/api/sync/pair/create',
  pairPrepare: '/api/sync/pair/prepare',
  pairClaim: '/api/sync/pair/claim',
  deviceRevoke: '/api/sync/device/revoke',
  deviceRename: '/api/sync/device/rename',
  pull: '/api/sync/pull',
  push: '/api/sync/push',
}

function activeAuth() {
  if (isSyncSpaceBound.value) {
    return { spaceId: syncSpaceSettings.value.spaceId, deviceCredential: syncSpaceSettings.value.deviceCredential }
  }
  if (SYNC_CODE_PATTERN.test(code.value)) return { code: code.value }
  return null
}

function beginSyncOperation(operation) {
  if (syncOperation) return null
  const auth = activeAuth()
  if (!auth) return null
  syncOperation = {
    id: `sync-op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    generation: syncGeneration,
    auth: { ...auth },
    spaceId: auth.spaceId || '',
    encryptionSecret: activeEncryptionSecret(),
  }
  return syncOperation
}

// 连接/重新校准本身不携带业务 payload，但仍必须占用同一把空间级锁，
// 防止验证响应与正在进行的 Pull/Push 交叉提交到不同的身份状态。
function beginControlOperation(operation) {
  if (syncOperation) return null
  syncOperation = {
    id: `sync-control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    generation: syncGeneration,
    auth: null,
    spaceId: syncSpaceSettings.value?.spaceId || '',
  }
  return syncOperation
}

function staleSyncOperation() {
  const error = new Error('同步请求已失效，未写入当前空间')
  error.code = 'SYNC_OPERATION_STALE'
  return error
}

function assertSyncOperation(operation) {
  const current = activeAuth()
  if (
    !operation
    || syncOperation !== operation
    || operation.generation !== syncGeneration
    || JSON.stringify(current || null) !== JSON.stringify(operation.auth)
  ) throw staleSyncOperation()
}

function assertSyncGeneration(operation) {
  if (!operation || syncOperation !== operation || operation.generation !== syncGeneration) throw staleSyncOperation()
}

function isStaleSyncOperationError(error) {
  return error?.code === 'SYNC_OPERATION_STALE'
}

function finishSyncOperation(operation) {
  if (syncOperation === operation) syncOperation = null
}

function activeEncryptionSecret() {
  return isSyncSpaceBound.value ? syncSpaceSettings.value.payloadKey : code.value
}

function hasSyncAuth() {
  return Boolean(activeAuth())
}

function showError(msg, error = null) {
  if (error) applySyncError(error)
  syncStatus.value = 'error'
  lastError.value = msg
  return false
}

function showSuccess(message = '', { quiet = false } = {}) {
  clearSyncError()
  syncStatus.value = 'success'
  if (!quiet) lastError.value = message
  window.setTimeout(() => { if (syncStatus.value === 'success') syncStatus.value = 'idle' }, 2600)
  return true
}

function nowText() {
  return new Date().toLocaleString()
}

function syncKindForStatus(status, code = '') {
  if (code === 'COORDINATOR_VERSION_MISMATCH' || status === 426) return 'version-mismatch'
  if (status === 401) return 'credential-invalid'
  if (status === 403) return 'permission-denied'
  if (status === 409) return 'cas-conflict'
  if (status === 429) return 'rate-limited'
  if (status === 413) return 'payload-too-large'
  if (status >= 400 && status < 500) return 'invalid-request'
  return 'error'
}

function makeHttpError(status, message, headers = null, code = '') {
  const error = new Error(message)
  error.status = Number(status) || 0
  error.code = code || ''
  error.syncKind = syncKindForStatus(error.status, error.code)
  error.retryAfterMs = error.syncKind === 'rate-limited'
    ? parseRetryAfterMs(headers?.get?.('Retry-After') ?? headers?.['Retry-After'], Date.now())
    : null
  return error
}

async function responseError(response, fallback) {
  let message = fallback
  let code = ''
  try {
    const body = await response.json()
    message = body.error || fallback
    code = body.code || ''
  } catch {
  }
  return makeHttpError(response.status, message, response.headers, code)
}

function reportProgress(onProgress, step, message, partial = null) {
  onProgress?.({ step, message, partial })
}

async function controlledFetch(url, init = {}, { signal = null, timeoutMs = SYNC_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  activeAbortControllers.add(controller)
  try {
    return await raceWithControls(fetch(url, { ...init, signal: controller.signal }), {
      signal,
      timeoutMs,
      timeoutMessage: '云端请求超时，请检查网络后重试',
      onInterrupt: () => controller.abort(),
    })
  } finally {
    activeAbortControllers.delete(controller)
  }
}

function readUndo() {
  try {
    const value = JSON.parse(localStorage.getItem(syncUndoStorageKey()))
    return value && value.version === 1 && value.values ? value : null
  } catch {
    return null
  }
}

function saveUndo(values) {
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

function metadataListFingerprint(items = []) {
  return JSON.stringify([...items].sort((left, right) => (
    `${left?.entityType || ''}:${left?.entityId || ''}:${left?.tombstoneId || left?.operationId || ''}`
      .localeCompare(`${right?.entityType || ''}:${right?.entityId || ''}:${right?.tombstoneId || right?.operationId || ''}`)
  )))
}

function syncPayloadMatchesBaseline(payload, metadata) {
  if (!metadata?.hasBaseline) return false
  const current = buildEntityManifest(payload)
  if (JSON.stringify({ entities: current.entities, singletons: current.singletons }) !== JSON.stringify(metadata.baseline || { entities: {}, singletons: {} })) return false
  if (metadata.baselineTombstones && metadataListFingerprint(metadata.tombstones) !== metadataListFingerprint(metadata.baselineTombstones)) return false
  if (metadata.baselineRestoreMarkers && metadataListFingerprint(metadata.restoreMarkers) !== metadataListFingerprint(metadata.baselineRestoreMarkers)) return false
  return true
}

async function commitStoredValues(values, operation = null) {
  if (operation) assertSyncOperation(operation)
  const generation = ++remoteWriteGeneration
  const entries = Object.entries(values)
  for (const [key, remoteValue] of entries) {
    // 远端值已经来自解密后的独立快照；这里只需记录写入抑制所需的
    // canonical raw，不再先深拷贝一次再由 restoreStoredValues 二次序列化。
    const nextRaw = JSON.stringify(remoteValue)
    remoteWriteValues.set(key, { raw: nextRaw, generation })
  }
  const { restoreStoredValues } = await import('./store/cloudAccess.js')
  if (operation) assertSyncOperation(operation)
  // 云端合并提交不是新的用户编辑；提交后的 dirty 状态由调用方按合并结果决定。
  await restoreStoredValues(values, { markChanged: false })
  if (operation) assertSyncOperation(operation)
  window.setTimeout(() => {
    for (const [key, marker] of remoteWriteValues) {
      if (marker.generation === generation) remoteWriteValues.delete(key)
    }
  }, 1200)
}

function mergeTombstones(...groups) {
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

function removeRestoredTombstones(tombstones, restoreMarkers) {
  const restored = new Set(restoreMarkers.map((item) => `${item.entityType}:${item.entityId}:${item.tombstoneId}`))
  return tombstones.filter((item) => !item.tombstoneId || !restored.has(`${item.entityType}:${item.entityId}:${item.tombstoneId}`))
}

function metadataForPull(items, pullKeys) {
  const selected = new Set(pullKeys)
  return (Array.isArray(items) ? items : []).filter((item) => selected.has(syncKeyForEntityType(item?.entityType)))
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

async function requestSpaceEndpoint(url, body, { signal = null, timeoutMs = VERIFY_TIMEOUT_MS } = {}) {
  const res = await controlledFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { signal, timeoutMs })
  let response = {}
  try { response = await res.json() } catch {}
  if (!res.ok) throw makeHttpError(res.status, response.error || '同步空间操作失败', res.headers, response.code)
  return response
}

async function localSyncSnapshot() {
  const { flushStoredWrites } = await import('./store/cloudAccess.js')
  flushStoredWrites()
  const states = await storedStates(SYNC_KEYS)
  return { states, values: currentStateValues(states) }
}

function clearSyncRuntime(spaceId) {
  for (const key of [SYNC_METADATA_KEY, SYNC_HISTORY_KEY, LOCAL_TS_KEY, SYNC_DIRTY_SIGNAL_KEY, UNDO_KEY, SYNC_COMMIT_MARKER_KEY, LAST_KNOWN_GOOD_KEY]) {
    try { localStorage.removeItem(syncStorageKey(key, spaceId)) } catch {}
  }
}

async function stageSyncSpaceBootstrap(settings, response) {
  const { values } = await localSyncSnapshot()
  bootstrapHasMeaningfulLocalData.value = hasMeaningfulLocalData(values)
  clearSyncRuntime(settings.spaceId)
  saveSyncSpaceSettings({ ...settings, autoSyncEnabled: false, bootstrapPending: true })
  code.value = ''
  try { sessionStorage.removeItem(SESSION_CODE_KEY) } catch {}
  applySpaceMetadata(response)
  localChanged.value = false
  lastLocalChangedAt.value = null
  syncPreview.value = null
  pendingMerge = null
  canUndoPull.value = false
  connectionState.value = 'connected'
  // 记录判断所需的完整本机快照；不会写入 Base，也不会改变业务数据。
  return { values, hasMeaningfulLocalData: hasMeaningfulLocalData(values) }
}

function finishSyncSpaceBootstrap() {
  if (!syncSpaceBootstrapPending.value) return
  saveSyncSpaceSettings({ ...syncSpaceSettings.value, autoSyncEnabled: false, bootstrapPending: false })
  bootstrapHasMeaningfulLocalData.value = false
}

async function bindLocalSyncSpace(settings, { localDirty = false } = {}) {
  if (syncRecoveryLocked.value) throw recoveryError('同步已暂停，请先完成本机恢复')
  const { values } = await localSyncSnapshot()
  // 更换同步空间时丢弃的只是该空间的本地同步基线，不是业务数据。
  // 绑定身份成功不等于远端已经确认业务数据；此处只能清空旧运行时状态，
  // 绝不能把当前 Local 写成 Base。Base 必须由首次 Push/Pull 确认后建立。
  localStorage.removeItem(syncStorageKey(SYNC_METADATA_KEY))
  localStorage.removeItem(syncStorageKey(SYNC_HISTORY_KEY))
  localStorage.removeItem(syncStorageKey(LOCAL_TS_KEY))
  // 清掉尚未命名空间化的旧版 singleton，避免它在任何兼容路径中被误读。
  try {
    localStorage.removeItem(SYNC_METADATA_KEY)
    localStorage.removeItem(SYNC_HISTORY_KEY)
    localStorage.removeItem(LOCAL_TS_KEY)
  } catch {}
  localChanged.value = localDirty
  lastLocalChangedAt.value = localDirty ? new Date().toISOString() : null
  if (localDirty) localStorage.setItem(syncStorageKey(LOCAL_TS_KEY), lastLocalChangedAt.value)
  // 保持 hasBase=false，直到服务端确认了首个共同版本。
  saveSyncHistory()
  return values
}

function applySpaceMetadata(response) {
  const metadata = applyCloudMetadata(response)
  return { ...response, ...metadata }
}

// ---------- 新版 SyncSpace 身份与绑定 ----------
export async function connectSyncSpace({ spaceId, deviceCredential, payloadKey, autoSync = false, persist = true, signal = null } = {}) {
  const normalizedSpaceId = normalizeSyncSpaceId(spaceId)
  if (!normalizedSpaceId || !deviceCredential || !payloadKey) return { ok: false, error: '同步空间绑定信息不完整' }
  if (isSyncing.value || syncOperation) return { ok: false, error: '正在执行其他同步操作，请稍后再试' }
  const operation = beginControlOperation('reconnect')
  if (!operation) return { ok: false, error: '正在执行其他同步操作，请稍后再试' }
  connectionState.value = 'validating'
  lastError.value = ''
  try {
    assertSyncGeneration(operation)
    const response = await requestSpaceEndpoint(API.spaceVerify, { spaceId: normalizedSpaceId, deviceCredential }, { signal })
    assertSyncGeneration(operation)
    if (persist) saveSyncSpaceSettings({ spaceId: normalizedSpaceId, deviceCredential, payloadKey, autoSyncEnabled: autoSync })
    applySpaceMetadata(response)
    code.value = ''
    connectionState.value = 'connected'
    localChanged.value = readSyncHistory().localDirty === true
    return { ok: true, ...response }
  } catch (error) {
    if (isStaleSyncOperationError(error)) return { ok: false, stale: true, error: error.message }
    connectionState.value = 'disconnected'
    return { ok: false, error: error instanceof Error ? error.message : '同步空间验证失败' }
  } finally {
    finishSyncOperation(operation)
  }
}

// 旧版本可能在远端确认前写入了错误 Base。此操作只重新获取远端 metadata、
// 清除该空间的本地运行时基线并回到 bootstrap-pending；业务数据始终留在本机，
// 后续仍必须经过 Initial Reconciliation 和用户确认。
export async function recalibrateSyncSpace({ signal = null } = {}) {
  if (!isSyncSpaceBound.value) return { ok: false, error: '尚未绑定同步空间' }
  if (isSyncing.value || syncOperation) return { ok: false, error: '正在执行其他同步操作，请稍后再试' }
  const operation = beginControlOperation('recalibrate')
  if (!operation) return { ok: false, error: '正在执行其他同步操作，请稍后再试' }
  const settings = { ...syncSpaceSettings.value, autoSyncEnabled: false, bootstrapPending: false }
  connectionState.value = 'validating'
  lastError.value = ''
  try {
    assertSyncGeneration(operation)
    const response = await requestSpaceEndpoint(API.spaceVerify, {
      spaceId: settings.spaceId,
      deviceCredential: settings.deviceCredential,
    }, { signal })
    assertSyncGeneration(operation)
    await stageSyncSpaceBootstrap(settings, response)
    return { ok: true, ...response }
  } catch (error) {
    if (isStaleSyncOperationError(error)) return { ok: false, stale: true, error: error.message }
    connectionState.value = 'connected'
    applySyncError(error)
    lastError.value = error instanceof Error ? error.message : '重新校准失败'
    return { ok: false, error: lastError.value }
  } finally {
    finishSyncOperation(operation)
  }
}

export async function createSyncSpace({ deviceName = deviceProfile.value.name, signal = null, allowLegacy = false } = {}) {
  if (isSyncSpaceBound.value || (hasSyncAuth() && !allowLegacy)) return { ok: false, error: '当前设备已经连接同步空间，请先退出后再创建' }
  try {
    const spaceId = randomSyncSpaceId()
    const payloadKey = randomSecret(32)
    const deviceCredential = randomSecret(32)
    const response = await requestSpaceEndpoint(API.spaceCreate, {
      spaceId,
      recoveryVerifier: await hashSecret(payloadKey),
      credentialVerifier: await hashSecret(deviceCredential),
      deviceId: deviceProfile.value.id,
      deviceName: String(deviceName || deviceProfile.value.name).trim().slice(0, 30),
      platform: deviceProfile.value.platform,
    }, { signal })
    await saveSyncSpaceSettings({ spaceId, deviceCredential, payloadKey, autoSyncEnabled: false })
    code.value = ''
    try { sessionStorage.removeItem(SESSION_CODE_KEY) } catch {}
    await bindLocalSyncSpace(syncSpaceSettings.value, { localDirty: true })
    applySpaceMetadata(response)
    connectionState.value = 'connected'
    const pushed = await pushToCloud({ signal, quiet: true })
    if (!pushed) return { ok: false, error: lastError.value || '同步空间创建成功，但初始数据上传失败；可稍后重试' }
    setAutoSyncEnabled(true)
    return { ok: true, spaceId, recovery: recoveryText(), ...response }
  } catch (error) {
    connectionState.value = 'disconnected'
    return { ok: false, error: error instanceof Error ? error.message : '无法创建同步空间' }
  }
}

export async function upgradeLegacySyncSpace({ deviceName = deviceProfile.value.name, signal = null } = {}) {
  if (isSyncSpaceBound.value || !SYNC_CODE_PATTERN.test(code.value) || connectionState.value !== 'connected') {
    return { ok: false, error: '请先连接有效的旧版访问码' }
  }
  return createSyncSpace({ deviceName, signal, allowLegacy: true })
}

export async function joinSyncSpaceWithRecovery({ spaceId, recoverySecret, deviceName = deviceProfile.value.name, signal = null } = {}) {
  const normalizedSpaceId = normalizeSyncSpaceId(spaceId)
  if (!normalizedSpaceId || typeof recoverySecret !== 'string' || recoverySecret.length < 32) return { ok: false, error: '请输入有效的同步空间和恢复密钥' }
  if (isSyncSpaceBound.value) return { ok: false, error: '当前设备已经连接同步空间，请先退出后再加入' }
  const deviceCredential = randomSecret(32)
  try {
    const response = await requestSpaceEndpoint(API.spaceRecover, {
      spaceId: normalizedSpaceId,
      recoverySecret,
      credentialVerifier: await hashSecret(deviceCredential),
      deviceId: deviceProfile.value.id,
      deviceName: String(deviceName || deviceProfile.value.name).trim().slice(0, 30),
      platform: deviceProfile.value.platform,
    }, { signal })
    await stageSyncSpaceBootstrap({ spaceId: normalizedSpaceId, deviceCredential, payloadKey: recoverySecret }, response)
    return { ok: true, spaceId: normalizedSpaceId, ...response }
  } catch (error) {
    connectionState.value = 'disconnected'
    return { ok: false, error: error instanceof Error ? error.message : '加入同步空间失败' }
  }
}

export async function createPairingCode({ signal = null } = {}) {
  // 本地绑定材料就是配对 API 的身份凭据；connectionState 可能仍在启动校验中，
  // 不能把这个瞬时 UI 状态当成“添加设备”的前置条件。
  if (!isSyncSpaceBound.value) return { ok: false, error: '请先连接同步空间' }
  try {
    const response = await requestSpaceEndpoint(API.pairCreate, { ...activeAuth() }, { signal })
    if (typeof response?.pairingToken !== 'string' || response.pairingToken.length < 32 || !response.expiresAt) {
      throw new Error('配对服务返回的信息不完整，请稍后重试')
    }
    const wrappedPayloadKey = await encryptData({ payloadKey: syncSpaceSettings.value.payloadKey }, response.pairingToken)
    await requestSpaceEndpoint(API.pairPrepare, { ...activeAuth(), pairingToken: response.pairingToken, wrappedPayloadKey }, { signal })
    return { ok: true, pairing: { format: 'study-life-sync-pairing', version: 1, spaceId: response.spaceId || syncSpaceSettings.value.spaceId, pairingToken: response.pairingToken, expiresAt: response.expiresAt } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '无法生成绑定二维码' }
  }
}

export async function claimPairingCode(value, { deviceName = deviceProfile.value.name, signal = null } = {}) {
  if (isSyncSpaceBound.value) return { ok: false, error: '当前设备已经连接同步空间，请先退出后再加入' }
  let pairing
  try { pairing = parsePairingPayload(value) } catch (error) { return { ok: false, error: error.message } }
  const deviceCredential = randomSecret(32)
  try {
    const response = await requestSpaceEndpoint(API.pairClaim, {
      spaceId: pairing.spaceId,
      pairingToken: pairing.pairingToken,
      credentialVerifier: await hashSecret(deviceCredential),
      deviceId: deviceProfile.value.id,
      deviceName: String(deviceName || deviceProfile.value.name).trim().slice(0, 30),
      platform: deviceProfile.value.platform,
    }, { signal })
    const wrapper = await decryptData(response.wrappedPayloadKey, pairing.pairingToken)
    if (typeof wrapper?.payloadKey !== 'string' || wrapper.payloadKey.length < 32) throw new Error('绑定信息已损坏，请重新生成二维码')
    await stageSyncSpaceBootstrap({ spaceId: pairing.spaceId, deviceCredential, payloadKey: wrapper.payloadKey }, response)
    return { ok: true, spaceId: pairing.spaceId, ...response }
  } catch (error) {
    connectionState.value = 'disconnected'
    return { ok: false, error: error instanceof Error ? error.message : '绑定同步空间失败' }
  }
}

export async function revokeSyncDevice(deviceId, { signal = null } = {}) {
  if (!isSyncSpaceBound.value || connectionState.value !== 'connected') return { ok: false, error: '请先连接同步空间' }
  try {
    const response = await requestSpaceEndpoint(API.deviceRevoke, { ...activeAuth(), deviceId }, { signal })
    applySpaceMetadata(response)
    return { ok: true, ...response }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '移除设备失败' }
  }
}

export async function renameSyncDevice(deviceName, { signal = null } = {}) {
  if (!isSyncSpaceBound.value || connectionState.value !== 'connected') return { ok: false, error: '请先连接同步空间' }
  try {
    const response = await requestSpaceEndpoint(API.deviceRename, { ...activeAuth(), deviceName }, { signal })
    applySpaceMetadata(response)
    return { ok: true, ...response }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '保存设备名称失败' }
  }
}

export function enableAutoSync(enabled = true) {
  return setAutoSyncEnabled(enabled)
}

// ---------- 连接：仅验证访问码 + 读取云端元数据（不下载业务数据） ----------
export async function connectCloud(codeInput, { signal = null } = {}) {
  if (isSyncing.value || syncOperation) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
  if (!SYNC_CODE_PATTERN.test(String(codeInput ?? ''))) {
    connectionState.value = 'disconnected'
    return { ok: false, error: '请输入 6 位数字访问码' }
  }
  const operation = beginControlOperation('connect')
  if (!operation) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
  connectionState.value = 'validating'
  lastError.value = ''
  try {
    assertSyncGeneration(operation)
    const res = await controlledFetch(API.verify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput }),
    }, { signal, timeoutMs: VERIFY_TIMEOUT_MS })
    if (!res.ok) throw await responseError(res, '访问码验证失败')
    const response = await res.json()
    assertSyncGeneration(operation)
    const metadata = applyCloudMetadata(response)
    // 仅在验证通过后记住当前空间，不触发任何数据下载或上传。
    code.value = codeInput
    try { sessionStorage.setItem(SESSION_CODE_KEY, codeInput) } catch {}
    // 恢复上次已确认的本地基线；连接本身绝不改变业务数据或“本机已修改”标记。
    localChanged.value = readSyncHistory().localDirty === true
    recordCloudCheck()
    clearSyncError()
    connectionState.value = 'connected'
    return {
      ok: true,
      ...metadata,
    }
  } catch (error) {
    if (isStaleSyncOperationError(error)) return { ok: false, stale: true, error: error.message }
    connectionState.value = 'disconnected'
    code.value = ''
    return { ok: false, error: error instanceof Error ? error.message : '访问码验证失败' }
  } finally {
    finishSyncOperation(operation)
  }
}

// 已连接后只刷新 revision、更新时间与来源设备，不拉取或上传业务数据。
export async function refreshCloudMetadata({ signal = null } = {}) {
  if (isSyncing.value) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
  if (syncRecoveryLocked.value) return { ok: false, error: syncRecovery.value.message || '同步已暂停，请先完成本机恢复' }
  const auth = activeAuth()
  if (!auth) return { ok: false, error: '尚未连接同步空间，请先完成绑定' }
  const operation = beginSyncOperation('revision')
  if (!operation) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
  lastError.value = ''
  try {
    assertSyncOperation(operation)
    if (isSyncSpaceBound.value) {
      const response = await requestSpaceEndpoint(API.spaceRevision, operation.auth, { signal })
      assertSyncOperation(operation)
      const metadata = applySpaceMetadata(response)
      recordCloudCheck()
      clearSyncError()
      return { ok: true, ...metadata }
    }
    const res = await controlledFetch(API.verify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation.auth),
    }, { signal, timeoutMs: VERIFY_TIMEOUT_MS })
    if (!res.ok) throw await responseError(res, '无法刷新云端状态')
    const response = await res.json()
    assertSyncOperation(operation)
    const metadata = applyCloudMetadata(response)
    recordCloudCheck()
    clearSyncError()
    return { ok: true, ...metadata }
  } catch (error) {
    if (isStaleSyncOperationError(error)) return { ok: false, stale: true, error: error.message }
    const message = error instanceof Error ? error.message : '无法刷新云端状态'
    applySyncError(error)
    lastError.value = message
    return { ok: false, error: message }
  } finally {
    finishSyncOperation(operation)
  }
}

// 生命周期结束或空间切换时取消正在等待的网络操作。generation 让无法及时
// 取消的 Promise 在返回后也只能被丢弃，绝不把旧空间结果提交到当前状态。
export function cancelSyncOperations() {
  syncGeneration += 1
  syncOperation = null
  for (const controller of activeAbortControllers) controller.abort()
}

export function disconnectCloud() {
  // 只断开同步空间，不删除本地任何数据。
  cancelSyncOperations()
  code.value = ''
  try { sessionStorage.removeItem(SESSION_CODE_KEY) } catch {}
  if (isSyncSpaceBound.value) {
    const disconnectedSpaceId = syncSpaceSettings.value?.spaceId
    clearSyncSpaceSettings()
    try {
      localStorage.removeItem(syncStorageKey(SYNC_METADATA_KEY, disconnectedSpaceId))
      localStorage.removeItem(syncStorageKey(SYNC_HISTORY_KEY, disconnectedSpaceId))
      localStorage.removeItem(syncStorageKey(LOCAL_TS_KEY, disconnectedSpaceId))
      localStorage.removeItem(syncStorageKey(UNDO_KEY, disconnectedSpaceId))
      localStorage.removeItem(syncStorageKey(SYNC_COMMIT_MARKER_KEY, disconnectedSpaceId))
      localStorage.removeItem(syncStorageKey(LAST_KNOWN_GOOD_KEY, disconnectedSpaceId))
    } catch {}
  }
  applyCloudMetadata(emptyMetadata())
  localChanged.value = false
  bootstrapHasMeaningfulLocalData.value = false
  lastLocalChangedAt.value = null
  lastSyncedAt.value = null
  lastCheckedAt.value = null
  remoteRevision.value = null
  remoteUpdatedAt.value = null
  remoteDevice.value = null
  lastPushedDevice.value = null
  canUndoPull.value = false
  syncPreview.value = null
  pendingMerge = null
  syncStatus.value = 'idle'
  syncRecovery.value = { status: 'idle', marker: null, message: '' }
  lastError.value = ''
  connectionState.value = 'disconnected'
}

export function cancelSyncSpaceBootstrap() {
  if (!syncSpaceBootstrapPending.value) return false
  disconnectCloud()
  return true
}

// ---------- 拉取：由立即同步、自动协调器或高级手动入口调用 ----------
// keys：本次要拉取的 sl_* 键子集；null/undefined 保持全量向后兼容。
export async function pullFromCloud({ signal = null, onProgress = null, keys = null, previewOnly = false, quiet = false, bootstrapConfirm = false } = {}) {
  if (isSyncing.value) return false
  if (!hasSyncAuth()) return showError('尚未连接同步空间，请先完成绑定')
  if (syncRecoveryLocked.value) return showError(syncRecovery.value.message || '同步已暂停，请先完成本地恢复')
  if (syncSpaceBootstrapPending.value && !previewOnly && !bootstrapConfirm) return showError('请先完成加入预览确认')
  if (syncCalibrationRequired.value) return showError('检测到旧版不可靠同步基线，请先在“高级同步与恢复”中重新校准此设备')
  const pullKeys = normalizePullKeys(keys)
  if (!pullKeys.length) return showSuccess('未选择要拉取的数据模块，本地数据未发生变化', { quiet })
  const operation = beginSyncOperation('pull')
  if (!operation) return false
  syncStatus.value = 'pulling'
  lastError.value = ''
  let commitStarted = false

  try {
    assertSyncOperation(operation)
    reportProgress(onProgress, 'request', '正在请求云端版本')
    const res = await controlledFetch(API.pull, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation.auth),
    }, { signal })
    if (!res.ok) throw await responseError(res, '拉取失败')
    const response = await res.json()
    assertSyncOperation(operation)
    const { data } = response

    if (!data) {
      applyCloudMetadata({ ...response, exists: response.exists ?? Boolean(data) })
      recordCloudCheck()
      return showSuccess('云端暂无数据，本地数据未发生变化', { quiet })
    }

    throwIfAborted(signal)
    reportProgress(onProgress, 'decrypt', '云端数据已收到，正在本机解密')
    const remote = unpackSyncPackage(await decryptData(data, operation.encryptionSecret))
    assertSyncOperation(operation)
    const metadata = applyCloudMetadata({ ...response, exists: response.exists ?? Boolean(data) })
    recordCloudCheck()
    throwIfAborted(signal)
    reportProgress(onProgress, 'validate', '正在校验数据结构与兼容性')
    let manifestNotice = ''
    if (remote.manifest) {
      const manifestIssues = validateSyncManifest(remote.values, remote.manifest)
      // 结构损坏与稳定 ID 问题仍然 fail closed。旧版客户端写入的完整性标记
      // （分类集合与指纹算法都已变化）只提示不阻断：否则退休某个同步键就会让
      // 整个同步空间永久卡死，既拉不下来也覆盖不上去。
      if (manifestIssues.some((issue) => issue.fatal)) throw new Error('云端 manifest 与数据内容不一致，本地数据未发生变化')
      if (manifestIssues.length) manifestNotice = '云端完整性标记来自旧版本客户端，已按数据内容继续合并'
    }
    // 只对选中键做解密后校验，未勾选模块的云端值直接忽略、本地保持原样。
    const { values: validated, invalidKeys } = sanitizeSyncPayload(pickSyncValues(remote.values, pullKeys))
    if (!Object.keys(validated).length && invalidKeys.length) {
      throw new Error('云端数据全部为旧版异常格式，本地数据未发生变化')
    }
    assertSyncOperation(operation)
    throwIfAborted(signal)
    const states = await storedStates(SYNC_KEYS)
    assertSyncOperation(operation)
    const localValues = currentStateValues(states)
    const localMetadata = readSyncMetadata()
    const remoteTombstones = metadataForPull(remote.manifest?.tombstones, pullKeys)
    const remoteRestoreMarkers = metadataForPull(remote.manifest?.restoreMarkers, pullKeys)
    const merge = mergeSyncPayload({
      baseManifest: localMetadata.hasBaseline ? localMetadata.baseline : null,
      localValues,
      remoteValues: validated,
      localTombstones: localMetadata.tombstones,
      remoteTombstones,
      remoteRestoreMarkers,
      keys: Object.keys(validated),
      // 旧版包只在非 Bootstrap 的旧访问码兼容路径保留 remote-wins；
      // 首次加入没有可信 Base，哪怕没有 manifest 也必须走 Initial Reconciliation。
      legacy: !remote.manifest && !localMetadata.hasBaseline && !syncSpaceBootstrapPending.value,
    })
    syncPreview.value = buildPreview(merge, remote)
    const structuralConflicts = merge.conflicts.filter((conflict) => ['local-entity-id-invalid', 'remote-entity-id-invalid'].includes(conflict.reason))
    if (structuralConflicts.length) {
      syncPreview.value = { ...syncPreview.value, conflicts: [] }
      return showError('发现缺少稳定 ID 的同步记录，本次未应用；请先修复数据后重试')
    }
    if (merge.conflicts.length) {
      pendingMerge = { merge, localValues, remoteValues: validated, pullKeys: Object.keys(validated), remoteTombstones, remoteRestoreMarkers, localTombstones: localMetadata.tombstones, localChanged: localChanged.value, metadata }
      return showError(`发现 ${merge.conflicts.length} 个需要确认的同步冲突`)
    }
    if (previewOnly) {
      pendingMerge = { merge, localValues, remoteValues: validated, pullKeys: Object.keys(validated), remoteTombstones, remoteRestoreMarkers, localTombstones: localMetadata.tombstones, localChanged: localChanged.value, metadata }
      return showSuccess('已生成同步预览，本地数据未发生变化')
    }
    // 先创建本机安全快照，再以 store 的可回滚事务提交合并结果。
    reportProgress(onProgress, 'apply', '已创建拉取前快照，正在应用可用数据', { 数据模块: Object.keys(validated).length, 冲突: merge.conflicts.length, 修复关系: merge.summary.repairedRelations })
    await beginSyncCommit({ baseRevision: localMetadata.baseRemoteRevision, targetRevision: metadata.revision, operation })
    commitStarted = true
    saveUndo(snapshotStates(states, pullKeys))
    updateSyncCommitMarker('writing-business')
    await commitStoredValues(pickSyncValues(merge.values, pullKeys), operation)
    assertSyncOperation(operation)
    pendingMerge = null
    const restoreMarkers = mergeRestoreMarkers(localMetadata.restoreMarkers, remoteRestoreMarkers)
    const tombstones = removeRestoredTombstones(removeSupersededTombstones(
      merge.values,
      mergeTombstones(localMetadata.tombstones, remoteTombstones)
    ), restoreMarkers)
    const baselineValues = { ...localValues, ...merge.values }
    updateSyncCommitMarker('writing-metadata')
    saveSyncBaseline(baselineValues, { remoteRevision: metadata.revision, tombstones, restoreMarkers })

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
    finishSyncSpaceBootstrap()
    const pulledText = invalidKeys.length
      ? `已合并可用数据，并跳过 ${invalidKeys.length} 项旧版异常设置 · ${nowText()}`
      : `已从云端拉取 ${nowText()}，可撤销本次拉取`
    return showSuccess(manifestNotice ? `${pulledText} · ${manifestNotice}` : pulledText, { quiet })
  } catch (error) {
    if (isStaleSyncOperationError(error)) return false
    if (error?.name === 'AbortError') {
      if (commitStarted) await abortSyncCommit(error)
      syncStatus.value = 'idle'
      lastError.value = ''
      return false
    }
    if (commitStarted) await abortSyncCommit(error)
    return showError(syncRecovery.value.status === 'recovery-required'
      ? syncRecovery.value.message
      : error instanceof Error ? `${error.message}（本地数据未发生变化）` : `拉取失败 ${nowText()}，本地数据未发生变化`, error)
  } finally {
    finishSyncOperation(operation)
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
  const operation = beginSyncOperation('resolve')
  if (!operation) return false
  syncStatus.value = 'restoring'
  let commitStarted = false
  try {
    assertSyncOperation(operation)
    const merge = { ...pendingMerge.merge, values: cloneValue(pendingMerge.merge.values) }
    const restoredTombstones = new Set()
    const restoreTargets = []
    for (const conflict of merge.conflicts) {
      const decision = decisions[`${conflict.key}:${conflict.entityId || conflict.key}`] || decisions[conflict.key]
      if (!conflict.entityType) {
        if (decision === 'remote') merge.values[conflict.key] = cloneValue(conflict.remote)
        else if (decision === 'local') merge.values[conflict.key] = cloneValue(conflict.local)
        continue
      }
      const list = Array.isArray(merge.values[conflict.key]) ? merge.values[conflict.key] : []
      const id = String(conflict.entityId)
      const chosen = decision === 'remote' || decision === 'restore-remote'
        ? conflict.remote
        : decision === 'local' || decision === 'restore-local'
          ? conflict.local
          : undefined
      const filtered = conflict.reason === 'same-bill-period-different-fact'
        ? list.filter((item) => `${item?.billId || ''}:${item?.billingPeriodKey || ''}` !== id)
        : list.filter((item) => String(item?.id || '') !== id)
      if (chosen !== undefined) filtered.push(cloneValue(chosen))
      merge.values[conflict.key] = filtered
      if (decision === 'local' || decision === 'remote' || decision === 'restore-local' || decision === 'restore-remote') restoredTombstones.add(`${conflict.entityType}:${id}`)
      if (conflict.status === 'delete-update-conflict' && (decision === 'restore-local' || decision === 'restore-remote')) {
        const tombstones = decision === 'restore-local' ? pendingMerge.remoteTombstones : pendingMerge.localTombstones
        const target = tombstones.find((item) => item.entityType === conflict.entityType && String(item.entityId) === id)
        if (target?.tombstoneId) restoreTargets.push({ conflict, tombstone: target })
      }
    }
    const repaired = validateAndRepairRelations(merge.values)
    const invalidIds = validateStableEntityIds(repaired.values)
    if (invalidIds.length) throw new Error('冲突决策产生了缺少稳定 ID 的同步记录')
    merge.values = repaired.values
    const states = await storedStates(SYNC_KEYS)
    const commitMarker = await beginSyncCommit({ baseRevision: pendingMerge.metadata.revision, targetRevision: pendingMerge.metadata.revision, operation })
    commitStarted = true
    saveUndo(snapshotStates(states, pendingMerge.pullKeys))
    updateSyncCommitMarker('writing-business')
    await commitStoredValues(pickSyncValues(merge.values, pendingMerge.pullKeys), operation)
    assertSyncOperation(operation)
    const tombstones = mergeTombstones(pendingMerge.localTombstones, pendingMerge.remoteTombstones).filter((item) => !restoredTombstones.has(`${item.entityType}:${item.entityId}`))
    for (const { conflict, tombstone } of restoreTargets) {
      recordRestoreMarker(conflict.entityType, conflict.entityId, tombstone, {
        operationId: `${commitMarker.operationId}:${conflict.entityType}:${conflict.entityId}`,
      })
    }
    const restoreMarkers = mergeRestoreMarkers(readSyncMetadata().restoreMarkers, pendingMerge.remoteRestoreMarkers || [])
    // Base 必须记录“冲突选择后的最终值”，否则选择保留本机时下一次同步会把
    // 远端旧值误当成 Base，导致同一冲突再次出现。
    const baselineValues = { ...pendingMerge.localValues, ...pendingMerge.remoteValues, ...merge.values }
    updateSyncCommitMarker('writing-metadata')
    saveSyncBaseline(baselineValues, { remoteRevision: pendingMerge.metadata.revision, tombstones, restoreMarkers })
    lastSyncedAt.value = new Date().toISOString()
    const keptLocalValue = pendingMerge.localChanged || Object.values(decisions).some((decision) => ['local', 'restore-local'].includes(decision))
    localChanged.value = keptLocalValue
    updateSyncCommitMarker('updating-base')
    saveSyncBase({ hasBase: true, baseRevision: pendingMerge.metadata.revision, localDirty: keptLocalValue })
    saveSyncHistory()
    finishSyncCommit()
    finishSyncSpaceBootstrap()
    pendingMerge = null
    syncPreview.value = { ...syncPreview.value, conflicts: [], resolved: true }
    return showSuccess(`已按你的选择完成冲突合并 · ${nowText()}`)
  } catch (error) {
    if (isStaleSyncOperationError(error)) return false
    if (commitStarted) await abortSyncCommit(error)
    return showError(syncRecovery.value.status === 'recovery-required'
      ? syncRecovery.value.message
      : error instanceof Error ? `${error.message}（本地数据未发生变化）` : '冲突提交失败（本地数据未发生变化）')
  } finally {
    finishSyncOperation(operation)
  }
}

// ---------- 推送：由立即同步、自动协调器或高级手动入口调用 ----------
export async function pushToCloud({ signal = null, onProgress = null, quiet = false, bootstrapConfirm = false } = {}) {
  if (isSyncing.value) return false
  if (!hasSyncAuth()) return showError('尚未连接同步空间，请先完成绑定')
  if (syncRecoveryLocked.value) return showError(syncRecovery.value.message || '同步已暂停，请先完成本地恢复')
  if (syncSpaceBootstrapPending.value && !bootstrapConfirm) return showError('请先完成加入预览确认')
  if (syncCalibrationRequired.value) return showError('检测到旧版不可靠同步基线，请先在“高级同步与恢复”中重新校准此设备')
  // 已建立基线且本机没有新修改时，重复点击不应制造空 revision；
  // 若云端已有新版本，仍交给用户先拉取/预览，而不是用旧快照覆盖它。
  if (cloudExists.value && remoteRevision.value !== null && readSyncHistory().hasBase && !localChanged.value) {
    return showSuccess('没有需要推送的更改')
  }
  const operation = beginSyncOperation('push')
  if (!operation) return false

  syncStatus.value = 'pushing'
  lastError.value = ''
  let commitStarted = false

  try {
    assertSyncOperation(operation)
    reportProgress(onProgress, 'collect', '正在收集本机可同步数据')
    const { flushStoredWrites, useStoredRef } = await import('./store/cloudAccess.js')
    flushStoredWrites()
    const states = Object.fromEntries(
      SYNC_KEYS.map((key) => [key, useStoredRef(key, cloneValue(SYNC_DEFAULTS[key]))])
    )
    const payload = currentStateValues(states)
    assertSyncOperation(operation)
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
      platform: deviceProfile.value.platform,
      pushedAt: new Date().toISOString(),
    }
    const syncMetadata = readSyncMetadata()
    if (cloudExists.value && remoteRevision.value !== null && syncPayloadMatchesBaseline(payload, syncMetadata)) {
      localChanged.value = false
      saveSyncBase({ hasBase: true, baseRevision: remoteRevision.value, localDirty: false })
      saveSyncHistory()
      return showSuccess('没有需要推送的更改', { quiet })
    }
    const manifest = buildSyncManifest(payload, { tombstones: syncMetadata.tombstones, deviceId: meta.id, schemaVersion: SYNC_DATA_SCHEMA_VERSION })
    await beginSyncCommit({ baseRevision: readSyncHistory().baseRevision ?? null, targetRevision: null, operation })
    commitStarted = true
    // 新版使用带 manifest 的 envelope；旧版客户端仍可读取其中的 values。
    throwIfAborted(signal)
    reportProgress(onProgress, 'encrypt', '正在本机加密同步数据', { 数据模块: Object.keys(payload).length })
    const encrypted = await encryptData({ format: 'study-life-sync', version: 3, values: payload, manifest, meta }, operation.encryptionSecret)
    assertSyncOperation(operation)
    throwIfAborted(signal)

    reportProgress(onProgress, 'upload', '加密完成，正在上传云端')
    const res = await controlledFetch(API.push, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...operation.auth,
        data: encrypted,
        expectedRevision: knownRevision,
        deviceId: meta.id,
        deviceName: meta.name,
        clientDataSchemaVersion: SYNC_DATA_SCHEMA_VERSION,
      }),
    }, { signal })

    const response = await res.json()
    assertSyncOperation(operation)
    if (!res.ok) {
      if (response.conflict) applyCloudMetadata(response)
      throw makeHttpError(res.status, response.error || '推送失败', res.headers, response.code)
    }
    reportProgress(onProgress, 'confirm', '云端已确认接收新版本')
    const metadata = applyCloudMetadata({ ...response, exists: true })
    recordCloudCheck()
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
    finishSyncSpaceBootstrap()
    return showSuccess(`已推送到云端 ${nowText()}`, { quiet })
  } catch (error) {
    if (isStaleSyncOperationError(error)) return false
    if (error?.name === 'AbortError') {
      if (commitStarted) await abortSyncCommit(error)
      syncStatus.value = 'idle'
      lastError.value = ''
      return false
    }
    if (commitStarted) await abortSyncCommit(error)
    return showError(syncRecovery.value.status === 'recovery-required'
      ? syncRecovery.value.message
      : error instanceof Error ? `${error.message}（云端数据未发生变化）` : `推送失败 ${nowText()}，云端数据未发生变化`, error)
  } finally {
    finishSyncOperation(operation)
  }
}

export async function undoLastPull() {
  if (isSyncing.value) return false
  if (syncRecoveryLocked.value) return showError(syncRecovery.value.message || '同步已暂停，请先完成本地恢复')
  const undo = readUndo()
  if (!undo) return showError('暂无可撤销的拉取记录')
  const operation = beginSyncOperation('undo')
  if (!operation) return false
  syncStatus.value = 'restoring'
  let commitStarted = false
  try {
    assertSyncOperation(operation)
    const values = validateSyncPayload(undo.values)
    await beginSyncCommit({ baseRevision: readSyncHistory().baseRevision ?? null, targetRevision: readSyncHistory().baseRevision ?? null, operation })
    commitStarted = true
    updateSyncCommitMarker('writing-business')
    await commitStoredValues(values, operation)
    assertSyncOperation(operation)
    updateSyncCommitMarker('writing-metadata')
    localStorage.removeItem(syncUndoStorageKey())
    canUndoPull.value = false
    localChanged.value = true
    updateSyncCommitMarker('updating-base')
    saveSyncBase({ hasBase: true, baseRevision: readSyncHistory().baseRevision ?? null, localDirty: true })
    saveSyncHistory()
    finishSyncCommit()
    return showSuccess(`已恢复到拉取前的本机数据 · ${nowText()}`)
  } catch (error) {
    if (isStaleSyncOperationError(error)) return false
    if (commitStarted) await abortSyncCommit(error)
    return showError(error instanceof Error ? error.message : '撤销失败')
  } finally {
    finishSyncOperation(operation)
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
    syncErrorKind,
    syncRetryAfterMs,
    lastCheckedAt,
    lastSyncedAt,
    syncCalibrationRequired,
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
    syncSpaceSettings,
    isSyncSpaceBound,
    autoSyncEnabled,
    connectSyncSpace,
    recalibrateSyncSpace,
    createSyncSpace,
    upgradeLegacySyncSpace,
    joinSyncSpaceWithRecovery,
    createPairingCode,
    claimPairingCode,
    revokeSyncDevice,
    renameSyncDevice,
    enableAutoSync,
  }
}

export { validateLocalSyncData }
