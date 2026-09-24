// 拉取 / 冲突合并 / 推送 / 撤销。
import { decryptData, encryptData } from '../utils/crypto.js'
import { throwIfAborted } from './asyncTask.js'
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
  mergeRestoreMarkers,
  recordRestoreMarker,
  readSyncMetadata,
  removeSupersededTombstones,
  saveSyncBaseline,
  validateSyncManifest,
  validateStableEntityIds,
} from './syncMetadata.js'
import { SYNC_DATA_SCHEMA_VERSION } from '../../sync-protocol.js'
import { mergeSyncPayload } from './syncMerge.js'
import { validateAndRepairRelations } from './syncIntegrity.js'
import { syncSpaceBootstrapPending } from './syncSpace.js'
import {
  runtime,
  SYNC_HISTORY_KEY,
  LOCAL_TS_KEY,
  syncStorageKey,
  syncUndoStorageKey,
  isSyncing,
  syncRecovery,
  syncRecoveryLocked,
  syncCalibrationRequired,
  syncPreview,
  localChanged,
  canUndoPull,
  remoteDevice,
  lastSyncedAt,
  lastPushedDevice,
  lastError,
  syncStatus,
  cloudExists,
  remoteRevision,
  unpackSyncPackage,
  applyCloudMetadata,
  recordCloudCheck,
  clearSyncError,
  applySyncError,
  readSyncHistory,
  saveSyncHistory,
  saveSyncBase,
  readUndo,
  saveUndo,
  storedStates,
  snapshotStates,
  currentStateValues,
  commitStoredValues,
  mergeTombstones,
  removeRestoredTombstones,
  metadataForPull,
  syncPayloadMatchesBaseline,
  conflictDisplay,
  buildPreview,
  beginSyncCommit,
  updateSyncCommitMarker,
  finishSyncCommit,
  abortSyncCommit,
  finishSyncSpaceBootstrap,
  beginSyncOperation,
  assertSyncOperation,
  isStaleSyncOperationError,
  finishSyncOperation,
  activeAuth,
  activeEncryptionSecret,
  hasSyncAuth,
  showError,
  showSuccess,
  nowText,
} from './cloudSyncState.js'
import {
  API,
  controlledFetch,
  makeHttpError,
  responseError,
  reportProgress,
} from './cloudSyncHttp.js'

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
      runtime.pendingMerge = { merge, localValues, remoteValues: validated, pullKeys: Object.keys(validated), remoteTombstones, remoteRestoreMarkers, localTombstones: localMetadata.tombstones, localChanged: localChanged.value, metadata }
      return showError(`发现 ${merge.conflicts.length} 个需要确认的同步冲突`)
    }
    if (previewOnly) {
      runtime.pendingMerge = { merge, localValues, remoteValues: validated, pullKeys: Object.keys(validated), remoteTombstones, remoteRestoreMarkers, localTombstones: localMetadata.tombstones, localChanged: localChanged.value, metadata }
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
    runtime.pendingMerge = null
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
  if (!runtime.pendingMerge?.merge?.conflicts?.length) return showError('暂无待处理的同步冲突')
  const unresolved = runtime.pendingMerge.merge.conflicts.filter((conflict) => {
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
    const merge = { ...runtime.pendingMerge.merge, values: cloneValue(runtime.pendingMerge.merge.values) }
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
        const tombstones = decision === 'restore-local' ? runtime.pendingMerge.remoteTombstones : runtime.pendingMerge.localTombstones
        const target = tombstones.find((item) => item.entityType === conflict.entityType && String(item.entityId) === id)
        if (target?.tombstoneId) restoreTargets.push({ conflict, tombstone: target })
      }
    }
    const repaired = validateAndRepairRelations(merge.values)
    const invalidIds = validateStableEntityIds(repaired.values)
    if (invalidIds.length) throw new Error('冲突决策产生了缺少稳定 ID 的同步记录')
    merge.values = repaired.values
    const states = await storedStates(SYNC_KEYS)
    const commitMarker = await beginSyncCommit({ baseRevision: runtime.pendingMerge.metadata.revision, targetRevision: runtime.pendingMerge.metadata.revision, operation })
    commitStarted = true
    saveUndo(snapshotStates(states, runtime.pendingMerge.pullKeys))
    updateSyncCommitMarker('writing-business')
    await commitStoredValues(pickSyncValues(merge.values, runtime.pendingMerge.pullKeys), operation)
    assertSyncOperation(operation)
    const tombstones = mergeTombstones(runtime.pendingMerge.localTombstones, runtime.pendingMerge.remoteTombstones).filter((item) => !restoredTombstones.has(`${item.entityType}:${item.entityId}`))
    for (const { conflict, tombstone } of restoreTargets) {
      recordRestoreMarker(conflict.entityType, conflict.entityId, tombstone, {
        operationId: `${commitMarker.operationId}:${conflict.entityType}:${conflict.entityId}`,
      })
    }
    const restoreMarkers = mergeRestoreMarkers(readSyncMetadata().restoreMarkers, runtime.pendingMerge.remoteRestoreMarkers || [])
    // Base 必须记录“冲突选择后的最终值”，否则选择保留本机时下一次同步会把
    // 远端旧值误当成 Base，导致同一冲突再次出现。
    const baselineValues = { ...runtime.pendingMerge.localValues, ...runtime.pendingMerge.remoteValues, ...merge.values }
    updateSyncCommitMarker('writing-metadata')
    saveSyncBaseline(baselineValues, { remoteRevision: runtime.pendingMerge.metadata.revision, tombstones, restoreMarkers })
    lastSyncedAt.value = new Date().toISOString()
    const keptLocalValue = runtime.pendingMerge.localChanged || Object.values(decisions).some((decision) => ['local', 'restore-local'].includes(decision))
    localChanged.value = keptLocalValue
    updateSyncCommitMarker('updating-base')
    saveSyncBase({ hasBase: true, baseRevision: runtime.pendingMerge.metadata.revision, localDirty: keptLocalValue })
    saveSyncHistory()
    finishSyncCommit()
    finishSyncSpaceBootstrap()
    runtime.pendingMerge = null
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
    const pushStartedAtSequence = runtime.localChangeSequence
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
    const changedDuringPush = runtime.localChangeSequence !== pushStartedAtSequence
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

