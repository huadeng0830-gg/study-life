<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import TaskProgress from './TaskProgress.vue'
import {
  appUpdateProgress,
  checkForAppUpdate,
  retryAppUpdate,
  updateChecking,
  updateMessage,
} from '../composables/appUpdate.js'
import { lastBackupAt, markBackedUp, needsBackup } from '../composables/backupReminder.js'
import { backupProvidedFields, buildBackupRestoreValues } from '../composables/backupRestore.js'
import { normalizeFocusSettings } from '../composables/focusTimer.js'
import { normalizePerformanceMode } from '../composables/performanceMode.js'
import {
  canUndoPull,
  cloudExists,
  code,
  connectCloud,
  connectionState,
  disconnectCloud,
  isSyncing,
  lastError,
  lastLocalChangedAt,
  localChanged,
  pullFromCloud,
  pushToCloud,
  refreshCloudMetadata,
  remoteDevice,
  remoteUpdatedAt,
  syncRelationship,
  syncPreview,
  syncStatus,
  resolvePendingMerge,
  restoreSyncRecovery,
  syncRecovery,
  undoLastPull,
} from '../composables/cloudSync.js'
import { deviceProfile, setDeviceName } from '../composables/deviceIdentity.js'
import { SYNC_MODULES, moduleKeysFor } from '../composables/cloudSyncData.js'
import {
  backupWallpapersForUndo,
  discardWallpaperUndo,
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
  restoreWallpaperUndo,
} from '../composables/wallpaperStorage.js'
import { restoreStoredValues } from '../composables/store'
import { todayStr } from '../composables/store/utils.js'
import { useTaskProgress } from '../composables/taskProgress.js'

// 二维码生成/扫描依赖体积较大，仅在用户真正打开迁移面板时下载和解析。
const LocalTransfer = defineAsyncComponent(() => import('./LocalTransfer.vue'))

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const selectedBackup = ref(null)
const selectedName = ref('')
const error = ref('')
const message = ref('')
const showTransfer = ref(false)
const includeWallpapers = ref(false)
const syncProgress = useTaskProgress()
const backupProgress = useTaskProgress()
let syncController = null
let backupController = null
let lastSyncAction = ''
let lastSyncOptions = {}
const conflictChoices = ref({})

// 选择性拉取：默认全选所有可同步模块，可一键全选/清空。
const selectedPullModules = ref(SYNC_MODULES.map((mod) => mod.key))
const pullScopeKeys = computed(() => moduleKeysFor(selectedPullModules.value))
const allModulesSelected = computed(() => selectedPullModules.value.length === SYNC_MODULES.length)
const selectedModuleCount = computed(() => selectedPullModules.value.length)
let pendingPullKeys = null

function toggleAllModules() {
  selectedPullModules.value = allModulesSelected.value ? [] : SYNC_MODULES.map((mod) => mod.key)
}

const codeInput = ref(code.value)
const refreshingCloud = ref(false)
const deviceNameInput = ref(deviceProfile.value.name)
const dataHealth = ref({ keys: 0, bytes: 0, quota: null, usage: null, largest: [] })

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function refreshDataHealth() {
  const records = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith('sl_')) continue
    const raw = localStorage.getItem(key) || ''
    // localStorage 以 UTF-16 保存字符串，估算为每字符两个字节。
    records.push({ key, bytes: (key.length + raw.length) * 2 })
  }
  let estimate = null
  try { estimate = await navigator.storage?.estimate?.() } catch {}
  dataHealth.value = {
    keys: records.length,
    bytes: records.reduce((sum, record) => sum + record.bytes, 0),
    quota: Number(estimate?.quota) || null,
    usage: Number(estimate?.usage) || null,
    largest: records.sort((left, right) => right.bytes - left.bytes).slice(0, 3),
  }
}

// 连接：只验证访问码 + 读取云端元数据（是否存在、最后更新时间），绝不触碰业务数据。
async function connectCode() {
  error.value = ''
  message.value = ''
  if (!codeInput.value || !/^\d{6}$/.test(codeInput.value)) {
    error.value = '请输入 6 位数字访问码'
    return
  }
  const result = await connectCloud(codeInput.value)
  if (!result.ok) {
    error.value = result.error
    return
  }
  codeInput.value = ''
  message.value = result.exists
    ? '已连接到云端空间（连接只做了验证，本地数据没有任何变化）'
    : '新访问码，首次推送到云端时会创建远程数据'
}

