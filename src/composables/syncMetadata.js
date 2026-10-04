import { deviceProfile } from './deviceIdentity.js'
import { normalizeSyncSpaceId, syncSpaceSettings } from './syncSpace.js'

/** @type {string} */
export const SYNC_METADATA_KEY = 'study_life_sync_metadata'
/** @type {number} */
export const SYNC_METADATA_VERSION = 1

// 同步基线和墓碑属于“某个空间”的本地运行时状态，不能与业务数据一样使用
// 一个跨空间 singleton。无空间时仍使用旧 key，兼容旧版手动同步和现有测试。
/**
 * @param {string} [spaceId]
 * @returns {string}
 */
export function syncMetadataStorageKey(spaceId = syncSpaceSettings.value?.spaceId) {
  const normalized = normalizeSyncSpaceId(spaceId)
  return normalized ? `${SYNC_METADATA_KEY}:${encodeURIComponent(normalized)}` : SYNC_METADATA_KEY
}

// 只有这些集合按实体合并；设置、日志和界面偏好仍作为单个同步对象处理。
/** @type {Record<string, string>} */
export const SYNC_ENTITY_COLLECTIONS = Object.freeze({
  sl_courses: 'Course',
  sl_course_templates: 'CourseTemplate',
  sl_tasks: 'Task',
  sl_events: 'Event',
  sl_quick_notes: 'Note',
  sl_exams: 'Milestone',
  sl_bills: 'Bill',
  sl_expenses: 'Transaction',
  sl_ledger_templates: 'BillTemplate',
  sl_checklists: 'Checklist',
  sl_focus_sessions: 'FocusSession',
  sl_course_checkins: 'CourseCheckin',
})

/** @type {Set<string>} */
const SYNC_SINGLETON_KEYS = new Set([
  'sl_quick_record_settings', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_schedule_note',
  'sl_ocr_vocabulary', 'sl_mood_log', 'sl_festive_config', 'sl_festive_birthday_full',
  'sl_capture_enabled', 'sl_focus_settings', 'sl_countdown_show_past', 'sl_ledger_categories',
  'sl_ledger_freq', 'sl_theme', 'sl_custom_theme_color', 'sl_auto_wallpaper_color',
  'sl_wallpaper_accent', 'sl_appearance', 'sl_wallpaper_config', 'sl_performance_mode',
  'sl_ledger_fx', 'sl_ledger_budget', 'sl_festive_lunar', 'sl_ui_language',
])

/**
 * @param {string} key
 * @returns {string}
 */
export function entityTypeForKey(key) { return SYNC_ENTITY_COLLECTIONS[key] || '' }

/**
 * @param {string} entityType
 * @returns {string}
 */
