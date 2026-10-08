import { ACCOUNT_SWITCH_MARKER_KEY, randomToken, readAccountDataOwner, setAccountDataOwner } from './accountSyncIdentity.js'

// 锁名与引擎侧保持一致：这是**同一把**锁，不是两把各管各的。
export const ACCOUNT_DATA_LOCK = 'study-life-account-data'
const ACCOUNT_DATA_LOCK_KEY = 'study-life-account-data-lock'
const RETIRED_NOTES_PURGE_KEY = 'study-life-retired-notes-purged-v1'
const LOCAL_ACCOUNT_STATE_DEFAULTS = Object.freeze({
  sl_focus_active: null,
  sl_retro_year_notice: '',
  sl_last_backup_at: '',
  sl_domain_schema: 0,
  sl_task_center_log: [],
})

function readLocalAccountState() {
  const values = {}
  for (const [key, fallback] of Object.entries(LOCAL_ACCOUNT_STATE_DEFAULTS)) {
    try { values[key] = JSON.parse(localStorage.getItem(key)) ?? cloneValue(fallback) }
    catch { values[key] = cloneValue(fallback) }
  }
  return values
}

function localAccountStateFromSnapshot(snapshot) {
  const source = snapshot?.__localAccountState
  return Object.fromEntries(Object.entries(LOCAL_ACCOUNT_STATE_DEFAULTS).map(([key, fallback]) => [
    key,
    source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : cloneValue(fallback),
  ]))
}
import { SYNC_DEFAULTS } from './syncKeys.js'
import { cloneValue, validateSyncPayload } from './accountSyncData.js'
import { defaultTimeConfig } from './store/timeConfig.js'
import { defaultAppearanceValue, defaultTargets } from './appearance.js'

export function accountDefaultValues() {
  return validateSyncPayload({ ...cloneValue(SYNC_DEFAULTS), sl_timecfg: defaultTimeConfig(),
    sl_appearance: defaultAppearanceValue(), sl_wallpaper_config: { targets: cloneValue(defaultTargets) } })
}
// 本机账号切换保护副本单独保存，不使用业务存储键，也不进入备份文件或云端同步负载。

/**
 * 本机副本的超时预算。
 *
 * 原来这里只有 4 秒，在桌面上从没触发过，但在手机上是个定时炸弹：iOS 会把
 * 挂在后台的 PWA 连同它的 IndexedDB 后端一起冻结/驱逐，重新冷启动后第一次
 * open 通常要好几秒；再叠上一个多 MB 的 store.put，4 秒相当容易被越过。
 * 而越过之后抛出的错误会一路冒到 accountSyncLifecycle 的 catch —— 那条路径
 * **没有任何自动重试**（见该文件注释），于是"一次瞬时卡顿"变成永久的红色横幅。
 * 放宽预算只是第一层；下面 openAccountVault 还会在预算内重试。
 */
export const ACCOUNT_VAULT_TIMEOUT_MS = 20000
// 事务超时的重试间隔。第一次 open 失败后立刻重试往往仍然失败（后端还在预热），
// 所以退一小步再试，而不是 0ms 硬撞。
const ACCOUNT_VAULT_RETRY_MS = 600

function openAccountVaultOnce() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器无法保存账号本机副本。')); return }
    const request = indexedDB.open('study-life-account-local', 1)
    let finished = false
    const timer = window.setTimeout(() => finish(new Error('保存账号本机副本超时，请稍后重试。')), ACCOUNT_VAULT_TIMEOUT_MS)
    function finish(error, db = null) {
      if (finished) { db?.close(); return }
      finished = true
      window.clearTimeout(timer)
      if (error) reject(error)
      else resolve(db)
    }
    request.onupgradeneeded = () => { request.result.createObjectStore('accounts', { keyPath: 'id' }) }
    request.onsuccess = () => finish(null, request.result)
    request.onerror = () => finish(new Error('无法保存账号本机副本，请先导出备份。'))
    // onblocked 只表示"还有别的连接没关"，不等于失败。这里不立刻放弃：
    // 手机上那个"别的连接"常常就是同一个 PWA 上一轮遗留的，
    // 等它超时预算走完大概率能拿到句柄。
    request.onblocked = () => { /* 由超时兜底 */ }
  })
}

async function openAccountVault() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await openAccountVaultOnce()
    } catch (error) {
      // 预算已经放宽到 20 秒，重试两次足够覆盖冷启动预热；再多次只是拖慢用户。
      if (attempt >= 2) throw error
      await new Promise((resolveWait) => window.setTimeout(resolveWait, ACCOUNT_VAULT_RETRY_MS))
    }
  }
}

export function mergeRetiredQuickNotes(...sources) {
  const notesById = new Map()
  for (const source of sources) {
    if (!Array.isArray(source)) continue
    for (const note of source) {
      if (!note || typeof note !== 'object' || Array.isArray(note)) continue
      const id = String(note.id || `${note.createdAt || ''}:${note.title || note.content || ''}`)
      notesById.set(id, note)
    }
  }
  return [...notesById.values()]
}

function clearRetiredNotesFromDomainValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false
  let changed = false
  if (Object.prototype.hasOwnProperty.call(values, 'sl_quick_notes')) {
    const archived = mergeRetiredQuickNotes(values.sl_archived_quick_notes, values.sl_quick_notes)
    if (JSON.stringify(archived) !== JSON.stringify(values.sl_archived_quick_notes || [])) {
      values.sl_archived_quick_notes = archived
    }
    delete values.sl_quick_notes
    changed = true
  }
  for (const key of ['sl_tasks', 'sl_events']) {
    if (!Array.isArray(values[key])) continue
    values[key] = values[key].map((item) => {
      if (item?.sourceType !== 'note') return item
      changed = true
      return { ...item, sourceType: '', sourceId: '', relationId: '', updatedAt: new Date().toISOString() }
    })
  }
  return changed
}

function clearRetiredNotesFromManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return false
  let changed = false
  if (manifest.entities && typeof manifest.entities === 'object' && Object.prototype.hasOwnProperty.call(manifest.entities, 'sl_quick_notes')) {
    delete manifest.entities.sl_quick_notes
    changed = true
  }
  for (const field of ['tombstones', 'restoreMarkers']) {
    if (!Array.isArray(manifest[field])) continue
    const filtered = manifest[field].filter((item) => item?.entityType !== 'Note')
    if (filtered.length !== manifest[field].length) { manifest[field] = filtered; changed = true }
  }
  return changed
}

export function clearRetiredNotesFromAccountRecord(record) {
  let changed = false
  const payload = record?.values
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  if (record.id?.startsWith('conflict:') && Array.isArray(payload.conflicts)) {
    const retiredNoteConflicts = payload.conflicts.filter((item) => item?.entityType === 'Note' || item?.key === 'sl_quick_notes')
    const conflictNotes = retiredNoteConflicts.flatMap((item) => ['local', 'remote', 'base'].flatMap((field) => {
      const value = item?.[field]
      return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
    }))
    if (conflictNotes.length) {
      payload.sl_archived_quick_notes = mergeRetiredQuickNotes(payload.sl_archived_quick_notes, conflictNotes)
      changed = true
    }
    const originalLength = payload.conflicts.length
    payload.conflicts = payload.conflicts.filter((item) => item?.entityType !== 'Note' && item?.key !== 'sl_quick_notes')
    if (payload.conflicts.length !== originalLength) {
      changed = true
    }
    for (const conflict of payload.conflicts) {
      for (const field of ['local', 'remote', 'base']) {
        const value = conflict?.[field]
        if (value?.sourceType !== 'note') continue
        conflict[field] = { ...value, sourceType: '', sourceId: '', relationId: '', updatedAt: new Date().toISOString() }
        changed = true
      }
    }
    if (changed) {
      payload.signature = ''
    }
  }
  if (clearRetiredNotesFromDomainValues(payload)) changed = true
  if (clearRetiredNotesFromDomainValues(payload.values)) changed = true
  if (clearRetiredNotesFromManifest(payload)) changed = true
  if (clearRetiredNotesFromManifest(payload.baseline)) changed = true
  if (clearRetiredNotesFromManifest(payload.meta)) changed = true
  if (clearRetiredNotesFromManifest(payload.meta?.baseline)) changed = true
  return changed
}

/** Remove retired note data and relation metadata from every saved account snapshot. */
export async function purgeRetiredNotesFromAccountData() {
  try {
    if (localStorage.getItem(RETIRED_NOTES_PURGE_KEY) === '1') return 0
  } catch { /* Continue: storage may be unavailable while the account vault is readable. */ }
  const db = await openAccountVault()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('accounts', 'readwrite')
    const store = tx.objectStore('accounts')
    const request = store.openCursor()
    let changedRecords = 0
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const record = cursor.value
      if (clearRetiredNotesFromAccountRecord(record)) {
        cursor.update(record)
        changedRecords++
      }
      cursor.continue()
    }
    request.onerror = () => { try { tx.abort() } catch {} }
    tx.oncomplete = () => {
      db.close()
      try { localStorage.setItem(RETIRED_NOTES_PURGE_KEY, '1') } catch { /* The completed IDB migration is still safe to repeat. */ }
      resolve(changedRecords)
    }
    tx.onerror = tx.onabort = () => {
      db.close()
      reject(new Error('无法清理账号本机副本中的退役笔记数据。'))
    }
  })
}

