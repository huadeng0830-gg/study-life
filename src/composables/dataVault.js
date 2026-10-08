import { RETIRED_DATA_KEYS } from './retiredData.js'

const DB_NAME = 'study-life-local-vault'
const STORE_NAME = 'records'
const DB_VERSION = 1
const DB_OPEN_TIMEOUT = 800
const DB_REQUEST_TIMEOUT = 1200

function managedKey(key) {
  return typeof key === 'string' && key.startsWith('sl_') && key !== 'sl_transfer_undo'
}

const RETIRED_DATA_KEY_SET = new Set(RETIRED_DATA_KEYS)

// 应用生命周期内复用同一个连接，避免高频保存时反复开关数据库。
let vaultPromise = null
const pendingMirrorWrites = new Map()
let mirrorTimer = null
let flushingMirrors = false
let mirrorErrorHandler = null
let mirrorTimingHandler = null
// 连续失败次数：用于镜像写失败后的指数退避。没有它的话，「失败 → 重新排队
// → 立即重排下一次 flush」会变成一个每 240ms 转一圈的死循环，在隐私模式等
// IndexedDB 永久不可用的环境下持续敲 openVault 并刷错误回调。
let mirrorFailureCount = 0
let mirrorGeneration = 0
const MIRROR_BASE_DELAY_MS = 240
const MIRROR_MAX_DELAY_MS = 30000
let mirrorLifecycleBound = false

// 待写队列与防抖定时器都属于**安排它们的那个宿主环境**。页面被卸载、测试环境
// 被拆除、或同一进程里换上了另一个 window 之后，这个环境就不存在了；但已经排进
// 定时器队列的那一次冲刷**仍然会触发**（happy-dom 的定时器底层就是 Node 定时器，
// 环境拆除不会把队列里已排好的那一个也收走）。旧环境遗留的冲刷会照常写盘、照常
// 调用错误回调，产出的却是一批**没有任何归属的上报**：vitest 会把「环境拆除后仍在
// pending 的 onUserConsoleLog」记成 unhandled error —— 于是 1819 条用例全绿，
// `npm test` 仍然以 exit 1 退出。
// 所以这里记住安排这批写盘时的 window：宿主不见了、或者换了另一个宿主，就丢弃这
// 批影子写盘，也不再安排新的定时器。localStorage 主数据不受影响，用户下一次写入
// 会在新宿主里重新排队。
let mirrorOwnerWindow = null

// 当前宿主是否仍然是这批影子写盘所属的那个环境；模块首次使用时认领当时的 window。
// 没有 window（Node/SSR 等没有宿主的环境）时永远返回 false：那里根本不存在
// IndexedDB 安全副本，排队与调度都只是空转。
function mirrorHostAlive() {
  if (typeof window === 'undefined') return false
  mirrorOwnerWindow ??= window
  return mirrorOwnerWindow === window
}

export function setMirrorErrorHandler(handler) {
  mirrorErrorHandler = typeof handler === 'function' ? handler : null
}

export function setMirrorTimingHandler(handler) {
  mirrorTimingHandler = typeof handler === 'function' ? handler : null
}

function timingNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function openVault() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  vaultPromise ??= new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    let settled = false
    const finish = (value) => {
      if (settled) {
        if (value?.close) value.close()
        return
      }
      settled = true
      window.clearTimeout(timer)
      // 连接失败或被阻塞时重置，允许后续调用重试打开。
      if (!value) vaultPromise = null
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), DB_OPEN_TIMEOUT)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => finish(request.result)
    request.onerror = () => finish(null)
    request.onblocked = () => finish(null)
  })
  return vaultPromise
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      callback(value)
    }
    const timer = window.setTimeout(
      () => finish(reject, new Error('本地安全副本读取超时')),
      DB_REQUEST_TIMEOUT
    )
    request.onsuccess = () => finish(resolve, request.result)
    request.onerror = () => finish(reject, request.error)
  })
}

async function readRecords(db, keys) {
  if (!keys.length) return new Map()
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)
  const requests = keys.map((key) => [key, requestResult(store.get(key))])
  const records = await Promise.all(requests.map(async ([key, request]) => [key, await request]))
  return new Map(records)
}

async function readRecordKeys(db) {
  const transaction = db.transaction(STORE_NAME, 'readonly')
  return requestResult(transaction.objectStore(STORE_NAME).getAllKeys())
}

