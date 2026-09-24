import { computed, ref, watch } from 'vue'
import {
  lastError,
  cancelSyncOperations,
  localChanged,
  pullFromCloud,
  pushToCloud,
  refreshCloudMetadata,
  remoteRevision,
  syncErrorKind,
  syncRetryAfterMs,
  syncCalibrationRequired,
  syncRelationship,
  syncRecovery,
  syncPreview,
  syncStorageKey,
  SYNC_DIRTY_SIGNAL_KEY,
} from './cloudSync.js'
import { autoSyncEnabled, isSyncSpaceBound, syncSpaceBootstrapPending, syncSpaceSettings } from './syncSpace.js'

export const AUTO_SYNC_STATES = Object.freeze([
  'disabled', 'idle', 'dirty', 'checking', 'pulling', 'merging', 'conflict', 'pushing', 'synced', 'offline', 'retrying', 'recovery-required', 'calibration-required', 'credential-invalid', 'permission-denied', 'error',
])
export const autoSyncState = ref('disabled')
export const autoSyncStatus = autoSyncState
export const autoSyncError = ref('')
export const autoSyncLastSyncedAt = ref(null)
export const autoSyncPendingCount = computed(() => localChanged.value ? 1 : 0)

export const AUTO_SYNC_DEBOUNCE_MS = 4000
export const AUTO_SYNC_POLL_MS = 60 * 1000
export const AUTO_SYNC_BACKOFF_MS = Object.freeze([5000, 15000, 30000, 60000, 300000])
export const EVENT_COALESCE_MS = 250
// CAS 冲突属于正常并发信号，但单个 transaction 不能在持续竞争时无限循环。
// 超过上限后交给受控的外层 backoff，避免 revision/pull/push 请求风暴。
export const MAX_CAS_RETRIES = 2
const LEADER_KEY = 'study_life_auto_sync_leader'
const LEADER_TTL_MS = 12000
const LEADER_HEARTBEAT_MS = 4000
const LEADER_RETRY_MS = 3000
// 跨标签页消息的协议版本。频道名是固定字符串，任何同源脚本都能往里面发消息；
// 带上版本与同步空间 ID 后，可以忽略掉不兼容的、或属于另一个同步空间的消息，
// 否则本标签页会去执行一条不属于自己空间的同步请求。
const CHANNEL_VERSION = 1
const CHANNEL_ERROR_MAX = 200
// CAS 冲突时两次尝试之间的短随机退避：两个标签页同时推送会互相顶掉对方的 CAS，
// 立刻重试往往再次相撞，把 MAX_CAS_RETRIES 白白耗尽。这里只做毫秒级的错开，
// 秒级以上的退避交给外层 scheduleRetry（否则手动同步会卡住十几秒）。
const CAS_BACKOFF_MIN_MS = 150
const CAS_BACKOFF_JITTER_MS = 350

const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
let started = false
let running = false
let coordinatorGeneration = 0
let debounceTimer = null
let pollTimer = null
let retryTimer = null
let leaderTimer = null
let heartbeatTimer = null
let failureCount = 0
let channel = null
let stopSettingsWatch = null
let stopDirtyWatch = null
let onDirty = null
let onOnline = null
let onOffline = null
let onVisibility = null
let onFocus = null
let onPageShow = null
let onStorage = null
let eventSyncTimer = null
let leaderLeaseId = null

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function isVisible() {
  return typeof document === 'undefined' || !document.hidden
}

function readLease() {
  try {
    const value = JSON.parse(localStorage.getItem(LEADER_KEY))
    if (!value || typeof value !== 'object') return null
    // 兼容 B1 之前已经存在的临时租约字段；新写入一律使用明确的
    // owner/lease/fencing 语义，避免把普通随机 token 当成版本栅栏。
    return {
      ownerId: value.ownerId || value.id || '',
      leaseId: value.leaseId || value.token || '',
      fencingToken: Number(value.fencingToken ?? value.generation) || 0,
      expiresAt: Number(value.expiresAt) || 0,
    }
  } catch { return null }
}

function writeLease(expiresAt, fencingToken, leaseId) {
  try { localStorage.setItem(LEADER_KEY, JSON.stringify({ ownerId: tabId, leaseId, fencingToken, expiresAt })) } catch {}
}

