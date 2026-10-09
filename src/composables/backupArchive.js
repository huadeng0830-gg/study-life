import { backupProvidedFields } from './backupRestore.js'
import { normalizeFocusSettings } from './focusTimer.js'
import { normalizePerformanceMode } from './performanceMode.js'

export const BACKUP_STORAGE_KEYS = Object.freeze({
  courses: 'sl_courses',
  countdowns: 'sl_exams',
  tasks: 'sl_tasks',
  events: 'sl_events',
  quickRecordSettings: 'sl_quick_record_settings',
  captureEnabled: 'sl_capture_enabled',
  focusSessions: 'sl_focus_sessions',
  focusSettings: 'sl_focus_settings',
  courseCheckins: 'sl_course_checkins',
  courseTemplates: 'sl_course_templates',
  checklists: 'sl_checklists',
  bills: 'sl_bills',
  expenses: 'sl_expenses',
  ledgerCategories: 'sl_ledger_categories',
  ledgerFreq: 'sl_ledger_freq',
  ledgerFx: 'sl_ledger_fx',
  ledgerBudget: 'sl_ledger_budget',
  ledgerTemplates: 'sl_ledger_templates',
  timeConfig: 'sl_timecfg',
  semester: 'sl_semester',
  scheduleExceptions: 'sl_schedule_exceptions',
  scheduleNote: 'sl_schedule_note',
  theme: 'sl_theme',
  customThemeColor: 'sl_custom_theme_color',
  highContrast: 'sl_high_contrast',
  countdownShowPast: 'sl_countdown_show_past',
  ocrVocabulary: 'sl_ocr_vocabulary',
  appearance: 'sl_appearance',
  mobileNavigation: 'sl_navigation_mobile',
  desktopNavigation: 'sl_navigation_desktop',
  wallpaperConfig: 'sl_wallpaper_config',
  autoWallpaperColor: 'sl_auto_wallpaper_color',
  wallpaperAccent: 'sl_wallpaper_accent',
  performanceMode: 'sl_performance_mode',
  festiveConfig: 'sl_festive_config',
  festiveBirthdayFull: 'sl_festive_birthday_full',
  festiveLunar: 'sl_festive_lunar',
  uiLanguage: 'sl_ui_language',
  moodLog: 'sl_mood_log',
  reminderLog: 'sl_reminder_log',
  activeFocus: 'sl_focus_active',
  taskCenterLog: 'sl_task_center_log',
  archivedQuickNotes: 'sl_archived_quick_notes',
})

