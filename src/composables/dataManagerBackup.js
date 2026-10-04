import { computed, ref } from 'vue'
import { markBackedUp } from './backupReminder.js'
import { backupProvidedFields, buildBackupRestoreValues } from './backupRestore.js'
import { normalizeFocusSettings } from './focusTimer.js'
import { normalizePerformanceMode } from './performanceMode.js'
import { SYNC_MODULES, moduleKeysFor } from './cloudSyncData.js'
import {
  backupWallpapersForUndo,
  discardWallpaperUndo,
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
  restoreWallpaperUndo,
} from './wallpaperStorage.js'
import { restoreStoredValues } from './store'
import { getAppToday } from './timeContext.js'
import { useTaskProgress } from './taskProgress.js'
import { useDataManagerStatus } from './dataManagerStatus.js'

const { error, message } = useDataManagerStatus()

// 进度条等第一次被用到时才创建：useTaskProgress 会挂 onScopeDispose，
// 只有在主面板 setup 期间首次调用，才会挂到主面板的 scope 上、随它一起停表。
let backupProgress = null
let backupController = null

const selectedBackup = ref(null)
const selectedName = ref('')

const includeWallpapers = ref(false)

// 选择性备份导出：默认全选所有模块；未全选时仅导出勾选范围内的数据字段。
const selectedBackupModules = ref(SYNC_MODULES.map((mod) => mod.key))
const backupScopeKeys = computed(() => moduleKeysFor(selectedBackupModules.value))
const allBackupModulesSelected = computed(() => selectedBackupModules.value.length === SYNC_MODULES.length)
function toggleAllBackupModules() {
  selectedBackupModules.value = allBackupModulesSelected.value ? [] : SYNC_MODULES.map((mod) => mod.key)
}

const STORAGE_KEYS = {
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
}

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function makeBackup() {
  const backup = {
    app: 'study-life',
    version: 9,
    schema: 'study-life.backup/v1',
    exportedAt: new Date().toISOString(),
    data: {
      courses: readStored(STORAGE_KEYS.courses, []),
      countdowns: readStored(STORAGE_KEYS.countdowns, []),
      tasks: readStored(STORAGE_KEYS.tasks, []),
      events: readStored(STORAGE_KEYS.events, []),
      quickNotes: readStored(STORAGE_KEYS.quickNotes, []),
      quickRecordSettings: readStored(STORAGE_KEYS.quickRecordSettings, { clipboardHint: true, recentTypes: [] }),
      captureEnabled: readStored(STORAGE_KEYS.captureEnabled, true),
      focusSessions: readStored(STORAGE_KEYS.focusSessions, []),
        focusSettings: readStored(STORAGE_KEYS.focusSettings, { quickTimes: [15, 25, 45, 60], lastUsedMinutes: 25, recentTemporaries: [], soundEnabled: true, vibrationEnabled: true, systemNotificationEnabled: true }),
      courseCheckins: readStored(STORAGE_KEYS.courseCheckins, []),
      courseTemplates: readStored(STORAGE_KEYS.courseTemplates, []),
      checklists: readStored(STORAGE_KEYS.checklists, []),
      bills: readStored(STORAGE_KEYS.bills, []),
      expenses: readStored(STORAGE_KEYS.expenses, []),
      ledgerCategories: readStored(STORAGE_KEYS.ledgerCategories, null),
      ledgerFreq: readStored(STORAGE_KEYS.ledgerFreq, null),
      ledgerFx: readStored(STORAGE_KEYS.ledgerFx, null),
      ledgerBudget: readStored(STORAGE_KEYS.ledgerBudget, null),
      ledgerTemplates: readStored(STORAGE_KEYS.ledgerTemplates, []),
      timeConfig: readStored(STORAGE_KEYS.timeConfig, null),
      semester: readStored(STORAGE_KEYS.semester, null),
      scheduleExceptions: readStored(STORAGE_KEYS.scheduleExceptions, []),
      scheduleNote: readStored(STORAGE_KEYS.scheduleNote, ''),
      theme: readStored(STORAGE_KEYS.theme, 'blue'),
      customThemeColor: readStored(STORAGE_KEYS.customThemeColor, '#456fe8'),
      countdownShowPast: readStored(STORAGE_KEYS.countdownShowPast, false),
      ocrVocabulary: readStored(STORAGE_KEYS.ocrVocabulary, { courses: [], teachers: [], rooms: [], campuses: [] }),
      appearance: readStored(STORAGE_KEYS.appearance, null),
      wallpaperConfig: readStored(STORAGE_KEYS.wallpaperConfig, null),
      autoWallpaperColor: readStored(STORAGE_KEYS.autoWallpaperColor, false),
      wallpaperAccent: readStored(STORAGE_KEYS.wallpaperAccent, '#456fe8'),
      performanceMode: readStored(STORAGE_KEYS.performanceMode, 'auto'),
      festiveConfig: readStored(STORAGE_KEYS.festiveConfig, { enabled: true, birthday: '', installDate: '', anniversaries: [] }),
      festiveBirthdayFull: readStored(STORAGE_KEYS.festiveBirthdayFull, ''),
      festiveLunar: readStored(STORAGE_KEYS.festiveLunar, []),
      uiLanguage: readStored(STORAGE_KEYS.uiLanguage, 'zh'),
      moodLog: readStored(STORAGE_KEYS.moodLog, {}),
    },
  }
  // 未全选时只保留勾选模块对应的数据字段，其余字段不进入备份文件（恢复时保持原样）。
  if (!allBackupModulesSelected.value) {
    const allowed = new Set(backupScopeKeys.value)
    backup.data = Object.fromEntries(
      Object.entries(backup.data).filter(([field]) => allowed.has(STORAGE_KEYS[field]))
    )
  }
  return backup
}

