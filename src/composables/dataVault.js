const DB_NAME = 'study-life-local-vault'
const STORE_NAME = 'records'
const DB_VERSION = 1
const DB_OPEN_TIMEOUT = 800
const DB_REQUEST_TIMEOUT = 1200

function managedKey(key) {
  return typeof key === 'string' && key.startsWith('sl_') && key !== 'sl_transfer_undo'
}

// 应用生命周期内复用同一个连接，避免高频保存时反复开关数据库。
let vaultPromise = null
const pendingMirrorWrites = new Map()
let mirrorTimer = null
let flushingMirrors = false

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

async function readAllRecords(db) {
  const transaction = db.transaction(STORE_NAME, 'readonly')
  return requestResult(transaction.objectStore(STORE_NAME).getAll())
}

async function writeRecords(db, entries) {
  if (!entries.length) return
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const updatedAt = new Date().toISOString()
  for (const [key, value] of entries) store.put({ key, value, updatedAt })
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

// 在应用读取数据前执行：本地存储意外缺失时，从设备内的影子副本恢复。
export async function initializeDataVault() {
  try {
    // 请求持久化存储，防止 iOS 等系统在存储紧张时自动清除数据
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persist().then((persisted) => {
        if (!persisted && window.matchMedia?.('(display-mode: standalone)').matches) {
          console.warn('[DataVault] 持久化存储未授予，建议定期导出备份')
        }
      }).catch(() => {})
    }
    const db = await openVault()
    if (!db) return []
    const backups = await readAllRecords(db)
    const backupMap = new Map(backups.map((record) => [record.key, record]))
    const localKeys = Object.keys(localStorage).filter(managedKey)
    const keys = new Set([...localKeys, ...backupMap.keys()])
    const restored = []
    const pendingMirrors = []

    for (const key of keys) {
      if (!managedKey(key)) continue
      const localValue = localStorage.getItem(key)
      const backup = backupMap.get(key)
      if (localValue === null && backup?.value !== undefined) {
        localStorage.setItem(key, backup.value)
        restored.push(key)
      } else if (localValue !== null) {
        // 空数组可能是正常删除结果，但不应覆盖最后一份非空安全副本。
        if (!backup || !isEmptyCollection(localValue) || isEmptyCollection(backup.value)) {
          pendingMirrors.push([key, localValue])
        }
      }
    }

    // 恢复检查完成即可显示页面；安全副本的常规刷新放到后台串行执行，
    // 避免 iPhone 每次启动都等待多次 IndexedDB 写入。
    if (pendingMirrors.length) void writeRecords(db, pendingMirrors).catch(() => {})
    return restored
  } catch {
    // IndexedDB 不可用时仍使用 localStorage，避免阻断应用启动。
    return []
  }
}

async function flushMirrorWrites() {
  if (flushingMirrors || !pendingMirrorWrites.size) return
  flushingMirrors = true
  const entries = [...pendingMirrorWrites.entries()]
  pendingMirrorWrites.clear()
  try {
    const db = await openVault()
    if (!db) return
    const previous = await readRecords(db, entries.map(([key]) => key))
    const safeEntries = entries.filter(([key, value]) => {
      const backup = previous.get(key)
      return !backup || !isEmptyCollection(value) || isEmptyCollection(backup.value)
    })
    await writeRecords(db, safeEntries)
  } catch {
    // 影子备份失败不影响本次正常保存。
  } finally {
    flushingMirrors = false
    if (pendingMirrorWrites.size) scheduleMirrorFlush()
  }
}

function scheduleMirrorFlush() {
  if (mirrorTimer !== null) return
  mirrorTimer = window.setTimeout(() => {
    mirrorTimer = null
    void flushMirrorWrites()
  }, 240)
}

// 每次正常保存时同步一份设备内副本；同一小段时间内的多个模块会合并为
// 一次读取和一次 IndexedDB 事务，不再为每个键单独打开读写事务。
export function mirrorLocalValue(key, rawValue) {
  if (!managedKey(key) || rawValue === null || rawValue === undefined) return Promise.resolve()
  pendingMirrorWrites.set(key, rawValue)
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
    if (!db) return
    await writeRecords(db, entries)
  } catch {
    // 影子备份失败不影响本次恢复；localStorage 仍会保留已恢复的数据。
  }
}

// Cloudflare 的每次预览地址都是不同来源，本地记录不会互通；统一回正式域名。
export function redirectPreviewOrigin() {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  if (host !== 'study-life.pages.dev' && host.endsWith('.study-life.pages.dev')) {
    window.location.replace(`https://study-life.pages.dev${window.location.pathname}${window.location.search}${window.location.hash}`)
    return true
  }
  return false
}
