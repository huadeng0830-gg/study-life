// 前端云同步：严格手动模式。
// 连接 ≠ 拉取 ≠ 推送：connectCloud() 只做验证和读取云端元数据，
// 业务数据的下行只能由用户点击「从云端拉取」触发，
// 上行只能由用户点击「推送到云端」触发。
// 应用内不存在任何定时器、启动钩子或输入事件触发的自动同步。
import { computed, ref } from 'vue'
import { decryptData, encryptData } from '../utils/crypto.js'
import { raceWithControls, throwIfAborted } from './asyncTask.js'
import { deviceProfile } from './deviceIdentity.js'
import {
  SYNC_DEFAULTS,
  SYNC_KEYS,
  cloneValue,
  sanitizeSyncPayload,
  validateSyncPayload,
} from './cloudSyncData.js'

const UNDO_KEY = 'study_life_cloud_pull_undo'
const SYNC_HISTORY_KEY = 'study_life_sync_history'
const LOCAL_TS_KEY = 'study_life_last_local_change'
const VERIFY_TIMEOUT_MS = 15_000
const SYNC_TIMEOUT_MS = 45_000
const SYNC_CODE_PATTERN = /^\d{6}$/

export const code = ref('')
// disconnected -> validating -> connected（连接成功后停留，绝不进入 pulling）
export const connectionState = ref('disconnected')
export const syncStatus = ref('idle') // idle | pulling | pushing | restoring | success | error
export const lastError = ref('')
export const lastSyncedAt = ref(null)
export const remoteUpdatedAt = ref(null)
export const cloudExists = ref(false)
export const remoteRevision = ref(readSyncHistory().baseRevision ?? null)
export const cloudMetadata = ref(emptyMetadata())
export const remoteDevice = ref(readSyncHistory().remoteDevice ?? null)
export const lastPushedDevice = ref(readSyncHistory().lastPushedDevice ?? null)
export const localChanged = ref(false)
export const canUndoPull = ref(readUndo() !== null)
const remoteWriteKeys = new Set()

export const isSyncing = computed(() =>
  ['pulling', 'pushing', 'restoring'].includes(syncStatus.value)
)
export const syncRelationship = computed(() => deriveSyncRelationship({
  exists: cloudExists.value,
  revision: remoteRevision.value,
}, {
  hasBase: readSyncHistory().hasBase === true,
  baseRevision: readSyncHistory().baseRevision ?? null,
  localDirty: localChanged.value,
}))

export function deriveSyncRelationship(metadata, localState) {
  if (!metadata?.exists) return localState?.localDirty ? 'local-changes' : 'empty'
  // 旧云端记录没有 revision 时，不能用时间猜测同步方向。
  if (!localState?.hasBase || metadata.revision === null) return 'unknown'
  if (metadata.revision === localState.baseRevision) return localState.localDirty ? 'local-changes' : 'synced'
  return localState.localDirty ? 'both-changed' : 'cloud-updated'
}

function readLocalChangedAt() {
  try { return localStorage.getItem(LOCAL_TS_KEY) || null } catch { return null }
}
export const lastLocalChangedAt = ref(readLocalChangedAt())

function readSyncHistory() {
  try { return JSON.parse(localStorage.getItem(SYNC_HISTORY_KEY)) ?? {} } catch { return {} }
}
function saveSyncHistory() {
  try {
    localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify({
      remoteDevice: remoteDevice.value,
      lastPushedDevice: lastPushedDevice.value,
      hasBase: readSyncHistory().hasBase === true,
      baseRevision: readSyncHistory().baseRevision ?? null,
      localDirty: localChanged.value,
    }))
  } catch {}
}

function saveSyncBase({ hasBase = true, baseRevision = remoteRevision.value, localDirty = localChanged.value } = {}) {
  try {
    const history = readSyncHistory()
    localStorage.setItem(SYNC_HISTORY_KEY, JSON.stringify({
      ...history,
      remoteDevice: remoteDevice.value,
      lastPushedDevice: lastPushedDevice.value,
      hasBase,
      baseRevision,
      localDirty,
    }))
  } catch {}
}

function emptyMetadata() {
  return { exists: false, revision: null, updatedAt: null, updatedByDeviceId: null, updatedByDeviceName: null }
}