function isLeader() {
  const current = readLease()
  return Boolean(leaderLeaseId && current?.ownerId === tabId && current.leaseId === leaderLeaseId && current.expiresAt > Date.now())
}

function claimLeader() {
  if (!started) return false
  const current = readLease()
  if (current?.ownerId && current.ownerId !== tabId && current.expiresAt > Date.now()) return false
  const fencingToken = Math.max(current?.fencingToken || 0, Date.now()) + 1
  const leaseId = `${tabId}:${fencingToken}:${Math.random().toString(36).slice(2, 8)}`
  writeLease(Date.now() + LEADER_TTL_MS, fencingToken, leaseId)
  leaderLeaseId = leaseId
  return isLeader()
}

function maintainLeader() {
  if (!started) return false
  if (isLeader()) {
    const current = readLease()
    writeLease(Date.now() + LEADER_TTL_MS, current?.fencingToken || Date.now(), leaderLeaseId)
    if (heartbeatTimer === null) heartbeatTimer = window.setTimeout(() => {
      heartbeatTimer = null
      maintainLeader()
    }, LEADER_HEARTBEAT_MS)
    return true
  }
  if (claimLeader()) return true
  if (leaderTimer === null) leaderTimer = window.setTimeout(() => {
    leaderTimer = null
    maintainLeader()
  }, LEADER_RETRY_MS)
  return false
}

function broadcast(message) {
  if (!channel) return false
  try {
    channel.postMessage({
      ...message,
      v: CHANNEL_VERSION,
      spaceId: syncSpaceSettings.value?.spaceId || '',
      source: tabId,
    })
    return true
  } catch {
    return false
  }
}

function publishState() {
  broadcast({ type: 'state', state: autoSyncState.value, error: autoSyncError.value, pending: autoSyncPendingCount.value })
}

function setState(next, error = '') {
  if (!AUTO_SYNC_STATES.includes(next)) return
  autoSyncState.value = next
  autoSyncError.value = error
  publishState()
}

function clearTimer(name) {
  if (name === 'debounce' && debounceTimer !== null) window.clearTimeout(debounceTimer)
  if (name === 'poll' && pollTimer !== null) window.clearTimeout(pollTimer)
  if (name === 'retry' && retryTimer !== null) window.clearTimeout(retryTimer)
  if (name === 'leader' && leaderTimer !== null) window.clearTimeout(leaderTimer)
  if (name === 'heartbeat' && heartbeatTimer !== null) window.clearTimeout(heartbeatTimer)
  if (name === 'event' && eventSyncTimer !== null) window.clearTimeout(eventSyncTimer)
  if (name === 'debounce') debounceTimer = null
  if (name === 'poll') pollTimer = null
  if (name === 'retry') retryTimer = null
  if (name === 'leader') leaderTimer = null
  if (name === 'heartbeat') heartbeatTimer = null
  if (name === 'event') eventSyncTimer = null
}

function scheduleEventSyncCheck() {
  if (!started || eventSyncTimer !== null) return
  const generation = coordinatorGeneration
  eventSyncTimer = window.setTimeout(() => {
    eventSyncTimer = null
    if (generation === coordinatorGeneration) void runSyncCycle('event', generation)
  }, EVENT_COALESCE_MS)
}

function armPolling() {
  clearTimer('poll')
  if (!started || !autoSyncEnabled.value || !isVisible() || !isLeader() || ['credential-invalid', 'permission-denied'].includes(syncErrorKind.value)) return
  const generation = coordinatorGeneration
  pollTimer = window.setTimeout(() => {
    pollTimer = null
    if (generation === coordinatorGeneration) void runSyncCycle('poll', generation)
  }, AUTO_SYNC_POLL_MS)
}

