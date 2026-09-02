import { effectScope, ref, watch } from 'vue'
import { markLocalChanged } from '../cloudSync.js'
import { mirrorLocalValue, mirrorLocalValues } from '../dataVault.js'
import { recordSilentError } from '../globalError.js'

const storedRefs = new Map()

export const clock = ref(new Date())

const CLOCK_INTERVAL = 30000
let clockTimer = null

function startClock() {
  clearInterval(clockTimer)
  clockTimer = setInterval(() => {
    clock.value = new Date()
  }, CLOCK_INTERVAL)
}

startClock()

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearInterval(clockTimer)
      clockTimer = null
    } else {
      clock.value = new Date()
      startClock()
    }
  })
}

const WRITE_DELAY = 300
const pendingWrites = new Map()
let writeTimer = null
let idleWrite = null

function writeNow(key, makeRaw) {
  try {
    const raw = makeRaw()
    localStorage.setItem(key, raw)
    // 来自响应式业务状态的写入是用户已确认的最新事实；即便是空集合，
    // 也必须覆盖影子副本，避免之后把已删除的数据重新恢复出来。
    mirrorLocalValue(key, raw, { allowEmpty: true }).catch((error) => recordSilentError('vault-mirror', error))
    markLocalChanged(key, raw)
  } catch (error) {
    // 配额溢出/隐私模式等失败不阻塞应用，但必须留下排查线索。
    recordSilentError('storage-write', error)
  }
}

function cancelScheduledBatch() {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (idleWrite !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(idleWrite)
  }
  idleWrite = null
}

function writePendingBatch() {
  cancelScheduledBatch()
  const batch = [...pendingWrites.entries()]
  pendingWrites.clear()
  for (const [key, producer] of batch) writeNow(key, producer)
}

function scheduleWrite(key, makeRaw) {
  pendingWrites.set(key, makeRaw)
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleWrite = window.requestIdleCallback(writePendingBatch, { timeout: 700 })
    } else {
      writePendingBatch()
    }
  }, WRITE_DELAY)
}

function flushAllWrites() {
  flushPendingWatcherInstalls()
  if (pendingWrites.size) writePendingBatch()
  else cancelScheduledBatch()
}

export function flushStoredWrites() {
  flushAllWrites()
}

function cancelPendingWrite(key) {
  pendingWrites.delete(key)
  if (!pendingWrites.size) cancelScheduledBatch()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllWrites()
  })
  window.addEventListener('pagehide', flushAllWrites)
  window.addEventListener('beforeunload', flushAllWrites)
}

const persistenceScope = effectScope()
const pendingWatcherInstalls = new Map()

function installPersistenceWatcher(key) {
  const pending = pendingWatcherInstalls.get(key)
  if (!pending) return
  pendingWatcherInstalls.delete(key)
  if (pending.timer !== null && typeof window !== 'undefined') window.clearTimeout(pending.timer)
  if (pending.idle !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(pending.idle)
  }

  persistenceScope.run(() => {
    watch(
      pending.state,
      () => {
        scheduleWrite(key, () => JSON.stringify(pending.state.value))
      },
      { deep: true }
    )
  })
  try {
    if (JSON.stringify(pending.state.value) !== pending.baselineRaw) {
      scheduleWrite(key, () => JSON.stringify(pending.state.value))
    }
  } catch {
  }
}

function schedulePersistenceWatcher(key, state, baselineRaw) {
  const pending = { state, baselineRaw, timer: null, idle: null }
  pendingWatcherInstalls.set(key, pending)
  const install = () => installPersistenceWatcher(key)
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    pending.idle = window.requestIdleCallback(install, { timeout: 800 })
  } else if (typeof window !== 'undefined') {
    pending.timer = window.setTimeout(install, 120)
  } else {
    install()
  }
}

