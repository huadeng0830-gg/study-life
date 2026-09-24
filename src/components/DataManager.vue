<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
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
import { animationsEnabled } from '../composables/motion.js'
import { normalizePerformanceMode } from '../composables/performanceMode.js'
import {
  canUndoPull,
  bootstrapHasMeaningfulLocalData,
  cancelSyncSpaceBootstrap,
  cloudMetadata,
  cloudExists,
  code,
  connectCloud,
  connectionState,
  disconnectCloud,
  isSyncing,
  lastError,
  lastCheckedAt,
  lastLocalChangedAt,
  lastSyncedAt,
  localChanged,
  pullFromCloud,
  pushToCloud,
  recalibrateSyncSpace,
  refreshCloudMetadata,
  remoteDevice,
  remoteUpdatedAt,
  syncRelationship,
  syncPreview,
  syncStatus,
  syncUndoStorageKey,
  resolvePendingMerge,
  restoreSyncRecovery,
  syncRecovery,
  syncCalibrationRequired,
  undoLastPull,
  validateLocalSyncData,
} from '../composables/cloudSync.js'
import { deviceProfile, setDeviceName } from '../composables/deviceIdentity.js'
import {
  autoSyncEnabled,
  isSyncSpaceBound,
  syncSpaceBootstrapPending,
  recoveryText,
  syncSpaceSettings,
} from '../composables/syncSpace.js'
import {
  autoSyncError,
  autoSyncState,
  resumeAutoSync,
  startAutoSyncCoordinator,
  stopAutoSyncCoordinator,
  syncNow,
} from '../composables/autoSyncCoordinator.js'
import {
  claimPairingCode,
  createPairingCode,
  createSyncSpace,
  enableAutoSync,
  joinSyncSpaceWithRecovery,
  revokeSyncDevice,
  renameSyncDevice,
  upgradeLegacySyncSpace,
} from '../composables/cloudSync.js'
import { SYNC_MODULES, moduleKeysFor } from '../composables/cloudSyncData.js'
import {
  backupWallpapersForUndo,
  discardWallpaperUndo,
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
  restoreWallpaperUndo,
} from '../composables/wallpaperStorage.js'
import { restoreStoredValues } from '../composables/store'
import { addAppDays, formatAppDate, getAppTime, getAppToday } from '../composables/timeContext.js'
import { useTaskProgress } from '../composables/taskProgress.js'
import { disableLocalSafeMode, localSafeMode } from '../composables/localSafeMode.js'

// 二维码生成/扫描依赖体积较大，仅在用户真正打开迁移面板时下载和解析。
const LocalTransfer = defineAsyncComponent(() => import('./LocalTransfer.vue'))
const SyncPairingModal = defineAsyncComponent(() => import('./SyncPairingModal.vue'))

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
const showPairing = ref(false)
const pairingInfo = ref(null)
const pairingBusy = ref(false)
const pairingTokenBusy = ref(false)
const pairingMode = ref('create')
const pairingError = ref('')
const manualSyncBusy = ref(false)
const showAllDevices = ref(false)
const editingDeviceName = ref(false)
const deviceNameEditor = ref(null)
const disconnectConfirmOpen = ref(false)
const spaceCopied = ref(false)
const joinSpaceId = ref('')
const joinRecoverySecret = ref('')
const joinBusy = ref(false)

// 移动端分区导航：用组件内滚动代替 `#hash` 锚点。
// 应用使用 hash 路由，`href="#data-restore"` 会被路由解析成 /data-restore 并命中 404 兜底页，
// 恢复完成后的 reload 又会停在这个地址上，导致手机上“从备份恢复”看起来完全不可用。
const backupSectionRef = ref(null)
const syncSectionRef = ref(null)
const transferSectionRef = ref(null)
const restoreSectionRef = ref(null)
const sectionRefs = {
  backup: backupSectionRef,
  sync: syncSectionRef,
  transfer: transferSectionRef,
  restore: restoreSectionRef,
}

function jumpToSection(name) {
  const target = sectionRefs[name]?.value
  if (!target?.scrollIntoView) return
  // 与 focusNavigation.scrollAndHighlight 同理：JS 发起的平滑滚动不受 CSS 降级规则约束，
  // 必须自己问一次。数据管理页的分区很长，不门控时「流畅优先」用户仍会被拖着滚。
  target.scrollIntoView({ block: 'start', behavior: animationsEnabled() ? 'smooth' : 'auto' })
}

// 选择性拉取：默认全选所有可同步模块，可一键全选/清空。
const selectedPullModules = ref(SYNC_MODULES.map((mod) => mod.key))
const pullScopeKeys = computed(() => moduleKeysFor(selectedPullModules.value))
const allModulesSelected = computed(() => selectedPullModules.value.length === SYNC_MODULES.length)
const selectedModuleCount = computed(() => selectedPullModules.value.length)
let pendingPullKeys = null
let deviceRefreshTimer = null

function toggleAllModules() {
  selectedPullModules.value = allModulesSelected.value ? [] : SYNC_MODULES.map((mod) => mod.key)
}

// 选择性备份导出：默认全选所有模块；未全选时仅导出勾选范围内的数据字段。
const selectedBackupModules = ref(SYNC_MODULES.map((mod) => mod.key))
const backupScopeKeys = computed(() => moduleKeysFor(selectedBackupModules.value))
const allBackupModulesSelected = computed(() => selectedBackupModules.value.length === SYNC_MODULES.length)
function toggleAllBackupModules() {
  selectedBackupModules.value = allBackupModulesSelected.value ? [] : SYNC_MODULES.map((mod) => mod.key)
}

const codeInput = ref(code.value)
const refreshingCloud = ref(false)
const deviceNameInput = ref(deviceProfile.value.name)
const dataHealth = ref({ keys: 0, bytes: 0, quota: null, usage: null, largest: [] })
const syncActionBusy = computed(() => localSafeMode.value || manualSyncBusy.value || isSyncing.value || ['checking', 'pulling', 'merging', 'pushing'].includes(autoSyncState.value))
const syncUiDisabled = computed(() => localSafeMode.value || isSyncing.value)
const syncMainActionLabel = computed(() => {
  if (syncActionBusy.value) return '正在同步…'
  return syncSpaceBootstrapPending.value ? '查看并确认' : '立即同步'
})
const syncSummary = computed(() => {
  if (localSafeMode.value) {
    return { tone: 'danger', title: '本机安全模式', detail: '同步恢复完成前，自动同步、手动拉取和推送均已暂停；本机仍可读写和导出。' }
  }
  const recoveryStatus = syncRecovery.value.status
  const state = autoSyncState.value
  if (recoveryStatus === 'recovery-required' || recoveryStatus === 'recovering') {
    return { tone: 'danger', title: '同步已暂停', detail: '上次同步未完整结束，请先恢复本机数据。' }
  }
  if (syncSpaceBootstrapPending.value) {
    return { tone: 'warning', title: '等待确认加入', detail: '本机数据尚未写入同步空间，请先查看并确认合并结果。' }
  }
  if (state === 'conflict' || syncPreview.value?.conflicts?.length) {
    return { tone: 'warning', title: '有修改需要确认', detail: `有 ${syncPreview.value?.conflicts?.length || 1} 项冲突，自动同步已暂停。` }
  }
  if (syncCalibrationRequired.value || state === 'calibration-required') {
    return { tone: 'danger', title: '需要重新校准', detail: '检测到旧版同步基线不可靠，已暂停自动同步；请先重新校准此设备。' }
  }
  if (connectionState.value === 'credential-invalid' || state === 'credential-invalid') {
    return { tone: 'danger', title: '需要重新绑定', detail: '本设备同步授权已失效，请重新添加此设备。' }
  }
  if (connectionState.value === 'permission-denied' || state === 'permission-denied') {
    return { tone: 'danger', title: '没有同步权限', detail: '当前设备没有访问同步空间的权限，请重新绑定后再试。' }
  }
  if (state === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { tone: 'offline', title: '当前离线', detail: localChanged.value ? '本机仍可正常使用，联网后会继续同步。' : '当前无法连接云端，联网后会继续检查。' }
  }
  if (['checking', 'pulling', 'merging', 'pushing'].includes(state) || ['pulling', 'pushing', 'restoring'].includes(syncStatus.value)) {
    return { tone: 'working', title: state === 'checking' ? '正在检查更新' : '正在同步', detail: state === 'checking' ? '正在检查其它设备更新…' : '正在合并最新修改…' }
  }
  if (connectionState.value === 'validating') {
    return { tone: 'working', title: '正在连接', detail: '正在验证本设备的同步授权…' }
  }
  if (connectionState.value !== 'connected' && isSyncSpaceBound.value) {
    return { tone: 'working', title: '正在连接', detail: '正在验证本设备的同步授权…' }
  }
  if (state === 'error' || state === 'retrying') {
    return { tone: 'warning', title: '云端暂时不可用', detail: '本机数据已保存，系统会稍后重试。' }
  }
  if (localChanged.value) {
    return { tone: 'pending', title: '有未同步修改', detail: autoSyncEnabled.value ? '本机修改将在几秒后自动同步。' : '本机有修改尚未同步。自动同步当前已关闭。' }
  }
  if (state === 'synced' || (lastSyncedAt.value && !localChanged.value)) {
    return { tone: 'success', title: '✓ 已同步', detail: '本机数据与同步空间保持一致。' }
  }
  if (!autoSyncEnabled.value) {
    return { tone: 'neutral', title: '自动同步已关闭', detail: '本机数据仍会保存，需要时可手动同步。' }
  }
  if (state === 'idle') {
    return { tone: 'success', title: '已同步', detail: '所有设备数据保持一致。' }
  }
  return { tone: 'neutral', title: '同步已连接', detail: '准备在本机修改或云端更新后同步。' }
})