export async function accountLocalSnapshot(id, values = undefined) {
  const db = await openAccountVault()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', values === undefined ? 'readonly' : 'readwrite')
      const store = tx.objectStore('accounts')
      const request = values === undefined ? store.get(id) : store.put({ id, values: cloneValue(values) })
      const timer = window.setTimeout(() => { tx.abort(); reject(new Error('账号本机副本读写超时。')) }, ACCOUNT_VAULT_TIMEOUT_MS)
      tx.oncomplete = () => { window.clearTimeout(timer); resolve(values === undefined ? request.result?.values : values) }
      tx.onerror = tx.onabort = () => { window.clearTimeout(timer); reject(new Error('无法保存账号本机副本，本机记录已保留。')) }
    })
  } finally { db.close() }
}

/** Remove all saved account values and conflict/rollback snapshots from this device. */
export async function clearAccountLocalData() {
  const db = await openAccountVault()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite')
      tx.objectStore('accounts').clear()
      tx.oncomplete = resolve
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('无法清理账号本机副本。'))
    })
    return true
  } finally { db.close() }
}
export async function recoverAccountDataSwitch() {
  const raw = localStorage.getItem(ACCOUNT_SWITCH_MARKER_KEY)
  if (!raw) return { ok: true, recovered: false }
  try {
    const marker = JSON.parse(raw)
    if (!marker.from || !marker.to) throw new Error('账号切换恢复信息不完整。')
    if (readAccountDataOwner() !== marker.to) {
      const values = await accountLocalSnapshot(marker.from)
      if (!values) throw new Error('找不到账号切换前的本机副本。')
      const { restoreStoredValues } = await import('./store/cloudAccess.js')
      await restoreStoredValues({ ...validateSyncPayload(values), ...localAccountStateFromSnapshot(values) }, { markChanged: false })
      setAccountDataOwner(marker.from)
    }
    localStorage.removeItem(ACCOUNT_SWITCH_MARKER_KEY)
    return { ok: true, recovered: true }
  } catch (error) { return { ok: false, error } }
}

// 读锁标记。存储可能被外部写坏（用户手改、另一版本残留、隐私模式下的怪值），
// 而这层锁只在"准备账号数据"时用到 —— 它绝不该因为一行脏数据就把整个账号
// 同步打进死胡同：accountSyncLifecycle 对准备失败没有任何自动重试。
function readDataLock() {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_DATA_LOCK_KEY) || 'null') } catch { return null }
}

async function withAccountDataLock(action) {
  // 【必须带 ifAvailable】原来这里是**排队**等待。同一把锁名也被账号同步引擎用
  // （accountSyncEngine 的 runAccountSync 带 ifAvailable）。一旦另一个上下文
  // —— 最常见的就是手机上还活着的那个 PWA，或桌面浏览器里没关的旧标签页 ——
  // 持有这把锁，请求就永远不 resolve：accountSyncPreparing 一直是 true，
  // accountSyncStatus 一直卡在 'preparing'，面板上的"立即同步"永远是禁用的
  // 「正在同步…」，连重试按钮自己都会一起挂住。除了杀掉应用没有别的出路。
  if (navigator.locks?.request) {
    return navigator.locks.request(ACCOUNT_DATA_LOCK, { ifAvailable: true }, (lock) => {
      if (!lock) throw new Error('其他页面正在处理账号数据，请稍后重试。')
      return action()
    })
  }
  const token = randomToken()
  const now = Date.now()
  if (readDataLock()?.expires > now) throw new Error('其他页面正在切换账号，请稍后重试。')
  localStorage.setItem(ACCOUNT_DATA_LOCK_KEY, JSON.stringify({ token, expires: now + 20000 }))
  const assertLock = () => {
    if (readDataLock()?.token !== token) throw new Error('账号切换已在其他页面完成，请重试。')
  }
  try { assertLock(); return await action(assertLock) } finally {
    if (readDataLock()?.token === token) localStorage.removeItem(ACCOUNT_DATA_LOCK_KEY)
  }
}
export async function prepareAccountLocalData(id, getCurrentValues, isCurrent = () => true) {
  return withAccountDataLock(async (assertLock = () => {}) => {
    const recovered = await recoverAccountDataSwitch()
    if (!recovered.ok) throw recovered.error
    if (!isCurrent()) return false
    const from = readAccountDataOwner()
    if (!from || from === id) { setAccountDataOwner(id); return true }
    // 必须先持久化旧账号离线改动，随后才载入目标账号；不能把旧账号记录推给新账号。
    await accountLocalSnapshot(from, { ...(await getCurrentValues()), __localAccountState: readLocalAccountState() })
    const saved = await accountLocalSnapshot(id)
    const target = saved ? validateSyncPayload(saved) : accountDefaultValues()
    assertLock()
    if (!isCurrent()) return false
    localStorage.setItem(ACCOUNT_SWITCH_MARKER_KEY, JSON.stringify({ from, to: id }))
    const { restoreStoredValues } = await import('./store/cloudAccess.js')
    await restoreStoredValues({ ...target, ...localAccountStateFromSnapshot(saved) }, { markChanged: false })
    assertLock()
    setAccountDataOwner(id)
    localStorage.removeItem(ACCOUNT_SWITCH_MARKER_KEY)
    return true
  })
}