async function writeRecords(db, entries) {
  if (!entries.length) return
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const updatedAt = new Date().toISOString()
  for (const [key, value] of entries) store.put({ key, value, updatedAt })
  await transactionDone(transaction)
}

async function deleteRecords(db, keys) {
  if (!keys.length) return
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  for (const key of keys) store.delete(key)
  await transactionDone(transaction)
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('本地安全副本写入失败'))
    transaction.onerror = () => reject(transaction.error || new Error('本地安全副本写入失败'))
  })
}

function isEmptyCollection(raw) {
  try {
    const value = JSON.parse(raw)
    if (value === null) return true
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object') return Object.keys(value).length === 0
    return false
  } catch {
    return false
  }
}

export function shouldMirrorValue(rawValue, previousValue, { allowEmpty = false } = {}) {
  return allowEmpty || previousValue === undefined || !isEmptyCollection(rawValue) || isEmptyCollection(previousValue)
}

function deferStartupMirror(keys) {
  if (!keys.length || !mirrorHostAlive()) return
  const flush = () => {
    // 延迟期间页面可能已经被卸载（宿主消失），此时这批写盘已经没有意义。
    if (!mirrorHostAlive()) return
    // 延迟期间用户可能已经修改过数据；只把此刻 localStorage 的最新值
    // 放回统一队列，不能让启动时捕获的旧快照覆盖刚写入的影子副本。
    for (const key of keys) {
      const latest = localStorage.getItem(key)
      if (latest !== null) {
        const pending = pendingMirrorWrites.get(key)
        pendingMirrorWrites.set(key, { raw: latest, allowEmpty: pending?.allowEmpty === true })
      }
    }
    void flushMirrorWrites()
  }
  // 启动阶段以 localStorage 为即时数据源；至少等首屏启动窗口过去再比对整批副本，
  // 避免 iPhone 在 Vault、App 与首页分包仍加载时就克隆大型 IndexedDB 值。
  const registry = mirrorTimerRegistry()
  const timer = window.setTimeout(() => {
    registry?.delete(timer)
    if (!mirrorHostAlive()) return
    flush()
  }, 8000)
  registry?.add(timer)
}

function reportVaultTiming(onTiming, label, startedAt, details = {}) {
  try {
    onTiming?.({
      label,
      durationMs: Math.round((timingNow() - startedAt) * 100) / 100,
      ...details,
    })
  } catch {
    // 诊断回调不能改变安全副本恢复结果。
  }
}

