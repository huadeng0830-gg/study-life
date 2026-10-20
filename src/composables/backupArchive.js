import { backupProvidedFields } from './backupRestore.js'
import { normalizeFocusSettings } from './focusTimer.js'
// 语言清单放在零依赖的模块里：备份解析要校验它，却不能为了校验就把存储层拉进来。
import {
  DEFAULT_NARRATIVE_LANGUAGE,
  isNarrativeLanguage,
} from './narrativeLanguages.js'
import { normalizePerformanceMode } from './performanceMode.js'
import { isWeeklyReflectionsShape, normalizeWeeklyReflections } from './weeklyReflections.js'
import { normalizeNoticeRecord } from './noticeArchiveModel.js'
import { DEFAULT_DATA_HEALTH_THRESHOLDS, normalizeDataHealthThresholds } from './dataHealthReport.js'
import { normalizePlaceOffer, normalizePlaceRecord, normalizePlaceVisit } from './placeModels.js'
import { getPendingPersistenceKeys, readLatestStoredRaw } from './store/snapshotAccess.js'

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
  places: 'sl_places',
  placeVisits: 'sl_place_visits',
  placeOffers: 'sl_place_offers',
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
  countdownView: 'sl_countdown_view',
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
  lastFocusCompleted: 'sl_focus_last_completed',
  taskCenterLog: 'sl_task_center_log',
  archivedQuickNotes: 'sl_archived_quick_notes',
  notices: 'sl_notices',
  noticeSources: 'sl_notice_sources',
  dataHealthSettings: 'sl_data_health_settings',
  weeklyReflections: 'sl_weekly_reflections',
})