function compactTime(value) {
  if (!value) return '尚未完成同步'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未完成同步'
  const time = getAppTime(date)
  const dateKey = getAppToday(date)
  const today = getAppToday()
  if (dateKey === today) return `今天 ${time}`
  if (dateKey === addAppDays(today, -1)) return `昨天 ${time}`
  return `${formatAppDate(date, { withWeekday: false })} ${time}`
}

function compactCheckTime(value) {
  return value ? compactTime(value) : '尚未检查'
}

function fullTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

const maskedSpaceId = computed(() => {
  const value = String(syncSpaceSettings.value?.spaceId || '')
  if (!value) return ''
  const parts = value.split('-')
  return parts.length >= 4 ? `${parts[0]}-••••-••••-${parts.at(-1)}` : `${value.slice(0, 4)}-••••`
})

const connectedDevices = computed(() => Array.isArray(cloudMetadata.value?.devices) ? cloudMetadata.value.devices : [])
const deviceList = computed(() => connectedDevices.value.length
  ? connectedDevices.value
  : [{ id: deviceProfile.value.id, name: deviceProfile.value.name, lastSeenAt: null }])
const visibleDevices = computed(() => showAllDevices.value ? deviceList.value : deviceList.value.slice(0, 3))
const hiddenDeviceCount = computed(() => Math.max(0, deviceList.value.length - visibleDevices.value.length))

function deviceIcon(device) {
  const value = `${device?.platform || ''} ${device?.name || ''}`.toLowerCase()
  if (/iphone|ipad|ios/.test(value)) return '📱'
  if (/android|手机/.test(value)) return '📱'
  if (/mac|macbook/.test(value)) return '💻'
  if (/windows|电脑|pc/.test(value)) return '💻'
  return '▣'
}

function devicePlatform(device) {
  const value = `${device?.platform || ''} ${device?.name || ''}`.toLowerCase()
  if (/iphone|ipad|ios/.test(value)) return 'iPhone / iPad'
  if (/android|手机/.test(value)) return 'Android'
  if (/mac|macbook/.test(value)) return 'Mac'
  if (/windows|电脑|pc/.test(value)) return 'Windows'
  return '浏览器'
}

function deviceActivity(device) {
  return device?.lastSeenAt ? `最近活动 ${compactTime(device.lastSeenAt)}` : '最近活动未知'
}

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

async function refreshDeviceMetadata() {
  if (!props.open || !isSyncSpaceBound.value || pairingBusy.value || pairingTokenBusy.value || joinBusy.value || isSyncing.value) return
  // 设备列表必须独立于 AutoSync；AutoSync 关闭时，配对/撤销也要在当前页面收敛。
  await refreshCloudMetadata()
}

function stopDeviceMetadataRefresh() {
  if (deviceRefreshTimer !== null) window.clearInterval(deviceRefreshTimer)
  deviceRefreshTimer = null
}

function startDeviceMetadataRefresh() {
  stopDeviceMetadataRefresh()
  if (!isSyncSpaceBound.value) return
  void refreshDeviceMetadata()
  deviceRefreshTimer = window.setInterval(() => { void refreshDeviceMetadata() }, 15_000)
}

// 连接：只验证访问码 + 读取云端元数据（是否存在、最后更新时间），绝不触碰业务数据。
async function connectCode() {
  if (localSafeMode.value) return
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

// 创建同步空间的二次确认：沿用仓库既有的 state + 回调惯例。
// 注意执行仍然用 `void`（不是 await）：`createSpaceFlow` 内部自己 try/finally，
// 未捕获的 rejection 走的是既有的未处理拒绝通道；把它 await 进 async 处理器会
// 改道到 Vue 的全局错误通道，那是行为变化，不是这次改造该做的事。
const createSpaceTarget = ref(false)

function confirmCreateSpace() {
  if (localSafeMode.value) return
  createSpaceTarget.value = true
}

function runCreateSpace() {
  createSpaceTarget.value = false
  void createSpaceFlow()
}

async function createSpaceFlow() {
  pairingBusy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await createSyncSpace({ deviceName: deviceProfile.value.name })
    if (!result.ok) { error.value = result.error; return }
    message.value = `同步空间 ${result.spaceId} 已创建，初始数据已上传。`
    startAutoSyncCoordinator()
    await openPairingFlow()
  } finally { pairingBusy.value = false }
}

// 同上：确认与执行分开，执行保持 `void`（理由见 confirmCreateSpace 上方注释）。
const upgradeLegacyTarget = ref(false)

function confirmUpgradeLegacy() {
  if (localSafeMode.value) return
  upgradeLegacyTarget.value = true
}

function runUpgradeLegacy() {
  upgradeLegacyTarget.value = false
  void upgradeLegacyFlow()
}

async function upgradeLegacyFlow() {
  pairingBusy.value = true
  error.value = ''
  try {
    const result = await upgradeLegacySyncSpace({ deviceName: deviceProfile.value.name })
    if (!result.ok) { error.value = result.error; return }
    message.value = `已升级为多设备同步空间 ${result.spaceId}；旧云端数据仍保留。`
    await openPairingFlow()
  } finally { pairingBusy.value = false }
}

async function openPairingFlow() {
  if (localSafeMode.value) return
  pairingMode.value = 'create'
  if (pairingInfo.value && new Date(pairingInfo.value.expiresAt).getTime() > Date.now()) {
    pairingError.value = ''
    showPairing.value = true
    return
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showPairing.value = false
    pairingError.value = ''
    error.value = '添加设备需要联网。'
    return
  }
  if (pairingTokenBusy.value) return
  showPairing.value = true
  pairingError.value = ''
  pairingTokenBusy.value = true
  error.value = ''
  try {
    const result = await createPairingCode()
    if (!result.ok) {
      pairingError.value = result.error || '暂时无法生成配对信息，请稍后重试。'
      return
    }
    pairingInfo.value = result.pairing
  } finally { pairingTokenBusy.value = false }
}

async function regeneratePairing() {
  pairingInfo.value = null
  pairingError.value = ''
  await openPairingFlow()
}

function startClaimPairing() {
  if (localSafeMode.value) return
  pairingMode.value = 'claim'
  pairingInfo.value = null
  pairingError.value = ''
  showPairing.value = true
}

async function previewJoinedSpace() {
  if (!cloudExists.value) {
    message.value = bootstrapHasMeaningfulLocalData.value
      ? '本机有数据，云端为空；确认后将由本机数据建立首个版本。'
      : '本机和云端都为空；确认后将建立空的同步初始状态。'
    return
  }
  const previewed = await pullFromCloud({ previewOnly: true })
  if (!previewed && !syncPreview.value?.conflicts?.length) error.value = lastError.value || '无法生成合并预览'
  else if (syncPreview.value) message.value = '已生成合并预览；确认前不会修改本机业务数据。'
}

async function joinSpaceFlow() {
  if (localSafeMode.value) return
  joinBusy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await joinSyncSpaceWithRecovery({
      spaceId: joinSpaceId.value,
      recoverySecret: joinRecoverySecret.value,
      deviceName: deviceProfile.value.name,
    })
    if (!result.ok) { error.value = result.error; return }
    joinSpaceId.value = ''
    joinRecoverySecret.value = ''
    await previewJoinedSpace()
  } finally { joinBusy.value = false }
}

// 「重新校准」的守卫与按钮的 :disabled 收敛成同一个 computed。
// 【为什么必须共用】守卫原本在函数里写一遍、按钮上再写一遍。改成确认框之后，
// 从打开对话框到点确认之间隔着一段真实时间，后台自动同步完全可能把 isSyncing
// 翻真——那时按钮如果只按老条件算，会看起来仍然可点，而校准和正在跑的同步
// 撞在一起。两处共用同一个 computed 才能保证"看得见的可点性"和"真的能执行"
// 说的是同一件事。
const recalibrateBlocked = computed(() =>
  localSafeMode.value || !syncCalibrationRequired.value || joinBusy.value || isSyncing.value
)
const recalibrateTarget = ref(false)

async function recalibrateCurrentSync() {
  if (recalibrateBlocked.value) return
  recalibrateTarget.value = true
}