// 校验和固定基于**紧凑** JSON：历史备份都是这么算的，改成缩进格式会让
// 所有旧备份导入时校验失败。这里的两次序列化无法合并——文件体还要带上
// checksum 本身，是 backup 的超集——所以保持原样，不做半吊子优化。
async function backupChecksum(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function exportBackup() {
  error.value = ''
  const backup = makeBackup()
  const includeImages = includeWallpapers.value
  const controller = new AbortController()
  backupController = controller
  if (includeImages) {
    backupProgress.start({
      title: '正在生成含壁纸的备份',
      steps: [
        { id: 'collect', label: '收集本机数据' },
        { id: 'wallpapers', label: '压缩壁纸图片' },
        { id: 'file', label: '生成备份文件' },
      ],
      cancel: () => controller.abort(),
    })
    backupProgress.setStep('collect', 'completed', '文字数据与设置已收集')
  }
  try {
    if (includeImages) {
      backupProgress.setStep('wallpapers', 'running', '正在读取壁纸')
      const images = await exportWallpapersForTransfer({
        signal: controller.signal,
        onProgress: ({ current, total }) => {
          backupProgress.setPartial({ 壁纸: `${current}/${total}` }, total ? `已处理 ${current}/${total} 张壁纸` : '当前没有壁纸')
        },
      })
      if (Object.keys(images).length) backup.data.__wallpaper_images = images
    }
  } catch (reason) {
    if (reason?.name === 'AbortError') {
      if (backupController === controller) backupController = null
      return
    }
    error.value = '壁纸导出失败，已改为仅备份文字数据。'
    backupProgress.setStep('wallpapers', 'warning', '壁纸处理失败，将导出文字数据')
  }
  if (includeImages) backupProgress.setStep('file', 'running', '正在生成 JSON 备份文件')
  backup.checksum = await backupChecksum(backup.data)
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = getAppToday()
  link.href = url
  link.download = `控制台备份-${date}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  message.value = backup.data.__wallpaper_images
    ? `备份文件已导出（含 ${Object.keys(backup.data.__wallpaper_images).length} 张壁纸），请妥善保存。`
    : '备份文件已导出，请妥善保存。'
  markBackedUp()
  if (includeImages) {
    backupProgress.setStep('file', 'completed', '备份文件已交给浏览器下载')
    backupProgress.finish(error.value ? '文字数据已导出，壁纸需要稍后重试' : '备份文件已生成', error.value ? 'warning' : 'completed')
  }
  if (backupController === controller) backupController = null
}

function retryBackup() {
  void exportBackup()
}

function continueBackupResult() {
  backupProgress.reset()
}

function sanitizeWallpaperImages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value).filter(
    ([target, dataUrl]) => typeof target === 'string' && /^data:image\//.test(String(dataUrl))
  )
  return entries.length ? Object.fromEntries(entries) : null
}

async function validateBackup(value) {
  if (!value || value.app !== 'study-life' || ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(value.version) || !value.data) {
    throw new Error('这不是有效的控制台备份文件')
  }
  if (value.version >= 7 && value.schema !== 'study-life.backup/v1') {
    throw new Error('备份文件版本不受支持')
  }
  // v7 起的导出都会写入 checksum。导入侧原来只在"checksum 存在"时才校验，
  // 于是把 checksum 字段整段删掉就能绕过完整性检查 —— 校验和成了摆设。
  // 现在 v7+ 必须带校验和；v1–v6 的老备份（含应急导出）仍然可以不带。
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
      __wallpaper_images: sanitizeWallpaperImages(data.__wallpaper_images),
    },
  }
}

async function selectFile(event) {
  error.value = ''
  message.value = ''
  selectedBackup.value = null
  const file = event.target.files?.[0]
  if (!file) return
  selectedName.value = file.name
  try {
    selectedBackup.value = await validateBackup(JSON.parse(await file.text()))
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法读取这个备份文件'
  } finally {
    event.target.value = ''
  }
}

const summary = computed(() => {
  const data = selectedBackup.value?.data
  if (!data) return null
  return {
    courses: data.courses.length,
    countdowns: data.countdowns.length,
    tasks: data.tasks.length,
    events: data.events.length,
    quickNotes: data.quickNotes.length,
    courseTemplates: data.courseTemplates.length,
    checklists: data.checklists.length,
    bills: data.bills.length,
        expenses: data.expenses.length,
    scheduleExceptions: data.scheduleExceptions.length,
    wallpapers: data.__wallpaper_images ? Object.keys(data.__wallpaper_images).length : 0,
  }
})

// 恢复备份的确认。快照必须在打开对话框**之前**取：恢复预览里可以换文件，
// 若确认后才去读 selectedBackup，用户中途换了备份就会写错目标（弹窗套弹窗）。
const restoreBackupTarget = ref(null)

function restoreBackup() {
  const backup = selectedBackup.value
  if (!backup) return
  restoreBackupTarget.value = backup
}

async function applyRestoreBackup() {
  const backup = restoreBackupTarget.value
  restoreBackupTarget.value = null
  if (!backup) return

  const { data } = backup
  // 校验层会为旧备份补齐显示用默认值；恢复时只能写入原文件实际携带的字段，
  // 避免用空默认值覆盖当前版本后来新增的模块。
  const restoredValues = buildBackupRestoreValues(data, backup.providedFields, STORAGE_KEYS)
  const previous = Object.fromEntries(
    Object.keys(restoredValues).map((key) => [key, localStorage.getItem(key)])
  )
  const hasWallpapers = Boolean(data.__wallpaper_images && Object.keys(data.__wallpaper_images).length)
  if (hasWallpapers) {
    backupProgress.start({
      title: '正在恢复备份',
      steps: [
        { id: 'validate', label: '校验备份内容' },
        { id: 'wallpapers', label: '创建恢复点并恢复壁纸' },
        { id: 'data', label: '恢复文字数据与设置' },
        { id: 'finish', label: '完成并重新载入' },
      ],
    })
    backupProgress.setStep('validate', 'completed', '备份格式和必要字段检查通过')
  }
  let wallpaperUndoReady = false
  try {
    if (data.__wallpaper_images) {
      backupProgress.setStep('wallpapers', 'running', '正在创建现有壁纸恢复点')
      await backupWallpapersForUndo()
      wallpaperUndoReady = true
      await importWallpapersFromTransfer(data.__wallpaper_images, 'replace', {
        onProgress: ({ current, total, stage }) => {
          backupProgress.setPartial({ 壁纸: `${current}/${total}` }, stage === 'committed' ? '壁纸已原子写入本机' : `已处理 ${current}/${total} 张壁纸`)
        },
      })
      backupProgress.setStep('wallpapers', 'completed', '壁纸恢复完成')
      backupProgress.setStep('data', 'running', '正在写入文字数据与设置')
    }
    // 文字数据最后提交。它自身会同时回滚 localStorage 和已创建的响应式引用，
    // 因此任一阶段失败都不会留下“半套备份”。
    await restoreStoredValues(restoredValues)
    if (hasWallpapers) {
      try { await discardWallpaperUndo() } catch {}
      backupProgress.setStep('data', 'completed', '文字数据与设置已恢复')
      backupProgress.setStep('finish', 'completed', '恢复完成，即将重新载入')
      backupProgress.finish('备份恢复完成')
      window.setTimeout(() => window.location.reload(), 700)
    } else {
      window.location.reload()
    }
  } catch (reason) {
    for (const [key, raw] of Object.entries(previous)) {
      if (raw === null) localStorage.removeItem(key)
      else localStorage.setItem(key, raw)
    }
    if (wallpaperUndoReady) {
      try { await restoreWallpaperUndo() } catch {}
    }
    error.value = '恢复失败，浏览器可能已禁止本地存储或存储空间不足'
    if (hasWallpapers) {
      const running = backupProgress.state.steps.find((step) => step.status === 'running')?.id
      backupProgress.fail(running, reason instanceof Error ? reason.message : error.value, { retry: false })
    }
  }
}

function abortBackup() {
  backupController?.abort()
}

export function useDataManagerBackup() {
  if (!backupProgress) backupProgress = useTaskProgress()
  return {
    selectedBackup, selectedName, includeWallpapers, selectedBackupModules, backupScopeKeys, allBackupModulesSelected, toggleAllBackupModules, backupProgress, exportBackup, retryBackup, continueBackupResult, abortBackup, selectFile, summary, restoreBackup, restoreBackupTarget, applyRestoreBackup, readStored, makeBackup, backupChecksum, sanitizeWallpaperImages, validateBackup,
  }
}
