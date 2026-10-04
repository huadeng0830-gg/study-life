import { computed, ref } from 'vue'
import {
  bootstrapHasMeaningfulLocalData,
  claimPairingCode,
  cloudExists,
  code,
  connectCloud,
  createPairingCode,
  createSyncSpace,
  enableAutoSync,
  isSyncing,
  joinSyncSpaceWithRecovery,
  lastError,
  pullFromCloud,
  pushToCloud,
  recalibrateSyncSpace,
  syncCalibrationRequired,
  syncPreview,
  upgradeLegacySyncSpace,
} from './cloudSync.js'
import { syncSpaceBootstrapPending } from './syncSpace.js'
import { recoveryText, syncSpaceSettings } from './syncSpace.js'
import { resumeAutoSync, startAutoSyncCoordinator } from './autoSyncCoordinator.js'
// revokeSyncDevice 原先漏了导入，confirmRemoveDevice() 里调用它会在运行时抛
// ReferenceError —— 点"移除设备"必炸。它由 vue-tsc --checkJs 报出。
import { revokeSyncDevice } from './cloudSyncSpaceOps.js'
import { deviceProfile } from './deviceIdentity.js'
import { localSafeMode } from './localSafeMode.js'
import { useDataManagerStatus } from './dataManagerStatus.js'

const { error, message } = useDataManagerStatus()

const showPairing = ref(false)
const pairingInfo = ref(null)
const pairingBusy = ref(false)
const pairingTokenBusy = ref(false)
const pairingMode = ref('create')
const pairingError = ref('')

const spaceCopied = ref(false)
const joinSpaceId = ref('')
const joinRecoverySecret = ref('')
const joinBusy = ref(false)

const codeInput = ref(code.value)

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

function runCreateSpaceFlow() {
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

function runUpgradeLegacyFlow() {
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

async function applyRecalibrate() {
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

const removeDeviceTarget = ref(null)

async function removeDevice(device) {
  if (!device?.id || device.id === deviceProfile.value.id) return
  removeDeviceTarget.value = device
}

async function applyRemoveDevice() {
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

// 面板卸载时清掉配对相关的临时状态：这些 ref 是模块级单例，不随组件销毁，
// 留着会让下次打开面板时直接沿用上一次的绑定码/错误提示（旧的组件内状态天然会被销毁）。
function resetPairingUi() {
  showPairing.value = false
  pairingInfo.value = null
  pairingBusy.value = false
  pairingTokenBusy.value = false
  pairingMode.value = 'create'
  pairingError.value = ''
  joinBusy.value = false
  joinSpaceId.value = ''
  joinRecoverySecret.value = ''
  spaceCopied.value = false
}

export function useDataManagerPairing() {
  return {
    codeInput, showPairing, pairingInfo, pairingBusy, pairingTokenBusy, pairingMode, pairingError, joinSpaceId, joinRecoverySecret, joinBusy, spaceCopied, connectCode, confirmCreateSpace, runCreateSpaceFlow, confirmUpgradeLegacy, runUpgradeLegacyFlow, openPairingFlow, regeneratePairing, startClaimPairing, previewJoinedSpace, joinSpaceFlow, recalibrateBlocked, recalibrateCurrentSync, applyRecalibrate, onPairingScanned, confirmJoin, exportRecoveryInfo, removeDevice, applyRemoveDevice, copySpaceId, resetPairingUi, createSpaceTarget, upgradeLegacyTarget, recalibrateTarget, removeDeviceTarget,
  }
}