/** 备份恢复预览分类；与账号同步协议解耦，范围由备份文件实际携带的字段决定。 */
export const BACKUP_MODULES = Object.freeze([
  { key: 'courses', label: '课程与课表', keys: ['sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_schedule_note', 'sl_ocr_vocabulary', 'sl_course_checkins'] },
  { key: 'tasks', label: '待办与快速记录', keys: ['sl_tasks', 'sl_events', 'sl_quick_record_settings', 'sl_capture_enabled', 'sl_task_center_log', 'sl_archived_quick_notes'] },
  { key: 'focus', label: '专注记录', keys: ['sl_focus_sessions', 'sl_focus_settings', 'sl_focus_active'] },
  { key: 'countdown', label: '重要日期', keys: ['sl_exams', 'sl_countdown_show_past'] },
  { key: 'checklists', label: '清单', keys: ['sl_checklists'] },
  { key: 'ledger', label: '账本', keys: ['sl_bills', 'sl_expenses', 'sl_ledger_categories', 'sl_ledger_freq', 'sl_ledger_fx', 'sl_ledger_budget', 'sl_ledger_templates'] },
  { key: 'appearance', label: '外观与主题', keys: ['sl_theme', 'sl_custom_theme_color', 'sl_high_contrast', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent', 'sl_appearance', 'sl_wallpaper_config', 'sl_performance_mode', 'sl_navigation_mobile', 'sl_navigation_desktop'] },
  { key: 'atmosphere', label: '氛围与心情', keys: ['sl_festive_config', 'sl_festive_birthday_full', 'sl_mood_log', 'sl_festive_lunar', 'sl_ui_language'] },
  { key: 'reminders', label: '提醒记录', keys: ['sl_reminder_log'] },
])

const BACKUP_ARRAY_FIELDS = ['courses', 'countdowns', 'tasks', 'events', 'focusSessions', 'courseCheckins', 'courseTemplates', 'checklists', 'bills', 'expenses', 'ledgerCategories', 'ledgerTemplates', 'scheduleExceptions', 'festiveLunar', 'reminderLog', 'taskCenterLog', 'archivedQuickNotes']
const BACKUP_ARRAY_KEYS = new Set(BACKUP_ARRAY_FIELDS.map((field) => BACKUP_STORAGE_KEYS[field]))

function readStored(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    if (raw === null || raw === undefined) return fallback
    const value = JSON.parse(raw) ?? fallback
    if (value !== null && BACKUP_ARRAY_KEYS.has(key) && !Array.isArray(value)) {
      throw new Error('记录格式不正确')
    }
    if (key === BACKUP_STORAGE_KEYS.moodLog && (typeof value !== 'object' || Array.isArray(value))) throw new Error('记录格式不正确')
    return value
  } catch (error) {
    const label = BACKUP_MODULES.find((module) => module.keys.includes(key))?.label || '本机数据'
    const detail = error?.message === '记录格式不正确' ? '记录格式不正确' : 'JSON 内容损坏或无法读取'
    throw new Error(`无法备份${label}：${detail}，已停止导出以保留原始数据。`, { cause: error })
  }
}

function browserStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/** 从本机持久化状态创建一份尚未附加可选壁纸与校验和的备份快照。 */
export function createBackupSnapshot(storage = browserStorage()) {
  if (!storage || typeof storage.getItem !== 'function') throw new Error('本机存储不可用，无法安全读取数据。请检查浏览器的存储权限后重试。')
  return {
    app: 'study-life',
    version: 12,
    schema: 'study-life.backup/v1',
    exportedAt: new Date().toISOString(),
    data: {
      courses: readStored(storage, BACKUP_STORAGE_KEYS.courses, []),
      countdowns: readStored(storage, BACKUP_STORAGE_KEYS.countdowns, []),
      tasks: readStored(storage, BACKUP_STORAGE_KEYS.tasks, []),
      events: readStored(storage, BACKUP_STORAGE_KEYS.events, []),
      quickRecordSettings: readStored(storage, BACKUP_STORAGE_KEYS.quickRecordSettings, { clipboardHint: true, recentTypes: [] }),
      captureEnabled: readStored(storage, BACKUP_STORAGE_KEYS.captureEnabled, true),
      focusSessions: readStored(storage, BACKUP_STORAGE_KEYS.focusSessions, []),
      focusSettings: readStored(storage, BACKUP_STORAGE_KEYS.focusSettings, { quickTimes: [15, 25, 45, 60], lastUsedMinutes: 25, recentTemporaries: [], soundEnabled: true, vibrationEnabled: true, systemNotificationEnabled: true }),
      courseCheckins: readStored(storage, BACKUP_STORAGE_KEYS.courseCheckins, []),
      courseTemplates: readStored(storage, BACKUP_STORAGE_KEYS.courseTemplates, []),
      checklists: readStored(storage, BACKUP_STORAGE_KEYS.checklists, []),
      bills: readStored(storage, BACKUP_STORAGE_KEYS.bills, []),
      expenses: readStored(storage, BACKUP_STORAGE_KEYS.expenses, []),
      ledgerCategories: readStored(storage, BACKUP_STORAGE_KEYS.ledgerCategories, null),
      ledgerFreq: readStored(storage, BACKUP_STORAGE_KEYS.ledgerFreq, null),
      ledgerFx: readStored(storage, BACKUP_STORAGE_KEYS.ledgerFx, null),
      ledgerBudget: readStored(storage, BACKUP_STORAGE_KEYS.ledgerBudget, null),
      ledgerTemplates: readStored(storage, BACKUP_STORAGE_KEYS.ledgerTemplates, []),
      timeConfig: readStored(storage, BACKUP_STORAGE_KEYS.timeConfig, null),
      semester: readStored(storage, BACKUP_STORAGE_KEYS.semester, null),
      scheduleExceptions: readStored(storage, BACKUP_STORAGE_KEYS.scheduleExceptions, []),
      scheduleNote: readStored(storage, BACKUP_STORAGE_KEYS.scheduleNote, ''),
      theme: readStored(storage, BACKUP_STORAGE_KEYS.theme, 'blue'),
      customThemeColor: readStored(storage, BACKUP_STORAGE_KEYS.customThemeColor, '#456fe8'),
      highContrast: readStored(storage, BACKUP_STORAGE_KEYS.highContrast, false),
      countdownShowPast: readStored(storage, BACKUP_STORAGE_KEYS.countdownShowPast, false),
      ocrVocabulary: readStored(storage, BACKUP_STORAGE_KEYS.ocrVocabulary, { courses: [], teachers: [], rooms: [], campuses: [] }),
      appearance: readStored(storage, BACKUP_STORAGE_KEYS.appearance, null),
      mobileNavigation: readStored(storage, BACKUP_STORAGE_KEYS.mobileNavigation, null),
      desktopNavigation: readStored(storage, BACKUP_STORAGE_KEYS.desktopNavigation, null),
      wallpaperConfig: readStored(storage, BACKUP_STORAGE_KEYS.wallpaperConfig, null),
      autoWallpaperColor: readStored(storage, BACKUP_STORAGE_KEYS.autoWallpaperColor, false),
      wallpaperAccent: readStored(storage, BACKUP_STORAGE_KEYS.wallpaperAccent, '#456fe8'),
      performanceMode: readStored(storage, BACKUP_STORAGE_KEYS.performanceMode, 'auto'),
      festiveConfig: readStored(storage, BACKUP_STORAGE_KEYS.festiveConfig, { enabled: true, birthday: '', installDate: '', anniversaries: [] }),
      festiveBirthdayFull: readStored(storage, BACKUP_STORAGE_KEYS.festiveBirthdayFull, ''),
      festiveLunar: readStored(storage, BACKUP_STORAGE_KEYS.festiveLunar, []),
      uiLanguage: readStored(storage, BACKUP_STORAGE_KEYS.uiLanguage, 'zh'),
      moodLog: readStored(storage, BACKUP_STORAGE_KEYS.moodLog, {}),
      reminderLog: readStored(storage, BACKUP_STORAGE_KEYS.reminderLog, []),
      activeFocus: readStored(storage, BACKUP_STORAGE_KEYS.activeFocus, null),
      taskCenterLog: readStored(storage, BACKUP_STORAGE_KEYS.taskCenterLog, []),
      archivedQuickNotes: readStored(storage, BACKUP_STORAGE_KEYS.archivedQuickNotes, []),
    },
  }
}

// 校验和固定基于紧凑 JSON：历史备份都是这么算的，改成缩进格式会让旧备份校验失败。
async function checksumSerializedJson(serialized) {
  const bytes = new TextEncoder().encode(serialized)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function backupChecksum(data) {
  return checksumSerializedJson(JSON.stringify(data))
}

/** 在导出可选附件后封存快照；返回新对象，不修改传入的快照。 */
export async function completeBackupArchive(snapshot) {
  return { ...snapshot, checksum: await backupChecksum(snapshot.data) }
}

/**
 * 给下载直接提供 Blob 分片：数据只序列化一次，避免「校验和 JSON + 完整归档 JSON」
 * 同时在内存里保留两份大文本。返回数组可直接传给 Blob，无需先 join。
 */
export async function createBackupArchiveParts(snapshot) {
  const serializedData = JSON.stringify(snapshot.data)
  const checksum = await checksumSerializedJson(serializedData)
  const { data: _data, checksum: _oldChecksum, ...metadata } = snapshot
  const metadataJson = JSON.stringify(metadata)
  return [
    `${metadataJson.slice(0, -1)},"data":`,
    serializedData,
    `,"checksum":${JSON.stringify(checksum)}}`,
  ]
}

function sanitizeWallpaperImages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value).filter(
    ([target, dataUrl]) => typeof target === 'string' && /^data:image\//.test(String(dataUrl))
  )
  return entries.length ? Object.fromEntries(entries) : null
}