function fmtTime(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

const cloudSourceText = computed(() => {
  if (!remoteDevice.value?.name) return '来源设备未知'
  return `来自「${remoteDevice.value.name}」${remoteDevice.value.id && remoteDevice.value.id === deviceProfile.value.id ? '（当前设备）' : ''}`
})

const relationshipCopy = computed(() => ({
  synced: ['✓ 已同步', '本机数据与当前云端版本一致。'],
  'local-changes': ['本机有未同步修改', '本地数据在上次同步后发生了变化，可推送到云端。'],
  'cloud-updated': ['云端有更新', `${remoteDevice.value?.name ? `「${remoteDevice.value.name}」更新了云端数据。` : '其他设备或客户端更新了云端数据。'}可从云端拉取。`],
  'both-changed': ['⚠ 本机和云端都有修改', '本机和云端都在上次同步后发生过变化，请自行选择下一步操作。'],
  unknown: ['状态无法可靠判断', '此云端版本缺少 revision 信息；系统不会按时间自动决定同步方向。'],
  empty: ['云端暂无数据', '尚未创建云端版本，可在确认后手动推送。'],
}[syncRelationship.value] || ['状态无法可靠判断', '请手动选择下一步操作。']))

// ---------- 手动同步操作：每个动作都先弹确认框 ----------
const confirmBox = ref(null) // { mode: 'pull'|'push', title, bodyLines[], confirmLabel }
const confirmCancelBtn = ref(null)

watch(confirmBox, (box) => {
  if (box) nextTick(() => confirmCancelBtn.value?.focus())
})

function closeConfirm() {
  confirmBox.value = null
}

function requestPullConfirm(scopeKeys = null) {
  if (connectionState.value !== 'connected' || isSyncing.value) return
  pendingPullKeys = scopeKeys == null ? null : scopeKeys
  const scopeLabel = scopeKeys == null
    ? '全部数据模块'
    : selectedModuleCount.value
      ? `已选 ${selectedModuleCount.value} 个模块`
      : '未选择模块（需先勾选）'
  confirmBox.value = {
    mode: 'pull',
    title: '从云端拉取数据？',
    lines: [
      ['操作', '云端数据将应用到当前设备'],
      ['拉取范围', scopeLabel],
      ['云端最后更新', `${fmtTime(remoteUpdatedAt.value)} · ${cloudSourceText.value}`],
      ['本地最后更新', `${fmtTime(lastLocalChangedAt.value)} · 当前设备「${deviceProfile.value.name}」`],
      ['提示', localChanged.value ? '本机存在未同步修改；拉取可能覆盖本机尚未推送的数据。拉取前会创建安全快照。' : '拉取前会自动创建本机快照，未勾选模块保持原样。'],
    ],
    confirmLabel: localChanged.value ? '仍然拉取' : '确认拉取',
  }
}

function requestPushConfirm() {
  if (connectionState.value !== 'connected' || isSyncing.value) return
  const overwritesNewerCloud = ['cloud-updated', 'both-changed'].includes(syncRelationship.value)
  confirmBox.value = {
    mode: 'push',
    title: overwritesNewerCloud ? '云端存在其他设备的新版本' : '推送到云端？',
    lines: [
      ['操作', '本机数据将作为新的云端版本'],
      ['本地最后更新', `${fmtTime(lastLocalChangedAt.value)} · 当前设备「${deviceProfile.value.name}」`],
      ['云端最后更新', cloudExists.value ? `${fmtTime(remoteUpdatedAt.value)} · ${cloudSourceText.value}` : '云端还没有数据'],
      ['提示', overwritesNewerCloud ? '继续推送将覆盖当前云端版本。' : '推送成功后，云端版本将更新为本机当前数据。'],
    ],
    confirmLabel: overwritesNewerCloud ? '仍然使用本机覆盖' : '确认推送',
  }
}

const recommendedSyncLabel = computed(() => ({
  'local-changes': '一键同步（推送本机）',
  'cloud-updated': '一键同步（拉取云端）',
  empty: '一键同步（创建云端）',
  synced: '已同步',
  'both-changed': '双方都有修改，请选择',
  unknown: '请选择拉取或推送',
}[syncRelationship.value] || '请选择同步操作'))

function requestRecommendedSync() {
  if (['local-changes', 'empty'].includes(syncRelationship.value)) requestPushConfirm()
  else if (syncRelationship.value === 'cloud-updated') requestPullConfirm()
}

async function refreshCloudStatus() {
  if (refreshingCloud.value || isSyncing.value) return
  refreshingCloud.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await refreshCloudMetadata()
    if (!result.ok) error.value = result.error
    else message.value = '云端状态已刷新，未拉取或上传任何业务数据'
  } finally {
    refreshingCloud.value = false
  }
}

async function recoverSyncData() {
  const result = await restoreSyncRecovery()
  if (result.ok) message.value = '已恢复同步前数据；未自动拉取或推送。'
  else error.value = result.error?.message || '同步恢复失败，请保留当前恢复数据并重试'
}

const SYNC_STEPS = {
  pull: [
    { id: 'request', label: '请求云端版本' },
    { id: 'decrypt', label: '本机解密数据' },
    { id: 'validate', label: '校验数据结构' },
    { id: 'apply', label: '创建快照并应用' },
  ],
  push: [
    { id: 'collect', label: '收集本机数据' },
    { id: 'check', label: '重新确认云端版本' },
    { id: 'encrypt', label: '本机加密数据' },
    { id: 'upload', label: '上传云端' },
    { id: 'confirm', label: '等待云端确认' },
  ],
}

function handleSyncProgress(event) {
  if (!event?.step) return
  syncProgress.setStep(event.step, 'running', event.message)
  if (event.partial) syncProgress.setPartial(event.partial, event.message)
}

async function runSync(action, keys = null, options = {}) {
  closeConfirm()
  if (syncProgress.state.status === 'running') return
  lastSyncAction = action
  lastSyncOptions = options
  const controller = new AbortController()
  syncController = controller
  syncProgress.start({
    title: action === 'pull' ? '正在从云端拉取' : '正在推送到云端',
    steps: SYNC_STEPS[action],
    cancel: () => controller.abort(),
  })
  try {
    const ok = action === 'pull'
      ? await pullFromCloud({ signal: controller.signal, onProgress: handleSyncProgress, keys, ...lastSyncOptions })
      : await pushToCloud({ signal: controller.signal, onProgress: handleSyncProgress })
    if (controller.signal.aborted) return
    if (!ok) {
      const running = syncProgress.state.steps.find((step) => step.status === 'running')?.id
      syncProgress.fail(running, lastError.value || '云同步失败', { retry: true })
      return
    }
    if (action === 'pull' && !cloudExists.value) {
      for (const step of syncProgress.state.steps.filter((item) => item.status === 'waiting')) {
        syncProgress.setStep(step.id, 'cancelled', '云端暂无数据，无需执行')
      }
    }
    syncProgress.finish(lastError.value || (action === 'pull' ? '云端数据已应用' : '云端已接收新版本'))
  } finally {
    if (syncController === controller) syncController = null
  }
}

