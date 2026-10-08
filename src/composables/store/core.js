import { effectScope, ref, triggerRef, watch, shallowRef, isRef } from 'vue'
import { isSyncKey } from '../syncKeys.js'
import { mirrorLocalValue, mirrorLocalValues, setMirrorErrorHandler, setMirrorTimingHandler } from '../dataVault.js'
import { recordSilentError } from '../globalError.js'

// 存储层只发出本机数据变更信号；账号同步监听同一个事件，不反向耦合存储实现。
function notifyLocalChanged(key = '', rawValue = undefined) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('study-life:sync-dirty', { detail: { key, rawValue } }))
  }
}

const storedRefs = new Map()
// 这些高增长集合由领域命令显式提交，避免每次嵌套修改递归遍历整棵状态树。
//
// 【加入本集合的前提，两条缺一不可】
// 1. 该键的**每一条**修改路径都要显式调用 touchStoredRef（否则改动不会被持久化）；
// 2. 视图只依赖 touchStoredRef 那一次通知 —— 集合内的键是 shallowRef，
//    push/splice/就地改字段都不会自己通知（见 touchStoredRef 处的说明）。
// 漏掉第 1 条 = 改了不存盘；漏掉第 2 条 = 存盘了但界面停在旧值（「删了不消失」）。
// `sl_mood_log` 此前在本清单里，但全仓**没有任何一处** touchStoredRef('sl_mood_log')
// —— 违反上面第 1 条前提。它之所以没出事，是因为所有写入都是整体替换引用
// （TodayView 的 `moodLog.value = logMood(...)`），shallowRef 换引用会触发 watcher。
// 但只要有人改成 `moodLog.value[day] = x`，就是静默丢数据。
// 按自己的契约（前提 1 不成立就不该进清单）把它移出：它是个很小的
// 日期→心情映射，deep watch 的开销可以忽略，反而换来"任何改法都存得下去"。
// 守卫见 tests/explicitCommitContract.test.js。
const EXPLICIT_COMMIT_KEY_LIST = Object.freeze([
  'sl_expenses', 'sl_tasks', 'sl_events', 'sl_exams', 'sl_bills', 'sl_focus_sessions',
  'sl_checklists', 'sl_courses', 'sl_course_templates', 'sl_ledger_fx', 'sl_ledger_budget',
  'sl_ledger_templates', 'sl_schedule_exceptions',
])
export { EXPLICIT_COMMIT_KEY_LIST }
const EXPLICIT_COMMIT_KEYS = new Set(EXPLICIT_COMMIT_KEY_LIST)
const OBSERVABILITY_ENABLED = import.meta.env?.DEV === true
export const STORAGE_PERF_THRESHOLDS = Object.freeze({
  serializeMs: 32,
  localStorageMs: 32,
  mirrorMs: 32,
  payloadBytes: 1024 * 1024,
  writesPerMinute: 60,
})
const storagePerformance = new Map()
const storageWriteTimes = new Map()

function performanceNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function payloadBytes(raw) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(raw).byteLength
  return String(raw).length * 2
}

function observeStorage(key, values = {}, { countWrite = true } = {}) {
  if (!OBSERVABILITY_ENABLED) return
  const now = Date.now()
  const recent = (storageWriteTimes.get(key) || []).filter((stamp) => now - stamp < 60 * 1000)
  if (countWrite) recent.push(now)
  storageWriteTimes.set(key, recent)
  const previous = storagePerformance.get(key) || { key, payloadBytes: 0, serializeMs: 0, localStorageMs: 0, mirrorMs: 0, writesPerMinute: 0 }
  const next = { ...previous, ...values, key, writesPerMinute: recent.length }
  storagePerformance.set(key, next)
  const warnings = []
  if (next.serializeMs > STORAGE_PERF_THRESHOLDS.serializeMs) warnings.push(`serialize ${next.serializeMs}ms`)
  if (next.localStorageMs > STORAGE_PERF_THRESHOLDS.localStorageMs) warnings.push(`localStorage ${next.localStorageMs}ms`)
  if (next.mirrorMs > STORAGE_PERF_THRESHOLDS.mirrorMs) warnings.push(`mirror ${next.mirrorMs}ms`)
  if (next.payloadBytes > STORAGE_PERF_THRESHOLDS.payloadBytes) warnings.push(`payload ${next.payloadBytes}B`)
  if (next.writesPerMinute > STORAGE_PERF_THRESHOLDS.writesPerMinute) warnings.push(`writes/min ${next.writesPerMinute}`)
  if (warnings.length) console.warn(`[Study Life storage] ${key}: ${warnings.join(', ')}`)
}