async function confirmRecalibrate() {
  recalibrateTarget.value = false
  // 确认后**重算**同一组守卫：对话框期间状态可能已经变了。
  // 这里给一句提示而不是静默 return —— 没反应会让用户以为按钮坏了。
  if (recalibrateBlocked.value) {
    error.value = '当前无法重新校准：同步正在进行或状态已变化，请稍后再试。'
    return
  }
  joinBusy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await recalibrateSyncSpace()
    if (!result.ok) { error.value = result.error; return }
    message.value = '已清除不可靠同步基线，正在生成重新校准预览。'
    await previewJoinedSpace()
  } finally { joinBusy.value = false }
}

async function onPairingScanned(value) {
  if (localSafeMode.value) return
  pairingBusy.value = true
  error.value = ''
  pairingError.value = ''
  try {
    const result = await claimPairingCode(value, { deviceName: deviceProfile.value.name })
    if (!result.ok) { pairingError.value = result.error || '暂时无法加入同步空间，请稍后重试。'; return }
    showPairing.value = false
    pairingInfo.value = null
    message.value = '设备绑定成功，正在生成合并预览。'
    await previewJoinedSpace()
  } finally { pairingBusy.value = false }
}

async function confirmJoin() {
  if (!syncSpaceBootstrapPending.value || localSafeMode.value) return
  joinBusy.value = true
  error.value = ''
  try {
    const ok = cloudExists.value ? await pullFromCloud({ bootstrapConfirm: true }) : await pushToCloud({ bootstrapConfirm: true })
    if (!ok) return
    enableAutoSync(true)
    message.value = '已加入同步空间，自动同步已开启。'
    startAutoSyncCoordinator()
    resumeAutoSync()
  } finally { joinBusy.value = false }
}

function cancelJoinPreview() {
  if (!syncSpaceBootstrapPending.value) return
  stopAutoSyncCoordinator()
  cancelSyncSpaceBootstrap()
  conflictChoices.value = {}
  message.value = '已取消加入，本机数据保留。'
  error.value = ''
}

function exportRecoveryInfo() {
  const text = recoveryText()
  if (!text) return
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'study-life-sync-recovery.txt'
  link.click()
  URL.revokeObjectURL(url)
  message.value = '恢复信息已导出。请妥善保存；所有设备丢失后，没有账号找回机制。'
}

function toggleAutoSync() {
  if (localSafeMode.value) return
  enableAutoSync(!autoSyncEnabled.value)
  if (autoSyncEnabled.value) startAutoSyncCoordinator()
  message.value = autoSyncEnabled.value ? '自动同步已开启' : '自动同步已关闭；本机数据仍会正常保存'
}

async function immediateSync() {
  if (localSafeMode.value) return
  if (!isSyncSpaceBound.value) return
  if (manualSyncBusy.value) return
  manualSyncBusy.value = true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    error.value = '当前离线，本机修改已保存，联网后可同步。'
    manualSyncBusy.value = false
    return
  }
  try {
    if (syncSpaceBootstrapPending.value) {
      await previewJoinedSpace()
      return
    }
    const result = await Promise.resolve(syncNow())
    if (result !== false) return
    error.value = autoSyncState.value === 'offline'
      ? '当前离线，本机修改已保存，联网后可同步。'
      : '同步暂时无法开始，请稍后重试。'
  } finally {
    manualSyncBusy.value = false
  }
}

const removeDeviceTarget = ref(null)

async function removeDevice(device) {
  if (!device?.id || device.id === deviceProfile.value.id) return
  removeDeviceTarget.value = device
}

async function confirmRemoveDevice() {
  const device = removeDeviceTarget.value
  removeDeviceTarget.value = null
  if (!device) return
  pairingBusy.value = true
  error.value = ''
  try {
    const result = await revokeSyncDevice(device.id)
    if (result.ok) message.value = `已移除设备“${device.name}”`
    else error.value = result.error
  } finally { pairingBusy.value = false }
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
  'calibration-required': ['需要重新校准', '检测到旧版同步基线不可靠，系统不会自动选择本机或云端版本。'],
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
  if (localSafeMode.value) return
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
  if (localSafeMode.value) return
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
  if (localSafeMode.value) return
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
  if (result.ok) {
    message.value = '已恢复同步前数据；未自动拉取或推送。'
    if (localSafeMode.value) {
      disableLocalSafeMode()
      window.location.reload()
    }
  }
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
  if (localSafeMode.value) return
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
  if (localSafeMode.value) return
  return runSync('pull', pendingPullKeys)
}

function runPreview() {
  if (localSafeMode.value) return
  return runSync('pull', pullScopeKeys.value, { previewOnly: true })
}

function runPush() {
  if (localSafeMode.value) return
  return runSync('push')
}

function retrySync() {
  if (lastSyncAction) void runSync(lastSyncAction, lastSyncAction === 'pull' ? pendingPullKeys : null, lastSyncOptions)
}

async function runPrePushCheck() {
  if (localSafeMode.value || syncUiDisabled.value) return
  message.value = ''
  error.value = ''
  try {
    const result = await validateLocalSyncData()
    if (result.valid) {
      const sizeMB = (result.totalBytes / 1024 / 1024).toFixed(2)
      const maxMB = (result.maxBytes / 1024 / 1024).toFixed(0)
      message.value = `✓ 预检通过：${result.totalKeys} 个数据模块，${sizeMB} MB / ${maxMB} MB 限额`
    } else {
      error.value = `✗ 预检失败：${result.invalidKeys.join('、')} 格式异常${result.oversizedKeys.length ? `，${result.oversizedKeys.join('、')} 超过大小限制` : ''}`
    }
  } catch (e) {
    error.value = `预检出错：${e instanceof Error ? e.message : String(e)}`
  }
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

function getConflictReasonText(conflict) {
  const reasonMap = {
    'both-modified': '本机和云端都修改了此记录',
    'delete-update-conflict': '一方删除了此记录，另一方修改了它',
    'local-entity-id-invalid': '本机记录缺少有效 ID',
    'remote-entity-id-invalid': '云端记录缺少有效 ID',
    'same-bill-period-different-fact': '同一账期存在不同的交易记录',
  }
  return reasonMap[conflict.reason] || conflict.reason || '两端内容均发生变化'
}

async function commitConflictChoices() {
  const wasBootstrapPending = syncSpaceBootstrapPending.value
  const ok = await resolvePendingMerge(conflictChoices.value)
  if (ok) {
    conflictChoices.value = {}
    syncProgress.reset()
    if (wasBootstrapPending) {
      enableAutoSync(true)
      message.value = '冲突已按选择处理，自动同步已开启。'
      startAutoSyncCoordinator()
      resumeAutoSync()
    }
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
  if (open) {
    void refreshDataHealth()
    startDeviceMetadataRefresh()
  } else {
    stopDeviceMetadataRefresh()
  }
  if (!open && syncProgress.state.status === 'running') void syncProgress.cancel()
  if (!open && backupProgress.state.status === 'running' && backupProgress.state.canCancel) void backupProgress.cancel()
}, { immediate: true })

onBeforeUnmount(() => {
  syncController?.abort()
  backupController?.abort()
  stopDeviceMetadataRefresh()
})

// 「撤销上次拉取」只有在存在拉取前快照时可用；否则禁用并解释原因。
const undoTitle = computed(() =>
  canUndoPull.value
    ? `恢复到上次拉取前的本机数据（${readUndoCreatedAtText()}）`
    : '暂无可撤销的拉取记录'
)

function readUndoCreatedAtText() {
  try {
    const value = JSON.parse(localStorage.getItem(syncUndoStorageKey()))
    return value?.createdAt ? new Date(value.createdAt).toLocaleString() : ''
  } catch {
    return ''
  }
}

function doDisconnect() {
  disconnectConfirmOpen.value = false
  stopAutoSyncCoordinator()
  disconnectCloud()
  codeInput.value = ''
  pairingInfo.value = null
  message.value = '已停止本设备同步，本地数据保留'
  error.value = ''
}

function requestDisconnect() {
  if (isSyncing.value) return
  disconnectConfirmOpen.value = true
}

async function copySpaceId() {
  const spaceId = syncSpaceSettings.value?.spaceId
  if (!spaceId) return
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable')
    await navigator.clipboard.writeText(spaceId)
    spaceCopied.value = true
    window.setTimeout(() => { spaceCopied.value = false }, 2200)
  } catch {
    error.value = '无法自动复制同步空间编号，请在“查看”中手动复制'
  }
}

function startDeviceNameEdit() {
  deviceNameInput.value = deviceProfile.value.name
  editingDeviceName.value = true
  nextTick(() => deviceNameEditor.value?.focus?.())
}

function cancelDeviceNameEdit() {
  deviceNameInput.value = deviceProfile.value.name
  editingDeviceName.value = false
}

const maskedCode = computed(() => {
  const value = String(code.value ?? '')
  if (!value) return ''
  return `••••••${value.slice(-2)}`
})

