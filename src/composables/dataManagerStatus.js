import { computed, ref } from 'vue'
import {
  cloudMetadata,
  connectionState,
  lastSyncedAt,
  localChanged,
  remoteDevice,
  syncCalibrationRequired,
  syncPreview,
  syncRelationship,
  syncRecovery,
  syncStatus,
} from './cloudSync.js'
import { autoSyncEnabled, isSyncSpaceBound, syncSpaceBootstrapPending, syncSpaceSettings } from './syncSpace.js'
import { autoSyncState } from './autoSyncCoordinator.js'
import { localSafeMode } from './localSafeMode.js'
import { deviceProfile } from './deviceIdentity.js'
import { addAppDays, formatAppDate, getAppTime, getAppToday } from './timeContext.js'

// 数据管理页共用的只读状态与格式化：同步摘要、设备列表、时间与容量显示。
// 全部是模块级单例 —— 主面板与各分区组件必须读写同一份 error / message / dataHealth。
const error = ref('')
const message = ref('')

const showAllDevices = ref(false)

const dataHealth = ref({ keys: 0, bytes: 0, quota: null, usage: null, largest: [] })

// localStorage 的写入上限按浏览器取。Chrome / Edge 是 5 MiB，Firefox 约 10 MB，
// Safari 老版本 5 MB。这里取最保守的 5 MiB 做预警基准——超过它说明已经逼近
// 一部分用户当前浏览器的上限，必须提醒用户清理或归档。
export const LOCALSTORAGE_BUDGET_BYTES = 5 * 1024 * 1024

// 数据健康卡上显示的"容量"不是 navigator.storage.estimate() 的 quota：
// Chrome M144 起 estimate().quota 变成"随 usage 增长的估算值"（见 Chromium
// 494350644，状态 Won't Fix），usage/quota 这个比值已失去"填充率"含义；
// 且它统计的是 IDB + Cache + localStorage 合计，不是 localStorage 的 5 MiB。
// 真正该盯的是 dataHealth.bytes（refreshDataHealth 自己按键累加，口径是对的）。
export const dataHealthFillRatio = computed(() => {
  const bytes = Number(dataHealth.value?.bytes) || 0
  return bytes / LOCALSTORAGE_BUDGET_BYTES
})

// 预警等级：< 60% 不提示；60–85% 建议清理旧数据；> 85% 必须提醒导出备份。
// 阈值给出用户至少一个月的缓冲期——localStorage 撞线表现为整个集合写不进去，
// 不是"新记录失败"，界面与落盘会永久分叉。
export const dataHealthLevel = computed(() => {
  const ratio = dataHealthFillRatio.value
  if (ratio >= 0.85) return 'critical'
  if (ratio >= 0.60) return 'warning'
  return 'ok'
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

export function useDataManagerStatus() {
  return {
    error, message, dataHealth, showAllDevices, syncSummary, maskedSpaceId, connectedDevices, deviceList, visibleDevices, hiddenDeviceCount, cloudSourceText, relationshipCopy, compactTime, compactCheckTime, fullTime, fmtTime, deviceIcon, devicePlatform, deviceActivity, formatBytes, refreshDataHealth,
  }
}