export function getStoragePerformanceSnapshot() {
  return [...storagePerformance.values()].map((item) => ({ ...item }))
}

setMirrorTimingHandler(({ keys = [], durationMs = 0 } = {}) => {
  for (const key of keys) observeStorage(key, { mirrorMs: durationMs }, { countWrite: false })
})

export const clock = ref(new Date())

// 持久化失败不能只进入静默日志：用户仍可继续使用内存中的本次状态，
// 但必须明确知道刷新/关闭页面前需要导出数据。
export const persistenceState = ref({
  status: 'idle',
  key: '',
  source: '',
  message: '',
  at: 0,
})

export function reportPersistenceFailure(error, key = '', source = 'local') {
  const isMirror = source === 'mirror'
  persistenceState.value = {
    status: 'error',
    key,
    source,
    message: isMirror
      ? '本机主数据已写入，但安全副本未能更新；建议立即导出当前数据。'
      : '本次修改未能保存到本机；刷新或关闭页面前请先导出当前数据。',
    at: Date.now(),
  }
  recordSilentError(`storage-${source}`, error)
}

export function dismissPersistenceNotice() {
  persistenceState.value = { status: 'idle', key: '', source: '', message: '', at: 0 }
}

setMirrorErrorHandler((error, keys = []) => {
  reportPersistenceFailure(error, keys[0] || '', 'mirror')
})

function markPersistenceSuccess() {
  if (persistenceState.value.status !== 'error') return
  persistenceState.value = {
    ...persistenceState.value,
    status: 'recovered',
    message: '本机保存已恢复。',
    at: Date.now(),
  }
}

const CLOCK_INTERVAL = 60 * 1000
let clockTimer = null
let midnightTimer = null

function startClock() {
  clearInterval(clockTimer)
  clockTimer = setInterval(() => {
    clock.value = new Date()
  }, CLOCK_INTERVAL)
  if (midnightTimer) clearTimeout(midnightTimer)
  const now = new Date()
  const nextMidnight = new Date(now)
  nextMidnight.setHours(24, 0, 0, 10)
  midnightTimer = setTimeout(() => {
    clock.value = new Date()
    startClock()
  }, Math.max(1000, nextMidnight.getTime() - now.getTime()))
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
  window.addEventListener('focus', () => {
    clock.value = new Date()
    startClock()
  })
}

const WRITE_DELAY = 300
// 不同类型数据的差异化防抖：表单输入 500ms，大集合 300ms，设置类 1000ms
const WRITE_DELAY_BY_TYPE = {
  default: 300,
  form: 500,        // 表单输入：给用户更多打字时间
  collection: 300,  // 大集合：批量操作后快速持久化
  settings: 1000,   // 设置类：低频变更，延迟更久避免抖动
}
const pendingWrites = new Map()
const lastWrittenRaw = new Map()
let writeTimer = null
let idleWrite = null

function getWriteDelay(key) {
  if (key.startsWith('sl_') && (key.includes('expense') || key.includes('task') || key.includes('course') || key.includes('bill') || key.includes('event'))) {
    return WRITE_DELAY_BY_TYPE.collection
  }
  if (key.includes('setting') || key.includes('theme') || key.includes('config') || key.includes('preference')) {
    return WRITE_DELAY_BY_TYPE.settings
  }
  if (key.includes('note') || key.includes('draft') || key.includes('input')) {
    return WRITE_DELAY_BY_TYPE.form
  }
  return WRITE_DELAY_BY_TYPE.default
}

