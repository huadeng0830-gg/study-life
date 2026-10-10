const BACKUP_SCHEMA = 'study-life.backup/v1'

const BACKUP_FIELDS = Object.freeze({
  sl_courses: 'courses', sl_exams: 'countdowns', sl_tasks: 'tasks', sl_events: 'events',
  sl_quick_record_settings: 'quickRecordSettings', sl_capture_enabled: 'captureEnabled',
  sl_focus_sessions: 'focusSessions', sl_focus_settings: 'focusSettings', sl_course_checkins: 'courseCheckins',
  sl_course_templates: 'courseTemplates', sl_checklists: 'checklists', sl_bills: 'bills', sl_expenses: 'expenses',
  sl_ledger_categories: 'ledgerCategories', sl_ledger_freq: 'ledgerFreq', sl_ledger_fx: 'ledgerFx',
  sl_ledger_budget: 'ledgerBudget', sl_ledger_templates: 'ledgerTemplates', sl_timecfg: 'timeConfig', sl_semester: 'semester',
  sl_schedule_exceptions: 'scheduleExceptions', sl_schedule_note: 'scheduleNote', sl_theme: 'theme', sl_custom_theme_color: 'customThemeColor',
  sl_high_contrast: 'highContrast',
  sl_navigation_mobile: 'mobileNavigation', sl_navigation_desktop: 'desktopNavigation',
  sl_countdown_show_past: 'countdownShowPast', sl_ocr_vocabulary: 'ocrVocabulary', sl_appearance: 'appearance',
  sl_wallpaper_config: 'wallpaperConfig', sl_auto_wallpaper_color: 'autoWallpaperColor', sl_wallpaper_accent: 'wallpaperAccent',
  sl_performance_mode: 'performanceMode', sl_festive_config: 'festiveConfig', sl_festive_birthday_full: 'festiveBirthdayFull',
  sl_festive_lunar: 'festiveLunar', sl_ui_language: 'uiLanguage',
  sl_mood_log: 'moodLog', sl_reminder_log: 'reminderLog',
  sl_focus_active: 'activeFocus', sl_task_center_log: 'taskCenterLog', sl_archived_quick_notes: 'archivedQuickNotes',
  // Retirement requires this archive before removing these legacy records.
  // Keep their original export fields even though the current UI no longer restores them.
  sl_food_places: 'foodPlaces', sl_food_history: 'foodHistory', sl_food_filters: 'foodFilters', sl_packages: 'packages',
})

function readLocalData() {
  const data = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith('sl_') || !BACKUP_FIELDS[key]) continue
    const raw = localStorage.getItem(key)
    try { data[BACKUP_FIELDS[key]] = raw === null ? null : JSON.parse(raw) } catch { data[BACKUP_FIELDS[key]] = raw }
  }
  return data
}

export function createEmergencyBackup() {
  const data = readLocalData()
  data.courses ??= []
  data.countdowns ??= []
  return {
    app: 'study-life',
    version: 1,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
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