function applyCloudMetadata(value) {
  const metadata = {
    exists: Boolean(value?.exists),
    revision: Number.isInteger(value?.revision) ? value.revision : null,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
    updatedByDeviceId: typeof value?.updatedByDeviceId === 'string' ? value.updatedByDeviceId : null,
    updatedByDeviceName: typeof value?.updatedByDeviceName === 'string' && value.updatedByDeviceName.trim()
      ? value.updatedByDeviceName.trim().slice(0, 30)
      : null,
  }
  cloudMetadata.value = metadata
  cloudExists.value = metadata.exists
  remoteRevision.value = metadata.revision
  remoteUpdatedAt.value = metadata.updatedAt
  remoteDevice.value = metadata.updatedByDeviceName
    ? { id: metadata.updatedByDeviceId || '', name: metadata.updatedByDeviceName, pushedAt: metadata.updatedAt || '' }
    : null
  return metadata
}

function safeDeviceMeta(meta) {
  if (!meta || typeof meta !== 'object' || typeof meta.name !== 'string') return null
  return {
    id: typeof meta.id === 'string' ? meta.id.slice(0, 80) : '',
    name: meta.name.trim().slice(0, 30) || '未知设备',
    pushedAt: typeof meta.pushedAt === 'string' ? meta.pushedAt : '',
  }
}
function unpackSyncPackage(value) {
  if (value?.format === 'study-life-sync' && value.version === 2 && value.values) {
    return { values: value.values, meta: safeDeviceMeta(value.meta) }
  }
  return { values: value, meta: safeDeviceMeta(value?.__sync_meta) }
}

export function markLocalChanged(key = '') {
  if (key && remoteWriteKeys.delete(key)) return
  lastLocalChangedAt.value = new Date().toISOString()
  try { localStorage.setItem(LOCAL_TS_KEY, lastLocalChangedAt.value) } catch {}
  localChanged.value = true
  saveSyncBase({ localDirty: true })
}

const API = {
  verify: '/api/auth/verify',
  pull: '/api/sync/pull',
  push: '/api/sync/push',
}

function showError(msg) {
  syncStatus.value = 'error'
  lastError.value = msg
  return false
}

function showSuccess(message = '') {
  syncStatus.value = 'success'
  lastError.value = message
  window.setTimeout(() => { if (syncStatus.value === 'success') syncStatus.value = 'idle' }, 2600)
  return true
}

function nowText() {
  return new Date().toLocaleString()
}

async function responseError(response, fallback) {
  try {
    const body = await response.json()
    return body.error || fallback
  } catch {
    return fallback
  }
}

function reportProgress(onProgress, step, message, partial = null) {
  onProgress?.({ step, message, partial })
}

async function controlledFetch(url, init = {}, { signal = null, timeoutMs = SYNC_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  return raceWithControls(fetch(url, { ...init, signal: controller.signal }), {
    signal,
    timeoutMs,
    timeoutMessage: '云端请求超时，请检查网络后重试',
    onInterrupt: () => controller.abort(),
  })
}

function readUndo() {
  try {
    const value = JSON.parse(localStorage.getItem(UNDO_KEY))
    return value && value.version === 1 && value.values ? value : null
  } catch {
    return null
  }
}

function saveUndo(values) {
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      values,
    }))
    canUndoPull.value = true
  } catch {
    // 存储空间不足时不阻断同步；格式校验仍会保护本地结构。
  }
}

async function storedStates() {
  const { useStoredRef } = await import('./store.js')
  return Object.fromEntries(
    SYNC_KEYS.map((key) => [key, useStoredRef(key, cloneValue(SYNC_DEFAULTS[key]))])
  )
}

function snapshotStates(states) {
  return Object.fromEntries(SYNC_KEYS.map((key) => [key, cloneValue(states[key].value)]))
}

function applyRemoteValues(states, validated) {
  for (const [key, remoteValue] of Object.entries(validated)) {
    const nextValue = cloneValue(remoteValue)
    if (JSON.stringify(nextValue) === JSON.stringify(states[key].value)) continue
    remoteWriteKeys.add(key)
    states[key].value = nextValue
  }
  window.setTimeout(() => remoteWriteKeys.clear(), 1200)
}