async function saveCurrentDeviceName() {
  const nextName = String(deviceNameInput.value ?? '').trim().slice(0, 30)
  if (!nextName) {
    error.value = '设备名称不能为空'
    return
  }
  if (nextName === deviceProfile.value.name) {
    editingDeviceName.value = false
    return
  }
  if (isSyncSpaceBound.value && connectionState.value === 'connected') {
    const result = await renameSyncDevice(nextName)
    if (!result.ok) {
      error.value = result.error
      return
    }
  }
  setDeviceName(nextName)
  deviceNameInput.value = deviceProfile.value.name
  editingDeviceName.value = false
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

defineExpose({ exportBackup })

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

async function confirmRestoreBackup() {
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
</script>

<template>
  <Modal :open="open" title="数据备份与恢复" :wide="true" @close="emit('close')">
    <div class="data-manager">
      <p v-if="needsBackup" class="backup-hint">⚠️ 删除苹果桌面应用或清除 Safari 网站数据可能同时删除本地记录。已超过 7 天未备份，建议先导出一份。</p>
      <nav class="mobile-data-nav" aria-label="数据管理分区">
        <button type="button" @click="jumpToSection('backup')">备份</button>
        <button type="button" @click="jumpToSection('sync')">同步</button>
        <button type="button" @click="jumpToSection('transfer')">迁移</button>
        <button type="button" @click="jumpToSection('restore')">恢复</button>
      </nav>
      <section id="data-backup" ref="backupSectionRef" class="data-section">
        <div class="section-icon">↓</div>
        <div class="section-copy">
          <h4>导出本地数据</h4>
          <p>将课程、待办、清单、账本和个性化设置保存为备份文件。可勾选携带壁纸（文件会明显变大）。</p>
          <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" /> 同时包含壁纸图片</label>
          <div class="pull-scope">
            <div class="pull-scope-head"><span class="ops-label">选择要导出的模块（默认全部）</span><button type="button" class="scope-toggle" @click="toggleAllBackupModules">{{ allBackupModulesSelected ? '清空' : '全选' }}</button></div>
            <div class="scope-grid"><label v-for="mod in SYNC_MODULES" :key="mod.key" class="scope-item"><input v-model="selectedBackupModules" type="checkbox" :value="mod.key" /><span>{{ mod.label }}</span></label></div>
          </div>
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

      <section id="data-transfer" ref="transferSectionRef" class="data-section">
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

      <section id="data-restore" ref="restoreSectionRef" class="data-section">
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

      <section id="data-sync" ref="syncSectionRef" class="data-section">
        <div class="section-icon sync">☁</div>
        <div class="section-copy sync-section-copy">
          <h4>多设备同步</h4>
          <p>无需账号。创建或加入同步空间时会先明确确认；确认后才会建立绑定并开启自动同步。联网时设备端加密数据会在已绑定设备之间同步，离线时本机照常使用。</p>
          <template v-if="isSyncSpaceBound">
            <section class="sync-status-card" :data-tone="syncSummary.tone" aria-live="polite">
              <div class="sync-status-copy">
                <span class="status-kicker">同步状态</span>
                <h5>{{ syncSummary.title }}</h5>
                <p>{{ syncSummary.detail }}</p>
              </div>
              <div class="sync-status-meta">
                <span><i>最近同步</i><b :title="fullTime(lastSyncedAt)">{{ compactTime(lastSyncedAt) }}</b></span>
                <span><i>最后检查</i><b :title="fullTime(lastCheckedAt)">{{ compactCheckTime(lastCheckedAt) }}</b></span>
                <span><i>当前设备</i><b class="truncate" :title="deviceProfile.name">{{ deviceProfile.name }}</b></span>
              </div>
              <button class="btn btn-primary sync-main-action" :disabled="syncActionBusy || pairingBusy || joinBusy || syncCalibrationRequired || ['conflict', 'recovery-required', 'calibration-required', 'credential-invalid', 'permission-denied'].includes(autoSyncState) || ['credential-invalid', 'permission-denied'].includes(connectionState)" @click="immediateSync">{{ syncMainActionLabel }}</button>
              <button v-if="['credential-invalid', 'permission-denied'].includes(connectionState) || ['credential-invalid', 'permission-denied'].includes(autoSyncState)" type="button" class="text-button sync-rebind-action" @click="doDisconnect">重新绑定此设备</button>
            </section>

            <div class="sync-setting-row">
              <div><b>自动同步</b><span>本机修改后自动上传，并检查其它设备更新。</span></div>
              <button type="button" class="switch" role="switch" :aria-checked="autoSyncEnabled" :class="{ on: autoSyncEnabled }" :disabled="syncCalibrationRequired || localSafeMode" @click="toggleAutoSync"><span>{{ autoSyncEnabled ? '开' : '关' }}</span></button>
            </div>

              <section class="sync-devices" aria-labelledby="sync-devices-title">
              <div class="section-line-head"><div><h5 id="sync-devices-title">已连接设备</h5><span>{{ deviceList.length }} 台</span></div><button type="button" class="btn btn-add-device" :disabled="syncUiDisabled || pairingBusy || pairingTokenBusy || joinBusy" @click="openPairingFlow">＋ 添加设备</button></div>
              <ul class="device-list">
                <li v-for="device in visibleDevices" :key="device.id" class="device-row">
                  <span class="device-icon" aria-hidden="true">{{ deviceIcon(device) }}</span>
                  <div class="device-copy"><strong :title="device.name">{{ device.name }}<em v-if="device.id === deviceProfile.id">本设备</em></strong><span>{{ device.id === deviceProfile.id ? '本设备 · ' : '' }}{{ devicePlatform(device) }} · {{ deviceActivity(device) }}</span></div>
                  <button v-if="device.id === deviceProfile.id" type="button" class="icon-button" aria-label="重命名当前设备" @click="startDeviceNameEdit">✎</button>
                   <details v-else class="device-menu"><summary aria-label="打开设备菜单">•••</summary><div class="device-menu-popover"><button type="button" :disabled="pairingBusy" @click="removeDevice(device)">{{ pairingBusy ? '正在处理…' : '移除设备' }}</button></div></details>
                </li>
              </ul>
              <button v-if="hiddenDeviceCount" type="button" class="text-button device-more" :aria-expanded="showAllDevices" @click="showAllDevices = !showAllDevices">{{ showAllDevices ? '收起设备' : `查看全部设备（还有 ${hiddenDeviceCount} 台）` }}</button>
              <form v-if="editingDeviceName" class="device-name-edit" @submit.prevent="saveCurrentDeviceName">
                <label for="sync-device-name">设备名称</label>
                <input id="sync-device-name" ref="deviceNameEditor" v-model="deviceNameInput" maxlength="30" autocomplete="off" placeholder="例如：我的 iPhone" @keydown.esc="cancelDeviceNameEdit" />
                <button type="button" class="btn btn-sm" @click="cancelDeviceNameEdit">取消</button><button type="submit" class="btn btn-sm btn-primary">保存</button>
              </form>
            </section>

            <section class="space-summary">
              <div><span>同步空间</span><code>{{ maskedSpaceId }}</code></div>
              <details><summary>查看</summary><div class="space-id-detail"><code>{{ syncSpaceSettings.spaceId }}</code><button type="button" class="text-button" @click="copySpaceId">{{ spaceCopied ? '已复制' : '复制编号' }}</button></div></details>
            </section>

            <details class="sync-advanced">
              <summary>高级同步与恢复</summary>
              <div class="advanced-content">
                <div v-if="syncCalibrationRequired" class="sync-recovery danger" role="alert">
                  <b>发现旧版不可靠同步基线</b>
                  <span>系统不会猜测本机或云端哪一份正确。请先导出本机备份，再重新查看初始协调结果。</span>
                  <div class="calibration-actions"><button type="button" class="btn" :disabled="joinBusy || isSyncing" @click="exportBackup">先导出本机备份</button><button type="button" class="btn btn-danger" :disabled="recalibrateBlocked" @click="recalibrateCurrentSync">重新校准此设备同步</button></div>
                </div>
                <div v-if="['interrupted', 'recovering', 'recovered', 'recovery-required'].includes(syncRecovery.status)" class="sync-recovery" :class="{ danger: syncRecovery.status === 'recovery-required' }" role="alert">
                  <b>{{ syncRecovery.status === 'recovery-required' ? '同步已暂停' : '同步恢复状态' }}</b>
                  <span>{{ syncRecovery.message }}</span>
                  <button v-if="syncRecovery.status === 'recovery-required'" type="button" class="btn btn-danger" :disabled="syncRecovery.status === 'recovering'" @click="recoverSyncData">恢复同步前数据</button>
                </div>

                <div class="advanced-group">
                  <h5>手动同步</h5>
                  <p>通常使用“立即同步”即可。需要精细控制时，可查看差异或选择数据范围。</p>
                  <div v-if="syncRelationship === 'both-changed' || syncRelationship === 'unknown'" class="conflict-guide" role="note">
                    <b>{{ syncRelationship === 'both-changed' ? '双方都有修改，需要你决定' : '暂时无法判断同步方向' }}</b>
                    <span>{{ syncRelationship === 'both-changed' ? '建议先查看差异；只有同一条记录两边都改过时才需要选择。' : '请查看更新时间与来源设备后，再手动选择。' }}</span>
                  <div><button type="button" class="btn btn-sm" :disabled="syncUiDisabled || syncCalibrationRequired || !cloudExists || !selectedModuleCount" @click="requestPullConfirm(pullScopeKeys)">以云端为准</button><button type="button" class="btn btn-sm btn-push" :disabled="syncUiDisabled || syncCalibrationRequired" @click="requestPushConfirm">以本机为准</button></div>
                  </div>
                  <div class="sync-actions">
                    <button class="btn" :disabled="syncUiDisabled || syncCalibrationRequired || !cloudExists || !selectedModuleCount" @click="runPreview">查看差异</button>
                    <button class="btn btn-pull" :disabled="syncUiDisabled || syncCalibrationRequired || !cloudExists || !selectedModuleCount" @click="requestPullConfirm(pullScopeKeys)">从云端拉取</button>
                    <button class="btn btn-push" :disabled="syncUiDisabled || syncCalibrationRequired" @click="requestPushConfirm">上传本机数据</button>
                    <button class="btn" :disabled="syncUiDisabled || refreshingCloud" @click="refreshCloudStatus">{{ refreshingCloud ? '正在刷新…' : '刷新云端状态' }}</button>
                    <button class="btn" :disabled="syncUiDisabled || !canUndoPull" :title="undoTitle" @click="undoLastPull">撤销上次拉取</button>
                  </div>
                  <details class="pull-scope-details">
                    <summary>选择从云端拉取的数据范围</summary>
                    <div class="pull-scope"><div class="pull-scope-head"><span class="ops-label">未勾选的模块保持原样</span><button type="button" class="scope-toggle" @click="toggleAllModules">{{ allModulesSelected ? '清空' : '全选' }}</button></div><div class="scope-grid"><label v-for="mod in SYNC_MODULES" :key="mod.key" class="scope-item"><input v-model="selectedPullModules" type="checkbox" :value="mod.key" /><span>{{ mod.label }}</span></label></div></div>
                  </details>
                  <span v-if="!canUndoPull" class="sync-hint">{{ undoTitle }}</span>
                  <p v-if="autoSyncError && ['error', 'retrying'].includes(autoSyncState)" class="sync-hint">{{ autoSyncError }}</p>
                </div>

                <div class="advanced-group recovery-actions">
                  <h5>恢复与迁移</h5>
                  <p>恢复信息可以让其它设备访问此同步空间，请像密码一样保存。</p>
                  <button class="btn" @click="exportRecoveryInfo">导出恢复信息</button>
                </div>

                <div class="advanced-group space-management">
                  <h5>同步空间管理</h5>
                  <p>停止后只影响本设备同步，本机数据不会删除；之后可再次绑定。</p>
                  <button class="btn btn-danger-text" :disabled="syncUiDisabled" @click="requestDisconnect">停止本设备同步</button>
                </div>

                <small>高级操作不会显示同步密钥或设备授权信息。</small>
              </div>
            </details>
          </template>
          <template v-else-if="connectionState === 'connected'">
            <section class="sync-empty-card legacy-card">
              <span class="status-kicker">旧版手动同步</span>
              <h5>已连接云端</h5>
              <p>当前连接仍可手动同步。升级为多设备同步后，手机和电脑可以自动保持一致。</p>
              <div class="space-actions"><button class="btn btn-primary" :disabled="pairingBusy || syncUiDisabled" @click="confirmUpgradeLegacy">升级为自动同步</button><button class="btn btn-danger-text" :disabled="syncUiDisabled" @click="requestDisconnect">断开云端连接</button></div>
            </section>
            <details class="sync-advanced setup-advanced"><summary>手动同步与数据范围</summary><div class="advanced-content"><div class="conn-times"><div class="relationship-state"><b>{{ relationshipCopy[0] }}</b><span>{{ relationshipCopy[1] }}</span></div><span>云端最后更新：<b>{{ fmtTime(remoteUpdatedAt) }}</b> · {{ cloudSourceText }}</span><span>本地最后更新：<b>{{ fmtTime(lastLocalChangedAt) }}</b></span></div><div class="sync-actions"><button class="btn" :disabled="syncUiDisabled || !cloudExists || !selectedModuleCount" @click="runPreview">查看差异</button><button class="btn btn-pull" :disabled="syncUiDisabled || !cloudExists || !selectedModuleCount" @click="requestPullConfirm(pullScopeKeys)">从云端拉取</button><button class="btn btn-push" :disabled="syncUiDisabled" @click="requestPushConfirm">上传本机数据</button><button class="btn" :disabled="syncUiDisabled" @click="runPrePushCheck">推送前预检</button></div><details class="pull-scope-details"><summary>选择从云端拉取的数据范围</summary><div class="pull-scope"><div class="pull-scope-head"><span class="ops-label">未勾选的模块保持原样</span><button type="button" class="scope-toggle" @click="toggleAllModules">{{ allModulesSelected ? '清空' : '全选' }}</button></div><div class="scope-grid"><label v-for="mod in SYNC_MODULES" :key="mod.key" class="scope-item"><input v-model="selectedPullModules" type="checkbox" :value="mod.key" /><span>{{ mod.label }}</span></label></div></div></details></div></details>
          </template>
          <template v-else>
            <section class="sync-empty-card">
              <span class="status-kicker">还没有连接设备</span>
              <h5>开始使用多设备同步</h5>
              <p>在此设备创建同步空间，或扫描另一台设备的绑定码。</p>
              <div class="space-actions"><button class="btn btn-primary" :disabled="localSafeMode || pairingBusy || joinBusy" @click="confirmCreateSpace">创建同步空间</button><button class="btn" :disabled="localSafeMode || pairingBusy || joinBusy" @click="startClaimPairing">扫描绑定码</button></div>
            </section>
            <details class="sync-advanced setup-advanced"><summary>使用恢复信息或旧版访问码</summary><div class="advanced-content"><div class="join-form"><input aria-label="同步空间编号" v-model="joinSpaceId" type="text" autocomplete="off" placeholder="同步空间编号" /><input aria-label="恢复信息" v-model="joinRecoverySecret" type="password" autocomplete="off" placeholder="恢复信息" /><button class="btn" :disabled="localSafeMode || joinBusy || !joinSpaceId || !joinRecoverySecret" @click="joinSpaceFlow">{{ joinBusy ? '正在验证…' : '使用恢复信息加入' }}</button></div><small>恢复信息只用于重新绑定当前设备，不会在页面显示密钥内容。</small><div class="advanced-group"><h5>旧版手动同步</h5><div class="sync-input-row"><input aria-label="6 位数字访问码" v-model="codeInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 位数字访问码" :disabled="localSafeMode || connectionState === 'validating' || isSyncing" @keydown.enter="connectCode" /><button class="btn" :disabled="localSafeMode || connectionState === 'validating' || isSyncing" @click="connectCode">{{ connectionState === 'validating' ? '正在验证…' : '连接云端' }}</button></div></div></div></details>
          </template>

          <TaskProgress
            v-if="isSyncSpaceBound && (syncProgress.state.active || syncProgress.state.status !== 'idle')"
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
          <span v-if="syncStatus === 'success' && !(syncProgress.state.active && syncProgress.state.visible)" class="success" role="status">{{ lastError }}</span>
          <span v-else-if="syncStatus === 'error' && !(syncProgress.state.active && syncProgress.state.visible)" class="error" role="alert">⚠ {{ lastError }}</span>
          <div v-if="syncPreview && isSyncSpaceBound" class="sync-preview-card"><b>{{ syncPreview.resolved ? '冲突已处理' : '最近一次同步预览' }}</b><span>新增 {{ syncPreview.summary.added }} · 变更 {{ syncPreview.summary.updated }} · 删除 {{ syncPreview.summary.deleted }} · 需确认 {{ syncPreview.conflicts.length }}</span><details v-if="syncPreview.changes?.length" class="sync-preview-details"><summary>展开查看变更明细</summary><ul><li v-for="change in syncPreview.changes" :key="`${change.key}:${change.entityId || change.status}`"><span>{{ change.label }}</span><small>{{ previewChangeLabel(change) }}</small></li></ul></details><small v-if="syncPreview.remoteDevice">云端来源：{{ syncPreview.remoteDevice.name }}</small></div>
          <div v-if="syncSpaceBootstrapPending" class="bootstrap-actions">
            <p>确认前不会修改本机业务数据；取消加入只会清除本机临时绑定。</p>
            <div><button type="button" class="btn" :disabled="joinBusy || isSyncing" @click="cancelJoinPreview">取消加入</button><button type="button" class="btn btn-primary" :disabled="localSafeMode || joinBusy || isSyncing || syncPreview?.conflicts?.length" @click="confirmJoin">{{ cloudExists ? '确认应用合并结果' : '使用本机初始化云端' }}</button></div>
          </div>
        </div>
      </section>

      <Modal v-if="disconnectConfirmOpen" :open="disconnectConfirmOpen" title="停止本设备同步" @close="disconnectConfirmOpen = false">
        <div class="confirm-body disconnect-confirm"><p>仅停止当前设备同步，本机课程、待办和记录都会保留。之后如需使用同步，可再次绑定设备。</p><div class="actions"><button type="button" class="btn" @click="disconnectConfirmOpen = false">取消</button><button type="button" class="btn btn-danger" @click="doDisconnect">停止同步</button></div></div>
      </Modal>

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
            <small v-else class="merge-reason">{{ getConflictReasonText(conflict) }}</small>
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
        <span v-if="summary.wallpapers">{{ summary.wallpapers }} 张壁纸</span>
        <button class="btn btn-primary" @click="restoreBackup">确认恢复</button>
      </div>

      <p v-if="message" class="success" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="local-note">
        数据保存在当前浏览器，并同步保留一份设备内安全副本。换设备或清理浏览器前仍建议导出备份。
        <b class="ios-warning">iPhone 注意：从后台划掉应用不会删除记录；删除桌面应用或清除 Safari 网站数据则可能清空本地数据。重要操作前请先导出备份或推送云端。</b>
      </p>
    </div>
  </Modal>

  <LocalTransfer v-if="showTransfer" :open="showTransfer" @close="showTransfer = false" />
  <SyncPairingModal v-if="showPairing" :open="showPairing" :pairing="pairingInfo" :mode="pairingMode" :busy="pairingBusy || pairingTokenBusy" :error="pairingError" @close="showPairing = false" @regenerate="regeneratePairing" @scanned="onPairingScanned" />

  <!-- 这几处确认框都在本组件自身的 Modal 之上（弹窗套弹窗）；ConfirmDialog 自己
       Teleport 到 body，所以叠放顺序与 Escape 只关最上层这两条都由现有机制保证。
       五个都加 v-if 随目标挂载：本组件的 Modal 没有 v-if、声明在最前面，锚点天然
       更早，但 LocalTransfer / SyncPairingModal 是 v-if 的、挂载更晚——统一 v-if
       可以让确认框的锚点在打开这一刻才创建，永远排到最上层
       （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
  <ConfirmDialog
    v-if="createSpaceTarget"
    :open="createSpaceTarget"
    title="创建同步空间"
    message="当前本机数据会在设备端加密后上传到同步空间。创建成功后将开启自动同步：联网时本机加密数据会在已绑定设备之间同步，离线时仍可本地使用。是否继续？"
    confirm-label="创建同步空间"
    @close="createSpaceTarget = false"
    @confirm="runCreateSpace"
  />

  <ConfirmDialog
    v-if="upgradeLegacyTarget"
    :open="upgradeLegacyTarget"
    title="升级为自动同步"
    message="将使用当前设备的数据创建新版同步空间；旧访问码和旧云端数据会保留不删除。是否继续？"
    confirm-label="升级"
    @close="upgradeLegacyTarget = false"
    @confirm="runUpgradeLegacy"
  />

  <ConfirmDialog
    v-if="recalibrateTarget"
    :open="recalibrateTarget"
    title="重新校准同步"
    message="重新校准前建议先导出本机备份。校准不会删除本机数据，但会要求重新查看远端与本机的首次合并结果。是否继续？"
    confirm-label="重新校准"
    @close="recalibrateTarget = false"
    @confirm="confirmRecalibrate"
  />

  <ConfirmDialog
    v-if="removeDeviceTarget"
    :open="Boolean(removeDeviceTarget)"
    title="移除设备"
    :message="`确定移除“${removeDeviceTarget?.name || ''}”吗？\n\n该设备之后无法继续同步，但设备上的本地数据不会自动删除；重新使用需再次绑定。`"
    confirm-label="移除设备"
    @close="removeDeviceTarget = null"
    @confirm="confirmRemoveDevice"
  />

  <ConfirmDialog
    v-if="restoreBackupTarget"
    :open="Boolean(restoreBackupTarget)"
    title="从备份恢复"
    message="恢复后将覆盖当前浏览器中的课程、重要日期和待办数据，是否继续？"
    confirm-label="确认恢复"
    @close="restoreBackupTarget = null"
    @confirm="confirmRestoreBackup"
  />
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
.data-manager {
  flex-direction:column;
  gap:12px;
  width:100%;
  max-width:780px;
  margin:0 auto;
  display:flex}
.backup-hint {
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 10%, var(--card));
  color:var(--warning);
  border-radius:10px;
  padding:10px 12px;
  font-size:12px;
  line-height:1.55}
.mobile-data-nav {
  display:none}
.data-section {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:12px;
  align-items:flex-start;
  gap:13px;
  padding:14px;
  display:flex}
.section-icon {
  width:38px;
  height:38px;
  color:var(--primary);
  background:var(--primary-soft);
  border-radius:10px;
  flex:0 0 38px;
  place-items:center;
  font-size:20px;
  font-weight:800;
  display:grid}
.section-icon.restore {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card))}
.section-icon.transfer {
  color:var(--warning);
  background:color-mix(in srgb, var(--warning) 10%, var(--card))}