function flushPendingWatcherInstalls() {
  for (const key of [...pendingWatcherInstalls.keys()]) installPersistenceWatcher(key)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeStoredValue(saved, defaultValue) {
  if (Array.isArray(defaultValue)) {
    if (Array.isArray(saved)) return { value: saved, repaired: false }
    if (isPlainObject(saved)) {
      const numericEntries = Object.entries(saved)
        .filter(([entryKey]) => /^\d+$/.test(entryKey))
        .sort(([a], [b]) => Number(a) - Number(b))
      if (numericEntries.length) return { value: numericEntries.map(([, value]) => value), repaired: true }
    }
    return { value: JSON.parse(JSON.stringify(defaultValue)), repaired: true }
  }
  if (isPlainObject(defaultValue)) {
    if (!isPlainObject(saved)) {
      return { value: JSON.parse(JSON.stringify(defaultValue)), repaired: true }
    }
    const value = { ...JSON.parse(JSON.stringify(defaultValue)), ...saved }
    return { value, repaired: JSON.stringify(value) !== JSON.stringify(saved) }
  }
  return typeof saved === typeof defaultValue
    ? { value: saved, repaired: false }
    : { value: JSON.parse(JSON.stringify(defaultValue)), repaired: true }
}

/**
 * 读取或创建一个持久化的响应式引用（localStorage + IndexedDB 镜像 + 云同步标记）。
 * 同一 key 全局共享同一 ref；读取异常时回退到默认值并上报静默错误。
 *
 * @template T
 * @param {string} key 以 `sl_` 开头的存储键
 * @param {T} defaultValue 默认值（同时决定数据修复的形状基准）
 * @returns {import('vue').Ref<T>}
 */
export function useStoredRef(key, defaultValue) {
  if (storedRefs.has(key)) return storedRefs.get(key)

  let saved = null
  let savedRaw = null
  try {
    savedRaw = localStorage.getItem(key)
    saved = savedRaw === null ? null : JSON.parse(savedRaw)
  } catch (error) {
    // 读取失败（损坏/隐私模式）回退到默认值，同时留下排查线索。
    recordSilentError('storage-read', error)
    saved = null
    savedRaw = null
  }
  const normalized = saved === null
    ? { value: JSON.parse(JSON.stringify(defaultValue)), repaired: false }
    : normalizeStoredValue(saved, defaultValue)
  const state = ref(normalized.value)
  if (normalized.repaired) {
    try {
      const raw = JSON.stringify(normalized.value)
      localStorage.setItem(key, raw)
      mirrorLocalValue(key, raw).catch((error) => recordSilentError('vault-mirror', error))
      savedRaw = raw
    } catch (error) {
      recordSilentError('storage-repair', error)
    }
  }
  storedRefs.set(key, state)
  schedulePersistenceWatcher(key, state, savedRaw ?? JSON.stringify(normalized.value))
  return state
}

export function migrateTaskCourseLinks(taskList, courseList) {
  if (!Array.isArray(taskList) || !Array.isArray(courseList)) return false
  const byName = new Map()
  for (const course of courseList) {
    const name = String(course?.name ?? '').trim()
    if (!name) continue
    if (byName.has(name)) byName.set(name, null)
    else byName.set(name, course.id)
  }
  let changed = false
  for (const task of taskList) {
    if (!task || task.courseId || !task.course) continue
    const courseId = byName.get(String(task.course).trim())
    if (!courseId) continue
    task.courseId = courseId
    changed = true
  }
  return changed
}

export async function restoreStoredValues(values, { markChanged = true } = {}) {
  const entries = Object.entries(values || {}).filter(([key]) => typeof key === 'string' && key.startsWith('sl_'))
  if (!entries.length) return
  const rawValues = Object.fromEntries(entries.map(([key, value]) => [key, JSON.stringify(value)]))
  const previous = Object.fromEntries(entries.map(([key]) => [key, localStorage.getItem(key)]))
  const previousStates = new Map(entries.flatMap(([key]) => (
    storedRefs.has(key)
      ? [[key, JSON.parse(JSON.stringify(storedRefs.get(key).value))]]
      : []
  )))
  try {
    for (const [key, raw] of Object.entries(rawValues)) localStorage.setItem(key, raw)
    for (const [key, value] of entries) {
      if (storedRefs.has(key)) storedRefs.get(key).value = value
    }
    await mirrorLocalValues(rawValues)
    if (markChanged) markLocalChanged()
  } catch (error) {
    let rollbackError = null
    try {
      for (const [key, raw] of Object.entries(previous)) {
        if (raw === null) localStorage.removeItem(key)
        else localStorage.setItem(key, raw)
      }
    } catch (cause) {
      rollbackError = cause
    }
    for (const [key, value] of previousStates) storedRefs.get(key).value = value
    if (rollbackError && error && typeof error === 'object') {
      error.rollbackFailed = true
      error.rollbackError = rollbackError
    }
    throw error
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key || !storedRefs.has(event.key) || event.newValue === null) return
    cancelPendingWrite(event.key)
    try {
      storedRefs.get(event.key).value = JSON.parse(event.newValue)
    } catch {
    }
  })
}