/** 备份恢复预览分类；与账号同步协议解耦，范围由备份文件实际携带的字段决定。 */
export const BACKUP_MODULES = Object.freeze([
  { key: 'courses', label: '课程与课表', keys: ['sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester', 'sl_schedule_exceptions', 'sl_schedule_note', 'sl_ocr_vocabulary', 'sl_course_checkins'] },
  { key: 'tasks', label: '待办与快速记录', keys: ['sl_tasks', 'sl_events', 'sl_quick_record_settings', 'sl_capture_enabled', 'sl_task_center_log', 'sl_archived_quick_notes'] },
  { key: 'focus', label: '专注记录', keys: ['sl_focus_sessions', 'sl_focus_settings', 'sl_focus_active', 'sl_focus_last_completed'] },
  { key: 'countdown', label: '重要日期', keys: ['sl_exams', 'sl_countdown_show_past', 'sl_countdown_view'] },
  { key: 'checklists', label: '清单', keys: ['sl_checklists'] },
  { key: 'ledger', label: '账本', keys: ['sl_bills', 'sl_expenses', 'sl_ledger_categories', 'sl_ledger_freq', 'sl_ledger_fx', 'sl_ledger_budget', 'sl_ledger_templates'] },
  { key: 'places', label: '地点记录', keys: ['sl_places', 'sl_place_visits', 'sl_place_offers'] },
  { key: 'appearance', label: '外观与主题', keys: ['sl_theme', 'sl_custom_theme_color', 'sl_high_contrast', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent', 'sl_appearance', 'sl_wallpaper_config', 'sl_performance_mode', 'sl_navigation_mobile', 'sl_navigation_desktop'] },
  { key: 'atmosphere', label: '氛围与心情', keys: ['sl_festive_config', 'sl_festive_birthday_full', 'sl_mood_log', 'sl_festive_lunar', 'sl_ui_language'] },
  { key: 'reminders', label: '提醒记录', keys: ['sl_reminder_log'] },
  { key: 'notices', label: '通知档案', keys: ['sl_notices', 'sl_notice_sources'] },
  { key: 'data-health', label: '数据体检设置', keys: ['sl_data_health_settings'] },
  { key: 'reviews', label: '周回顾记录', keys: ['sl_weekly_reflections'] },
])

const BACKUP_ARRAY_FIELDS = ['courses', 'countdowns', 'tasks', 'events', 'focusSessions', 'courseCheckins', 'courseTemplates', 'checklists', 'bills', 'expenses', 'places', 'placeVisits', 'placeOffers', 'ledgerCategories', 'ledgerTemplates', 'scheduleExceptions', 'festiveLunar', 'reminderLog', 'taskCenterLog', 'archivedQuickNotes', 'notices', 'noticeSources']
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
    if (key === BACKUP_STORAGE_KEYS.weeklyReflections && !isWeeklyReflectionsShape(value)) throw new Error('记录格式不正确')
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
export function createBackupSnapshot(storage = browserStorage(), metadata = {}) {
  if (!storage || typeof storage.getItem !== 'function') throw new Error('本机存储不可用，无法安全读取数据。请检查浏览器的存储权限后重试。')
  const latestStorage = { getItem: (key) => readLatestStoredRaw(key, storage) }
  let ownerId = metadata.ownerId
  if (ownerId === undefined) {
    try { ownerId = storage.getItem('study-life-data-owner') || '' } catch { ownerId = '' }
  }
  const unsavedKeys = metadata.unsavedKeys || getPendingPersistenceKeys()
  const snapshot = {
    app: 'study-life',
    version: BACKUP_ARCHIVE_VERSION,
    schema: 'study-life.backup/v1',
    exportedAt: new Date().toISOString(),
    ownerId: ownerId || '',
    completeness: { complete: true, includesLatestEdits: true, unsavedKeys: [...unsavedKeys], missingKeys: [] },
    data: {
      courses: readStored(latestStorage, BACKUP_STORAGE_KEYS.courses, []),
      countdowns: readStored(latestStorage, BACKUP_STORAGE_KEYS.countdowns, []),
      tasks: readStored(latestStorage, BACKUP_STORAGE_KEYS.tasks, []),
      events: readStored(latestStorage, BACKUP_STORAGE_KEYS.events, []),
      quickRecordSettings: readStored(latestStorage, BACKUP_STORAGE_KEYS.quickRecordSettings, { clipboardHint: true, recentTypes: [] }),
      captureEnabled: readStored(latestStorage, BACKUP_STORAGE_KEYS.captureEnabled, true),
      focusSessions: readStored(latestStorage, BACKUP_STORAGE_KEYS.focusSessions, []),
      focusSettings: readStored(latestStorage, BACKUP_STORAGE_KEYS.focusSettings, { quickTimes: [15, 25, 45, 60], lastUsedMinutes: 25, recentTemporaries: [], soundEnabled: true, vibrationEnabled: true, systemNotificationEnabled: true }),
      courseCheckins: readStored(latestStorage, BACKUP_STORAGE_KEYS.courseCheckins, []),
      courseTemplates: readStored(latestStorage, BACKUP_STORAGE_KEYS.courseTemplates, []),
      checklists: readStored(latestStorage, BACKUP_STORAGE_KEYS.checklists, []),
      bills: readStored(latestStorage, BACKUP_STORAGE_KEYS.bills, []),
      expenses: readStored(latestStorage, BACKUP_STORAGE_KEYS.expenses, []),
      places: readStored(latestStorage, BACKUP_STORAGE_KEYS.places, []),
      placeVisits: readStored(latestStorage, BACKUP_STORAGE_KEYS.placeVisits, []),
      placeOffers: readStored(latestStorage, BACKUP_STORAGE_KEYS.placeOffers, []),
      ledgerCategories: readStored(latestStorage, BACKUP_STORAGE_KEYS.ledgerCategories, null),
      ledgerFreq: readStored(latestStorage, BACKUP_STORAGE_KEYS.ledgerFreq, null),
      ledgerFx: readStored(latestStorage, BACKUP_STORAGE_KEYS.ledgerFx, null),
      ledgerBudget: readStored(latestStorage, BACKUP_STORAGE_KEYS.ledgerBudget, null),
      ledgerTemplates: readStored(latestStorage, BACKUP_STORAGE_KEYS.ledgerTemplates, []),
      timeConfig: readStored(latestStorage, BACKUP_STORAGE_KEYS.timeConfig, null),
      semester: readStored(latestStorage, BACKUP_STORAGE_KEYS.semester, null),
      scheduleExceptions: readStored(latestStorage, BACKUP_STORAGE_KEYS.scheduleExceptions, []),
      scheduleNote: readStored(latestStorage, BACKUP_STORAGE_KEYS.scheduleNote, ''),
      theme: readStored(latestStorage, BACKUP_STORAGE_KEYS.theme, 'blue'),
      customThemeColor: readStored(latestStorage, BACKUP_STORAGE_KEYS.customThemeColor, '#456fe8'),
      highContrast: readStored(latestStorage, BACKUP_STORAGE_KEYS.highContrast, false),
      countdownShowPast: readStored(latestStorage, BACKUP_STORAGE_KEYS.countdownShowPast, false),
      countdownView: readStored(latestStorage, BACKUP_STORAGE_KEYS.countdownView, 'list'),
      ocrVocabulary: readStored(latestStorage, BACKUP_STORAGE_KEYS.ocrVocabulary, { courses: [], teachers: [], rooms: [], campuses: [] }),
      appearance: readStored(latestStorage, BACKUP_STORAGE_KEYS.appearance, null),
      mobileNavigation: readStored(latestStorage, BACKUP_STORAGE_KEYS.mobileNavigation, null),
      desktopNavigation: readStored(latestStorage, BACKUP_STORAGE_KEYS.desktopNavigation, null),
      wallpaperConfig: readStored(latestStorage, BACKUP_STORAGE_KEYS.wallpaperConfig, null),
      autoWallpaperColor: readStored(latestStorage, BACKUP_STORAGE_KEYS.autoWallpaperColor, false),
      wallpaperAccent: readStored(latestStorage, BACKUP_STORAGE_KEYS.wallpaperAccent, '#456fe8'),
      performanceMode: readStored(latestStorage, BACKUP_STORAGE_KEYS.performanceMode, 'auto'),
      festiveConfig: readStored(latestStorage, BACKUP_STORAGE_KEYS.festiveConfig, { enabled: true, birthday: '', installDate: '', anniversaries: [] }),
      festiveBirthdayFull: readStored(latestStorage, BACKUP_STORAGE_KEYS.festiveBirthdayFull, ''),
      festiveLunar: readStored(latestStorage, BACKUP_STORAGE_KEYS.festiveLunar, []),
      uiLanguage: readStored(latestStorage, BACKUP_STORAGE_KEYS.uiLanguage, 'zh'),
      moodLog: readStored(latestStorage, BACKUP_STORAGE_KEYS.moodLog, {}),
      reminderLog: readStored(latestStorage, BACKUP_STORAGE_KEYS.reminderLog, []),
      activeFocus: readStored(latestStorage, BACKUP_STORAGE_KEYS.activeFocus, null),
      taskCenterLog: readStored(latestStorage, BACKUP_STORAGE_KEYS.taskCenterLog, []),
      archivedQuickNotes: readStored(latestStorage, BACKUP_STORAGE_KEYS.archivedQuickNotes, []),
      notices: readStored(latestStorage, BACKUP_STORAGE_KEYS.notices, []),
      noticeSources: readStored(latestStorage, BACKUP_STORAGE_KEYS.noticeSources, []),
      dataHealthSettings: readStored(latestStorage, BACKUP_STORAGE_KEYS.dataHealthSettings, { ...DEFAULT_DATA_HEALTH_THRESHOLDS }),
      weeklyReflections: readStored(latestStorage, BACKUP_STORAGE_KEYS.weeklyReflections, {}),
    },
  }
  // Keep the source claim inside the checksum-covered payload as well as in
  // its metadata. A mismatched metadata edit must fail closed during import.
  snapshot.data.__owner_id = ownerId || ''
  return snapshot
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

/** 导出使用的备份格式版本。与 SUPPORTED_BACKUP_VERSIONS 同源，不需要手动同步两处。 */
export const BACKUP_ARCHIVE_VERSION = 16
/** 可以恢复的历史版本。升版本时只要改 BACKUP_ARCHIVE_VERSION。 */
export const SUPPORTED_BACKUP_VERSIONS = Object.freeze(Array.from({ length: BACKUP_ARCHIVE_VERSION }, (_, index) => index + 1))

/**
 * 数组字段的最小结构约定：元素必须是普通对象。
 *
 * 之前的导入校验只看 `Array.isArray(data[field])`，于是
 * `tasks: [null, "随便写的", {}]` 这种文件能一路通过校验、被原样写进
 * `sl_tasks`，直到某个页面读它时才在渲染过程中崩掉 —— 而那已经发生在
 * 恢复之后，用户换不回原来的数据了。
 *
 * 只守「是对象」这一条，不要求 `id`：备份里各分区的身份键并不统一
 * （账本分类用 `key`，课程和待办用 `id`），强行要求会把历史备份挡在门外。
 * 字段缺失交给各分区自己的 normalize 处理。
 */
function malformedArrayField(data) {
  for (const field of BACKUP_ARRAY_FIELDS) {
    const value = data[field]
    if (!Array.isArray(value)) continue
    if (value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
      return BACKUP_MODULES.find((item) => item.keys.includes(BACKUP_STORAGE_KEYS[field]))?.label || '记录'
    }
  }
  return ''
}

/** 校验并归一化导入内容，同时保留原文件实际携带的字段供恢复流程使用。 */
export async function parseBackupArchive(value) {
  if (!value || value.app !== 'study-life' || !value.data) {
    throw new Error('这不是有效的控制台备份文件')
  }
  // 来自更新版本的备份要单独说清楚。以前它落进上面的兜底分支，报的是
  // 「这不是有效的控制台备份文件」——用户会以为文件坏了，于是去重装应用，
  // 而真正需要做的只是升级应用。
  if (!SUPPORTED_BACKUP_VERSIONS.includes(value.version)) {
    if (Number.isInteger(value.version) && value.version > BACKUP_ARCHIVE_VERSION) {
      throw new Error(`这份备份来自更新的版本（v${value.version}），请先升级应用再恢复。`)
    }
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
  if (value.version >= 13 && (typeof data.__owner_id !== 'string' || value.ownerId !== data.__owner_id)) {
    throw new Error('备份来源账号信息不一致，已停止恢复。请从原设备重新导出。')
  }
  if (!Array.isArray(data.courses) || !Array.isArray(data.countdowns)) {
    throw new Error('备份文件中的课程或重要日期数据不完整')
  }
  for (const field of BACKUP_ARRAY_FIELDS) {
    if (data[field] === null || data[field] === undefined || Array.isArray(data[field])) continue
    const module = BACKUP_MODULES.find((item) => item.keys.includes(BACKUP_STORAGE_KEYS[field]))
    throw new Error(`备份中的${module?.label || '记录'}格式不正确，恢复已停止，请在原设备重新导出。`)
  }
  const malformed = malformedArrayField(data)
  if (malformed) throw new Error(`备份中的${malformed}里有格式不正确的条目，恢复已停止，请在原设备重新导出。`)
  if (data.moodLog !== null && data.moodLog !== undefined && (typeof data.moodLog !== 'object' || Array.isArray(data.moodLog))) {
    throw new Error('备份中的心情记录格式不正确，恢复已停止。')
  }
  if (data.weeklyReflections !== null && data.weeklyReflections !== undefined && !isWeeklyReflectionsShape(data.weeklyReflections)) {
    throw new Error('备份中的周回顾记录格式不正确，恢复已停止。')
  }
  if (Array.isArray(data.notices) && data.notices.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
    || typeof item.id !== 'string' || !item.id.trim() || typeof item.raw !== 'string' || !item.raw.trim())) {
    throw new Error('备份中的通知档案格式不正确，恢复已停止。')
  }
  if (Array.isArray(data.noticeSources) && data.noticeSources.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
    || typeof item.id !== 'string' || !item.id.trim() || typeof item.source !== 'string' || typeof item.muted !== 'boolean')) {
    throw new Error('备份中的通知来源设置格式不正确，恢复已停止。')
  }
  if (data.dataHealthSettings !== null && data.dataHealthSettings !== undefined
    && (typeof data.dataHealthSettings !== 'object' || Array.isArray(data.dataHealthSettings))) {
    throw new Error('备份中的数据体检设置格式不正确，恢复已停止。')
  }
  return {
    ...value,
    ownerId: typeof value.ownerId === 'string' ? value.ownerId : (typeof data.__owner_id === 'string' ? data.__owner_id : ''),
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
      places: Array.isArray(data.places) ? data.places.map((item) => normalizePlaceRecord(item)) : [],
      placeVisits: Array.isArray(data.placeVisits) ? data.placeVisits.map((item) => {
        const place = (data.places || []).find((entry) => String(entry?.id) === String(item?.placeId))
        return normalizePlaceVisit(item, place?.category || 'food')
      }) : [],
      placeOffers: Array.isArray(data.placeOffers) ? data.placeOffers.map((item) => normalizePlaceOffer(item)) : [],
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
      countdownView: data.countdownView === 'calendar' ? 'calendar' : 'list',
      ocrVocabulary: data.ocrVocabulary && typeof data.ocrVocabulary === 'object' ? data.ocrVocabulary : { courses: [], teachers: [], rooms: [], campuses: [] },
      appearance: data.appearance && typeof data.appearance === 'object' ? data.appearance : null,
      wallpaperConfig: data.wallpaperConfig && typeof data.wallpaperConfig === 'object' ? data.wallpaperConfig : null,
      autoWallpaperColor: Boolean(data.autoWallpaperColor),
      wallpaperAccent: typeof data.wallpaperAccent === 'string' ? data.wallpaperAccent : '#456fe8',
      performanceMode: normalizePerformanceMode(data.performanceMode),
      festiveConfig: data.festiveConfig && typeof data.festiveConfig === 'object' ? data.festiveConfig : { enabled: true, birthday: '', installDate: '', anniversaries: [] },
      festiveBirthdayFull: typeof data.festiveBirthdayFull === 'string' ? data.festiveBirthdayFull : '',
      festiveLunar: Array.isArray(data.festiveLunar) ? data.festiveLunar : [],
      uiLanguage: isNarrativeLanguage(data.uiLanguage) ? data.uiLanguage : DEFAULT_NARRATIVE_LANGUAGE,
      moodLog: data.moodLog && typeof data.moodLog === 'object' ? data.moodLog : {},
      reminderLog: Array.isArray(data.reminderLog) ? data.reminderLog : [],
      activeFocus: data.activeFocus && typeof data.activeFocus === 'object' ? data.activeFocus : null,
      taskCenterLog: Array.isArray(data.taskCenterLog) ? data.taskCenterLog : [],
      archivedQuickNotes: Array.isArray(data.archivedQuickNotes) ? data.archivedQuickNotes : [],
      notices: Array.isArray(data.notices) ? data.notices.map((item) => normalizeNoticeRecord(item)) : [],
      noticeSources: Array.isArray(data.noticeSources) ? data.noticeSources : [],
      dataHealthSettings: data.dataHealthSettings && typeof data.dataHealthSettings === 'object'
        ? normalizeDataHealthThresholds(data.dataHealthSettings) : null,
      weeklyReflections: normalizeWeeklyReflections(data.weeklyReflections),
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