.section-icon.update {
  color:#7755d0;
  background:#f0ebff}
.section-icon.sync {
  color:#0891b2;
  background:#e0f7ff}
.update-message {
  color:var(--primary);
  font-size:11px}
.section-copy {
  flex-direction:column;
  align-items:flex-start;
  gap:7px;
  display:flex}
.section-copy h4 {
  font-size:14px}
.section-copy p,.local-note {
  color:var(--muted);
  font-size:12px;
  line-height:1.55}
.file-button {
  color:var(--primary);
  cursor:pointer;
  background:var(--primary-soft);
  border-radius:8px;
  padding:8px 14px;
  font-size:13px;
  font-weight:700;
  display:inline-flex}
.file-button input {
  display:none}
.wallpaper-option {
  color:var(--text);
  align-items:center;
  gap:7px;
  font-size:12px;
  display:inline-flex}
.device-name-row {
  background:var(--bg);
  border-radius:9px;
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center;
  gap:8px;
  width:100%;
  margin-top:4px;
  padding:9px;
  display:grid}
.device-name-row label {
  color:var(--muted);
  font-size:11px}
.device-name-row input {
  width:100%;
  min-width:0}
.sync-input-row {
  gap:8px;
  margin:8px 0;
  display:flex}
.sync-input-row input {
  border:1px solid var(--border);
  text-align:center;
  letter-spacing:.2em;
  border-radius:8px;
  flex:1;
  padding:8px 10px;
  font-size:14px}
.sync-hint {
  color:var(--ink-faint);
  font-size:11px;
  line-height:1.5}
.conn-times {
  width:100%;
  color:var(--ink-soft,#55607a);
  background:var(--bg);
  border-radius:9px;
  flex-direction:column;
  gap:4px;
  padding:9px 11px;
  font-size:11.5px;
  line-height:1.5;
  display:flex}
.conn-times b {
  font-variant-numeric:tabular-nums;
  font-weight:700}
.conn-times i {
  color:var(--ink-faint);
  font-style:normal}
.relationship-state {
  border-bottom:1px solid var(--border);
  flex-direction:column;
  gap:2px;
  padding-bottom:5px;
  display:flex}
.relationship-state b {
  color:var(--text)}
.relationship-state span {
  color:var(--muted)}
.conflict-guide {
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 10%, var(--card));
  color:var(--warning);
  border-radius:9px;
  flex-direction:column;
  gap:6px;
  margin-top:10px;
  padding:10px 12px;
  font-size:12px;
  line-height:1.55;
  display:flex}
.conflict-guide span {
  color:var(--warning)}
.conflict-guide>div {
  flex-wrap:wrap;
  gap:6px;
  display:flex}
.conflict-guide .btn {
  min-height:30px}
.sync-ops {
  border-top:1px dashed var(--border);
  width:100%;
  margin-top:2px;
  padding-top:9px}
.ops-label {
  color:var(--ink-faint);
  letter-spacing:.08em;
  font-size:10px;
  font-weight:800}
.pull-scope {
  border:1px dashed var(--border);
  background:var(--bg);
  border-radius:9px;
  flex-direction:column;
  gap:7px;
  width:100%;
  padding:9px 10px;
  display:flex}
.pull-scope-head {
  justify-content:space-between;
  align-items:center;
  gap:8px;
  display:flex}
.scope-toggle {
  min-height:30px;
  color:var(--primary);
  background:var(--primary-soft);
  border:none;
  border-radius:8px;
  padding:3px 10px;
  font-size:11.5px;
  font-weight:700}
.scope-grid {
  grid-template-columns:repeat(auto-fill,minmax(132px,1fr));
  gap:6px;
  display:grid}
.scope-item {
  min-height:40px;
  color:var(--text);
  cursor:pointer;
  border:1px solid var(--border);
  background:var(--card);
  border-radius:8px;
  align-items:center;
  gap:7px;
  padding:4px 8px;
  font-size:12.5px;
  display:flex}
.scope-item input {
  accent-color:var(--primary)}
.sync-actions {
  flex-wrap:wrap;
  gap:8px;
  margin-top:7px;
  display:flex}
.btn-pull {
  color:var(--primary);
  background:var(--primary-soft)}
.btn-pull:hover:not(:disabled) {
  background:color-mix(in srgb, var(--primary) 6%, var(--card));
  box-shadow:0 3px 10px color-mix(in srgb, var(--primary) 24%, transparent)}
.btn-push {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card))}
.btn-push:hover:not(:disabled) {
  background:color-mix(in srgb, var(--success) 14%, var(--card))}