function runPull() {
  return runSync('pull', pendingPullKeys)
}

function runPreview() {
  return runSync('pull', pullScopeKeys.value, { previewOnly: true })
}

function runPush() {
  return runSync('push')
}

function retrySync() {
  if (lastSyncAction) void runSync(lastSyncAction, lastSyncAction === 'pull' ? pendingPullKeys : null, lastSyncOptions)
}

function conflictChoiceKey(conflict) {
  return `${conflict.key}:${conflict.entityId || conflict.key}`
}

function displayConflictValue(value) {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function previewChangeLabel(change) {
  return {
    'remote-only-change': '新增 / 云端变更',
    'local-only-change': '本机变更',
    'auto-merged': '自动合并',
    deleted: '将删除',
    conflict: '待确认',
    'delete-update-conflict': '删除与修改冲突',
  }[change.status] || change.status
}

async function commitConflictChoices() {
  const ok = await resolvePendingMerge(conflictChoices.value)
  if (ok) {
    conflictChoices.value = {}
    syncProgress.reset()
  }
}

function closeMergePreview() {
  syncPreview.value = null
  conflictChoices.value = {}
}

function continueSyncResult() {
  syncProgress.reset()
}

watch(() => props.open, (open) => {
  if (open) void refreshDataHealth()
  if (!open && syncProgress.state.status === 'running') void syncProgress.cancel()
  if (!open && backupProgress.state.status === 'running' && backupProgress.state.canCancel) void backupProgress.cancel()
})

onBeforeUnmount(() => {
  syncController?.abort()
  backupController?.abort()
})

// 「撤销上次拉取」只有在存在拉取前快照时可用；否则禁用并解释原因。
const undoTitle = computed(() =>
  canUndoPull.value
    ? `恢复到上次拉取前的本机数据（${readUndoCreatedAtText()}）`
    : '暂无可撤销的拉取记录'
)

function readUndoCreatedAtText() {
  try {
    const value = JSON.parse(localStorage.getItem('study_life_cloud_pull_undo'))
    return value?.createdAt ? new Date(value.createdAt).toLocaleString() : ''
  } catch {
    return ''
  }
}

function doDisconnect() {
  disconnectCloud()
  codeInput.value = ''
  message.value = '已断开同步，本地数据保留'
  error.value = ''
}

const maskedCode = computed(() => {
  const value = String(code.value ?? '')
  if (!value) return ''
  return `••••••${value.slice(-2)}`
})

function saveCurrentDeviceName() {
  if (!setDeviceName(deviceNameInput.value)) {
    error.value = '设备名称不能为空'
    return
  }
  deviceNameInput.value = deviceProfile.value.name
  error.value = ''
  message.value = `当前设备已命名为“${deviceProfile.value.name}”`
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
  timeConfig: 'sl_timecfg',
  semester: 'sl_semester',
  scheduleExceptions: 'sl_schedule_exceptions',
  theme: 'sl_theme',
  customThemeColor: 'sl_custom_theme_color',
  countdownShowPast: 'sl_countdown_show_past',
  foodPlaces: 'sl_food_places',
  foodHistory: 'sl_food_history',
  foodFilters: 'sl_food_filters',
  ocrVocabulary: 'sl_ocr_vocabulary',
  appearance: 'sl_appearance',
  wallpaperConfig: 'sl_wallpaper_config',
  autoWallpaperColor: 'sl_auto_wallpaper_color',
  wallpaperAccent: 'sl_wallpaper_accent',
  performanceMode: 'sl_performance_mode',
  festiveConfig: 'sl_festive_config',
  festiveBirthdayFull: 'sl_festive_birthday_full',
  moodLog: 'sl_mood_log',
}

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function makeBackup() {
  return {
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
      timeConfig: readStored(STORAGE_KEYS.timeConfig, null),
      semester: readStored(STORAGE_KEYS.semester, null),
      scheduleExceptions: readStored(STORAGE_KEYS.scheduleExceptions, []),
      theme: readStored(STORAGE_KEYS.theme, 'blue'),
      customThemeColor: readStored(STORAGE_KEYS.customThemeColor, '#456fe8'),
      countdownShowPast: readStored(STORAGE_KEYS.countdownShowPast, false),
      foodPlaces: readStored(STORAGE_KEYS.foodPlaces, []),
      foodHistory: readStored(STORAGE_KEYS.foodHistory, []),
      foodFilters: readStored(STORAGE_KEYS.foodFilters, {}),
      ocrVocabulary: readStored(STORAGE_KEYS.ocrVocabulary, { courses: [], teachers: [], rooms: [], campuses: [] }),
      appearance: readStored(STORAGE_KEYS.appearance, null),
      wallpaperConfig: readStored(STORAGE_KEYS.wallpaperConfig, null),
      autoWallpaperColor: readStored(STORAGE_KEYS.autoWallpaperColor, false),
      wallpaperAccent: readStored(STORAGE_KEYS.wallpaperAccent, '#456fe8'),
      performanceMode: readStored(STORAGE_KEYS.performanceMode, 'auto'),
      festiveConfig: readStored(STORAGE_KEYS.festiveConfig, { enabled: true, birthday: '', installDate: '', anniversaries: [] }),
      festiveBirthdayFull: readStored(STORAGE_KEYS.festiveBirthdayFull, ''),
      moodLog: readStored(STORAGE_KEYS.moodLog, {}),
    },
  }
}

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
  const date = todayStr()
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
  if (value.checksum && value.checksum !== await backupChecksum(value.data)) {
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
      timeConfig: data.timeConfig && typeof data.timeConfig === 'object' ? data.timeConfig : null,
      semester: data.semester && typeof data.semester === 'object' ? data.semester : null,
      scheduleExceptions: Array.isArray(data.scheduleExceptions) ? data.scheduleExceptions : [],
      theme: typeof data.theme === 'string' ? data.theme : 'blue',
      customThemeColor: typeof data.customThemeColor === 'string' ? data.customThemeColor : '#456fe8',
      countdownShowPast: Boolean(data.countdownShowPast),
      foodPlaces: Array.isArray(data.foodPlaces) ? data.foodPlaces : [],
      foodHistory: Array.isArray(data.foodHistory) ? data.foodHistory : [],
      foodFilters: data.foodFilters && typeof data.foodFilters === 'object' ? data.foodFilters : {},
      ocrVocabulary: data.ocrVocabulary && typeof data.ocrVocabulary === 'object' ? data.ocrVocabulary : { courses: [], teachers: [], rooms: [], campuses: [] },
      appearance: data.appearance && typeof data.appearance === 'object' ? data.appearance : null,
      wallpaperConfig: data.wallpaperConfig && typeof data.wallpaperConfig === 'object' ? data.wallpaperConfig : null,
      autoWallpaperColor: Boolean(data.autoWallpaperColor),
      wallpaperAccent: typeof data.wallpaperAccent === 'string' ? data.wallpaperAccent : '#456fe8',
      performanceMode: normalizePerformanceMode(data.performanceMode),
      festiveConfig: data.festiveConfig && typeof data.festiveConfig === 'object' ? data.festiveConfig : { enabled: true, birthday: '', installDate: '', anniversaries: [] },
      festiveBirthdayFull: typeof data.festiveBirthdayFull === 'string' ? data.festiveBirthdayFull : '',
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
    foodPlaces: data.foodPlaces.length,
    wallpapers: data.__wallpaper_images ? Object.keys(data.__wallpaper_images).length : 0,
  }
})

