import { cloneSyncValue, entityTypeForKey, hashSyncValue, isEntityCollectionKey, isSingletonKey, buildEntityManifest, stableEntityId, validateStableEntityIds } from './syncMetadata.js'
import { validateAndRepairRelations } from './syncIntegrity.js'

export const MERGE_STATUS = Object.freeze({ unchanged: 'unchanged', localOnly: 'local-only-change', remoteOnly: 'remote-only-change', autoMerged: 'auto-merged', deleted: 'deleted', conflict: 'conflict', deleteUpdateConflict: 'delete-update-conflict' })

function idOf(key, item) { return stableEntityId(key, item) }
function mapById(key, list = []) { return new Map(list.filter((item) => idOf(key, item)).map((item) => [idOf(key, item), item])) }
function tombstoneMap(tombstones = []) { return new Map(tombstones.map((item) => [`${item.entityType}:${item.entityId}`, item])) }
function baseEntry(baseManifest, key, id) { return baseManifest?.entities?.[key]?.[id] || null }
function sameHash(value, entry) { return value !== undefined && entry?.hash === hashSyncValue(value) }
function mergeOneEntity({ base, local, remote, localTombstone, remoteTombstone, restoreMarker, localDeleted, remoteDeleted, legacy = false }) {
  const localHash = local === undefined ? null : hashSyncValue(local)
  const remoteHash = remote === undefined ? null : hashSyncValue(remote)
  const baseHash = base?.hash || localTombstone?.baseHash || remoteTombstone?.baseHash || null
  if (localHash === remoteHash) return { result: cloneSyncValue(local ?? remote), status: localHash === null ? MERGE_STATUS.deleted : MERGE_STATUS.unchanged }
  if (localDeleted && remoteDeleted) return { result: undefined, status: MERGE_STATUS.deleted }
  if (localDeleted) {
    if (remote === undefined || sameHash(remote, base)) return { result: undefined, status: MERGE_STATUS.deleted }
    if (restoreMarker?.tombstoneId && restoreMarker.tombstoneId === localTombstone?.tombstoneId) {
      return { result: cloneSyncValue(remote), status: MERGE_STATUS.remoteOnly }
    }
    // 删除与另一端的有效实体冲突时，不能用客户端 wall-clock 推断恢复。
    // 只有后续明确的 restore marker 才能表达“用户主动恢复”。
    return { status: MERGE_STATUS.deleteUpdateConflict, conflict: true, reason: 'delete-update-conflict' }
  }
  if (remoteDeleted) {
    if (local === undefined || sameHash(local, base)) return { result: undefined, status: MERGE_STATUS.deleted }
    return { status: MERGE_STATUS.deleteUpdateConflict, conflict: true, reason: 'delete-update-conflict' }
  }
  if (legacy && remote !== undefined) return { result: cloneSyncValue(remote), status: MERGE_STATUS.remoteOnly }
  if (baseHash && localHash === baseHash) return { result: cloneSyncValue(remote), status: MERGE_STATUS.remoteOnly }
  if (baseHash && remoteHash === baseHash) return { result: cloneSyncValue(local), status: MERGE_STATUS.localOnly }
  if (local === undefined) return { result: cloneSyncValue(remote), status: MERGE_STATUS.remoteOnly }
  if (remote === undefined) return { result: cloneSyncValue(local), status: MERGE_STATUS.localOnly }
  return { status: MERGE_STATUS.conflict, conflict: true, reason: 'both-modified' }
}

function transactionEquivalent(left, right) {
  return left?.billId && left.billId === right?.billId && left.billingPeriodKey && left.billingPeriodKey === right?.billingPeriodKey
    && Number(left.amount) === Number(right.amount) && left.direction === right.direction && left.name === right.name
}

function mergeEntityCollection(key, local = [], remote = [], baseManifest, localTombstones, remoteTombstones, remoteRestoreMarkers, legacy) {
  const type = entityTypeForKey(key)
  if (legacy) {
    return { values: cloneSyncValue(remote), statuses: remote.map(() => MERGE_STATUS.remoteOnly), conflicts: [] }
  }
  const localMap = mapById(key, local)
  const remoteMap = mapById(key, remote)
  const localDeleted = tombstoneMap(localTombstones)
  const remoteDeleted = tombstoneMap(remoteTombstones)
  const restoreMarkers = new Map(remoteRestoreMarkers.map((item) => [`${item.entityType}:${item.entityId}`, item]))
  const ids = new Set([...localMap.keys(), ...remoteMap.keys(), ...[...localDeleted.keys(), ...remoteDeleted.keys()].filter((value) => value.startsWith(`${type}:`)).map((value) => value.slice(type.length + 1))])
  const results = []
  const statuses = []
  const conflicts = []
  for (const id of ids) {
    const result = mergeOneEntity({
      base: baseEntry(baseManifest, key, id),
      local: localMap.get(id),
      remote: remoteMap.get(id),
      localTombstone: localDeleted.get(`${type}:${id}`),
      remoteTombstone: remoteDeleted.get(`${type}:${id}`),
      restoreMarker: restoreMarkers.get(`${type}:${id}`),
      localDeleted: localDeleted.has(`${type}:${id}`),
      remoteDeleted: remoteDeleted.has(`${type}:${id}`),
      legacy,
    })
    statuses.push({ status: result.status, key, entityId: id, label: localMap.get(id)?.title || localMap.get(id)?.name || remoteMap.get(id)?.title || remoteMap.get(id)?.name || id })
    if (result.conflict) conflicts.push({ key, entityType: type, entityId: id, status: result.status, local: cloneSyncValue(localMap.get(id)), remote: cloneSyncValue(remoteMap.get(id)), base: cloneSyncValue(baseEntry(baseManifest, key, id)), reason: result.reason })
    else if (result.result !== undefined) results.push(result.result)
  }
  let autoMerged = false
  if (type === 'Transaction') {
    const seenPeriods = new Map()
    const filtered = []
    for (const item of results) {
      const periodKey = item.billId && item.billingPeriodKey ? `${item.billId}:${item.billingPeriodKey}` : ''
      if (!periodKey) { filtered.push(item); continue }
      const previous = seenPeriods.get(periodKey)
      if (!previous) { seenPeriods.set(periodKey, item); filtered.push(item); continue }
      if (transactionEquivalent(previous, item)) {
        const winner = String(previous.id).localeCompare(String(item.id)) <= 0 ? previous : item
        const index = filtered.indexOf(previous)
        filtered[index] = winner
        seenPeriods.set(periodKey, winner)
        autoMerged = true
      } else conflicts.push({ key, entityType: type, entityId: periodKey, status: MERGE_STATUS.conflict, local: previous, remote: item, reason: 'same-bill-period-different-fact' })
    }
    return { values: filtered, statuses: autoMerged ? [...statuses, { status: MERGE_STATUS.autoMerged, key, label: '账期交易幂等合并' }] : statuses, conflicts }
  }
  return { values: results, statuses, conflicts }
}