function markDirty() {
  if (!started || !autoSyncEnabled.value) return
  if (syncCalibrationRequired.value) {
    clearTimer('debounce'); clearTimer('poll'); clearTimer('retry')
    setState('calibration-required', '检测到旧版不可靠同步基线，请先重新校准此设备。')
    return
  }
  if (!isOnline()) {
    setState('offline')
    return
  }
  if (autoSyncState.value === 'conflict' || ['credential-invalid', 'permission-denied'].includes(syncErrorKind.value) || syncRecovery.value.status === 'recovery-required') return
  setState('dirty')
  const generation = coordinatorGeneration
  clearTimer('debounce')
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null
    if (generation === coordinatorGeneration) void runSyncCycle('dirty', generation)
  }, AUTO_SYNC_DEBOUNCE_MS)
}

function scheduleRetry(error, generation = coordinatorGeneration) {
  if (!started || generation !== coordinatorGeneration || !autoSyncEnabled.value || !isOnline() || ['conflict', 'credential-invalid', 'permission-denied'].includes(autoSyncState.value) || !shouldRetrySyncError(syncErrorKind.value)) return
  const delay = computeRetryDelay(failureCount, { retryAfterMs: syncRetryAfterMs.value })
  failureCount += 1
  setState('retrying', error)
  clearTimer('retry')
  const retryGeneration = coordinatorGeneration
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    if (retryGeneration === coordinatorGeneration) void runSyncCycle('retry', retryGeneration)
  }, delay)
}

export function shouldRetrySyncError(kind) {
  return !['credential-invalid', 'permission-denied', 'invalid-request', 'payload-too-large', 'version-mismatch'].includes(kind)
}

export function computeRetryDelay(failureIndex = 0, { retryAfterMs = null, random = Math.random } = {}) {
  const serverDelay = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.max(1000, retryAfterMs) : null
  const base = serverDelay ?? AUTO_SYNC_BACKOFF_MS[Math.min(Math.max(0, failureIndex), AUTO_SYNC_BACKOFF_MS.length - 1)]
  const jitterWindow = Math.min(1000, Math.max(100, Math.round(base * 0.1)))
  const jitter = Math.floor(Math.max(0, Math.min(0.999, Number(random()) || 0)) * jitterWindow)
  return base + jitter
}

function pauseForConflict() {
  clearTimer('debounce')
  clearTimer('poll')
  clearTimer('retry')
  setState('conflict', `有 ${syncPreview.value?.conflicts?.length || 1} 项修改需要确认。`)
}

async function mergeRemoteChanges() {
  if (!isLeader()) return false
  setState('pulling')
  const pulled = await pullFromCloud({ quiet: true })
  if (!pulled) {
    if (syncPreview.value?.conflicts?.length) {
      pauseForConflict()
      return false
    }
    throw new Error(lastError.value || '云端暂时不可用')
  }
  if (syncPreview.value?.conflicts?.length) {
    pauseForConflict()
    return false
  }
  setState('merging')
  return true
}