.sync-status {
  background:var(--bg-tint);
  border-radius:8px;
  margin-top:10px;
  padding:8px 10px;
  font-size:12px;
  line-height:1.6}
.sync-recovery {
  color:var(--success);
  border:1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:9px;
  flex-direction:column;
  gap:5px;
  margin:10px 0;
  padding:10px 12px;
  font-size:12px;
  display:flex}
.sync-recovery.danger {
  color:var(--danger);
  background:color-mix(in srgb, var(--danger) 8%, var(--card));
  border-color:#f2c4c4}
.calibration-actions {
  flex-wrap:wrap;
  gap:7px;
  margin-top:3px;
  display:flex}
.sync-status .muted {
  color:var(--muted)}
.sync-preview-card {
  color:#236175;
  background:#f1fbfe;
  border:1px solid #b9ddea;
  border-radius:9px;
  flex-wrap:wrap;
  gap:6px 12px;
  margin-top:9px;
  padding:9px 11px;
  font-size:11px;
  line-height:1.5;
  display:flex}
.sync-preview-card small {
  color:#4a6b78;
  width:100%}
.sync-preview-details {
  color:#236175;
  width:100%}
.sync-preview-details summary {
  cursor:pointer}
.sync-preview-details ul {
  gap:4px;
  margin:6px 0 0;
  padding-left:18px;
  display:grid}
.sync-preview-details li {
  justify-content:space-between;
  gap:10px;
  display:flex}
.sync-preview-details li small {
  color:#5d8290;
  width:auto}







.space-actions {
  flex-wrap:wrap;
  gap:7px;
  display:flex}






.join-form {
  grid-template-columns:1fr 1.3fr auto;
  gap:7px;
  display:grid}
.join-form input {
  border:1px solid var(--border);
  background:var(--card);
  min-width:0;
  color:var(--text);
  border-radius:8px;
  padding:8px 9px;
  font-size:11px}
.sync-section-copy {
  width:100%;
  min-width:0}
.sync-status-card {
  border:1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background:color-mix(in srgb, var(--success) 6%, var(--card));
  border-radius:12px;
  grid-template-columns:minmax(0,1fr) auto;
  gap:10px 18px;
  min-height:142px;
  padding:16px;
  display:grid}
.sync-status-card[data-tone=pending],.sync-status-card[data-tone=offline],.sync-status-card[data-tone=warning] {
  border-color:color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 6%, var(--card))}