function mergeSingleton(key, local, remote, baseManifest, legacy) {
  const localHash = hashSyncValue(local)
  const remoteHash = hashSyncValue(remote)
  const baseHash = baseManifest?.singletons?.[key] || null
  if (localHash === remoteHash) return { value: cloneSyncValue(local), status: MERGE_STATUS.unchanged }
  if (legacy) return { value: cloneSyncValue(remote), status: MERGE_STATUS.remoteOnly }
  if (baseHash && localHash === baseHash) return { value: cloneSyncValue(remote), status: MERGE_STATUS.remoteOnly }
  if (baseHash && remoteHash === baseHash) return { value: cloneSyncValue(local), status: MERGE_STATUS.localOnly }
  return { status: MERGE_STATUS.conflict, conflict: true }
}

export function mergeEntity(base, local, remote, options = {}) {
  if (options.entityType) {
    return mergeOneEntity({
      base,
      local,
      remote,
      localTombstone: options.localTombstone,
      remoteTombstone: options.remoteTombstone,
      restoreMarker: options.restoreMarker,
      localDeleted: Boolean(options.localDeleted),
      remoteDeleted: Boolean(options.remoteDeleted),
      legacy: options.legacy,
    })
  }
  return mergeSingleton(options.key || '', local, remote, base || {}, options.legacy)
}

export function mergeSyncPayload({ baseManifest = null, localValues = {}, remoteValues = {}, localTombstones = [], remoteTombstones = [], remoteRestoreMarkers = [], keys = Object.keys(remoteValues), legacy = false } = {}) {
  const merged = cloneSyncValue(localValues) || {}
  const conflicts = []
  const statuses = []
  const invalidLocalIds = validateStableEntityIds(localValues)
  const invalidRemoteIds = validateStableEntityIds(remoteValues)
  for (const key of keys) {
    if (remoteValues[key] === undefined) continue
    if (invalidLocalIds.some((issue) => issue.key === key)) {
      conflicts.push({ key, status: MERGE_STATUS.conflict, reason: 'local-entity-id-invalid', issues: invalidLocalIds.filter((issue) => issue.key === key) })
      continue
    }
    if (invalidRemoteIds.some((issue) => issue.key === key)) {
      conflicts.push({ key, status: MERGE_STATUS.conflict, reason: 'remote-entity-id-invalid', issues: invalidRemoteIds.filter((issue) => issue.key === key) })
      continue
    }
    if (isEntityCollectionKey(key)) {
      const result = mergeEntityCollection(key, localValues[key], remoteValues[key], baseManifest, localTombstones, remoteTombstones, remoteRestoreMarkers, legacy)
      merged[key] = result.values
      statuses.push(...result.statuses)
      conflicts.push(...result.conflicts)
    } else if (isSingletonKey(key) || !(Array.isArray(localValues[key]) && Array.isArray(remoteValues[key]))) {
      const result = mergeSingleton(key, localValues[key], remoteValues[key], baseManifest, legacy)
      if (!result.conflict) merged[key] = result.value
      statuses.push({ key, status: result.status })
      if (result.conflict) conflicts.push({ key, status: MERGE_STATUS.conflict, local: cloneSyncValue(localValues[key]), remote: cloneSyncValue(remoteValues[key]), reason: 'both-modified' })
    } else {
      const result = mergeSingleton(key, localValues[key], remoteValues[key], baseManifest, legacy)
      if (!result.conflict) merged[key] = result.value
      statuses.push({ key, status: result.status })
      if (result.conflict) conflicts.push({ key, status: MERGE_STATUS.conflict, local: cloneSyncValue(localValues[key]), remote: cloneSyncValue(remoteValues[key]), reason: 'both-modified' })
    }
  }
  const repaired = validateAndRepairRelations(merged)
  const summary = {
    added: statuses.filter((item) => item.status === MERGE_STATUS.remoteOnly && item.key).length,
    updated: statuses.filter((item) => item.status === MERGE_STATUS.remoteOnly || item.status === MERGE_STATUS.localOnly || item.status === MERGE_STATUS.autoMerged).length,
    deleted: statuses.filter((item) => item.status === MERGE_STATUS.deleted).length,
    conflicts: conflicts.length,
    repairedRelations: repaired.issues.length,
  }
  return { values: repaired.values, statuses, conflicts, integrityIssues: repaired.issues, summary, manifest: buildEntityManifest(repaired.values) }
}
