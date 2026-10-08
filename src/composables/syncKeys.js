// 同步键的轻量真源：SYNC_DEFAULTS / SYNC_KEYS / isSyncKey。
// 【为什么单独拆出来】store/core.js 每次写盘都要判断 isSyncKey；若从 accountSyncData 导入，
// 会连带 festive/mood/focusTimer 等规范化依赖，把整张云同步图打进 timeConfig 等业务 chunk。
// 这里只依赖 ledgerCategories（纯数据），core 与 accountSyncData 共用同一份键表。
import { DEFAULT_CATEGORIES } from './ledgerCategories.js'

export const SYNC_DEFAULTS = {
  sl_courses: [],
  sl_course_templates: [],
  sl_timecfg: {},
  sl_semester: { start: '' },
  sl_schedule_exceptions: [],
  sl_schedule_note: '',
  sl_tasks: [],
  sl_events: [],
  sl_quick_notes: [],
  sl_quick_record_settings: { clipboardHint: true, recentTypes: [] },
  sl_capture_enabled: true,
  sl_focus_sessions: [],
  sl_focus_settings: { quickTimes: [15, 25, 45, 60], lastUsedMinutes: 25, recentTemporaries: [], soundEnabled: true, vibrationEnabled: true, systemNotificationEnabled: true },
  sl_course_checkins: [],
  sl_exams: [],
  sl_countdown_show_past: false,
  sl_checklists: [],
  sl_bills: [],
  sl_expenses: [],
  sl_ledger_categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
  sl_ledger_freq: { pinned: [], hidden: [], categoryOverrides: [] },
  sl_ledger_fx: { base: 'CNY', rates: {}, updatedAt: '' },
  sl_ledger_budget: { monthly: null, updatedAt: '' },
  sl_ledger_templates: [],
  sl_ocr_vocabulary: { courses: [], teachers: [], rooms: [], campuses: [] },
  sl_theme: 'blue',
  sl_custom_theme_color: '#456fe8',
  sl_auto_wallpaper_color: false,
  sl_wallpaper_accent: '#456fe8',
  sl_appearance: {},
  sl_wallpaper_config: {},
  sl_performance_mode: 'auto',
  sl_festive_config: { enabled: true, birthday: '', installDate: '', anniversaries: [] },
  sl_festive_birthday_full: '',
  sl_festive_lunar: [],
  sl_ui_language: 'zh',
  sl_mood_log: {},
  // 提醒去重日志：同步它才能避免两台设备各响一次。
  sl_reminder_log: [],
}

/**
 * @type {(keyof typeof SYNC_DEFAULTS)[]}
 */
export const SYNC_KEYS = Object.keys(SYNC_DEFAULTS)
const SYNC_KEY_SET = new Set(SYNC_KEYS)

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSyncKey(key) {
  return typeof key === 'string' && SYNC_KEY_SET.has(key)
}