function writeNow(key, makeRaw) {
  let raw
  try {
    const serializeStartedAt = performanceNow()
    raw = makeRaw()
    const serializeMs = Math.round((performanceNow() - serializeStartedAt) * 100) / 100
    if (raw === lastWrittenRaw.get(key)) return
    const localStartedAt = performanceNow()
    localStorage.setItem(key, raw)
    lastWrittenRaw.set(key, raw)
    const localStorageMs = Math.round((performanceNow() - localStartedAt) * 100) / 100
    observeStorage(key, { payloadBytes: payloadBytes(raw), serializeMs, localStorageMs })
    markPersistenceSuccess()
    // 来自响应式业务状态的写入是用户已确认的最新事实；即便是空集合，
    // 也必须覆盖影子副本，避免之后把已删除的数据重新恢复出来。
    mirrorLocalValue(key, raw, { allowEmpty: true }).catch((error) => reportPersistenceFailure(error, key, 'mirror'))
    if (isSyncKey(key)) notifyLocalChanged(key, raw)
  } catch (error) {
    // 配额溢出/隐私模式等失败不阻塞应用，但必须留下排查线索。
    reportPersistenceFailure(error, key, 'local')
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
  // Serialize all values first to avoid interleaved layout thrashing
  const serialized = new Map()
  for (const [key, producer] of batch) {
    try {
      serialized.set(key, producer())
    } catch (e) {
      // producer error will be caught in writeNow
      serialized.set(key, producer)
    }
  }
  for (const [key, rawOrProducer] of serialized) {
    if (typeof rawOrProducer === 'function') {
      writeNow(key, rawOrProducer)
    } else {
      // Already serialized
      const raw = rawOrProducer
      if (raw === lastWrittenRaw.get(key)) continue
      try {
        const localStartedAt = performanceNow()
        localStorage.setItem(key, raw)
        lastWrittenRaw.set(key, raw)
        const localStorageMs = Math.round((performanceNow() - localStartedAt) * 100) / 100
        observeStorage(key, { payloadBytes: payloadBytes(raw), serializeMs: 0, localStorageMs })
        markPersistenceSuccess()
        mirrorLocalValue(key, raw, { allowEmpty: true }).catch((error) => reportPersistenceFailure(error, key, 'mirror'))
        if (isSyncKey(key)) notifyLocalChanged(key, raw)
      } catch (error) {
        reportPersistenceFailure(error, key, 'local')
      }
    }
  }
}

function scheduleWrite(key, makeRaw) {
  pendingWrites.set(key, makeRaw)
  if (writeTimer) clearTimeout(writeTimer)
  const delay = getWriteDelay(key)
  writeTimer = setTimeout(() => {
    writeTimer = null
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleWrite = window.requestIdleCallback(writePendingBatch, { timeout: 700 })
    } else {
      writePendingBatch()
    }
  }, delay)
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
      { deep: pending.deep }
    )
  })
  try {
    if (JSON.stringify(pending.state.value) !== pending.baselineRaw) {
      scheduleWrite(key, () => JSON.stringify(pending.state.value))
    }
  } catch {
  }
}

