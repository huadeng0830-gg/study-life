// 同步键的轻量真源：SYNC_DEFAULTS / SYNC_KEYS / isSyncKey。
// 【为什么单独拆出来】store/core.js 每次写盘都要判断 isSyncKey；若从 accountSyncData 导入，
// 会连带 festive/mood/focusTimer 等规范化依赖，把整张云同步图打进 timeConfig 等业务 chunk。
// 这里只依赖 ledgerCategories（纯数据），core 与 accountSyncData 共用同一份键表。
import { DEFAULT_CATEGORIES } from './ledgerCategories.js'

/** @type {Record<string, any>} */
export const SYNC_DEFAULTS = {
  sl_courses: [],
  sl_course_templates: [],
  sl_timecfg: {},
  sl_semester: { start: '' },
  sl_schedule_exceptions: [],
  sl_schedule_note: '',
  sl_tasks: [],
  sl_events: [],
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
  sl_navigation_mobile: ['today', 'schedule', 'events', 'projects'],
  sl_navigation_desktop: [
    { id: 'workspace', label: '今日', items: ['today'] },
    { id: 'learning', label: '学习', items: ['schedule', 'course', 'tasks', 'exams'] },
    { id: 'schedule', label: '日程', items: ['events', 'together'] },
    { id: 'qixing', label: '齐行', items: ['projects'] },
    { id: 'other', label: '其他', items: ['lists', 'bills', 'places', 'review'] },
  ],
  sl_wallpaper_config: {},
  sl_performance_mode: 'auto',
  sl_high_contrast: false,
  sl_festive_config: { enabled: true, birthday: '', installDate: '', anniversaries: [] },
  sl_festive_birthday_full: '',
  sl_festive_lunar: [],
  sl_ui_language: 'zh',
  sl_mood_log: {},
  // 提醒去重日志：同步它才能避免两台设备各响一次。
  sl_reminder_log: [],
  // 已退役的独立笔记只作为归档数据保留，避免旧云快照在升级时丢失正文。
  sl_archived_quick_notes: [],
  sl_notices: [],
  sl_notice_sources: [],
  sl_data_health_settings: { staleTaskDays: 90, unhandledNoticeDays: 30, maxTransactionAmount: 100000 },
  sl_weekly_reflections: {},
}

export const SYNC_KEYS = Object.keys(SYNC_DEFAULTS)
const SYNC_KEY_SET = new Set(SYNC_KEYS)

/**
 * 被备份、但**刻意不同步**的键，以及理由。
 *
 * 这不是遗漏。把它们加进 SYNC_DEFAULTS 看起来"更完整"，实际会引入新问题：
 *
 *  - `sl_places` / `sl_place_visits` / `sl_place_offers`：地点记录里的到访、
 *    优惠链接属于**个人上下文**，不上传。正因为它们留在本机，
 *    `projectAccountSyncValues` 才要在快照发出前把 `sl_expenses` / `sl_notices`
 *    里的 place 引用剥掉（见 placeModels.restoreLocalPlaceLinks）——
 *    同步它们会同时让投影失效，并把这些个人记录送上云端。
 *  - `sl_focus_active`：正在进行的专注计时。同步它等于让另一台设备冒出一段
 *    不该存在的计时，而且这份状态在两台设备上会立刻分叉。专注记录本身
 *    （`sl_focus_sessions`）是要同步的，正在计时的这件事不是。
 *  - `sl_task_center_log`：快捷记录的操作日志，只用于本机的撤销与去重，
 *    跨设备搬运没有意义，反而会让两台设备的撤销栈互相覆盖。
 *
 * 几者都仍然出现在 `BACKUP_STORAGE_KEYS` 里：备份是「把这台设备完整搬走」，
 * 与「两台设备保持一致」是两个不同的问题，不该用同一张表回答。
 *
 * 这条列表由 tests/backupSyncKeyScopes.test.js 断言 —— 新增备份字段时，
 * 它要么进 SYNC_DEFAULTS，要么在这里写明理由，不能默默两边都没有。
 */
export const BACKUP_ONLY_KEYS = Object.freeze({
  sl_places: '地点资料含个人到访与优惠上下文，只留在本机',
  sl_place_visits: '到访记录属于个人行为，不上传',
  sl_place_offers: '优惠链接属于个人上下文，不上传',
  sl_focus_active: '正在进行的专注计时，属于单台设备的瞬时状态',
  sl_task_center_log: '快捷记录操作日志，仅用于本机撤销与去重',
})

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSyncKey(key) {
  return typeof key === 'string' && SYNC_KEY_SET.has(key)
}
