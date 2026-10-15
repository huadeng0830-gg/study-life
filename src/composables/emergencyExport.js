import { BACKUP_STORAGE_KEYS } from './backupArchive.js'
import { captureAccountDataIdentity } from './accountSyncIdentity.js'
import { getPendingPersistenceKeys, readLatestStoredRaw } from './store/core.js'

const BACKUP_SCHEMA = 'study-life.backup/v1'

/**
 * 只有应急导出会带、常规备份不带的键。
 *
 * 常规备份的文件→存储键映射只有一份，在 BACKUP_STORAGE_KEYS 里。这里不再抄第二份
 * 完整表：抄一份就意味着新增一个备份字段时要记得改两处，而漏改的那一处会让
 * 保存失败时导出的「应急备份」静默缺数据 —— 而那恰恰是用户最需要它完整的时候。
 *
 * 下面这几个键是刻意的例外：退休流程必须先拿到可恢复的副本，才能删除这些旧记录。
 * 当前界面不再恢复它们，但删除之前的最后一版必须还在。
 */
const EMERGENCY_ONLY_FIELDS = Object.freeze({
  sl_food_places: 'foodPlaces', sl_food_history: 'foodHistory',
  sl_food_filters: 'foodFilters', sl_packages: 'packages',
})

/** 存储键 → 备份字段名。与 BACKUP_STORAGE_KEYS 严格取反，再并上退休专用键。 */
const BACKUP_FIELDS = Object.freeze({
  ...Object.fromEntries(Object.entries(BACKUP_STORAGE_KEYS).map(([field, key]) => [key, field])),
  ...EMERGENCY_ONLY_FIELDS,
})

/** 导出用到的全部键；测试据此断言两张表没有分叉。 */
export function emergencyBackupKeys() { return Object.keys(BACKUP_FIELDS) }

function readLocalData() {
  const data = {}
  const missingKeys = []
  const unreadableKeys = []
  for (const [key, field] of Object.entries(BACKUP_FIELDS)) {
    try {
      const raw = readLatestStoredRaw(key)
      if (raw === null) continue
      try { data[field] = JSON.parse(raw) }
      catch { data[field] = raw; unreadableKeys.push(key) }
    } catch {
      missingKeys.push(key)
    }
  }
  return { data, missingKeys, unreadableKeys }
}

export function createEmergencyBackup() {
  const { data, missingKeys, unreadableKeys } = readLocalData()
  data.courses ??= []
  data.countdowns ??= []
  const identity = captureAccountDataIdentity()
  const unsavedKeys = getPendingPersistenceKeys()
  const incompleteKeys = [...new Set([...missingKeys, ...unreadableKeys])]
  data.__owner_id = identity.userId || identity.ownerId || ''
  return {
    app: 'study-life',
    version: 1,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    ownerId: identity.userId || identity.ownerId || '',
    completeness: {
      complete: incompleteKeys.length === 0,
      includesLatestEdits: true,
      unsavedKeys,
      missingKeys,
      unreadableKeys,
    },
    data,
  }
}

export function downloadEmergencyBackup(filename = '三两事-本机数据备份.json') {
  const backup = createEmergencyBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return backup
}