.sync-status-card[data-tone=danger] {
  background:#fff6f5;
  border-color:#efc3c3}
.sync-status-card[data-tone=working] {
  background:#f7f9ff;
  border-color:#c8d7fb}
.sync-status-card[data-tone=neutral] {
  border-color:var(--border);
  background:var(--bg)}
.sync-status-copy {
  min-width:0}
.status-kicker {
  color:var(--muted);
  letter-spacing:.08em;
  margin-bottom:5px;
  font-size:10px;
  font-weight:800;
  display:block}
.sync-status-copy h5,.sync-empty-card h5 {
  color:var(--text);
  margin:0;
  font-size:21px;
  line-height:1.2}
.sync-status-copy p,.sync-empty-card p {
  color:var(--muted);
  margin:6px 0 0;
  font-size:12px;
  line-height:1.55}
.sync-status-meta {
  align-content:start;
  gap:7px;
  min-width:142px;
  display:grid}
.sync-status-meta span {
  flex-direction:column;
  gap:2px;
  min-width:0;
  display:flex}
.sync-status-meta i {
  color:var(--muted);
  font-size:10px;
  font-style:normal}
.sync-status-meta b {
  color:var(--text);
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:12px;
  font-weight:700;
  overflow:hidden}
.sync-main-action {
  grid-column:1/-1;
  justify-self:start;
  min-width:128px}
.sync-rebind-action {
  grid-column:1/-1;
  justify-self:start}
.sync-setting-row {
  border-bottom:1px solid var(--border);
  justify-content:space-between;
  align-items:center;
  gap:16px;
  padding:12px 2px;
  display:flex}
.sync-setting-row>div {
  flex-direction:column;
  gap:3px;
  min-width:0;
  display:flex}
.sync-setting-row b {
  color:var(--text);
  font-size:13px}
.sync-setting-row span {
  color:var(--muted);
  font-size:11px;
  line-height:1.45}
.switch {
  width:48px;
  height:28px;
  color:var(--muted);
  border:1px solid var(--border);
  background:var(--bg);
  cursor:pointer;
  border-radius:999px;
  flex:none;
  justify-content:center;
  align-items:center;
  padding:2px;
  display:inline-flex}
.switch span {
  width:22px;
  height:22px;
  box-shadow:var(--shadow-sm);
  background:#fff;
  border-radius:50%;
  place-items:center;
  font-size:10px;
  font-weight:800;
  display:grid}
.switch.on {
  color:#fff;
  background:#07805d;
  border-color:#07805d;
  justify-content:flex-end}
.switch.on span {
  color:#07805d}
.sync-devices {
  padding-top:12px}
.section-line-head {
  justify-content:space-between;
  align-items:center;
  gap:12px;
  display:flex}
.section-line-head>div {
  align-items:baseline;
  gap:8px;
  min-width:0;
  display:flex}
.section-line-head h5,.advanced-group h5 {
  color:var(--text);
  margin:0;
  font-size:14px}
.section-line-head span {
  color:var(--muted);
  font-size:11px}
.text-button {
  color:var(--primary);
  cursor:pointer;
  background:0 0;
  border:0;
  padding:4px 0;
  font-size:12px;
  font-weight:800}
.text-button:disabled {
  color:var(--ink-faint,#a4adbd);
  cursor:not-allowed}
.btn-add-device {
  color:var(--primary);
  border:1px solid var(--border-strong);
  background:var(--primary-soft);
  flex:none;
  padding:7px 11px}
.btn-add-device:hover:not(:disabled) {
  background:color-mix(in srgb, var(--primary) 6%, var(--card));
  box-shadow:0 3px 10px color-mix(in srgb, var(--primary) 24%, transparent)}
.device-list {
  gap:0;
  margin:5px 0 0;
  padding:0;
  list-style:none;
  display:grid}
.device-row {
  border-top:1px solid var(--border);
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center;
  gap:10px;
  min-width:0;
  padding:11px 0;
  display:grid;
  position:relative}
.device-icon {
  background:var(--bg);
  border-radius:9px;
  flex:0 0 32px;
  place-items:center;
  width:32px;
  height:32px;
  font-size:17px;
  display:grid}
.device-copy {
  flex-direction:column;
  gap:3px;
  min-width:0;
  display:flex}
.device-copy strong {
  min-width:0;
  color:var(--text);
  text-overflow:ellipsis;
  white-space:nowrap;
  align-items:center;
  gap:6px;
  font-size:13px;
  display:flex;
  overflow:hidden}
.device-copy strong em {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:5px;
  flex:none;
  padding:2px 5px;
  font-size:9px;
  font-style:normal;
  font-weight:800}
.device-copy>span {
  color:var(--muted);
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:10.5px;
  overflow:hidden}
.icon-button {
  width:30px;
  height:30px;
  color:var(--primary);
  background:var(--primary-soft);
  cursor:pointer;
  border:0;
  border-radius:7px;
  font-size:15px}
.device-menu {
  align-self:center;
  position:relative}
.device-menu summary {
  width:32px;
  height:30px;
  color:var(--muted);
  cursor:pointer;
  border-radius:7px;
  place-items:center;
  font-size:15px;
  line-height:1;
  list-style:none;
  display:grid}
.device-menu summary::-webkit-details-marker {
  display:none}
.device-menu summary:hover,.device-menu[open] summary {
  color:var(--text);
  background:var(--bg)}
.device-menu-popover {
  z-index:3;
  border:1px solid var(--border);
  background:var(--card);
  min-width:112px;
  box-shadow:var(--shadow-md);
  border-radius:8px;
  padding:4px;
  position:absolute;
  top:calc(100% + 4px);
  right:0}
.device-menu-popover button {
  width:100%;
  color:var(--danger);
  text-align:left;
  cursor:pointer;
  background:0 0;
  border:0;
  border-radius:6px;
  padding:7px 9px;
  font-size:11px}
.device-menu-popover button:hover {
  background:color-mix(in srgb, var(--danger) 8%, var(--card))}
.device-more {
  margin:4px auto 0;
  display:block}
.device-name-edit {
  background:var(--bg);
  border-radius:9px;
  grid-template-columns:auto minmax(0,1fr) auto auto;
  align-items:center;
  gap:7px;
  margin-top:3px;
  padding:9px;
  display:grid}
.device-name-edit label {
  color:var(--muted);
  font-size:11px}
.device-name-edit input {
  width:100%;
  min-width:0}
.space-summary {
  border-top:1px solid var(--border);
  border-bottom:1px solid var(--border);
  justify-content:space-between;
  align-items:center;
  gap:12px;
  padding:12px 0;
  display:flex}
.space-summary>div {
  flex-direction:column;
  gap:3px;
  min-width:0;
  display:flex}
.space-summary span {
  color:var(--muted);
  font-size:10px}
.space-summary code,.space-id-detail code {
  overflow-wrap:anywhere;
  color:var(--ink-soft,#55607a);
  letter-spacing:.08em;
  font-size:11px}
.space-summary details {
  flex:none;
  position:relative}
.space-summary summary,.pull-scope-details summary,.sync-advanced>summary {
  color:var(--primary);
  cursor:pointer;
  font-size:12px;
  font-weight:800}
.space-summary summary {
  list-style:none}
.space-summary summary::-webkit-details-marker {
  display:none}
.space-id-detail {
  z-index:3;
  border:1px solid var(--border);
  background:var(--card);
  min-width:220px;
  box-shadow:var(--shadow-md);
  border-radius:8px;
  align-items:center;
  gap:10px;
  padding:9px 10px;
  display:flex;
  position:absolute;
  top:calc(100% + 7px);
  right:0}
.sync-advanced {
  border-bottom:1px solid var(--border)}
.sync-advanced>summary {
  padding:13px 0;
  list-style-position:inside}
.advanced-content {
  gap:13px;
  padding:0 0 13px;
  display:grid}
.advanced-group {
  border-top:1px solid var(--border);
  gap:7px;
  padding-top:12px;
  display:grid}
.advanced-group:first-child {
  border-top:0;
  padding-top:0}
.advanced-group p {
  color:var(--muted);
  margin:0;
  font-size:11px;
  line-height:1.55}
.pull-scope-details {
  margin-top:4px}
.pull-scope-details>summary {
  padding:4px 0;
  font-size:11px;
  display:inline-block}
.pull-scope-details .pull-scope {
  margin-top:5px}
.btn-danger-text {
  color:var(--danger);
  background:0 0}
.btn-danger-text:hover:not(:disabled) {
  background:color-mix(in srgb, var(--danger) 8%, var(--card))}
.sync-empty-card {
  border:1px solid var(--border);
  background:var(--bg);
  border-radius:12px;
  gap:5px;
  padding:16px;
  display:grid}
.sync-empty-card .space-actions {
  margin-top:7px}
.legacy-card {
  background:#f7f9ff;
  border-color:#c8d7fb}
.disconnect-confirm p {
  color:var(--ink-soft,#55607a);
  margin:0;
  font-size:13px;
  line-height:1.6}
@media (max-width:760px) {
  .space-actions,.join-form {
  grid-template-columns:1fr;
  display:grid}
.space-actions .btn {
  width:100%}


}
.merge-conflicts {
  flex-direction:column;
  gap:10px;
  display:flex}
.merge-intro {
  color:var(--muted);
  margin:0;
  font-size:12px;
  line-height:1.55}
.merge-conflict {
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 6%, var(--card));
  border-radius:10px;
  padding:11px 12px}
.merge-conflict-head {
  color:var(--warning);
  justify-content:space-between;
  gap:10px;
  display:flex}
.merge-conflict-head small,.merge-reason {
  color:var(--warning);
  font-size:11px}
.merge-fields {
  gap:5px;
  margin-top:8px;
  display:grid}
.merge-field {
  grid-template-columns:90px 1fr 1fr;
  gap:7px;
  font-size:11px;
  line-height:1.45;
  display:grid}
.merge-field span {
  color:var(--muted)}
.merge-field em {
  overflow-wrap:anywhere;
  color:var(--text);
  font-style:normal}
.merge-choice {
  gap:7px;
  margin-top:9px;
  display:flex}
.merge-choice .selected {
  color:var(--on-primary,#fff);
  border-color:var(--primary);
  background:var(--primary)}
.confirm-body {
  flex-direction:column;
  gap:9px;
  display:flex}
.confirm-row {
  color:var(--ink-soft,#55607a);
  background:var(--bg);
  border-radius:8px;
  grid-template-columns:92px minmax(0,1fr);
  align-items:baseline;
  gap:10px;
  padding:7px 10px;
  font-size:12.5px;
  display:grid}
.confirm-row+.confirm-row {
  margin-top:-3px}
.confirm-row b {
  color:var(--text);
  font-variant-numeric:tabular-nums}
.restore-preview {
  border:1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:10px;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  padding:12px;
  font-size:12px;
  display:flex}
.restore-preview b {
  text-overflow:ellipsis;
  white-space:nowrap;
  width:100%;
  overflow:hidden}
.restore-preview span {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:6px;
  padding:4px 7px}
.restore-preview .btn {
  margin-left:auto}
.success {
  color:var(--success);
  font-size:13px}
.error {
  color:var(--danger);
  font-size:13px}
.local-note {
  padding:0 4px}
.ios-warning {
  color:var(--warning);
  margin-top:6px;
  display:block}
@media (max-width:520px) {
  .mobile-data-nav {
  z-index:3;
  border-bottom:1px solid var(--border);
  background:var(--card);
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:4px;
  margin:-14px -4px 0;
  padding:6px 4px;
  display:grid;
  position:sticky;
  top:-14px}
.mobile-data-nav button {
  min-height:40px;
  color:var(--ink-soft);
  font:inherit;
  background:var(--bg);
  cursor:pointer;
  border:0;
  border-radius:8px;
  place-items:center;
  padding:0;
  font-size:12px;
  font-weight:700;
  display:grid}
.mobile-data-nav button:active {
  color:var(--primary);
  background:var(--primary-soft)}
/* 58px 要让开移动端顶部那条粘性导航：本组件里 `.data-section` 是跳转/定位的目标，
   没有这个 scroll-margin 时，锚点滚动会把章节标题压在粘性栏下面。
   tests/focusObscured.test.js 的 OFFSETS 就是登记这一条，删掉这个声明守卫会红。 */
.data-section {
  gap:10px;
  padding:12px;
  scroll-margin-top:58px}
.section-icon {
  flex-basis:32px;
  width:32px;
  height:32px;
  font-size:17px}
.section-copy {
  width:100%;
  min-width:0}
.device-name-row {
  grid-template-columns:1fr auto}
.device-name-row label {
  grid-column:1/-1}
.sync-input-row {
  flex-direction:column;
  width:100%}
.sync-input-row .btn {
  width:100%}
.sync-actions {
  grid-template-columns:1fr;
  width:100%;
  display:grid}
.sync-status-card {
  grid-template-columns:minmax(0,1fr);
  gap:11px;
  min-height:0;
  padding:14px}
.sync-status-meta {
  grid-template-columns:repeat(2,minmax(0,1fr));
  min-width:0}
.sync-main-action {
  width:100%}
.sync-setting-row {
  align-items:flex-start}
.sync-setting-row>div {
  max-width:calc(100% - 64px)}
.device-name-edit {
  grid-template-columns:1fr auto auto}
.device-name-edit label {
  grid-column:1/-1}
.device-copy>span {
  white-space:normal}
.space-id-detail {
  min-width:min(250px,100vw - 76px);
  right:-4px}
}
.section-icon.health {
  color:#7755d0;
  background:#f0ebff}
.health-copy {
  width:100%;
  min-width:0}
.health-head {
  justify-content:space-between;
  align-items:flex-start;
  gap:10px;
  width:100%;
  display:flex}
.health-grid {
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:7px;
  width:100%;
  display:grid}
.health-grid span {
  background:var(--bg);
  border-radius:8px;
  flex-direction:column;
  gap:3px;
  min-width:0;
  padding:8px;
  display:flex}
.health-grid small {
  color:var(--muted);
  font-size:10px}
.health-grid b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:11px;
  overflow:hidden}
.health-largest {
  flex-wrap:wrap;
  align-items:center;
  gap:5px;
  width:100%;
  display:flex;
  font-size:10.5px!important}
.health-largest span {
  background:var(--bg);
  color:var(--ink-soft);
  border-radius:5px;
  padding:3px 6px}
@media (max-width:620px) {
  .health-grid {
  grid-template-columns:repeat(2,minmax(0,1fr))}
}

</style>


