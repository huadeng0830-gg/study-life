// SyncSpace 身份、绑定与连接生命周期。
import { decryptData, encryptData } from '../utils/crypto.js'
import { deviceProfile } from './deviceIdentity.js'
import { SYNC_KEYS, cloneValue, hasMeaningfulLocalData } from './cloudSyncData.js'
import { SYNC_METADATA_KEY, readSyncMetadata } from './syncMetadata.js'
import {
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
  clearSyncSpaceSettings,
} from './syncSpace.js'
import {
  runtime,
  UNDO_KEY,
  LOCAL_TS_KEY,
  SESSION_CODE_KEY,
  SYNC_HISTORY_KEY,
  SYNC_DIRTY_SIGNAL_KEY,
  SYNC_COMMIT_MARKER_KEY,
  LAST_KNOWN_GOOD_KEY,
  syncStorageKey,
  code,
  connectionState,
  isSyncing,
  syncRecovery,
  syncRecoveryLocked,
  syncPreview,
  localChanged,
  lastLocalChangedAt,
  bootstrapHasMeaningfulLocalData,
  canUndoPull,
  lastError,
  syncStatus,
  lastSyncedAt,
  lastCheckedAt,
  remoteRevision,
  remoteUpdatedAt,
  remoteDevice,
  lastPushedDevice,
  readSyncHistory,
  saveSyncHistory,
  saveSyncBase,
  applySyncError,
  clearSyncError,
  recordCloudCheck,
  applyCloudMetadata,
  emptyMetadata,
  clearSyncRuntime,
  localSyncSnapshot,
  finishSyncSpaceBootstrap,
  recoveryError,
  beginControlOperation,
  beginSyncOperation,
  assertSyncGeneration,
  assertSyncOperation,
  isStaleSyncOperationError,
  finishSyncOperation,
  activeAuth,
  hasSyncAuth,
} from './cloudSyncState.js'
import { API, controlledFetch, responseError, requestSpaceEndpoint, makeHttpError } from './cloudSyncHttp.js'
import { VERIFY_TIMEOUT_MS, SYNC_CODE_PATTERN } from './cloudSyncState.js'
// createSyncSpace 首次绑定后立即推送本机数据。
import { pushToCloud } from './cloudSyncTransfer.js'

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
  runtime.pendingMerge = null
  canUndoPull.value = false
  connectionState.value = 'connected'
  // 记录判断所需的完整本机快照；不会写入 Base，也不会改变业务数据。
  return { values, hasMeaningfulLocalData: hasMeaningfulLocalData(values) }
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
  if (isSyncing.value || runtime.syncOperation) return { ok: false, error: '正在执行其他同步操作，请稍后再试' }
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
  if (isSyncing.value || runtime.syncOperation) return { ok: false, error: '正在执行其他同步操作，请稍后再试' }
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
  if (isSyncing.value || runtime.syncOperation) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
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
  runtime.syncGeneration += 1
  runtime.syncOperation = null
  for (const controller of runtime.activeAbortControllers) controller.abort()
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
  runtime.pendingMerge = null
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

