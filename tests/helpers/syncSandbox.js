import { sanitizeSyncPayload } from '../../src/composables/cloudSyncData.js'
import {
  buildEntityManifest,
  buildSyncManifest,
  cloneSyncValue,
  hashSyncValue,
  removeSupersededTombstones,
  validateStableEntityIds,
  validateSyncManifest,
} from '../../src/composables/syncMetadata.js'
import { mergeSyncPayload } from '../../src/composables/syncMerge.js'
import { validateAndRepairRelations } from '../../src/composables/syncIntegrity.js'

let runSequence = 0

function runId() {
  runSequence += 1
  return `sync-test-${Date.now()}-${runSequence}`
}

function mergeTombstones(...groups) {
  const byEntity = new Map()
  for (const tombstone of groups.flat()) {
    if (!tombstone?.entityType || tombstone.entityId === undefined) continue
    const key = `${tombstone.entityType}:${tombstone.entityId}`
    const previous = byEntity.get(key)
    if (!previous || String(tombstone.updatedAt || '') >= String(previous.updatedAt || '')) {
      byEntity.set(key, cloneSyncValue(tombstone))
    }
  }
  return [...byEntity.values()]
}

function entityKey(key, value) {
  if (key === 'sl_focus_sessions' && value?.sessionId) return String(value.sessionId)
  if (key === 'sl_course_checkins' && value?.date && value?.courseId) return `${value.date}:${value.courseId}`
  return String(value?.id || '')
}

function removeEntity(values, key, id) {
  return {
    ...cloneSyncValue(values),
    [key]: (values[key] || []).filter((item) => entityKey(key, item) !== String(id)),
  }
}

function findEntity(values, key, id) {
  return (values[key] || []).find((item) => entityKey(key, item) === String(id))
}

function makeEnvelope(values, tombstones, device) {
  return {
    format: 'study-life-sync',
    version: 3,
    values: cloneSyncValue(values),
    manifest: buildSyncManifest(values, { tombstones, deviceId: device.id }),
    meta: { id: device.id, name: device.name, pushedAt: new Date().toISOString() },
  }
}

function metadataOf(remote) {
  return {
    exists: remote.revision !== null,
    revision: remote.revision,
    namespace: remote.namespace,
  }
}

