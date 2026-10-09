import { BACKUP_MODULES, BACKUP_STORAGE_KEYS, restoreBackupModuleOptions } from './backupArchive.js'
import { measureLocalBusinessStorage } from './localStorageUsage.js'

// 分开统计记录和配置，避免把预算、主题、作息等配置误报成用户记录。
const RECORD_FIELDS = Object.freeze({
  courses: ['课程', '门'], courseTemplates: ['课程模板', '套'], courseCheckins: ['课程打卡', '次'],
  scheduleExceptions: ['调课', '条'], tasks: ['待办', '项'], events: ['日程', '项'],
  taskCenterLog: ['快捷记录', '条'], archivedQuickNotes: ['存档笔记', '条'],
  focusSessions: ['专注', '次'], countdowns: ['重要日期', '个'], checklists: ['清单', '份'],
  bills: ['账单', '笔'], expenses: ['收支', '笔'], moodLog: ['心情', '天'], reminderLog: ['提醒', '条'],
})

function countRecords(field, value) {
  if (field === 'moodLog') return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0
  return Array.isArray(value) ? value.length : 0
}

function describeData(data, fields) {
  let recordCount = 0
  let settingCount = 0
  const details = []
  for (const field of fields) {
    if (data[field] === null || data[field] === undefined) continue
    if (Object.hasOwn(RECORD_FIELDS, field)) {
      const count = countRecords(field, data[field])
      recordCount += count
      const [label, unit] = RECORD_FIELDS[field]
      details.push(`${label} ${count.toLocaleString()} ${unit}`)
    } else settingCount += 1
  }
  return { recordCount, settingCount, text: `${recordCount.toLocaleString()} 项记录${settingCount ? ` · ${settingCount} 项设置` : ''}`, detail: details.join(' · ') }
}

export function formatDataSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 只读取本机数据；损坏字段单独报告，保留其它分区的统计。 */
export function readDataInventory(storage = globalThis.localStorage) {
  const data = {}
  const sizes = {}
  const issues = []
  const fieldLabels = Object.fromEntries(BACKUP_MODULES.flatMap((mod) => mod.keys.map((key) => [key, mod.label])))
  const usage = measureLocalBusinessStorage(storage)
  for (const [field, key] of Object.entries(BACKUP_STORAGE_KEYS)) {
    const raw = storage.getItem(key)
    if (raw === null) continue
    sizes[field] = (key.length + raw.length) * 2
    try {
      const value = JSON.parse(raw)
      if (value !== null && Object.hasOwn(RECORD_FIELDS, field)
        && (field === 'moodLog' ? typeof value !== 'object' || Array.isArray(value) : !Array.isArray(value))) throw new Error('记录格式不正确')
      data[field] = value
    } catch { issues.push({ field, label: fieldLabels[key] || '其它本机设置' }) }
  }
  const modules = BACKUP_MODULES.map((mod) => {
    const fields = Object.entries(BACKUP_STORAGE_KEYS).filter(([, key]) => mod.keys.includes(key)).map(([field]) => field)
    return {
      id: mod.key, label: mod.label, ...describeData(data, fields),
      bytes: fields.reduce((total, field) => total + (sizes[field] || 0), 0),
      hasIssue: issues.some((issue) => fields.includes(issue.field)),
    }
  })
  return { data, modules, issues, usage, recordCount: modules.reduce((total, mod) => total + mod.recordCount, 0) }
}

/** 对照范围只使用实际将写入的字段，旧备份没有的字段不会计入或提示覆盖。 */
export function buildRestorePreview(backup, inventory) {
  return restoreBackupModuleOptions(backup).map((option) => {
    const incoming = describeData(backup.data, option.fields)
    const current = inventory ? describeData(inventory.data, option.fields) : null
    const cleared = option.fields.filter((field) => Object.hasOwn(RECORD_FIELDS, field)
      && countRecords(field, backup.data[field]) === 0 && countRecords(field, inventory?.data[field]) > 0)
    const hasLocalIssue = Boolean(inventory?.issues.some((issue) => option.fields.includes(issue.field)))
    return {
      ...option, backupText: incoming.text, backupDetail: incoming.detail,
      localText: hasLocalIssue ? '部分本机数据无法读取' : current?.text || '本机数量暂不可用',
      clearsRecords: cleared.length > 0, clearedLabels: cleared.map((field) => RECORD_FIELDS[field][0]).join('、'),
    }
  })
}