// 在应用读取数据前执行：本地存储意外缺失时，从设备内的影子副本恢复。
export async function initializeDataVault({ onTiming } = {}) {
  bindMirrorLifecycleFlush()
  try {
    // 请求持久化存储，防止 iOS 等系统在存储紧张时自动清除数据
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persist().then((persisted) => {
        if (!persisted && window.matchMedia?.('(display-mode: standalone)').matches) {
          console.warn('[DataVault] 持久化存储未授予，建议定期导出备份')
        }
      }).catch(() => {})
    }
    let phaseStartedAt = timingNow()
    const db = await openVault()
    reportVaultTiming(onTiming, 'vault.open', phaseStartedAt)
    if (!db) {
      // IndexedDB 不存在时没有可恢复的 Vault；仍精确清掉已删除功能的本机键。
      // 若 IndexedDB 只是暂时打开失败，则保留键，下一次启动继续尝试清理。
      if (typeof indexedDB === 'undefined') {
        for (const key of RETIRED_DATA_KEYS) localStorage.removeItem(key)
      }
      return []
    }
    phaseStartedAt = timingNow()
    const backupKeys = (await readRecordKeys(db)).filter((key) => managedKey(key))
    reportVaultTiming(onTiming, 'vault.keys', phaseStartedAt, { count: backupKeys.length })

    // 删除已退休键只需要知道键是否存在，不必把对应的大段业务值读进内存。
    // 先清 Vault，再清 localStorage；任一步失败都会保留本机业务数据。
    const retiredKeys = []
    for (const key of RETIRED_DATA_KEYS) {
      const localValue = localStorage.getItem(key)
      if (localValue !== null || backupKeys.includes(key)) retiredKeys.push(key)
    }
    if (retiredKeys.length) {
      phaseStartedAt = timingNow()
      await deleteRecords(db, retiredKeys)
      for (const key of retiredKeys) localStorage.removeItem(key)
      reportVaultTiming(onTiming, 'vault.retired-cleanup', phaseStartedAt, { count: retiredKeys.length })
    }

    // 通常启动时 localStorage 已完整：先列出副本键，只读取本机确实缺失的记录。
    // 以前 getAll() 会在每次启动时克隆所有大型任务和账单，即使它们完全相同。
    let missingBackupKeys = backupKeys.filter((key) =>
      !RETIRED_DATA_KEY_SET.has(key) && localStorage.getItem(key) === null
    )
    phaseStartedAt = timingNow()
    const missingBackups = new Map()
    const attemptedBackupReads = new Set()
    while (missingBackupKeys.length) {
      const records = await readRecords(db, missingBackupKeys)
      for (const [key, record] of records) missingBackups.set(key, record)
      for (const key of missingBackupKeys) attemptedBackupReads.add(key)
      // Another open tab may remove a local key while IndexedDB is answering.
      // Recheck once per key so that this startup still restores the latest missing values.
      missingBackupKeys = backupKeys.filter((key) =>
        !RETIRED_DATA_KEY_SET.has(key)
        && !attemptedBackupReads.has(key)
        && localStorage.getItem(key) === null
      )
    }
    reportVaultTiming(onTiming, 'vault.restore-read', phaseStartedAt, { count: missingBackups.size })

    const localKeys = Object.keys(localStorage).filter(managedKey)
    const candidateKeys = new Set([...localKeys, ...backupKeys])
    const restored = []
    phaseStartedAt = timingNow()

    for (const key of candidateKeys) {
      if (!managedKey(key) || RETIRED_DATA_KEY_SET.has(key)) continue
      const localValue = localStorage.getItem(key)
      const backup = missingBackups.get(key)
      if (localValue === null && backup?.value !== undefined) {
        localStorage.setItem(key, backup.value)
        restored.push(key)
      }
    }

    // 副本刷新和完整值比较延迟到空闲时；本机数据恢复仍然在启动 gate 内完成。
    // 空集合保护仍由后台 flush 里的 shouldMirrorValue 执行。
    deferStartupMirror(Object.keys(localStorage).filter(managedKey))
    reportVaultTiming(onTiming, 'vault.restore', phaseStartedAt, { restored: restored.length })
    return restored
  } catch {
    // IndexedDB 不可用时仍使用 localStorage，避免阻断应用启动。
    return []
  }
}

async function flushMirrorWrites() {
  if (flushingMirrors || !pendingMirrorWrites.size) return
  if (!mirrorHostAlive()) {
    // 宿主已经消失：这批数据写不进任何地方，留着只会再排一次定时器，
    // 让那一声没有归属的 console 上报落到环境拆除之后。
    pendingMirrorWrites.clear()
    return
  }
  flushingMirrors = true
  const generation = mirrorGeneration
  const startedAt = timingNow()
  const entries = [...pendingMirrorWrites.entries()]
  pendingMirrorWrites.clear()
  let safeEntryCount = 0
  let failed = false
  try {
    const db = await openVault()
    if (!db) {
      failed = true
      mirrorErrorHandler?.(new Error('IndexedDB 不可用，无法更新本地安全副本'), entries.map(([key]) => key))
      return
    }
    // Normal store commits are authoritative (including explicit empty arrays), so
    // do not read and clone the old multi-megabyte value before replacing it.
    // Startup mirrors use allowEmpty=false and still read the old value to avoid
    // replacing a recoverable non-empty backup with an empty local default.
    const guardedKeys = entries.filter(([, value]) => !value.allowEmpty).map(([key]) => key)
    const previous = await readRecords(db, guardedKeys)
    if (generation !== mirrorGeneration) return
    const safeEntries = entries
      .filter(([key, value]) => {
        if (value.allowEmpty) return true
        const backup = previous.get(key)
        return backup?.value !== value.raw && shouldMirrorValue(value.raw, backup?.value, value)
      })
      .map(([key, value]) => [key, value.raw])
    safeEntryCount = safeEntries.length
    await writeRecords(db, safeEntries)
  } catch (error) {
    failed = true
    // 影子备份失败不影响本次正常保存。
    mirrorErrorHandler?.(error, entries.map(([key]) => key))
  } finally {
    if (failed) {
      // 这一批已经在上面从队列里清掉了。如果不重新排队，这些键的影子副本
      // 会一直停在**旧值**，要等到用户下次恰好再改同一个键才可能被纠正 ——
      // 而那可能永远不发生，安全副本就此静默过期。
      requeueMirrorEntries(entries)
      mirrorFailureCount += 1
    } else {
      mirrorFailureCount = 0
    }
    mirrorTimingHandler?.({
      keys: entries.map(([key]) => key),
      written: safeEntryCount,
      durationMs: Math.round((timingNow() - startedAt) * 100) / 100,
    })
    flushingMirrors = false
    if (pendingMirrorWrites.size) scheduleMirrorFlush(mirrorDelayFor(mirrorFailureCount))
  }
}

