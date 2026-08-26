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

async function readRecord(db, key) {
  const transaction = db.transaction(STORE_NAME, 'readonly')
  return requestResult(transaction.objectStore(STORE_NAME).get(key))
}

async function readAllRecords(db) {
  const transaction = db.transaction(STORE_NAME, 'readonly')
  return requestResult(transaction.objectStore(STORE_NAME).getAll())
}

async function writeRecord(db, key, value) {
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  await requestResult(transaction.objectStore(STORE_NAME).put({
    key,
    value,
    updatedAt: new Date().toISOString(),
  }))
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
          await writeRecord(db, key, localValue)
        }
      }
    }
    return restored
  } catch {
    // IndexedDB 不可用时仍使用 localStorage，避免阻断应用启动。
    return []
  }
}

// 每次正常保存时同步一份设备内副本；它不联网，也不会跨设备同步。
export async function mirrorLocalValue(key, rawValue) {
  if (!managedKey(key) || rawValue === null || rawValue === undefined) return
  try {
    const db = await openVault()
    if (!db) return
    const previous = await readRecord(db, key)
    if (!previous || !isEmptyCollection(rawValue) || isEmptyCollection(previous.value)) {
      await writeRecord(db, key, rawValue)
    }
  } catch {
    // 影子备份失败不影响本次正常保存。
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