export function syncKeyForEntityType(entityType) {
  return Object.entries(SYNC_ENTITY_COLLECTIONS).find(([, type]) => type === entityType)?.[0] || ''
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isEntityCollectionKey(key) { return Boolean(SYNC_ENTITY_COLLECTIONS[key]) }

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSingletonKey(key) { return SYNC_SINGLETON_KEYS.has(key) }

/**
 * @typedef {{ id?: string|number, sessionId?: string|number, date?: string, courseId?: string|number, updatedAt?: string }} EntityItem
 */

/**
 * @param {string} key
 * @param {EntityItem} item
 * @returns {string}
 */
export function stableEntityId(key, item) {
  if (item?.id !== undefined && item?.id !== null && String(item.id).trim()) return String(item.id)
  if (key === 'sl_focus_sessions' && item?.sessionId) return String(item.sessionId)
  if (key === 'sl_course_checkins' && item?.date && item?.courseId) return `${item.date}:${item.courseId}`
  return ''
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneSyncValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

// 同步值一定会经历一次 JSON 往返：Push 时先算指纹、再 JSON.stringify 加密，
// Pull 时从 JSON.parse 的结果反向核对。只要对象里出现 undefined 属性、数组空洞或
// Date，往返前后的文本就不同，指纹必然不一致。所有指纹都先按同样的往返归一化，
// 才能保证“同一份数据”在加密两侧得到同一个指纹。
/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalSyncValue(value) {
  if (value === undefined) return undefined
  try { return JSON.parse(JSON.stringify(value)) } catch { return value }
}

// manifest 哈希协议版本。旧版客户端写入的 manifest 既没有这个字段，分类集合也
// 确实变过（Food 退休后 sl_food_filters 不再同步），因此旧 manifest 的差异只能
// 作为提示，不能据此判定云端数据损坏。
/** @type {number} */
export const SYNC_MANIFEST_HASH_VERSION = 2

/**
 * 指纹缓存。
 *
 * 一次同步合并里，同一个实体会被反复算指纹：mergeOneEntity 算本地与远端各一次
 * （syncMerge.js），buildEntityManifest 之后又整体算一次（syncMetadata.js），
 * 冲突分支还会再算。也就是说 1000 条记录的合并要跑几千次
 * 「JSON.stringify → JSON.parse → 递归拼稳定串 → FNV 逐字符」。
 *
 * 缓存键取**规范化后的 JSON 文本**而不是对象身份：文本就是内容的完整表示，
 * 所以命中就一定等价，不存在对象被就地改过之后拿到过期指纹的风险
 * （用 WeakMap 按身份缓存会有这个风险，那是拿数据正确性换速度，不能做）。
 * 上限 512 条，超了就整批丢掉重来 —— 指纹计算是纯函数，丢缓存只损失命中率，
 * 不会影响正确性。
 */
const HASH_CACHE_LIMIT = 512
const hashCache = new Map()

/**
 * @param {unknown} value
 * @returns {string}
 */
export function hashSyncValue(value) {
  // canonicalSyncValue(undefined) 返回 undefined，stableValue 再走 JSON.stringify
  // 也会得到 undefined，接着 input.length 就抛了。所有调用点本来都判过 undefined，
  // 这里直接把「没有值」映射成空指纹，让函数对任何输入都有定义。
  if (value === undefined) return ''
  let json
  try {
    json = JSON.stringify(value)
  } catch {
    // 含循环引用等无法序列化的值：退回原来的路径，让它以既有方式失败/降级。
    json = null
  }
  if (json !== null) {
    const cached = hashCache.get(json)
    if (cached !== undefined) return cached
  }
  const input = stableValue(canonicalSyncValue(value))
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const result = (hash >>> 0).toString(16).padStart(8, '0')
  if (json !== null) {
    if (hashCache.size >= HASH_CACHE_LIMIT) hashCache.clear()
    hashCache.set(json, result)
  }
  return result
}

/**
 * @typedef {{ key: string, type: string, index: number, id?: string, reason: 'missing-id'|'duplicate-id' }} EntityIdIssue
 */

/**
 * @param {Record<string, unknown>} [values={}]
 * @returns {EntityIdIssue[]}
 */
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

/**
 * @typedef {{ entityType: string, hash: string, updatedAt: string }} EntityManifestEntry
 */

/**
 * @typedef {{ version: number, entities: Record<string, Record<string, EntityManifestEntry>>, singletons: Record<string, string> }} EntityManifest
 */

/**
 * @param {Record<string, unknown>} [values={}]
 * @returns {EntityManifest}
 */
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

/**
 * @typedef {{ reason: string, fatal: boolean, key?: string, id?: string }} ManifestIssue
 */

/**
 * @param {Record<string, unknown>} [values={}]
 * @param {unknown} manifest
 * @returns {ManifestIssue[]}
 */
export function validateSyncManifest(values = {}, manifest) {
  const issues = []
  const broken = (issue) => ({ ...issue, fatal: true })
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return [broken({ reason: 'invalid-manifest-values' })]
  }
  if (!manifest || typeof manifest !== 'object' || manifest.version !== 1) {
    return [broken({ reason: 'invalid-manifest-version' })]
  }
  if (!manifest.entities || typeof manifest.entities !== 'object' || Array.isArray(manifest.entities)) {
    issues.push(broken({ reason: 'invalid-manifest-entities' }))
  }
  if (!manifest.singletons || typeof manifest.singletons !== 'object' || Array.isArray(manifest.singletons)) {
    issues.push(broken({ reason: 'invalid-manifest-singletons' }))
  }
  if (!Array.isArray(manifest.tombstones)) issues.push(broken({ reason: 'invalid-manifest-tombstones' }))
  const idIssues = validateStableEntityIds(values)
  issues.push(...idIssues.map((issue) => broken({ ...issue, reason: `manifest-${issue.reason}` })))
  if (issues.length) return issues

  const verifiable = manifest.hashVersion === SYNC_MANIFEST_HASH_VERSION
  const drift = (issue) => ({ ...issue, fatal: verifiable })
  const expected = buildEntityManifest(values)
  for (const key of Object.keys(SYNC_ENTITY_COLLECTIONS)) {
    const actual = manifest.entities[key] || {}
    const wanted = expected.entities[key] || {}
    for (const id of new Set([...Object.keys(actual), ...Object.keys(wanted)])) {
      if (!actual[id]) issues.push(drift({ key, id, reason: 'manifest-missing-entity' }))
      else if (!wanted[id]) issues.push(drift({ key, id, reason: 'manifest-extra-entity' }))
      else if (JSON.stringify(actual[id]) !== JSON.stringify(wanted[id])) issues.push(drift({ key, id, reason: 'manifest-entity-hash-mismatch' }))
    }
  }
  // 只核对本版本仍在跟踪的 singleton。旧 manifest 里多出来的键（例如退休的
  // sl_food_filters）本版本无法验证，也不代表数据损坏。
  for (const key of Object.keys(expected.singletons)) {
    if (manifest.singletons[key] !== expected.singletons[key]) issues.push(drift({ key, reason: 'manifest-singleton-hash-mismatch' }))
  }
  return issues
}

// 保留旧导出名以兼容现有调用方，但不再依据 updatedAt/deletedAt 推断恢复。
// 客户端 wall-clock 不是删除因果；墓碑只能由 merge 层识别到的明确 restore marker
// 解除。真正的 marker 过滤由 cloudSync 的 removeRestoredTombstones 完成。
/**
 * @param {unknown} values
 * @param {unknown[]} [tombstones=[]]
 * @returns {unknown[]}
 */
export function removeSupersededTombstones(values, tombstones = []) {
  void values
  return cloneSyncValue(tombstones)
}

/**
 * @typedef {{ version: number, hasBaseline: boolean, baseRemoteRevision: number|null, baseline: { entities: Record<string, Record<string, { entityType: string, hash: string, updatedAt: string }>>, singletons: Record<string, string> }, tombstones: unknown[], restoreMarkers: unknown[], baselineTombstones: unknown[], baselineRestoreMarkers: unknown[] }} SyncMetadata
 */

/**
 * @returns {SyncMetadata}
 */
function emptyMetadata() {
  return { version: SYNC_METADATA_VERSION, hasBaseline: false, baseRemoteRevision: null, baseline: { entities: {}, singletons: {} }, tombstones: [], restoreMarkers: [], baselineTombstones: [], baselineRestoreMarkers: [] }
}

/**
 * @returns {SyncMetadata}
 */
export function readSyncMetadata() {
  try {
    const saved = JSON.parse(localStorage.getItem(syncMetadataStorageKey()))
    if (!saved || saved.version !== SYNC_METADATA_VERSION) return emptyMetadata()
    return {
      ...emptyMetadata(),
      ...saved,
      baseline: { entities: saved.baseline?.entities || {}, singletons: saved.baseline?.singletons || {} },
      tombstones: Array.isArray(saved.tombstones) ? saved.tombstones : [],
      restoreMarkers: Array.isArray(saved.restoreMarkers) ? saved.restoreMarkers : [],
      baselineTombstones: Array.isArray(saved.baselineTombstones) ? saved.baselineTombstones : [],
      baselineRestoreMarkers: Array.isArray(saved.baselineRestoreMarkers) ? saved.baselineRestoreMarkers : [],
    }
  } catch {
    return emptyMetadata()
  }
}

/**
 * @param {Partial<SyncMetadata>} value
 * @returns {SyncMetadata}
 */
export function saveSyncMetadata(value) {
  const next = { ...emptyMetadata(), ...cloneSyncValue(value), version: SYNC_METADATA_VERSION }
  try { localStorage.setItem(syncMetadataStorageKey(), JSON.stringify(next)) } catch {}
  return next
}

/**
 * @typedef {{ tombstoneId: string, entityType: string, entityId: string, deletedAt: string, updatedAt: string, revision: number, deviceId: string, baseHash: string }} Tombstone
 */

/**
 * @param {string} entityType
 * @param {string|number} entityId
 * @param {{ now?: Date, deviceId?: string, entity?: unknown }} [options={}]
 * @returns {Tombstone|null}
 */
export function recordTombstone(entityType, entityId, { now = new Date(), deviceId = deviceProfile.value.id, entity = undefined } = {}) {
  if (!entityType || entityId === undefined || entityId === null || String(entityId).trim() === '') return null
  const metadata = readSyncMetadata()
  const id = String(entityId)
  const current = metadata.tombstones.filter((item) => !(item.entityType === entityType && String(item.entityId) === id))
  const previousRevision = metadata.tombstones.reduce((max, item) => Math.max(max, Number(item.revision) || 0), 0)
  const tombstone = {
    tombstoneId: globalThis.crypto?.randomUUID?.() || `tombstone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    entityType,
    entityId: id,
    deletedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: previousRevision + 1,
    deviceId: String(deviceId || ''),
    baseHash: entity === undefined ? '' : hashSyncValue(entity),
  }
  saveSyncMetadata({ ...metadata, tombstones: [...current, tombstone] })
  return tombstone
}

/**
 * @typedef {{ version: number, entityType: string, entityId: string, tombstoneId: string, operationId: string, deviceId: string }} RestoreMarker
 */

/**
 * @param {...RestoreMarker[]} groups
 * @returns {RestoreMarker[]}
 */
export function mergeRestoreMarkers(...groups) {
  const result = new Map()
  for (const item of groups.flat()) {
    if (!item?.entityType || item.entityId === undefined || !item?.tombstoneId || !item?.operationId) continue
    const key = `${item.entityType}:${item.entityId}:${item.tombstoneId}`
    result.set(key, cloneSyncValue(item))
  }
  return [...result.values()]
}

/**
 * @param {string} entityType
 * @param {string|number} entityId
 * @param {Tombstone} tombstone
 * @param {{ operationId: string, deviceId?: string }} [options={}]
 * @returns {RestoreMarker|null}
 */
export function recordRestoreMarker(entityType, entityId, tombstone, { operationId, deviceId = deviceProfile.value.id } = {}) {
  if (!entityType || entityId === undefined || entityId === null || !tombstone?.tombstoneId || !operationId) return null
  const metadata = readSyncMetadata()
  const marker = {
    version: 1,
    entityType,
    entityId: String(entityId),
    tombstoneId: String(tombstone.tombstoneId),
    operationId: String(operationId),
    deviceId: String(deviceId || ''),
  }
  saveSyncMetadata({ ...metadata, restoreMarkers: mergeRestoreMarkers(metadata.restoreMarkers, [marker]) })
  return marker
}

/**
 * @param {string} entityType
 * @param {string|number} entityId
 * @returns {unknown[]}
 */
export function clearTombstone(entityType, entityId) {
  const metadata = readSyncMetadata()
  const id = String(entityId)
  const tombstones = metadata.tombstones.filter((item) => !(item.entityType === entityType && String(item.entityId) === id))
  saveSyncMetadata({ ...metadata, tombstones })
  return tombstones
}

/**
 * @typedef {EntityManifest & { schemaVersion: number, hashVersion: number, generatedAt: string, deviceId: string, tombstones: unknown[], restoreMarkers: unknown[] }} SyncManifest
 */

/**
 * @param {Record<string, unknown>} [values={}]
 * @param {{ tombstones?: unknown[], restoreMarkers?: unknown[], deviceId?: string, schemaVersion?: number }} [options={}]
 * @returns {SyncManifest}
 */
export function buildSyncManifest(values = {}, { tombstones = readSyncMetadata().tombstones, restoreMarkers = readSyncMetadata().restoreMarkers, deviceId = deviceProfile.value.id, schemaVersion = 1 } = {}) {
  return { version: 1, schemaVersion, hashVersion: SYNC_MANIFEST_HASH_VERSION, generatedAt: new Date().toISOString(), deviceId: String(deviceId || ''), ...buildEntityManifest(values), tombstones: cloneSyncValue(tombstones), restoreMarkers: cloneSyncValue(restoreMarkers) }
}

/**
 * 构建增量实体清单：仅包含 updatedAt > sinceTimestamp 的实体
 * 用于增量推送，减少同步载荷
 * @param {Record<string, unknown>} [values={}]
 * @param {string} sinceTimestamp - ISO 字符串时间戳
 * @returns {EntityManifest}
 */
export function buildIncrementalEntityManifest(values = {}, sinceTimestamp) {
  const entities = {}
  const since = new Date(sinceTimestamp).getTime()
  for (const [key, type] of Object.entries(SYNC_ENTITY_COLLECTIONS)) {
    const list = values[key]
    if (!Array.isArray(list)) continue
    entities[key] = {}
    for (const item of list) {
      const id = stableEntityId(key, item)
      if (!id) continue
      const updatedAt = typeof item.updatedAt === 'string' ? new Date(item.updatedAt).getTime() : 0
      if (updatedAt > since) {
        entities[key][id] = { entityType: type, hash: hashSyncValue(item), updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '' }
      }
    }
  }
  // Singletons: always include if changed (no per-item timestamp)
  const singletons = {}
  for (const key of SYNC_SINGLETON_KEYS) {
    if (values[key] !== undefined) singletons[key] = hashSyncValue(values[key])
  }
  return { version: 1, entities, singletons }
}

/**
 * @param {Record<string, unknown>} values
 * @param {{ remoteRevision?: number|null, tombstones?: unknown[], restoreMarkers?: unknown[] }} [options={}]
 * @returns {SyncMetadata}
 */
export function saveSyncBaseline(values, { remoteRevision = null, tombstones = readSyncMetadata().tombstones, restoreMarkers = readSyncMetadata().restoreMarkers } = {}) {
  const metadata = readSyncMetadata()
  const manifest = buildSyncManifest(values, { tombstones, restoreMarkers })
  return saveSyncMetadata({ ...metadata, hasBaseline: true, baseRemoteRevision: remoteRevision, baseline: { entities: manifest.entities, singletons: manifest.singletons }, tombstones: manifest.tombstones, restoreMarkers: manifest.restoreMarkers, baselineTombstones: manifest.tombstones, baselineRestoreMarkers: manifest.restoreMarkers })
}