async function restoreBackup() {
  const backup = selectedBackup.value
  if (!backup) return
  if (!window.confirm('恢复后将覆盖当前浏览器中的课程、重要日期和待办数据，是否继续？')) return

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
</script>

<template>
  <Modal :open="open" title="数据备份与恢复" @close="emit('close')">
    <div class="data-manager">
      <p v-if="needsBackup" class="backup-hint">⚠️ 删除苹果桌面应用或清除 Safari 网站数据可能同时删除本地记录。已超过 7 天未备份，建议先导出一份。</p>
      <nav class="mobile-data-nav" aria-label="数据管理分区">
        <a href="#data-backup">备份</a>
        <a href="#data-sync">同步</a>
        <a href="#data-transfer">迁移</a>
        <a href="#data-restore">恢复</a>
      </nav>
      <section id="data-backup" class="data-section">
        <div class="section-icon">↓</div>
        <div class="section-copy">
          <h4>导出本地数据</h4>
          <p>将课程、待办、清单、账单、吃饭地点和个性化设置保存为备份文件。可勾选携带壁纸（文件会明显变大）。</p>
          <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" /> 同时包含壁纸图片</label>
          <button class="btn btn-primary" @click="exportBackup">导出备份文件</button>
        </div>
      </section>

      <TaskProgress
        :task="backupProgress.state"
        :elapsed-seconds="backupProgress.elapsedSeconds.value"
        :activity-age-seconds="backupProgress.activityAgeSeconds.value"
        :stalled="backupProgress.isStalled.value"
        compact
        @cancel="backupProgress.cancel"
        @retry="retryBackup"
        @continue="continueBackupResult"
        @wait="backupProgress.continueWaiting"
      />

      <section id="data-update" class="data-section">
        <div class="section-icon update">↻</div>
        <div class="section-copy">
          <h4>电脑与手机更新</h4>
          <p>电脑浏览器和苹果桌面版都可以直接检查新版本。更新页面不会删除本地课程和记录；只有浏览器真实报告的阶段才会显示。</p>
          <button class="btn btn-primary" :disabled="updateChecking" @click="checkForAppUpdate()">
            {{ updateChecking ? '正在更新…' : '检查更新' }}
          </button>
          <span v-if="updateMessage" class="update-message">{{ updateMessage }}</span>
          <TaskProgress
            :task="appUpdateProgress.state"
            :elapsed-seconds="appUpdateProgress.elapsedSeconds.value"
            :activity-age-seconds="appUpdateProgress.activityAgeSeconds.value"
            :stalled="appUpdateProgress.isStalled.value"
            compact
            @retry="retryAppUpdate"
            @wait="appUpdateProgress.continueWaiting"
          />
        </div>
      </section>

      <section id="data-transfer" class="data-section">
        <div class="section-icon transfer">▦</div>
        <div class="section-copy">
          <h4>本地二维码迁移</h4>
          <p>电脑生成加密二维码，手机扫码后选择合并或覆盖。数据只在两台设备之间传递，不上传服务器。</p>
          <button class="btn btn-primary" @click="showTransfer = true">打开二维码迁移</button>
        </div>
      </section>

      <section id="data-health" class="data-section">
        <div class="section-icon health">⌁</div>
        <div class="section-copy health-copy">
          <div class="health-head"><div><h4>数据健康</h4><p>仅统计当前浏览器中的本地数据，不会上传任何内容。</p></div><button class="btn" @click="refreshDataHealth">刷新</button></div>
          <div class="health-grid">
            <span><small>数据模块</small><b>{{ dataHealth.keys }} 项</b></span>
            <span><small>本地数据</small><b>{{ formatBytes(dataHealth.bytes) }}</b></span>
            <span><small>最近备份</small><b>{{ fmtTime(lastBackupAt) }}</b></span>
            <span v-if="dataHealth.quota"><small>浏览器已用</small><b>{{ formatBytes(dataHealth.usage) }} / {{ formatBytes(dataHealth.quota) }}</b></span>
          </div>
          <p v-if="dataHealth.largest.length" class="health-largest">占用较大：<span v-for="record in dataHealth.largest" :key="record.key">{{ record.key.replace('sl_', '') }} {{ formatBytes(record.bytes) }}</span></p>
        </div>
      </section>

      <section id="data-restore" class="data-section">
        <div class="section-icon restore">↑</div>
        <div class="section-copy">
          <h4>从备份恢复</h4>
          <p>选择此前导出的 JSON 文件。确认恢复前不会修改当前数据。</p>
          <label class="file-button">
            选择备份文件
            <input type="file" accept="application/json,.json" @change="selectFile" />
          </label>
        </div>
      </section>

      <section id="data-sync" class="data-section">
        <div class="section-icon sync">☁</div>
        <div class="section-copy">
          <h4>云端同步（可选 · 手动模式）</h4>
          <p>连接只验证云端访问权限并读取必要版本信息，不会读取、上传或修改任何业务数据。</p>
          <div v-if="['interrupted', 'recovering', 'recovered', 'recovery-required'].includes(syncRecovery.status)" class="sync-recovery" :class="{ danger: syncRecovery.status === 'recovery-required' }" role="alert">
            <b>{{ syncRecovery.status === 'recovery-required' ? '同步已暂停' : '同步恢复状态' }}</b>
            <span>{{ syncRecovery.message }}</span>
            <button v-if="syncRecovery.status === 'recovery-required'" type="button" class="btn btn-danger" :disabled="syncRecovery.status === 'recovering'" @click="recoverSyncData">恢复同步前数据</button>
          </div>
          <div class="device-name-row">
            <label>当前设备</label>
            <input v-model="deviceNameInput" maxlength="30" placeholder="例如：我的 iPhone" @keydown.enter="saveCurrentDeviceName" />
            <button class="btn" @click="saveCurrentDeviceName">保存名称</button>
          </div>

          <!-- 未连接：输入访问码 -> 点击连接 -->
          <template v-if="connectionState !== 'connected'">
            <div class="sync-input-row">
              <input
                v-model="codeInput"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="6 位数字访问码"
                :disabled="connectionState === 'validating' || isSyncing"
                @keydown.enter="connectCode"
              />
              <button class="btn btn-primary" :disabled="connectionState === 'validating' || isSyncing" @click="connectCode">
                {{ connectionState === 'validating' ? '正在验证…' : '连接云端' }}
              </button>
            </div>
          </template>

          <!-- 已连接：展示双方状态 + 手动操作 -->
          <template v-else>
            <div class="conn-head">
              <b class="conn-badge">✓ 已连接</b>
              <span class="conn-meta-item">云端空间：<code>{{ maskedCode }}</code></span>
              <span class="conn-meta-item">当前设备：{{ deviceProfile.name }}</span>
            </div>
            <div class="conn-times">
              <div class="relationship-state">
                <b>{{ relationshipCopy[0] }}</b>
                <span>{{ relationshipCopy[1] }}</span>
              </div>
              <span>云端最后更新：<b>{{ fmtTime(remoteUpdatedAt) }}</b> · {{ cloudSourceText }}<i v-if="!cloudExists">（云端还没有数据）</i></span>
              <span>本地最后更新：<b>{{ fmtTime(lastLocalChangedAt) }}</b> · 当前设备「{{ deviceProfile.name }}」</span>
            </div>

            <div v-if="syncRelationship === 'both-changed' || syncRelationship === 'unknown'" class="conflict-guide" role="note">
              <b>{{ syncRelationship === 'both-changed' ? '需要你决定以哪个版本为准' : '无法自动判断同步方向' }}</b>
              <span>{{ syncRelationship === 'both-changed' ? '建议先查看差异；拉取会按实体合并，只有双方都改过的记录才需要逐项选择。' : '当前云端版本没有可靠的修订信息。请核对最后更新时间与来源设备后，再手动选择方向。' }}</span>
              <div><button type="button" class="btn btn-sm" :disabled="isSyncing || !cloudExists || !selectedModuleCount" @click="requestPullConfirm(pullScopeKeys)">以云端为准（拉取）</button><button type="button" class="btn btn-sm btn-push" :disabled="isSyncing" @click="requestPushConfirm">以本机为准（推送）</button></div>
            </div>

            <div class="sync-ops">
              <div class="pull-scope">
                <div class="pull-scope-head">
                  <span class="ops-label">拉取范围（可多选，只影响「从云端拉取」）</span>
                  <button type="button" class="scope-toggle" @click="toggleAllModules">{{ allModulesSelected ? '清空' : '全选' }}</button>
                </div>
                <div class="scope-grid">
                  <label v-for="mod in SYNC_MODULES" :key="mod.key" class="scope-item">
                    <input v-model="selectedPullModules" type="checkbox" :value="mod.key" />
                    <span>{{ mod.label }}</span>
                  </label>
                </div>
              </div>
              <span class="ops-label">同步操作（均需手动确认）</span>
              <div class="sync-actions">
                <button
                  class="btn btn-primary"
                  :disabled="isSyncing || ['synced', 'both-changed', 'unknown'].includes(syncRelationship)"
                  @click="requestRecommendedSync"
                >{{ recommendedSyncLabel }}</button>
                <button
                  class="btn btn-pull"
                  :disabled="isSyncing || !cloudExists || !selectedModuleCount"
                  :title="!selectedModuleCount ? '请先勾选要拉取的数据模块' : cloudExists ? '只下载勾选模块的数据应用到本机（会先弹确认）' : '云端还没有数据，等首次推送后再拉取'"
                  @click="requestPullConfirm(pullScopeKeys)"
                >↓ 从云端拉取</button>
                <button class="btn btn-push" :disabled="isSyncing" @click="requestPushConfirm">↑ 推送到云端</button>
              </div>
              <div class="sync-actions secondary">
                <button class="btn" :disabled="isSyncing || !cloudExists || !selectedModuleCount" @click="runPreview">查看差异</button>
                <button class="btn" :disabled="isSyncing || refreshingCloud" @click="refreshCloudStatus">
                  {{ refreshingCloud ? '正在刷新…' : '刷新云端状态' }}
                </button>
                <button class="btn" :disabled="isSyncing || !canUndoPull" :title="undoTitle" @click="undoLastPull">撤销上次拉取</button>
                <button class="btn btn-danger" :disabled="isSyncing" @click="doDisconnect">断开同步</button>
              </div>
              <span v-if="!canUndoPull" class="sync-hint">{{ undoTitle }}</span>
            </div>

            <TaskProgress
              :task="syncProgress.state"
              :elapsed-seconds="syncProgress.elapsedSeconds.value"
              :activity-age-seconds="syncProgress.activityAgeSeconds.value"
              :stalled="syncProgress.isStalled.value"
              compact
              @cancel="syncProgress.cancel"
              @retry="retrySync"
              @continue="continueSyncResult"
              @wait="syncProgress.continueWaiting"
            />
            <span v-if="syncStatus === 'success' && !(syncProgress.state.active && syncProgress.state.visible)" class="success">{{ lastError }}</span>
            <span v-else-if="syncStatus === 'error' && !(syncProgress.state.active && syncProgress.state.visible)" class="error">⚠ {{ lastError }}</span>
            <div v-if="syncPreview" class="sync-preview-card">
              <b>{{ syncPreview.resolved ? '冲突已处理' : '最近一次同步预览' }}</b>
              <span>新增 {{ syncPreview.summary.added }} · 变更 {{ syncPreview.summary.updated }} · 删除 {{ syncPreview.summary.deleted }} · 需确认 {{ syncPreview.conflicts.length }}</span>
              <details v-if="syncPreview.changes?.length" class="sync-preview-details">
                <summary>展开查看变更明细</summary>
                <ul>
                  <li v-for="change in syncPreview.changes" :key="`${change.key}:${change.entityId || change.status}`">
                    <span>{{ change.label }}</span><small>{{ previewChangeLabel(change) }}</small>
                  </li>
                </ul>
              </details>
              <small v-if="syncPreview.remoteDevice">云端来源：{{ syncPreview.remoteDevice.name }}</small>
            </div>
          </template>
        </div>
      </section>

      <!-- 拉取 / 推送 确认框（取消为默认焦点） -->
      <Modal v-if="confirmBox" :open="Boolean(confirmBox)" :title="confirmBox?.title ?? ''" @close="closeConfirm">
        <div v-if="confirmBox" class="confirm-body">
          <div v-for="[label, value] in confirmBox.lines" :key="label" class="confirm-row">
            <span>{{ label }}</span>
            <b>{{ value }}</b>
          </div>
          <div class="actions">
            <button ref="confirmCancelBtn" class="btn" @click="closeConfirm">取消</button>
            <button
              class="btn btn-primary"
              :class="{ 'btn-danger': confirmBox.mode === 'push' }"
              @click="confirmBox.mode === 'pull' ? runPull() : runPush()"
            >{{ confirmBox.confirmLabel }}</button>
          </div>
        </div>
      </Modal>

      <Modal v-if="syncPreview?.conflicts?.length" :open="true" title="同步差异需要确认" :wide="true" @close="closeMergePreview">
        <div class="merge-conflicts">
          <p class="merge-intro">系统已暂停应用冲突记录。请选择每条记录保留本机或云端版本，未选择的项目不会提交。</p>
          <article v-for="conflict in syncPreview.conflicts" :key="conflictChoiceKey(conflict)" class="merge-conflict">
            <div class="merge-conflict-head">
              <b>{{ conflict.label }}</b>
              <small>{{ conflict.entityType || '设置' }} · {{ conflict.entityId }}</small>
            </div>
            <div v-if="conflict.fields.length" class="merge-fields">
              <div v-for="field in conflict.fields" :key="field.field" class="merge-field">
                <span>{{ field.field }}</span><em>本机：{{ displayConflictValue(field.local) }}</em><em>云端：{{ displayConflictValue(field.remote) }}</em>
              </div>
            </div>
            <small v-else class="merge-reason">{{ conflict.reason || '两端内容均发生变化' }}</small>
            <div class="merge-choice">
              <button type="button" class="btn btn-sm" :class="{ selected: conflictChoices[conflictChoiceKey(conflict)] === 'local' || conflictChoices[conflictChoiceKey(conflict)] === 'restore-local' }" @click="conflictChoices[conflictChoiceKey(conflict)] = conflict.status === 'delete-update-conflict' ? 'restore-local' : 'local'">{{ conflict.status === 'delete-update-conflict' ? '恢复本机记录' : '保留本机' }}</button>
              <button type="button" class="btn btn-sm" :class="{ selected: conflictChoices[conflictChoiceKey(conflict)] === 'remote' || conflictChoices[conflictChoiceKey(conflict)] === 'keep-deleted' }" @click="conflictChoices[conflictChoiceKey(conflict)] = conflict.status === 'delete-update-conflict' ? 'keep-deleted' : 'remote'">{{ conflict.status === 'delete-update-conflict' ? '接受删除' : '使用云端' }}</button>
            </div>
          </article>
          <div class="actions"><button type="button" class="btn" @click="closeMergePreview">稍后处理</button><button type="button" class="btn btn-primary" @click="commitConflictChoices">提交已选决策</button></div>
        </div>
      </Modal>

      <div v-if="summary" class="restore-preview">
        <b>{{ selectedName }}</b>
        <span>{{ summary.courses }} 门课程</span>
        <span>{{ summary.scheduleExceptions }} 个特殊日期</span>
        <span>{{ summary.countdowns }} 个重要日期</span>
        <span>{{ summary.tasks }} 项待办</span>
        <span>{{ summary.courseTemplates }} 个课表模板</span>
        <span>{{ summary.checklists }} 份生活清单</span>
        <span>{{ summary.bills }} 项固定账单 · {{ summary.expenses }} 笔消费</span>
        <span>{{ summary.foodPlaces }} 个吃饭地点</span>
        <span v-if="summary.wallpapers">{{ summary.wallpapers }} 张壁纸</span>
        <button class="btn btn-primary" @click="restoreBackup">确认恢复</button>
      </div>

      <p v-if="message" class="success">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="local-note">
        数据保存在当前浏览器，并同步保留一份设备内安全副本。换设备或清理浏览器前仍建议导出备份。
        <b class="ios-warning">iPhone 注意：从后台划掉应用不会删除记录；删除桌面应用或清除 Safari 网站数据则可能清空本地数据。重要操作前请先导出备份或推送云端。</b>
      </p>
    </div>
  </Modal>

  <LocalTransfer v-if="showTransfer" :open="showTransfer" @close="showTransfer = false" />
</template>

<style scoped>
.data-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.backup-hint {
  padding: 10px 12px;
  border: 1px solid #f2d08c;
  border-radius: 10px;
  background: #fffaf0;
  color: #8a6845;
  font-size: 12px;
  line-height: 1.55;
}
.mobile-data-nav { display: none; }
.data-section {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fafbfd;
}
.section-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  color: var(--primary);
  font-size: 20px;
  font-weight: 800;
  border-radius: 10px;
  background: var(--primary-soft);
}
.section-icon.restore {
  color: #07805d;
  background: #e7f8f1;
}
.section-icon.transfer {
  color: #89520a;
  background: #fff1d8;
}
.section-icon.update {
  color: #7755d0;
  background: #f0ebff;
}
.section-icon.sync {
  color: #0891b2;
  background: #e0f7ff;
}
.update-message {
  color: var(--primary);
  font-size: 11px;
}
.section-copy {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
}
.section-copy h4 {
  font-size: 14px;
}
.section-copy p,
.local-note {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.file-button {
  display: inline-flex;
  padding: 8px 14px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 8px;
  background: var(--primary-soft);
}
.file-button input {
  display: none;
}
.wallpaper-option {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 12px;
}
.device-name-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
  padding: 9px;
  border-radius: 9px;
  background: var(--bg);
}
.device-name-row label { color: var(--muted); font-size: 11px; }
.device-name-row input { min-width: 0; width: 100%; }
.sync-input-row {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.sync-input-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
  text-align: center;
  letter-spacing: 0.2em;
}
.sync-hint {
  color: #8590a6;
  font-size: 11px;
  line-height: 1.5;
}

