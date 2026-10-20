import { deepClone } from '../../utils/clone.js'

export function createOwnerTransitionFence({
  pendingWrites, pendingWriteOwners, pendingWriteBases, storedRefs, storedDefaults,
  pendingWatcherInstalls, conflictedStorageKeys, writtenFingerprints, externallyRestoredRaw,
  recoveryDraftOwner, readLatestStoredRaw, storeRecoveryDraft, clearPendingWriteOwner,
  cancelScheduledBatch, cancelPendingWrite, rawFingerprint, normalizeStoredValue, isPlainObject,
  setPersistenceWriteState, reportPersistenceFailure, markPersistenceSuccess,
}) {
  const transitions = new Map()
  let observedOwner = recoveryDraftOwner()

  async function saveDraft(key, transition) {
    while (transitions.get(key) === transition) {
      const revision = transition.revision
      const raw = readLatestStoredRaw(key)
      const saved = await storeRecoveryDraft(key, raw, transition.baseRaw, transition.ownerId)
      if (!saved) {
        reportPersistenceFailure(new Error('无法将旧账号修改写入隔离恢复草稿。'), key, 'owner-draft-failed', { ownerId: transition.ownerId })
        return false
      }
      if (revision === transition.revision && raw === readLatestStoredRaw(key)) {
        reportPersistenceFailure(new Error('旧账号未保存修改已另存为隔离恢复草稿。'), key, 'owner-draft', { ownerId: transition.ownerId })
        return true
      }
    }
    return true
  }

  async function adoptExternalOwner(ownerId) {
    const stale = []
    for (const [key] of pendingWrites) {
      const queuedOwner = pendingWriteOwners.get(key) ?? observedOwner
      if (queuedOwner === ownerId) continue
      const transition = { ownerId: queuedOwner, baseRaw: pendingWriteBases.get(key), revision: 0, saving: null }
      transitions.set(key, transition)
      stale.push([key, transition])
      pendingWrites.delete(key)
      clearPendingWriteOwner(key)
    }
    if (!pendingWrites.size) cancelScheduledBatch()
    const protectedWrites = await Promise.all(stale.map(([key, transition]) => {
      setPersistenceWriteState(key, 'saving', 'owner-draft', '', { ownerId: transition.ownerId })
      return transition.saving = saveDraft(key, transition)
    }))
    if (protectedWrites.some((saved) => !saved) || recoveryDraftOwner() !== ownerId) return false
    for (const [key, state] of storedRefs) {
      if (pendingWriteOwners.get(key) === ownerId) continue
      try {
        const fallback = storedDefaults.get(key)
        const diskRaw = localStorage.getItem(key)
        const saved = diskRaw === null ? null : JSON.parse(diskRaw)
        if (saved !== null && (Array.isArray(fallback) ? !Array.isArray(saved)
          : isPlainObject(fallback) ? !isPlainObject(saved)
            : fallback !== null && typeof saved !== typeof fallback)) throw new Error('新账号本机数据格式异常。')
        const value = saved === null ? deepClone(fallback) : normalizeStoredValue(saved, fallback).value
        const raw = JSON.stringify(value)
        cancelPendingWrite(key)
        conflictedStorageKeys.delete(key)
        if (diskRaw === null) writtenFingerprints.delete(key)
        else writtenFingerprints.set(key, rawFingerprint(diskRaw))
        const pending = pendingWatcherInstalls.get(key)
        if (pending) pending.baselineFingerprint = rawFingerprint(raw)
        else externallyRestoredRaw.set(state, raw)
        state.value = value
        markPersistenceSuccess(key, 'local')
      } catch (error) { reportPersistenceFailure(error, key, 'read') }
    }
    for (const [key] of stale) transitions.delete(key)
    return true
  }

  function holdPendingEdit(key) {
    const transition = transitions.get(key)
    if (!transition) return false
    transition.revision += 1
    if (!transition.saving) transition.saving = saveDraft(key, transition).finally(() => { transition.saving = null })
    setPersistenceWriteState(key, 'saving', 'owner-draft', '', { ownerId: transition.ownerId })
    return true
  }

  function observeExternalOwner(ownerId) {
    if (ownerId === observedOwner) return false
    observedOwner = ownerId
    void adoptExternalOwner(ownerId)
    return true
  }

  return { holdPendingEdit, observeExternalOwner }
}