/** 校验并归一化导入内容，同时保留原文件实际携带的字段供恢复流程使用。 */
export async function parseBackupArchive(value) {
  if (!value || value.app !== 'study-life' || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(value.version) || !value.data) {
    throw new Error('这不是有效的控制台备份文件')
  }
  if (value.version >= 7 && value.schema !== 'study-life.backup/v1') {
    throw new Error('备份文件版本不受支持')
  }
  // v7 起必须带校验和；v1–v6 的老备份（含应急导出）仍然可以不带。
  const checksum = typeof value.checksum === 'string' ? value.checksum : ''
  if (value.version >= 7 && !checksum) {
    throw new Error('备份文件缺少校验和，无法确认文件完整性')
  }
  if (checksum && checksum !== await backupChecksum(value.data)) {
    throw new Error('备份文件校验失败，文件可能已损坏或被修改')
  }
  const data = value.data
  if (!Array.isArray(data.courses) || !Array.isArray(data.countdowns)) {
    throw new Error('备份文件中的课程或重要日期数据不完整')
  }
  for (const field of BACKUP_ARRAY_FIELDS) {
    if (data[field] === null || data[field] === undefined || Array.isArray(data[field])) continue
    const module = BACKUP_MODULES.find((item) => item.keys.includes(BACKUP_STORAGE_KEYS[field]))
    throw new Error(`备份中的${module?.label || '记录'}格式不正确，恢复已停止，请在原设备重新导出。`)
  }
  if (data.moodLog !== null && data.moodLog !== undefined && (typeof data.moodLog !== 'object' || Array.isArray(data.moodLog))) {
    throw new Error('备份中的心情记录格式不正确，恢复已停止。')
  }
  return {
    ...value,
    providedFields: [...backupProvidedFields(data)].filter((field) => data[field] !== null && data[field] !== undefined),
    data: {
      courses: data.courses,
      countdowns: data.countdowns,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      events: Array.isArray(data.events) ? data.events : [],
      quickRecordSettings: data.quickRecordSettings && typeof data.quickRecordSettings === 'object' ? data.quickRecordSettings : { clipboardHint: true, recentTypes: [] },
      captureEnabled: typeof data.captureEnabled === 'boolean' ? data.captureEnabled : true,
      focusSessions: Array.isArray(data.focusSessions) ? data.focusSessions : [],
      focusSettings: data.focusSettings && typeof data.focusSettings === 'object' ? normalizeFocusSettings(data.focusSettings) : { quickTimes: [15, 25, 45, 60], lastUsedMinutes: 25, recentTemporaries: [], soundEnabled: true, vibrationEnabled: true, systemNotificationEnabled: true },
      courseCheckins: Array.isArray(data.courseCheckins) ? data.courseCheckins : [],
      courseTemplates: Array.isArray(data.courseTemplates) ? data.courseTemplates : [],
      checklists: Array.isArray(data.checklists) ? data.checklists : [],
      bills: Array.isArray(data.bills) ? data.bills : [],
      expenses: Array.isArray(data.expenses) ? data.expenses : [],
      ledgerCategories: Array.isArray(data.ledgerCategories) ? data.ledgerCategories : null,
      ledgerFreq: data.ledgerFreq && typeof data.ledgerFreq === 'object' ? data.ledgerFreq : null,
      ledgerFx: data.ledgerFx && typeof data.ledgerFx === 'object' ? data.ledgerFx : null,
      ledgerBudget: data.ledgerBudget && typeof data.ledgerBudget === 'object' ? data.ledgerBudget : null,
      ledgerTemplates: Array.isArray(data.ledgerTemplates) ? data.ledgerTemplates : [],
      timeConfig: data.timeConfig && typeof data.timeConfig === 'object' ? data.timeConfig : null,
      semester: data.semester && typeof data.semester === 'object' ? data.semester : null,
      scheduleExceptions: Array.isArray(data.scheduleExceptions) ? data.scheduleExceptions : [],
      scheduleNote: typeof data.scheduleNote === 'string' ? data.scheduleNote : '',
      theme: typeof data.theme === 'string' ? data.theme : 'blue',
      customThemeColor: typeof data.customThemeColor === 'string' ? data.customThemeColor : '#456fe8',
      highContrast: typeof data.highContrast === 'boolean' ? data.highContrast : false,
      countdownShowPast: Boolean(data.countdownShowPast),
      ocrVocabulary: data.ocrVocabulary && typeof data.ocrVocabulary === 'object' ? data.ocrVocabulary : { courses: [], teachers: [], rooms: [], campuses: [] },
      appearance: data.appearance && typeof data.appearance === 'object' ? data.appearance : null,
      wallpaperConfig: data.wallpaperConfig && typeof data.wallpaperConfig === 'object' ? data.wallpaperConfig : null,
      autoWallpaperColor: Boolean(data.autoWallpaperColor),
      wallpaperAccent: typeof data.wallpaperAccent === 'string' ? data.wallpaperAccent : '#456fe8',
      performanceMode: normalizePerformanceMode(data.performanceMode),
      festiveConfig: data.festiveConfig && typeof data.festiveConfig === 'object' ? data.festiveConfig : { enabled: true, birthday: '', installDate: '', anniversaries: [] },
      festiveBirthdayFull: typeof data.festiveBirthdayFull === 'string' ? data.festiveBirthdayFull : '',
      festiveLunar: Array.isArray(data.festiveLunar) ? data.festiveLunar : [],
      uiLanguage: typeof data.uiLanguage === 'string' ? data.uiLanguage : 'zh',
      moodLog: data.moodLog && typeof data.moodLog === 'object' ? data.moodLog : {},
      reminderLog: Array.isArray(data.reminderLog) ? data.reminderLog : [],
      activeFocus: data.activeFocus && typeof data.activeFocus === 'object' ? data.activeFocus : null,
      taskCenterLog: Array.isArray(data.taskCenterLog) ? data.taskCenterLog : [],
      archivedQuickNotes: Array.isArray(data.archivedQuickNotes) ? data.archivedQuickNotes : [],
      __wallpaper_images: sanitizeWallpaperImages(data.__wallpaper_images),
    },
  }
}