// ---------- 连接：仅验证访问码 + 读取云端元数据（不下载业务数据） ----------
export async function connectCloud(codeInput, { signal = null } = {}) {
  if (isSyncing.value) return { ok: false, error: '正在执行其他云操作，请稍后再试' }
  if (!SYNC_CODE_PATTERN.test(String(codeInput ?? ''))) {
    connectionState.value = 'disconnected'
    return { ok: false, error: '请输入 6 位数字访问码' }
  }
  connectionState.value = 'validating'
  lastError.value = ''
  try {
    const res = await controlledFetch(API.verify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput }),
    }, { signal, timeoutMs: VERIFY_TIMEOUT_MS })
    if (!res.ok) throw new Error(await responseError(res, '访问码验证失败'))
    const metadata = applyCloudMetadata(await res.json())
    // 仅在验证通过后记住当前空间，不触发任何数据下载或上传。
    code.value = codeInput
    // 恢复上次已确认的本地基线；连接本身绝不改变业务数据或“本机已修改”标记。
    localChanged.value = readSyncHistory().localDirty === true
    connectionState.value = 'connected'
    return {
      ok: true,
      ...metadata,
    }
  } catch (error) {
    connectionState.value = 'disconnected'
    code.value = ''
    return { ok: false, error: error instanceof Error ? error.message : '访问码验证失败' }
  }
}

export function disconnectCloud() {
  // 只断开同步空间，不删除本地任何数据。
  code.value = ''
  applyCloudMetadata(emptyMetadata())
  localChanged.value = false
  lastError.value = ''
  connectionState.value = 'disconnected'
}

// ---------- 拉取：仅可由 UI 的「从云端拉取」按钮调用 ----------
export async function pullFromCloud({ signal = null, onProgress = null } = {}) {
  if (isSyncing.value) return false
  if (!SYNC_CODE_PATTERN.test(code.value)) return showError('尚未连接云端，请先输入访问码连接')
  syncStatus.value = 'pulling'
  lastError.value = ''

  try {
    reportProgress(onProgress, 'request', '正在请求云端版本')
    const res = await controlledFetch(API.pull, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value }),
    }, { signal })
    if (!res.ok) throw new Error(await responseError(res, '拉取失败'))
    const response = await res.json()
    const { data } = response
    const metadata = applyCloudMetadata({ ...response, exists: response.exists ?? Boolean(data) })

    if (!data) {
      return showSuccess('云端暂无数据，本地数据未发生变化')
    }

    throwIfAborted(signal)
    reportProgress(onProgress, 'decrypt', '云端数据已收到，正在本机解密')
    const remote = unpackSyncPackage(await decryptData(data, code.value))
    throwIfAborted(signal)
    reportProgress(onProgress, 'validate', '正在校验数据结构与兼容性')
    const { values: validated, invalidKeys } = sanitizeSyncPayload(remote.values)
    if (!Object.keys(validated).length && invalidKeys.length) {
      throw new Error('云端数据全部为旧版异常格式，本地数据未发生变化')
    }
    // 先创建本机安全快照，再应用云端版本。
    throwIfAborted(signal)
    const states = await storedStates()
    reportProgress(onProgress, 'apply', '已创建拉取前快照，正在应用可用数据', { 数据模块: Object.keys(validated).length })
    saveUndo(snapshotStates(states))
    applyRemoteValues(states, validated)

    // 新版来源以服务端 metadata 为准；旧加密包只作为兼容显示回退。
    if (!metadata.updatedByDeviceName && remote.meta) remoteDevice.value = remote.meta
    lastSyncedAt.value = new Date().toISOString()
    localChanged.value = false
    saveSyncBase({ hasBase: true, baseRevision: metadata.revision, localDirty: false })
    saveSyncHistory()
    return showSuccess(
      invalidKeys.length
        ? `已合并可用数据，并跳过 ${invalidKeys.length} 项旧版异常设置 · ${nowText()}`
        : `已从云端拉取 ${nowText()}，可撤销本次拉取`
    )
  } catch (error) {
    if (error?.name === 'AbortError') {
      syncStatus.value = 'idle'
      lastError.value = ''
      return false
    }
    return showError(error instanceof Error ? `${error.message}（本地数据未发生变化）` : `拉取失败 ${nowText()}，本地数据未发生变化`)
  }
}

