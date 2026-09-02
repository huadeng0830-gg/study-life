import { deviceProfile } from './deviceIdentity.js'

export const SYNC_METADATA_KEY = 'study_life_sync_metadata'
export const SYNC_METADATA_VERSION = 1

// 只有这些集合按实体合并；设置、日志和界面偏好仍作为单个同步对象处理。
export const SYNC_ENTITY_COLLECTIONS = Object.freeze({
  sl_courses: 'Course',
  sl_course_templates: 'CourseTemplate',
  sl_tasks: 'Task',
  sl_events: 'Event',
  sl_quick_notes: 'Note',
  sl_exams: 'Milestone',
  sl_bills: 'Bill',
  sl_expenses: 'Transaction',
  sl_checklists: 'Checklist',
  sl_food_places: 'FoodPlace',
  sl_food_history: 'FoodHistory',
  sl_focus_sessions: 'FocusSession',
  sl_course_checkins: 'CourseCheckin',
})

const SYNC_SINGLETON_KEYS = new Set(['sl_quick_record_settings', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_ocr_vocabulary', 'sl_mood_log', 'sl_festive_config', 'sl_festive_birthday_full', 'sl_capture_enabled', 'sl_focus_settings', 'sl_countdown_show_past', 'sl_ledger_categories', 'sl_ledger_freq', 'sl_food_filters', 'sl_theme', 'sl_custom_theme_color', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent', 'sl_appearance', 'sl_wallpaper_config', 'sl_performance_mode'])

export function entityTypeForKey(key) { return SYNC_ENTITY_COLLECTIONS[key] || '' }
export function isEntityCollectionKey(key) { return Boolean(SYNC_ENTITY_COLLECTIONS[key]) }
export function isSingletonKey(key) { return SYNC_SINGLETON_KEYS.has(key) }

export function stableEntityId(key, item) {
  if (item?.id !== undefined && item?.id !== null && String(item.id).trim()) return String(item.id)
  if (key === 'sl_focus_sessions' && item?.sessionId) return String(item.sessionId)
  if (key === 'sl_course_checkins' && item?.date && item?.courseId) return `${item.date}:${item.courseId}`
  return ''
}

export function cloneSyncValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function hashSyncValue(value) {
  const input = stableValue(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function validateStableEntityIds(values = {}) {
  const issues = []
  for (const [key, type] of Object.entries(SYNC_ENTITY_COLLECTIONS)) {
    const list = values[key]
    if (!Array.isArray(list)) continue
    const seen = new Set()
    list.forEach((item, index) => {
      if (!item || typeof item !== 'object' || !stableEntityId(key, item)) {
        issues.push({ key, type, index, reason: 'missing-id' })
        return
      }
      const id = stableEntityId(key, item)
      if (seen.has(id)) issues.push({ key, type, index, id, reason: 'duplicate-id' })
      seen.add(id)
    })
  }
  return issues
}

export function buildEntityManifest(values = {}) {
  const entities = {}
  const singletons = {}
  for (const [key, type] of Object.entries(SYNC_ENTITY_COLLECTIONS)) {
    const list = values[key]
    if (!Array.isArray(list)) continue
    entities[key] = {}
    for (const item of list) {
      const id = stableEntityId(key, item)
      if (!id) continue
      entities[key][id] = { entityType: type, hash: hashSyncValue(item), updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '' }
    }
  }
  for (const key of SYNC_SINGLETON_KEYS) {
    if (values[key] !== undefined) singletons[key] = hashSyncValue(values[key])
  }
  return { version: 1, entities, singletons }
}

// Pull 端必须反向核对 manifest，避免“payload 已被替换但 hash/实体列表仍沿用旧值”
// 的损坏包进入合并流程。返回 issue 列表而不是直接抛错，方便 UI/测试保留明确原因。
export function validateSyncManifest(values = {}, manifest) {
  const issues = []
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return [{ reason: 'invalid-manifest-values' }]
  }
  if (!manifest || typeof manifest !== 'object' || manifest.version !== 1) {
    return [{ reason: 'invalid-manifest-version' }]
  }
  if (!manifest.entities || typeof manifest.entities !== 'object' || Array.isArray(manifest.entities)) {
    issues.push({ reason: 'invalid-manifest-entities' })
  }
  if (!manifest.singletons || typeof manifest.singletons !== 'object' || Array.isArray(manifest.singletons)) {
    issues.push({ reason: 'invalid-manifest-singletons' })
  }
  if (!Array.isArray(manifest.tombstones)) issues.push({ reason: 'invalid-manifest-tombstones' })
  const idIssues = validateStableEntityIds(values)
  issues.push(...idIssues.map((issue) => ({ ...issue, reason: `manifest-${issue.reason}` })))
  if (issues.length) return issues

  const expected = buildEntityManifest(values)
  for (const key of Object.keys(SYNC_ENTITY_COLLECTIONS)) {
    const actual = manifest.entities[key] || {}
    const wanted = expected.entities[key] || {}
    for (const id of new Set([...Object.keys(actual), ...Object.keys(wanted)])) {
      if (!actual[id]) issues.push({ key, id, reason: 'manifest-missing-entity' })
      else if (!wanted[id]) issues.push({ key, id, reason: 'manifest-extra-entity' })
      else if (JSON.stringify(actual[id]) !== JSON.stringify(wanted[id])) issues.push({ key, id, reason: 'manifest-entity-hash-mismatch' })
    }
  }
  for (const key of new Set([...Object.keys(manifest.singletons), ...Object.keys(expected.singletons)])) {
    if (manifest.singletons[key] !== expected.singletons[key]) issues.push({ key, reason: 'manifest-singleton-hash-mismatch' })
  }
  return issues
}

// 远端明确发布了晚于墓碑的有效实体时，视为一次显式恢复；旧墓碑不应继续
// 随下一轮 Push/Pull 传播并删除这个新版本。
export function removeSupersededTombstones(values = {}, tombstones = []) {
  return tombstones.filter((tombstone) => {
    const key = Object.entries(SYNC_ENTITY_COLLECTIONS).find(([, type]) => type === tombstone?.entityType)?.[0]
    const entity = key && Array.isArray(values[key])
      ? values[key].find((item) => String(stableEntityId(key, item)) === String(tombstone.entityId))
      : null
    const entityTime = Date.parse(entity?.updatedAt ?? '')
    const deletedTime = Date.parse(tombstone?.deletedAt ?? tombstone?.updatedAt ?? '')
    return !(entity && Number.isFinite(entityTime) && Number.isFinite(deletedTime) && entityTime > deletedTime)
  })
}

function emptyMetadata() {
  return { version: SYNC_METADATA_VERSION, hasBaseline: false, baseRemoteRevision: null, baseline: { entities: {}, singletons: {} }, tombstones: [] }
}

export function readSyncMetadata() {
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_METADATA_KEY))
    if (!saved || saved.version !== SYNC_METADATA_VERSION) return emptyMetadata()
    return {
      ...emptyMetadata(),
      ...saved,
      baseline: { entities: saved.baseline?.entities || {}, singletons: saved.baseline?.singletons || {} },
      tombstones: Array.isArray(saved.tombstones) ? saved.tombstones : [],
    }
  } catch {
    return emptyMetadata()
  }
}

