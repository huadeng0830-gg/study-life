import { computed, ref } from 'vue'
import {
  canUndoPull,
  cancelSyncSpaceBootstrap,
  cloudExists,
  connectionState,
  disconnectCloud,
  enableAutoSync,
  isSyncing,
  lastError,
  lastLocalChangedAt,
  localChanged,
  pullFromCloud,
  pushToCloud,
  refreshCloudMetadata,
  remoteUpdatedAt,
  resolvePendingMerge,
  restoreSyncRecovery,
  syncRelationship,
  syncUndoStorageKey,
  validateLocalSyncData,
} from './cloudSync.js'
import { autoSyncEnabled, isSyncSpaceBound, syncSpaceBootstrapPending } from './syncSpace.js'
import {
  autoSyncState,
  resumeAutoSync,
  startAutoSyncCoordinator,
  stopAutoSyncCoordinator,
  syncNow,
} from './autoSyncCoordinator.js'
import { SYNC_MODULES, moduleKeysFor } from './cloudSyncData.js'
// syncPreview 原先漏了导入，closeMergePreview() 里引用它会在运行时抛
// ReferenceError（点"关闭预览"就炸）。它由 vue-tsc --checkJs 报出。
import { syncPreview } from './cloudSyncState.js'
import { deviceProfile } from './deviceIdentity.js'
import { disableLocalSafeMode, localSafeMode } from './localSafeMode.js'
import { useTaskProgress } from './taskProgress.js'
import { useDataManagerStatus } from './dataManagerStatus.js'
import { useDataManagerPairing } from './dataManagerPairing.js'

const { error, message, fmtTime, cloudSourceText } = useDataManagerStatus()
const { codeInput, pairingInfo, previewJoinedSpace, confirmJoin } = useDataManagerPairing()

// 进度条等第一次被用到时才创建（理由见 dataManagerBackup.js）。
let syncProgress = null

let syncController = null

let lastSyncAction = ''
let lastSyncOptions = {}
const conflictChoices = ref({})

const manualSyncBusy = ref(false)

const disconnectConfirmOpen = ref(false)

// 选择性拉取：默认全选所有可同步模块，可一键全选/清空。
const selectedPullModules = ref(SYNC_MODULES.map((mod) => mod.key))
const pullScopeKeys = computed(() => moduleKeysFor(selectedPullModules.value))
const allModulesSelected = computed(() => selectedPullModules.value.length === SYNC_MODULES.length)
const selectedModuleCount = computed(() => selectedPullModules.value.length)
let pendingPullKeys = null

function toggleAllModules() {
  selectedPullModules.value = allModulesSelected.value ? [] : SYNC_MODULES.map((mod) => mod.key)
}

const refreshingCloud = ref(false)

const syncActionBusy = computed(() => localSafeMode.value || manualSyncBusy.value || isSyncing.value || ['checking', 'pulling', 'merging', 'pushing'].includes(autoSyncState.value))
const syncUiDisabled = computed(() => localSafeMode.value || isSyncing.value)
const syncMainActionLabel = computed(() => {
  if (syncActionBusy.value) return '正在同步…'
  return syncSpaceBootstrapPending.value ? '查看并确认' : '立即同步'
})

function cancelJoinPreview() {
  if (!syncSpaceBootstrapPending.value) return
  stopAutoSyncCoordinator()
  cancelSyncSpaceBootstrap()
  conflictChoices.value = {}
  message.value = '已取消加入，本机数据保留。'
  error.value = ''
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

// ---------- 手动同步操作：每个动作都先弹确认框 ----------
const confirmBox = ref(null) // { mode: 'pull'|'push', title, bodyLines[], confirmLabel }

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

function abortSync() {
  syncController?.abort()
}

export function useDataManagerSyncActions() {
  if (!syncProgress) syncProgress = useTaskProgress()
  return {
    confirmBox, conflictChoices, manualSyncBusy, disconnectConfirmOpen, refreshingCloud, syncActionBusy, syncUiDisabled, syncMainActionLabel, syncProgress, selectedPullModules, pullScopeKeys, allModulesSelected, selectedModuleCount, toggleAllModules, closeConfirm, requestPullConfirm, requestPushConfirm, refreshCloudStatus, recoverSyncData, runPull, runPush, runPreview, retrySync, runPrePushCheck, conflictChoiceKey, displayConflictValue, previewChangeLabel, getConflictReasonText, commitConflictChoices, closeMergePreview, continueSyncResult, undoTitle, doDisconnect, requestDisconnect, immediateSync, toggleAutoSync, cancelJoinPreview, confirmJoin, abortSync,
  }
}