async function runSyncCycle(reason = 'manual', expectedGeneration = coordinatorGeneration) {
  const cycleGeneration = expectedGeneration
  if (!started || cycleGeneration !== coordinatorGeneration || running || !isSyncSpaceBound.value || (reason !== 'manual' && !autoSyncEnabled.value)) return false
  if (syncSpaceBootstrapPending.value) {
    setState('disabled')
    return false
  }
  if (syncCalibrationRequired.value) {
    setState('calibration-required', '检测到旧版不可靠同步基线，请先重新校准此设备。')
    return false
  }
  if (syncRecovery.value.status === 'recovery-required' || syncRecovery.value.status === 'recovering' || syncRecovery.value.status === 'interrupted') {
    setState('recovery-required', '上次同步未完整结束，已暂停自动同步以保护本机数据。')
    return false
  }
  if (!isOnline()) {
    setState('offline')
    return false
  }
  if (reason !== 'manual' && !isVisible()) return false
  if (!maintainLeader()) return false
  running = true
  clearTimer('debounce')
  clearTimer('retry')
  try {
    setState('checking')
    if (!isLeader()) return false
    if (!started || cycleGeneration !== coordinatorGeneration) return false
    const result = await refreshCloudMetadata()
    if (!started || cycleGeneration !== coordinatorGeneration) return false
    if (!result.ok) throw new Error(result.error || '无法检查云端版本')
    if (!isLeader()) return false
    const relationship = syncRelationship.value
    if (relationship === 'unknown') throw new Error('当前同步空间缺少可靠基线，请打开数据管理完成一次合并确认')

    if (relationship === 'synced') {
      failureCount = 0
      setState('synced')
      armPolling()
      return true
    }

    if (relationship === 'cloud-updated' || relationship === 'both-changed') {
      const merged = await mergeRemoteChanges()
      if (!started || cycleGeneration !== coordinatorGeneration) return false
      if (!merged) return false
      if (!localChanged.value) {
        failureCount = 0
        setState('synced')
        armPolling()
        return true
      }
    }

    if (localChanged.value || relationship === 'empty') {
      if (!started || cycleGeneration !== coordinatorGeneration) return false
      let pushed = false
      let casRetries = 0
      while (!pushed && (localChanged.value || relationship === 'empty')) {
        if (!isLeader()) return false
        setState('pushing')
        const expectedBeforePush = remoteRevision.value
        pushed = await pushToCloud({ quiet: true })
        if (pushed) break
        // CAS 被拒绝时，push 已刷新 remote metadata；马上进入拉取/合并，绝不覆盖新版本。
        if (remoteRevision.value === expectedBeforePush) {
          throw new Error(lastError.value || '云端暂时不可用')
        }
        if (casRetries >= MAX_CAS_RETRIES) {
          throw new Error('云端持续发生并发修改，请稍后重试')
        }
        casRetries += 1
        // 短随机退避：让两个同时推送的标签页错开，而不是立刻再撞一次。
        const backoff = CAS_BACKOFF_MIN_MS + Math.floor(Math.random() * CAS_BACKOFF_JITTER_MS)
        await new Promise((resolve) => { window.setTimeout(resolve, backoff) })
        if (!started || cycleGeneration !== coordinatorGeneration) return false
        const merged = await mergeRemoteChanges()
        if (!started || cycleGeneration !== coordinatorGeneration) return false
        if (!merged) return false
        if (!localChanged.value) break
      }
    }
    failureCount = 0
    setState('synced')
    armPolling()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步暂时失败'
    if (['credential-invalid', 'permission-denied'].includes(syncErrorKind.value)) {
      clearTimer('debounce'); clearTimer('poll'); clearTimer('retry')
      setState(syncErrorKind.value, message)
      return false
    }
    setState('error', message)
    scheduleRetry(message, cycleGeneration)
    return false
  } finally {
    if (cycleGeneration === coordinatorGeneration) running = false
  }
}

function reconfigure() {
  if (!started) return
  if (!isSyncSpaceBound.value || !autoSyncEnabled.value || syncSpaceBootstrapPending.value || syncCalibrationRequired.value) {
    clearTimer('debounce'); clearTimer('poll'); clearTimer('retry')
    setState(syncCalibrationRequired.value ? 'calibration-required' : 'disabled', syncCalibrationRequired.value ? '检测到旧版不可靠同步基线，请先重新校准此设备。' : '')
    return
  }
  if (['credential-invalid', 'permission-denied'].includes(syncErrorKind.value)) {
    clearTimer('debounce'); clearTimer('poll'); clearTimer('retry')
    setState(syncErrorKind.value, lastError.value || '同步授权已失效')
    return
  }
  if (!isOnline()) { setState('offline'); return }
  if (syncRecovery.value.status === 'recovery-required') { setState('recovery-required', syncRecovery.value.message); return }
  setState(localChanged.value ? 'dirty' : 'idle')
  if (localChanged.value) markDirty()
  else {
    void runSyncCycle('startup')
    armPolling()
  }
}

function handleMessage(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') return
  if (data.source === tabId) return
  // 协议版本不符的消息直接丢弃：宁可不同步，也不要按未知语义去碰数据。
  if (Number(data.v) !== CHANNEL_VERSION) return
  // 同步空间不一致时必须忽略。用户在两个标签页里绑定了不同的空间时，
  // 旧标签页发来的 sync-now 会让本标签页去跑一次与自己空间无关的同步。
  const mySpace = syncSpaceSettings.value?.spaceId || ''
  if (mySpace && String(data.spaceId || '') !== mySpace) return
  if (data.type === 'sync-now' && maintainLeader()) void runSyncCycle('manual')
  if (data.type === 'state' && !isLeader()) {
    if (AUTO_SYNC_STATES.includes(data.state)) {
      autoSyncState.value = data.state
      // 错误文本来自另一个标签页，长度必须先夹住再进 UI。
      autoSyncError.value = String(data.error ?? '').slice(0, CHANNEL_ERROR_MAX)
    }
  }
}