/** Clear every managed-data shadow copy after an explicit local-data purge. */
export async function clearDataVault() {
  mirrorGeneration += 1
  pendingMirrorWrites.clear()
  if (mirrorTimer) window.clearTimeout(mirrorTimer)
  mirrorTimer = null
  const db = await openVault()
  if (!db) return false
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = resolve
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('无法清理本机安全副本。'))
  })
  return true
}

// 失败重试的间隔：240ms 起，逐次翻倍到 30s 封顶。
// 成功的 flush 会把计数清零，所以短暂抖动不会留下长尾延迟。
function mirrorDelayFor(failureCount) {
  if (failureCount <= 0) return MIRROR_BASE_DELAY_MS
  return Math.min(MIRROR_MAX_DELAY_MS, MIRROR_BASE_DELAY_MS * (2 ** Math.min(failureCount - 1, 8)))
}

// 把失败的批次放回队列，但绝不覆盖更新的值：同一批次处理期间用户可能
// 又改了这个键，新值必须优先。
function requeueMirrorEntries(entries) {
  for (const [key, value] of entries) {
    if (!pendingMirrorWrites.has(key)) pendingMirrorWrites.set(key, value)
  }
}

function scheduleMirrorFlush(delayMs = MIRROR_BASE_DELAY_MS) {
  if (mirrorTimer !== null) return
  if (!mirrorHostAlive()) {
    pendingMirrorWrites.clear()
    return
  }
  const registry = mirrorTimerRegistry()
  const timer = window.setTimeout(() => {
    registry?.delete(timer)
    mirrorTimer = null
    // 等待期间宿主可能已经消失（页面卸载 / 测试环境拆除 / 换了 window）：
    // 此时不能再冲刷，否则失败回调里的 console 会落到环境拆除之后。
    if (!mirrorHostAlive()) {
      pendingMirrorWrites.clear()
      return
    }
    void flushMirrorWrites()
  }, delayMs)
  mirrorTimer = timer
  registry?.add(timer)
}

// 同一个宿主上可能同时存在多个模块实例：开发期 HMR 换模块、测试里的
// `vi.resetModules()` 都会重新求值本模块，而**旧实例的防抖/重试定时器还挂在
// 定时器队列里，它的句柄却再也拿不到了**。这类遗留定时器会在宿主环境拆除之后
// 继续冲刷，产出一批没人认领的写盘与告警。把所有待写盘定时器按宿主登记起来，
// 收尾时（见 cancelPendingMirrorWrites）就能一次全部取消，而不用管它属于哪个实例。
const MIRROR_TIMER_REGISTRY_KEY = '__studyLifeMirrorTimers'

function mirrorTimerRegistry() {
  if (typeof window === 'undefined') return null
  if (!window[MIRROR_TIMER_REGISTRY_KEY]) {
    Object.defineProperty(window, MIRROR_TIMER_REGISTRY_KEY, { value: new Set(), configurable: true })
  }
  return window[MIRROR_TIMER_REGISTRY_KEY]
}

/**
 * 收尾接缝：取消所有待写盘的防抖/重试定时器，并丢弃本实例的待写队列。
 *
 * 【为什么需要这个导出】影子写盘有 240ms 防抖，写失败还会按指数退避一直重试；
 * 而测试环境（happy-dom）里根本没有 IndexedDB，这条链**永远失败、永远挂着定时器**。
 * vitest 在最后一个用例跑完就拆除环境，但定时器队列里已经排好的那一次冲刷照样会
 * 触发：它走失败分支 → 调用错误回调 → `console.warn`。这一声 console 已经不属于
 * 任何测试，vitest 会把它算成「环境拆除后仍在 pending 的 `onUserConsoleLog` 上报」，
 * 在汇总里记成 `Errors 1 error` —— 于是所有用例全绿、`npm test` 却以 exit 1 退出。
 * 测试收尾调用这里，就能把这批「环境已经不需要」的写盘连同定时器一起取消。
 *
 * 产品代码不调用它：真实页面卸载时定时器会随页面一起消失，而镜像写盘是有意义的，
 * 不能丢。测试里的镜像本来就没有可写入的对象，取消它才是正确语义。
 */
