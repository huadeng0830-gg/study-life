// 前端云同步：远程数据先校验、再快照、最后写入本机响应式状态。
import { ref } from 'vue'
import { decryptData, encryptData } from '../utils/crypto.js'
import {
  SYNC_DEFAULTS,
  SYNC_KEYS,
  cloneValue,
  mergeSyncValue,
  sanitizeSyncPayload,
  validateSyncPayload,
} from './cloudSyncData.js'

const UNDO_KEY = 'study_life_cloud_pull_undo'

const code = ref('')
const syncStatus = ref('idle') // idle | pulling | pushing | success | error
const lastError = ref('')
const lastSyncedAt = ref(null)
const remoteUpdatedAt = ref(null)
const localChanged = ref(false)
const canUndoPull = ref(readUndo() !== null)
const remoteWriteKeys = new Set()

export function markLocalChanged(key = '') {
  if (key && remoteWriteKeys.delete(key)) return
  localChanged.value = true
}

const API = {
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
  window.setTimeout(() => { if (syncStatus.value === 'success') syncStatus.value = 'idle' }, 2000)
  return true
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
    const nextValue = mergeSyncValue(states[key].value, remoteValue)
    if (JSON.stringify(nextValue) === JSON.stringify(states[key].value)) continue
    remoteWriteKeys.add(key)
    states[key].value = nextValue
  }
  window.setTimeout(() => remoteWriteKeys.clear(), 1200)
}

async function responseError(response, fallback) {
  try {
    const body = await response.json()
    return body.error || fallback
  } catch {
    return fallback
  }
}

async function pull(accessCode = code.value) {
  if (!/^\d{6}$/.test(accessCode)) return showError('请输入有效的 6 位访问码')
  syncStatus.value = 'pulling'
  lastError.value = ''

  try {
    const res = await fetch(`${API.pull}?code=${encodeURIComponent(accessCode)}`)
    if (!res.ok) throw new Error(await responseError(res, '拉取失败'))
    const { data, updatedAt } = await res.json()

    if (!data) {
      remoteUpdatedAt.value = null
      return showSuccess('云端暂无数据，本机数据未改变')
    }

    const remote = await decryptData(data, accessCode)
    const { values: validated, invalidKeys } = sanitizeSyncPayload(remote)
    if (!Object.keys(validated).length && invalidKeys.length) {
      throw new Error('云端数据全部为旧版异常格式，本机数据未改变')
    }
    const states = await storedStates()
    saveUndo(snapshotStates(states))
    applyRemoteValues(states, validated)

    code.value = accessCode
    remoteUpdatedAt.value = updatedAt
    lastSyncedAt.value = new Date().toISOString()
    localChanged.value = false
    return showSuccess(
      invalidKeys.length
        ? `已合并可用数据，并跳过 ${invalidKeys.length} 项旧版异常设置`
        : '已安全合并云端数据，可撤销本次拉取'
    )
  } catch (error) {
    return showError(error instanceof Error ? error.message : '拉取失败')
  }
}

// 推送本地到远程
async function push() {
  if (!/^\d{6}$/.test(code.value)) return showError('请输入有效的 6 位访问码')

  syncStatus.value = 'pushing'
  lastError.value = ''

  try {
    const states = await storedStates()
    const payload = snapshotStates(states)
    validateSyncPayload(payload)
    const encrypted = await encryptData(payload, code.value)

    const res = await fetch(API.push, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value, data: encrypted }),
    })

    if (!res.ok) throw new Error(await responseError(res, '推送失败'))
    const { updatedAt } = await res.json()
    remoteUpdatedAt.value = updatedAt
    lastSyncedAt.value = new Date().toISOString()
    localChanged.value = false
    return showSuccess('已加密推送到云端')
  } catch (error) {
    return showError(error instanceof Error ? error.message : '推送失败')
  }
}

async function undoLastPull() {
  const undo = readUndo()
  if (!undo) return showError('没有可撤销的云端拉取')
  try {
    const values = validateSyncPayload(undo.values)
    const states = await storedStates()
    for (const [key, value] of Object.entries(values)) states[key].value = cloneValue(value)
    localStorage.removeItem(UNDO_KEY)
    canUndoPull.value = false
    localChanged.value = true
    return showSuccess('已恢复到拉取前的本机数据')
  } catch (error) {
    return showError(error instanceof Error ? error.message : '撤销失败')
  }
}

// 启动时自动拉取（若有码）
async function init() {
  if (code.value) {
    await pull(code.value)
  }
}

// 定期轮询（每 2 分钟）
setInterval(() => {
  if (code.value && syncStatus.value === 'idle') void pull(code.value)
}, 2 * 60 * 1000)

export function useCloudSync() {
  return {
    code,
    syncStatus,
    lastError,
    lastSyncedAt,
    remoteUpdatedAt,
    localChanged,
    canUndoPull,
    pull,
    push,
    undoLastPull,
    markLocalChanged,
    init,
    setCode(value) { code.value = value },
    clearCode() {
      code.value = ''
      remoteUpdatedAt.value = null
      localChanged.value = false
    },
  }
}