function schedulePersistenceWatcher(key, state, baselineRaw, { deep = true } = {}) {
  const pending = { state, baselineRaw, deep, timer: null, idle: null }
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
 * @param {{ deep?: boolean, shallow?: boolean }} options 
 *   - deep: 是否深层监听（默认对非显式提交键开启）
 *   - shallow: 是否使用 shallowRef（大集合建议开启，需配合 touchStoredRef 显式提交）
 * @returns {import('vue').Ref<T>}
 */
export function useStoredRef(key, defaultValue, options = {}) {
  if (storedRefs.has(key)) return storedRefs.get(key)
  const isExplicitCommit = EXPLICIT_COMMIT_KEYS.has(key)
  const deep = options.deep ?? !isExplicitCommit
  const shallow = options.shallow ?? isExplicitCommit

  let saved = null
  let savedRaw = null
  try {
    savedRaw = localStorage.getItem(key)
    saved = savedRaw === null ? null : JSON.parse(savedRaw)
  } catch (error) {
    // 读取失败（损坏/隐私模式）回退到默认值，同时留下排查线索。
    reportPersistenceFailure(error, key, 'read')
    saved = null
    savedRaw = null
  }
  const normalized = saved === null
    ? { value: JSON.parse(JSON.stringify(defaultValue)), repaired: false }
    : normalizeStoredValue(saved, defaultValue)
  const state = shallow ? shallowRef(normalized.value) : ref(normalized.value)
  if (normalized.repaired) {
    try {
      const raw = JSON.stringify(normalized.value)
      localStorage.setItem(key, raw)
      lastWrittenRaw.set(key, raw)
      markPersistenceSuccess()
      mirrorLocalValue(key, raw).catch((error) => reportPersistenceFailure(error, key, 'mirror'))
      savedRaw = raw
    } catch (error) {
      reportPersistenceFailure(error, key, 'repair')
    }
  }
  storedRefs.set(key, state)
  const baselineRaw = savedRaw ?? JSON.stringify(normalized.value)
  lastWrittenRaw.set(key, baselineRaw)
  schedulePersistenceWatcher(key, state, baselineRaw, { deep })
  return state
}

// 显式提交 seam：调用方已经掌握一次完整业务变更时，可避免大集合的递归监听。
// 未使用该选项的旧 store 仍由 deep watcher 兜底，保持现有调用方兼容。
//
// 【必须同时 triggerRef】这里的 shallowRef 只把「引用整体被换掉」变成通知，
// push/splice/就地改字段都不会通知任何依赖。而记账、勾待办、删账单都是就地改，
// 于是持久化（本函数负责）对了、界面（依赖 computed）却停在旧值上——
// 表现就是「删掉的记录不消失，刷新一次才没了」。发布一次通知是这条 seam 的
// 另一半职责：调用方声明「这次业务变更已完成」，视图必须跟着重算。
export function touchStoredRef(key) {
  if (!storedRefs.has(key)) return false
  const state = storedRefs.get(key)
  // 先发布：深的 ref 本来就靠变更自动通知，这里多一次通知是无害的重复；
  // shallow 的 ref 只有这一下能让 computed/模板失效。
  triggerRef(state)
  scheduleWrite(key, () => JSON.stringify(state.value))
  return true
}

export function migrateTaskCourseLinks(taskList, courseList) {
  if (!Array.isArray(taskList) || !Array.isArray(courseList)) return false
  const candidates = taskList.filter((task) => task && !task.courseId && task.course)
  if (!candidates.length) return false
  const byName = new Map()
  for (const course of courseList) {
    const name = String(course?.name ?? '').trim()
    if (!name) continue
    if (byName.has(name)) byName.set(name, null)
    else byName.set(name, course.id)
  }
  let changed = false
  for (const task of candidates) {
    const courseId = byName.get(String(task.course).trim())
    if (!courseId) continue
    task.courseId = courseId
    changed = true
  }
  return changed
}

/**
 * 农历纪念日的内存镜像（lunarAnniversaries.js）不在存储层里：它只在首次读取时从
 * localStorage 补水，之后只有设置面板会发布。账号同步应用与备份恢复
 * 都经过 restoreStoredValues，写完这个键必须补一次发布 —— 否则首页会一直读旧镜像
 * 直到刷新，用户看到的是「恢复成功了但首页没变」。
 */
async function publishLunarMirror(values) {
  if (!values || typeof values !== 'object' || !Object.prototype.hasOwnProperty.call(values, 'sl_festive_lunar')) return false
  try {
    const { publishLunarAnniversaries } = await import('../lunarAnniversaries.js')
    publishLunarAnniversaries(values.sl_festive_lunar)
    return true
  } catch (error) {
    // 发布失败不影响已经写入本机的数据，但不能静默。
    recordSilentError('lunar-mirror-publish', error)
    return false
  }
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
    for (const [key, raw] of Object.entries(rawValues)) lastWrittenRaw.set(key, raw)
    for (const [key, value] of entries) {
      if (storedRefs.has(key)) storedRefs.get(key).value = value
    }
    await mirrorLocalValues(rawValues)
    if (markChanged && entries.some(([key]) => isSyncKey(key))) notifyLocalChanged()
    markPersistenceSuccess()
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
    reportPersistenceFailure(error, 'restore', 'local')
    throw error
  }
  await publishLunarMirror(values)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // storage 事件对 sessionStorage 也会触发；这里只关心业务数据的 localStorage。
    // 不判断的话，任何写 sessionStorage 的代码都会让本标签页取消待写入并覆盖内存值。
    if (event.storageArea && event.storageArea !== window.localStorage) return
    if (!event.key || !storedRefs.has(event.key) || event.newValue === null) return
    // 另一个标签页写了同一个键：放弃本次待写入、采用对方的值。
    // 这是有意的「后写者胜」策略，保证多标签页看到同一份数据；
    // 真正的多设备合并由同步管线负责，不在这里做。
    cancelPendingWrite(event.key)
    try {
      storedRefs.get(event.key).value = JSON.parse(event.newValue)
      lastWrittenRaw.set(event.key, event.newValue)
    } catch {
    }
    // 另一个标签页改了农历纪念日时，内存镜像也要跟着走；否则本标签页的首页
    // 会一直读旧镜像（镜像只在首次读取时补水、之后只由设置面板发布）。
    if (event.key === 'sl_festive_lunar') {
      let nextValue = null
      try {
        nextValue = JSON.parse(event.newValue)
      } catch {
        return
      }
      void publishLunarMirror({ sl_festive_lunar: nextValue })
    }
  })
}