export function cancelPendingMirrorWrites() {
  if (typeof window !== 'undefined') {
    const registry = mirrorTimerRegistry()
    if (registry) {
      for (const timer of registry) window.clearTimeout(timer)
      registry.clear()
    }
    if (mirrorTimer !== null) window.clearTimeout(mirrorTimer)
  }
  mirrorTimer = null
  pendingMirrorWrites.clear()
  mirrorFailureCount = 0
}

// 页面被隐藏/关闭时立刻补一次：镜像有 240ms 防抖，如果用户在防抖窗口内
// 就直接切走或关掉页面，最后几次编辑的本地副本会丢。这里是尽力而为
// （IndexedDB 事务可能来不及完成），但比不试要好。
function bindMirrorLifecycleFlush() {
  if (mirrorLifecycleBound || typeof window === 'undefined') return
  mirrorLifecycleBound = true
  const flushSoon = () => {
    if (!pendingMirrorWrites.size || flushingMirrors) return
    if (mirrorTimer !== null) {
      window.clearTimeout(mirrorTimer)
      mirrorTimer = null
    }
    void flushMirrorWrites()
  }
  window.addEventListener('pagehide', flushSoon)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSoon() })
  }
}

// 每次正常保存时同步一份设备内副本；同一小段时间内的多个模块会合并为
// 一次读取和一次 IndexedDB 事务，不再为每个键单独打开读写事务。
export function mirrorLocalValue(key, rawValue, { allowEmpty = false } = {}) {
  if (!managedKey(key) || rawValue === null || rawValue === undefined) return Promise.resolve()
  // 宿主环境已经消失或换人：这次写盘没有可写的地方，连定时器都不要安排。
  if (!mirrorHostAlive()) return Promise.resolve()
  pendingMirrorWrites.set(key, { raw: rawValue, allowEmpty })
  scheduleMirrorFlush()
  return Promise.resolve()
}

// 恢复或批量导入时用一个 IndexedDB 事务提交，避免逐键写入留下半套影子副本。
export async function mirrorLocalValues(records) {
  const entries = Object.entries(records || {}).filter(([key, value]) =>
    managedKey(key) && typeof value === 'string'
  )
  if (!entries.length) return
  try {
    const db = await openVault()
    if (!db) {
      mirrorErrorHandler?.(new Error('IndexedDB 不可用，无法更新本地安全副本'), entries.map(([key]) => key))
      return
    }
    await writeRecords(db, entries)
  } catch (error) {
    // 影子备份失败不影响本次恢复；localStorage 仍会保留已恢复的数据。
    mirrorErrorHandler?.(error, entries.map(([key]) => key))
  }
}

// Retired product data must be removed from the mirror as well as from
// localStorage, otherwise the next startup can resurrect it.
export async function removeVaultKeys(keys = []) {
  const exactKeys = [...new Set(keys.filter((key) => managedKey(key)))]
  for (const key of exactKeys) pendingMirrorWrites.delete(key)
  if (!exactKeys.length) return { ok: true }
  try {
    const db = await openVault()
    if (!db) return { ok: false, error: new Error('IndexedDB 不可用，无法确认本地安全副本已清理') }
    await deleteRecords(db, exactKeys)
    return { ok: true }
  } catch (error) {
    mirrorErrorHandler?.(error, exactKeys)
    return { ok: false, error }
  }
}

// Cloudflare 的每次预览地址都是不同来源，本地记录不会互通；默认统一回正式域名。
// 真实发布验收可通过显式 query 标记留在隔离 Preview，不影响普通用户路径。
export function shouldRedirectPreviewOrigin(host, search = '') {
  const previewOptIn = new URLSearchParams(search).get('__study_life_preview') === '1'
  return host !== 'study-life.pages.dev' && host.endsWith('.study-life.pages.dev') && !previewOptIn
}

export function redirectPreviewOrigin() {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  if (shouldRedirectPreviewOrigin(url.hostname, url.search)) {
    window.location.replace(`https://study-life.pages.dev${window.location.pathname}${window.location.search}${window.location.hash}`)
    return true
  }
  return false
}