export function startAutoSyncCoordinator() {
  if (started) return
  coordinatorGeneration += 1
  started = true
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('study-life-auto-sync')
      channel.addEventListener('message', handleMessage)
    }
  } catch { channel = null }
  onDirty = () => markDirty()
  onOnline = () => scheduleEventSyncCheck()
  onOffline = () => {
    clearTimer('debounce'); clearTimer('poll'); clearTimer('retry'); clearTimer('event')
    // 未绑定同步空间时"离线"没有意义：应用本来就不需要联网。
    // 无条件置 offline 会让没用云同步的用户看到"本机修改已保存，联网后会继续同步"，
    // 而实际上根本没有任何同步在等待网络。
    setState(isSyncSpaceBound.value ? 'offline' : 'disabled')
  }
  onVisibility = () => {
    if (document.hidden) { clearTimer('poll'); return }
    if (autoSyncEnabled.value) scheduleEventSyncCheck()
    armPolling()
  }
  onFocus = () => scheduleEventSyncCheck()
  onPageShow = () => scheduleEventSyncCheck()
  onStorage = (event) => {
    if (event.key === LEADER_KEY) maintainLeader()
    if (event.key === syncStorageKey(SYNC_DIRTY_SIGNAL_KEY) && event.newValue) {
      localChanged.value = true
      markDirty()
    }
  }
  window.addEventListener('study-life:sync-dirty', onDirty)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('storage', onStorage)
  stopSettingsWatch = watch([syncSpaceSettings, autoSyncEnabled, syncRecovery, syncCalibrationRequired], reconfigure, { deep: true })
  stopDirtyWatch = watch(localChanged, (dirty) => { if (dirty) markDirty() })
  reconfigure()
}

export function stopAutoSyncCoordinator() {
  coordinatorGeneration += 1
  started = false
  running = false
  cancelSyncOperations()
  clearTimer('debounce'); clearTimer('poll'); clearTimer('retry'); clearTimer('leader'); clearTimer('heartbeat')
  clearTimer('event')
  stopSettingsWatch?.(); stopDirtyWatch?.()
  stopSettingsWatch = null; stopDirtyWatch = null
  if (onDirty) window.removeEventListener('study-life:sync-dirty', onDirty)
  if (onOnline) window.removeEventListener('online', onOnline)
  if (onOffline) window.removeEventListener('offline', onOffline)
  if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
  if (onFocus) window.removeEventListener('focus', onFocus)
  if (onPageShow) window.removeEventListener('pageshow', onPageShow)
  if (onStorage) window.removeEventListener('storage', onStorage)
  onDirty = null; onOnline = null; onOffline = null; onVisibility = null; onFocus = null; onPageShow = null; onStorage = null
  try {
    const lease = readLease()
    if (lease?.ownerId === tabId && lease.leaseId === leaderLeaseId) localStorage.removeItem(LEADER_KEY)
  } catch {}
  leaderLeaseId = null
  try { channel?.close() } catch {}
  channel = null
  setState('disabled')
}

export function syncNow() {
  if (!started) startAutoSyncCoordinator()
  if (!isSyncSpaceBound.value) return false
  if (!maintainLeader()) {
    // 本标签页不是 leader，只能请 leader 代跑一次。没有可用的 BroadcastChannel
    // （隐私模式、被企业策略禁用）时这条请求根本发不出去 —— 返回 true 会让
    // 调用方显示"已同步"，而实际上一个请求都没发出去。
    if (broadcast({ type: 'sync-now' })) return true
    setState('error', '当前浏览器环境不允许跨标签页同步，请保持本页在前台后重试。')
    return false
  }
  return runSyncCycle('manual')
}

export function resumeAutoSync() {
  if (autoSyncState.value === 'conflict') {
    if (syncPreview.value?.conflicts?.length) return false
    setState(localChanged.value ? 'dirty' : 'idle')
  }
  return syncNow()
}