export function saveSyncMetadata(value) {
  const next = { ...emptyMetadata(), ...cloneSyncValue(value), version: SYNC_METADATA_VERSION }
  try { localStorage.setItem(SYNC_METADATA_KEY, JSON.stringify(next)) } catch {}
  return next
}

export function recordTombstone(entityType, entityId, { now = new Date(), deviceId = deviceProfile.value.id, entity = undefined } = {}) {
  if (!entityType || entityId === undefined || entityId === null || String(entityId).trim() === '') return null
  const metadata = readSyncMetadata()
  const id = String(entityId)
  const current = metadata.tombstones.filter((item) => !(item.entityType === entityType && String(item.entityId) === id))
  const previousRevision = metadata.tombstones.reduce((max, item) => Math.max(max, Number(item.revision) || 0), 0)
  const tombstone = {
    entityType,
    entityId: id,
    deletedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: previousRevision + 1,
    deviceId: String(deviceId || ''),
    // 保留删除前的实体指纹，避免另一端仍持有“未修改旧版本”时被误判为冲突。
    baseHash: entity === undefined ? '' : hashSyncValue(entity),
  }
  saveSyncMetadata({ ...metadata, tombstones: [...current, tombstone] })
  return tombstone
}

export function clearTombstone(entityType, entityId) {
  const metadata = readSyncMetadata()
  const id = String(entityId)
  const tombstones = metadata.tombstones.filter((item) => !(item.entityType === entityType && String(item.entityId) === id))
  saveSyncMetadata({ ...metadata, tombstones })
  return tombstones
}

export function buildSyncManifest(values = {}, { tombstones = readSyncMetadata().tombstones, deviceId = deviceProfile.value.id, schemaVersion = 1 } = {}) {
  return { version: 1, schemaVersion, generatedAt: new Date().toISOString(), deviceId: String(deviceId || ''), ...buildEntityManifest(values), tombstones: cloneSyncValue(tombstones) }
}

export function saveSyncBaseline(values, { remoteRevision = null, tombstones = readSyncMetadata().tombstones } = {}) {
  const metadata = readSyncMetadata()
  const manifest = buildSyncManifest(values, { tombstones })
  return saveSyncMetadata({ ...metadata, hasBaseline: true, baseRemoteRevision: remoteRevision, baseline: { entities: manifest.entities, singletons: manifest.singletons }, tombstones: manifest.tombstones })
}