/* ---------- 已连接状态 ---------- */
.conn-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px 14px;
  width: 100%;
  padding: 9px 11px;
  border: 1px solid #bfe8d8;
  border-radius: 9px;
  background: #f0faf5;
}
.conn-badge { color: #07805d; font-size: 13px; }
.conn-meta-item { color: var(--ink-soft, #55607a); font-size: 11.5px; }
.conn-meta-item code {
  letter-spacing: 0.12em;
  background: rgba(255, 255, 255, 0.7);
  padding: 1px 6px;
  border-radius: 5px;
}
.conn-times {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 9px 11px;
  color: var(--ink-soft, #55607a);
  font-size: 11.5px;
  line-height: 1.5;
  border-radius: 9px;
  background: var(--bg);
}
.conn-times b { font-weight: 700; font-variant-numeric: tabular-nums; }
.conn-times i { color: #8590a6; font-style: normal; }
.relationship-state { display: flex; flex-direction: column; gap: 2px; padding-bottom: 5px; border-bottom: 1px solid var(--border); }
.relationship-state b { color: var(--text); }
.relationship-state span { color: var(--muted); }
.conflict-guide{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding:10px 12px;border:1px solid #f1bf63;border-radius:9px;background:#fff8e9;color:#75531b;font-size:12px;line-height:1.55}.conflict-guide span{color:#8b692b}.conflict-guide>div{display:flex;flex-wrap:wrap;gap:6px}.conflict-guide .btn{min-height:30px}

.sync-ops {
  width: 100%;
  margin-top: 2px;
  padding-top: 9px;
  border-top: 1px dashed var(--border);
}
.ops-label {
  color: #98a1b2;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

/* ---------- 选择性拉取范围 ---------- */
.pull-scope {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  padding: 9px 10px;
  border: 1px dashed var(--border);
  border-radius: 9px;
  background: var(--bg);
}
.pull-scope-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.scope-toggle {
  min-height: 30px;
  padding: 3px 10px;
  color: var(--primary);
  font-size: 11.5px;
  font-weight: 700;
  border: none;
  border-radius: 8px;
  background: var(--primary-soft);
}
.scope-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 6px;
}
.scope-item {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 4px 8px;
  color: var(--text);
  font-size: 12.5px;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
}
.scope-item input {
  accent-color: var(--primary);
}
.sync-actions {
  display: flex;
  gap: 8px;
  margin-top: 7px;
  flex-wrap: wrap;
}
.btn-pull { color: var(--primary); background: var(--primary-soft); }
.btn-pull:hover:not(:disabled) { background: #e1e9ff; }
.btn-push { color: #07805d; background: #e7f8f1; }
.btn-push:hover:not(:disabled) { background: #d7f2e8; }
.sync-status {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f5f7fb;
  font-size: 12px;
  line-height: 1.6;
}
.sync-recovery {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 10px 0;
  padding: 10px 12px;
  color: #087a58;
  border: 1px solid #b9e6d5;
  border-radius: 9px;
  background: #effaf6;
  font-size: 12px;
}
.sync-recovery.danger { color: var(--danger); border-color: #f2c4c4; background: #fff5f4; }
.sync-status .muted { color: var(--muted); }
.device-history { display: block; margin-top: 3px; color: #5e6f85; font-size: 10px; }
.sync-preview-card { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 9px; padding: 9px 11px; border: 1px solid #b9ddea; border-radius: 9px; background: #f1fbfe; color: #236175; font-size: 11px; line-height: 1.5; }
.sync-preview-card small { width: 100%; color: #5d8290; }
.sync-preview-details { width: 100%; color: #236175; }
.sync-preview-details summary { cursor: pointer; }
.sync-preview-details ul { display: grid; gap: 4px; margin: 6px 0 0; padding-left: 18px; }
.sync-preview-details li { display: flex; justify-content: space-between; gap: 10px; }
.sync-preview-details li small { width: auto; color: #5d8290; }
.merge-conflicts { display: flex; flex-direction: column; gap: 10px; }
.merge-intro { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
.merge-conflict { padding: 11px 12px; border: 1px solid #f0c979; border-radius: 10px; background: #fffaf0; }
.merge-conflict-head { display: flex; justify-content: space-between; gap: 10px; color: #684f1c; }
.merge-conflict-head small, .merge-reason { color: #8b692b; font-size: 11px; }
.merge-fields { display: grid; gap: 5px; margin-top: 8px; }
.merge-field { display: grid; grid-template-columns: 90px 1fr 1fr; gap: 7px; font-size: 11px; line-height: 1.45; }
.merge-field span { color: var(--muted); }
.merge-field em { overflow-wrap: anywhere; color: var(--text); font-style: normal; }
.merge-choice { display: flex; gap: 7px; margin-top: 9px; }
.merge-choice .selected { color: #fff; border-color: var(--primary); background: var(--primary); }

/* ---------- 拉取/推送 确认框 ---------- */
.confirm-body { display: flex; flex-direction: column; gap: 9px; }
.confirm-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 7px 10px;
  color: var(--ink-soft, #55607a);
  font-size: 12.5px;
  border-radius: 8px;
  background: var(--bg);
}
.confirm-row + .confirm-row { margin-top: -3px; }
.confirm-row b { color: var(--text); font-variant-numeric: tabular-nums; }
.restore-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  font-size: 12px;
  border: 1px solid #b9e6d5;
  border-radius: 10px;
  background: #f2fbf7;
}
.restore-preview b {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.restore-preview span {
  padding: 4px 7px;
  color: #16745a;
  border-radius: 6px;
  background: #e1f5ed;
}
.restore-preview .btn {
  margin-left: auto;
}
.success {
  color: #07805d;
  font-size: 13px;
}
.error {
  color: var(--danger);
  font-size: 13px;
}
.local-note {
  padding: 0 4px;
}
.ios-warning {
  display: block;
  margin-top: 6px;
  color: #a35e22;
}
@media (max-width: 520px) {
  .mobile-data-nav { position: sticky; top: -14px; z-index: 3; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin: -14px -4px 0; padding: 6px 4px; border-bottom: 1px solid var(--border); background: #fff; }
  .mobile-data-nav a { min-height: 40px; display: grid; place-items: center; color: var(--ink-soft); font-size: 12px; font-weight: 700; text-decoration: none; border-radius: 8px; background: var(--bg); }
  .mobile-data-nav a:active { color: var(--primary); background: var(--primary-soft); }
  .data-section { gap: 10px; padding: 12px; }
  .section-icon { width: 32px; height: 32px; flex-basis: 32px; font-size: 17px; }
  .section-copy { min-width: 0; width: 100%; }
  .device-name-row { grid-template-columns: 1fr auto; }
  .device-name-row label { grid-column: 1 / -1; }
  .sync-input-row { flex-direction: column; width: 100%; }
  .sync-input-row .btn { width: 100%; }
  .sync-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
}
</style>

<style scoped>
.section-icon.health { color: #7755d0; background: #f0ebff; }
.health-copy { min-width: 0; width: 100%; }
.health-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; width: 100%; }
.health-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; width: 100%; }
.health-grid span { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 8px; border-radius: 8px; background: var(--bg); }
.health-grid small { color: var(--muted); font-size: 10px; }
.health-grid b { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.health-largest { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; width: 100%; font-size: 10.5px !important; }
.health-largest span { padding: 3px 6px; border-radius: 5px; background: var(--bg); color: var(--ink-soft); }
@media (max-width: 620px) { .health-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