export function createSyncSandbox({ initialValues = {}, namespace = runId() } = {}) {
  const remote = { namespace, revision: null, envelope: null }

  function seed(values = initialValues) {
    const seedDevice = { id: `${namespace}:seed`, name: 'Sandbox seed' }
    remote.envelope = makeEnvelope(values, [], seedDevice)
    remote.revision = 1
    return metadataOf(remote)
  }

  function device(name, values = initialValues) {
    const local = cloneSyncValue(values)
    return {
      id: `${namespace}:${name}`,
      name,
      local,
      baseManifest: buildEntityManifest(local),
      baseRevision: remote.revision,
      tombstones: [],
      dirty: false,
      lastKnownGood: cloneSyncValue(local),
    }
  }

  function edit(target, key, id, changes) {
    const item = findEntity(target.local, key, id)
    if (!item) throw new Error(`missing entity ${key}:${id}`)
    Object.assign(item, changes)
    target.dirty = true
    return item
  }

  function deleteEntity(target, key, type, id) {
    const entity = findEntity(target.local, key, id)
    if (!entity) throw new Error(`missing entity ${key}:${id}`)
    target.local = removeEntity(target.local, key, id)
    target.tombstones = target.tombstones.filter((item) => !(item.entityType === type && String(item.entityId) === String(id)))
    target.tombstones.push({
      entityType: type,
      entityId: String(id),
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      baseHash: hashSyncValue(entity),
      deviceId: target.id,
    })
    target.dirty = true
  }

  function tryPush(target) {
    const expectedRevision = target.baseRevision
    if (remote.revision !== expectedRevision) {
      return { ok: false, conflict: true, expectedRevision, actualRevision: remote.revision, ...metadataOf(remote) }
    }
    const nextRevision = (remote.revision ?? 0) + 1
    remote.envelope = makeEnvelope(target.local, target.tombstones, target)
    remote.revision = nextRevision
    target.baseRevision = nextRevision
    target.baseManifest = buildEntityManifest(target.local)
    target.lastKnownGood = cloneSyncValue(target.local)
    target.dirty = false
    return { ok: true, revision: nextRevision, ...metadataOf(remote) }
  }

  function decodeRemote() {
    if (typeof remote.envelope === 'string') return JSON.parse(remote.envelope)
    return cloneSyncValue(remote.envelope)
  }

  function pull(target, { networkError = false, commitFailureAt = 0, keys = null } = {}) {
    const before = { local: cloneSyncValue(target.local), tombstones: cloneSyncValue(target.tombstones), baseManifest: cloneSyncValue(target.baseManifest), baseRevision: target.baseRevision, dirty: target.dirty }
    if (networkError) return { ok: false, error: 'network interrupted', unchanged: true }
    if (!remote.envelope) return { ok: true, summary: { added: 0, updated: 0, deleted: 0, conflicts: 0 }, unchanged: true }

    let envelope
    try {
      envelope = decodeRemote()
      if (envelope?.format !== 'study-life-sync' || ![2, 3].includes(envelope.version) || !envelope.values) {
        throw new Error('invalid envelope')
      }
      const manifestIssues = validateSyncManifest(envelope.values, envelope.manifest)
      if (manifestIssues.length) throw new Error(`invalid manifest: ${manifestIssues[0].reason}`)
    } catch (error) {
      return { ok: false, error: error.message, unchanged: true, before }
    }

    const sanitized = sanitizeSyncPayload(envelope.values)
    if (!Object.keys(sanitized.values).length && sanitized.invalidKeys.length) {
      return { ok: false, error: 'invalid payload', unchanged: true, before }
    }
    const pullKeys = keys || Object.keys(sanitized.values)
    const merge = mergeSyncPayload({
      baseManifest: target.baseManifest,
      localValues: target.local,
      remoteValues: sanitized.values,
      localTombstones: target.tombstones,
      remoteTombstones: envelope.manifest.tombstones || [],
      keys: pullKeys,
    })
    const structuralConflict = merge.conflicts.some((item) => ['local-entity-id-invalid', 'remote-entity-id-invalid'].includes(item.reason))
    if (merge.conflicts.length || structuralConflict) {
      return { ok: false, conflicts: merge.conflicts, preview: merge, remoteTombstones: envelope.manifest.tombstones || [], unchanged: true, before }
    }
    if (commitFailureAt > 0) {
      const entries = Object.entries(merge.values)
      if (commitFailureAt <= entries.length) return { ok: false, error: `commit failed at ${commitFailureAt}`, rollback: true, unchanged: true, before }
    }

    target.local = cloneSyncValue({ ...target.local, ...merge.values })
    target.tombstones = removeSupersededTombstones(
      merge.values,
      mergeTombstones(target.tombstones, envelope.manifest.tombstones || [])
    )
    target.baseManifest = buildEntityManifest(target.local)
    target.baseRevision = remote.revision
    target.lastKnownGood = cloneSyncValue(target.local)
    target.dirty = merge.statuses.some((item) => item.status === 'local-only-change')
    return { ok: true, summary: merge.summary, operations: merge.statuses, integrityIssues: merge.integrityIssues, before }
  }

  function resolve(target, pullResult, decisions) {
    if (!pullResult?.conflicts?.length) throw new Error('no conflicts')
    const values = cloneSyncValue(pullResult.preview.values)
    const restored = new Set()
    for (const conflict of pullResult.conflicts) {
      const key = `${conflict.key}:${conflict.entityId || conflict.key}`
      const decision = decisions[key] || decisions[conflict.key]
      if (!decision) throw new Error(`unresolved ${key}`)
      if (!conflict.entityType) {
        values[conflict.key] = cloneSyncValue(decision === 'remote' ? conflict.remote : conflict.local)
        continue
      }
      const list = (values[conflict.key] || []).filter((item) => String(entityKey(conflict.key, item)) !== String(conflict.entityId))
      const selected = decision === 'remote' ? conflict.remote : decision === 'local' || decision === 'restore-local' ? conflict.local : undefined
      if (selected !== undefined) list.push(cloneSyncValue(selected))
      values[conflict.key] = list
      if (selected !== undefined) restored.add(`${conflict.entityType}:${conflict.entityId}`)
    }
    const repaired = validateAndRepairRelations(values)
    if (validateStableEntityIds(repaired.values).length) throw new Error('resolution produced invalid IDs')
    target.local = repaired.values
    target.tombstones = mergeTombstones(target.tombstones, pullResult.remoteTombstones || [])
      .filter((item) => !restored.has(`${item.entityType}:${item.entityId}`))
    target.baseManifest = buildEntityManifest(target.local)
    target.baseRevision = remote.revision
    target.lastKnownGood = cloneSyncValue(target.local)
    target.dirty = Object.values(decisions).some((decision) => ['local', 'restore-local'].includes(decision))
    return { ok: true, integrityIssues: repaired.issues }
  }

  function integrity(target) {
    return validateAndRepairRelations(target.local).issues
  }

  function remoteSnapshot() {
    return { ...metadataOf(remote), envelope: cloneSyncValue(remote.envelope) }
  }

  return { namespace, remote, seed, device, edit, deleteEntity, tryPush, pull, resolve, integrity, remoteSnapshot }
}