/** 根据备份真实携带字段推导可选恢复分区，分类与实际存储映射保持同源。 */
export function restoreBackupModuleOptions(backup, { storageKeys = BACKUP_STORAGE_KEYS, modules = BACKUP_MODULES } = {}) {
  if (!backup) return []
  const fields = backup.providedFields instanceof Set ? backup.providedFields : new Set(backup.providedFields || [])
  const sourceFields = Object.entries(storageKeys)
    .filter(([field]) => fields.has(field) && backup.data?.[field] !== null && backup.data?.[field] !== undefined)
  const options = modules.flatMap((mod) => {
    const selectedFields = sourceFields
      .filter(([, key]) => mod.keys.includes(key))
      .map(([field]) => field)
    return selectedFields.length ? [{ id: mod.key, label: mod.label, fields: selectedFields }] : []
  })
  const categorizedKeys = new Set(modules.flatMap((mod) => mod.keys))
  const otherFields = sourceFields
    .filter(([, key]) => !categorizedKeys.has(key))
    .map(([field]) => field)
  if (otherFields.length) options.push({ id: 'other', label: '其它本机设置', fields: otherFields })
  return options
}

/** 给选择性恢复生成准确范围；未传选择时保持旧调用的“全部模块”行为。 */
export function restoreBackupModuleLabels(backup, { storageKeys = BACKUP_STORAGE_KEYS, modules = BACKUP_MODULES, selectedModuleIds = null } = {}) {
  const options = restoreBackupModuleOptions(backup, { storageKeys, modules })
  const selected = selectedModuleIds ? new Set(selectedModuleIds) : null
  return options.filter((option) => !selected || selected.has(option.id)).map((option) => option.label)
}

/** 返回选择的分区实际允许写入的备份字段。 */
export function restoreBackupSelectedFields(backup, selectedModuleIds, { storageKeys = BACKUP_STORAGE_KEYS, modules = BACKUP_MODULES } = {}) {
  const selected = new Set(selectedModuleIds || [])
  return restoreBackupModuleOptions(backup, { storageKeys, modules })
    .filter((option) => selected.has(option.id))
    .flatMap((option) => option.fields)
}
