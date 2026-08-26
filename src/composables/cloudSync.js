// 前端云同步逻辑：启动拉取、防抖推送、冲突合并、定期轮询
import { ref, watch, computed } from 'vue'
import { useStoredRef } from './store.js'
import { decryptData, encryptData, codeHash } from '../utils/crypto.js'

const API_BASE = '/api'

const code = ref('')
const syncStatus = ref('idle') // idle | pulling | pushing | success | error
const lastError = ref('')
const lastSyncedAt = ref(null)
const remoteUpdatedAt = ref(null)
const localChanged = ref(false)

export function markLocalChanged() {
  localChanged.value = true
}

const API = {
  pull: `${location.origin}/api/sync/pull`,
  push: `${location.origin}/api/sync/push`,
  verify: `${location.origin}/api/auth/verify`,
}

function showError(msg) {
  syncStatus.value = 'error'
  lastError.value = msg
}

function showSuccess() {
  syncStatus.value = 'success'
  lastError.value = ''
  setTimeout(() => { if (syncStatus.value === 'success') syncStatus.value = 'idle' }, 2000)
}

// 合并策略：以 updatedAt 为准，数组类按 id 去重合并
function mergeData(local, remote) {
  if (!remote) return local
  if (!local) return remote

  const merged = { ...local }

  for (const [key, remoteVal] of Object.entries(remote)) {
    const localVal = local[key]
    if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
      // 数组去重合并：以 id 为键，保留更新的
      const map = new Map()
      for (const item of [...localVal, ...remoteVal]) {
        if (item?.id) {
          const existing = map.get(item.id)
          if (!existing || (item.updatedAt && existing.updatedAt && item.updatedAt > existing.updatedAt)) {
            map.set(item.id, item)
          }
        } else {
          map.set(Math.random(), item) // 无 id 的直接保留
        }
      }
      merged[key] = [...map.values()]
    } else if (typeof remoteVal === 'object' && remoteVal !== null) {
      merged[key] = mergeData(localVal || {}, remoteVal)
    } else {
      merged[key] = remoteVal
    }
  }
  return merged
}

// 拉取远程并合并入本地 useStoredRef
async function pull() {
  if (!code.value) return
  syncStatus.value = 'pulling'
  lastError.value = ''

  try {
    const res = await fetch(`${API.pull}?code=${code.value}`)
    if (!res.ok) throw new Error('拉取失败')
    const { data, updatedAt } = await res.json()

    if (!data) {
      remoteUpdatedAt.value = null
      return
    }

    const remote = await decryptData(data, code.value)
    remoteUpdatedAt.value = updatedAt

    // 合并入各个 useStoredRef（需导入各 store）
    const { useStoredRef } = await import('./store.js')
    const keys = [
      'sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester',
      'sl_tasks', 'sl_exams', 'sl_countdown_show_past',
      'sl_checklists', 'sl_bills', 'sl_food_places', 'sl_food_history',
      'sl_theme', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent',
      'sl_appearance', 'sl_wallpaper_config',
    ]

    for (const key of keys) {
      if (remote[key] !== undefined) {
        const ref = useStoredRef(key, key.startsWith('sl_') ? [] : (key === 'sl_theme' ? 'blue' : key === 'sl_wallpaper_accent' ? '#456fe8' : false))
        ref.value = mergeData(ref.value, remote[key])
      }
    }

    showSuccess()
  } catch (e) {
    showError(e.message)
  }
}

// 推送本地到远程
async function push() {
  if (!code.value) return
  if (!localChanged.value) return

  syncStatus.value = 'pushing'
  lastError.value = ''

  try {
    const { useStoredRef } = await import('./store.js')
    const keys = [
      'sl_courses', 'sl_course_templates', 'sl_timecfg', 'sl_semester',
      'sl_tasks', 'sl_exams', 'sl_countdown_show_past',
      'sl_checklists', 'sl_bills', 'sl_food_places', 'sl_food_history',
      'sl_theme', 'sl_auto_wallpaper_color', 'sl_wallpaper_accent',
      'sl_appearance', 'sl_wallpaper_config',
    ]

    const payload = {}
    for (const key of keys) {
      const ref = useStoredRef(key, [])
      payload[key] = ref.value
    }

    const encrypted = await encryptData(payload, code.value)

    const res = await fetch(API.push, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value, data: encrypted }),
    })

    if (!res.ok) throw new Error('推送失败')
    const { updatedAt } = await res.json()
    remoteUpdatedAt.value = updatedAt
    lastSyncedAt.value = new Date().toISOString()
    localChanged.value = false
    showSuccess()
  } catch (e) {
    showError(e.message)
  }
}

// 启动时自动拉取（若有码）
async function init() {
  if (code.value) {
    await pull()
    // 监听本地变化（需在各 store 里调用 markLocalChanged）
  }
}

// 定期轮询（每 2 分钟）
setInterval(() => {
  if (code.value && syncStatus.value === 'idle') pull()
}, 2 * 60 * 1000)

export function useCloudSync() {
  return {
    code,
    syncStatus,
    lastError,
    lastSyncedAt,
    remoteUpdatedAt,
    localChanged,
    pull,
    push,
    markLocalChanged,
    init,
    setCode(c) { code.value = c },
    clearCode() { code.value = ''; remoteUpdatedAt.value = null; localChanged.value = false },
  }
}