// ---------- 推送：仅可由 UI 的「推送到云端」按钮调用 ----------
export async function pushToCloud({ signal = null, onProgress = null } = {}) {
  if (isSyncing.value) return false
  if (!SYNC_CODE_PATTERN.test(code.value)) return showError('尚未连接云端，请先输入访问码连接')

  syncStatus.value = 'pushing'
  lastError.value = ''

  try {
    reportProgress(onProgress, 'collect', '正在收集本机可同步数据')
    const states = await storedStates()
    const payload = snapshotStates(states)
    validateSyncPayload(payload)
    // 上传前重新读取轻量 metadata。若版本已变化，停止在这里，绝不上传覆盖。
    const knownRevision = remoteRevision.value
    reportProgress(onProgress, 'check', '正在重新确认云端版本')
    const checkRes = await controlledFetch(API.verify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value }),
    }, { signal, timeoutMs: VERIFY_TIMEOUT_MS })
    const latest = await checkRes.json()
    if (!checkRes.ok) throw new Error(latest.error || '无法确认云端最新版本')
    if (latest.revision !== knownRevision) {
      applyCloudMetadata(latest)
      return showError(`云端刚刚发生了变化${latest.updatedByDeviceName ? `，“${latest.updatedByDeviceName}”已经更新了数据` : ''}。请重新查看后再决定是否推送`)
    }
    const meta = {
      id: deviceProfile.value.id,
      name: deviceProfile.value.name,
      pushedAt: new Date().toISOString(),
    }
    // 元数据放在保留字段中；旧版客户端会忽略它但仍能读取 sl_* 数据。
    throwIfAborted(signal)
    reportProgress(onProgress, 'encrypt', '正在本机加密同步数据', { 数据模块: Object.keys(payload).length })
    const encrypted = await encryptData({ ...payload, __sync_meta: meta }, code.value)
    throwIfAborted(signal)

    reportProgress(onProgress, 'upload', '加密完成，正在上传云端')
    const res = await controlledFetch(API.push, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.value,
        data: encrypted,
        expectedRevision: knownRevision,
        deviceId: meta.id,
        deviceName: meta.name,
      }),
    }, { signal })

    const response = await res.json()
    if (!res.ok) {
      if (response.conflict) applyCloudMetadata(response)
      throw new Error(response.error || '推送失败')
    }
    reportProgress(onProgress, 'confirm', '云端已确认接收新版本')
    const metadata = applyCloudMetadata({ ...response, exists: true })
    lastPushedDevice.value = { ...meta, pushedAt: metadata.updatedAt }
    lastSyncedAt.value = new Date().toISOString()
    localChanged.value = false
    saveSyncBase({ hasBase: true, baseRevision: metadata.revision, localDirty: false })
    saveSyncHistory()
    return showSuccess(`已推送到云端 ${nowText()}`)
  } catch (error) {
    if (error?.name === 'AbortError') {
      syncStatus.value = 'idle'
      lastError.value = ''
      return false
    }
    return showError(error instanceof Error ? `${error.message}（云端数据未发生变化）` : `推送失败 ${nowText()}，云端数据未发生变化`)
  }
}

export async function undoLastPull() {
  if (isSyncing.value) return false
  const undo = readUndo()
  if (!undo) return showError('暂无可撤销的拉取记录')
  syncStatus.value = 'restoring'
  try {
    const values = validateSyncPayload(undo.values)
    const states = await storedStates()
    for (const [key, value] of Object.entries(values)) states[key].value = cloneValue(value)
    localStorage.removeItem(UNDO_KEY)
    canUndoPull.value = false
    localChanged.value = true
    return showSuccess(`已恢复到拉取前的本机数据 · ${nowText()}`)
  } catch (error) {
    return showError(error instanceof Error ? error.message : '撤销失败')
  } finally {
    if (syncStatus.value === 'restoring') syncStatus.value = 'idle'
  }
}

export function useCloudSync() {
  return {
    code,
    connectionState,
    isSyncing,
    syncStatus,
    lastError,
    lastSyncedAt,
    lastLocalChangedAt,
    remoteUpdatedAt,
    cloudExists,
    remoteDevice,
    lastPushedDevice,
    localChanged,
    canUndoPull,
    pullFromCloud,
    pushToCloud,
    undoLastPull,
    connectCloud,
    disconnectCloud,
    markLocalChanged,
  }
}
