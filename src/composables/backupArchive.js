import { backupProvidedFields } from './backupRestore.js'
import { normalizeFocusSettings } from './focusTimer.js'
import { normalizePerformanceMode } from './performanceMode.js'

export const BACKUP_STORAGE_KEYS = Object.freeze({
  courses: 'sl_courses',
  countdowns: 'sl_exams',
  tasks: 'sl_tasks',
  events: 'sl_events',
  quickNotes: 'sl_quick_notes',
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
})

/** 备份恢复预览分类；与账号同步协议解耦，范围由备份文件实际携带的字段决定。 */
export const BACKUP_MODULES = Object.freeze([
  { key: 'courses', label: '课程与课表', keys: ['sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_schedule_note', 'sl_ocr_vocabulary', 'sl_course_checkins'] },
  { key: 'tasks', label: '待办与快速记录', keys: ['sl_tasks', 'sl_events', 'sl_quick_notes', 'sl_quick_record_settings', 'sl_capture_enabled'] },
  { key: 'focus', label: '专注记录', keys: ['sl_focus_sessions', 'sl_focus_settings'] },
  { key: 'countdown', label: '重要日期', keys: ['sl_exams', 'sl_countdown_show_past'] },
  { key: 'checklists', label: '清单', keys: ['sl_checklists'] },
  { key: 'ledger', label: '账本', keys: ['sl_bills', 'sl_expenses', 'sl_ledger_categories', 'sl_ledger_freq', 'sl_ledger_fx', 'sl_ledger_budget', 'sl_ledger_templates'] },
  { key: 'appearance', label: '外观与主题', keys: ['sl_theme', 'sl_custom_theme_color', 'sl_high_contrast', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent', 'sl_appearance', 'sl_wallpaper_config', 'sl_performance_mode'] },
  { key: 'atmosphere', label: '氛围与心情', keys: ['sl_festive_config', 'sl_festive_birthday_full', 'sl_mood_log', 'sl_festive_lunar', 'sl_ui_language'] },
  { key: 'reminders', label: '提醒记录', keys: ['sl_reminder_log'] },
])

function readStored(storage, key, fallback) {
  try {
    return JSON.parse(storage.getItem(key)) ?? fallback
  } catch {
    return fallback
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
  return {
    app: 'study-life',
    version: 10,
    schema: 'study-life.backup/v1',
    exportedAt: new Date().toISOString(),
    data: {
      courses: readStored(storage, BACKUP_STORAGE_KEYS.courses, []),
      countdowns: readStored(storage, BACKUP_STORAGE_KEYS.countdowns, []),
      tasks: readStored(storage, BACKUP_STORAGE_KEYS.tasks, []),
      events: readStored(storage, BACKUP_STORAGE_KEYS.events, []),
      quickNotes: readStored(storage, BACKUP_STORAGE_KEYS.quickNotes, []),
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
    },
  }
}

// 校验和固定基于紧凑 JSON：历史备份都是这么算的，改成缩进格式会让旧备份校验失败。
async function backupChecksum(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 在导出可选附件后封存快照；返回新对象，不修改传入的快照。 */
export async function completeBackupArchive(snapshot) {
  return { ...snapshot, checksum: await backupChecksum(snapshot.data) }
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
  if (!value || value.app !== 'study-life' || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(value.version) || !value.data) {
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
  return {
    ...value,
    providedFields: [...backupProvidedFields(data)],
    data: {
      courses: data.courses,
      countdowns: data.countdowns,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      events: Array.isArray(data.events) ? data.events : [],
      quickNotes: Array.isArray(data.quickNotes) ? data.quickNotes : [],
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
      __wallpaper_images: sanitizeWallpaperImages(data.__wallpaper_images),
    },
  }
}

/** 根据备份真实携带字段推导将覆盖的本机数据分区。 */
export function restoreBackupModuleLabels(backup, { storageKeys = BACKUP_STORAGE_KEYS, modules = BACKUP_MODULES } = {}) {
  if (!backup) return []
  const fields = backup.providedFields instanceof Set ? backup.providedFields : new Set(backup.providedFields || [])
  const restoredKeys = Object.entries(storageKeys)
    .filter(([field]) => fields.has(field) && backup.data?.[field] !== null && backup.data?.[field] !== undefined)
    .map(([, key]) => key)
  const labels = modules
    .filter((mod) => mod.keys.some((key) => restoredKeys.includes(key)))
    .map((mod) => mod.label)
  if (restoredKeys.some((key) => !modules.some((mod) => mod.keys.includes(key)))) labels.push('其它本机设置')
  return labels
}
