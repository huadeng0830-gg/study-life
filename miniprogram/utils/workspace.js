const api = require('./api')
const config = require('../config')
const { normalize } = require('./record-model')
const PREFIX = 'study-life-workspace-v1:'
const running = new Map()
const clone = value => JSON.parse(JSON.stringify(value))
const uid = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
function identity() { return `${config.cloudEnvId || 'unconfigured'}:${api.getSession()?.user.id || 'guest'}` }
function read(key = identity()) {
  const value = wx.getStorageSync(PREFIX + key)
  return value && value.schema === 1 ? clone(value) : { schema: 1, records: {}, queue: [], error: '', status: key.endsWith(':guest') ? 'local' : 'idle' }
}
function write(state, key = identity()) {
  // 保存失败必须抛出，不能把未落盘的修改显示为成功。
  wx.setStorageSync(PREFIX + key, clone(state))
}
function all(kind) { return Object.values(read().records).filter(row => !row.deleted && (!kind || row.kind === kind)).map(row => ({ ...row.values, id: row.id, kind: row.kind, revision: row.revision, updatedAt: row.updated_at })) }
function get(id) { const row = read().records[id]; return row && !row.deleted ? { ...row.values, id: row.id, kind: row.kind, revision: row.revision } : null }
function commit(changes) {
  if (!changes.length || changes.length > 10) throw new Error('每次最多修改 10 条记录。')
  const state = read()
  const operations = changes.map(change => {
    const id = change.id || uid()
    const previous = state.records[id]
    if (change.loadedRevision !== undefined && (previous?.revision || 0) !== change.loadedRevision) throw new Error('这条记录在编辑期间已更新，请返回列表后重新打开，避免覆盖新内容。')
    if (previous && previous.kind !== change.kind) throw new Error('记录类型不能修改。')
    const values = change.deleted ? {} : normalize(change.kind, change.values)
    if (JSON.stringify(values).length > 16000) throw new Error('这条记录过长，请拆分后保存。')
    return { id, kind: change.kind, values, deleted: change.deleted === true, expectedRevision: previous?.revision || 0, mutationId: uid() }
  })
  if (new Set(operations.map(row => row.id)).size !== operations.length) throw new Error('不能重复修改同一记录。')
  if (JSON.stringify(operations).length > 24000) throw new Error('这批内容过长，请分批保存。')
  for (const operation of operations) state.records[operation.id] = { ...operation, revision: operation.expectedRevision + 1, updated_at: new Date().toISOString() }
  state.queue.push({ id: uid(), operations })
  state.error = ''
  state.status = api.isLoggedIn() ? 'pending' : 'local'
  write(state)
  return operations.map(row => row.id)
}
function put(kind, values, id, loadedRevision) { return commit([{ kind, values, id, loadedRevision }])[0] }
function remove(id, loadedRevision) { const row = get(id); if (!row) throw new Error('记录已不存在。'); commit([{ kind: row.kind, id, deleted: true, loadedRevision }]) }
async function remoteRecords() {
  const records = []
  for (let page = 0; ; page++) {
    const result = await api.personalRequest('list', { page })
    records.push(...result.records)
    if (!result.hasMore) return records
  }
}
async function sync() {
  const key = identity()
  if (!api.isLoggedIn()) return read()
  if (read(key).status === 'conflict') return read(key)
  if (running.has(key)) return running.get(key)
  const task = (async () => {
    try {
      let state = read(key)
      state.status = 'syncing'; write(state, key)
      while (state.queue.length) {
        const batch = state.queue[0]
        const result = await api.personalRequest('commit', { operations: batch.operations })
        if (identity() !== key) return null
        state = read(key)
        if (state.queue[0]?.id !== batch.id) throw new Error('本机同步队列发生变化，请重试。')
        state.queue.shift()
        for (const row of result.records) if (state.records[row.id]?.mutationId === row.mutationId) state.records[row.id] = row
        write(state, key)
      }
      const records = await remoteRecords()
      if (identity() !== key) return null
      state = read(key)
      const pending = new Set(state.queue.flatMap(batch => batch.operations.map(row => row.id)))
      for (const row of records) if (!pending.has(row.id)) state.records[row.id] = row
      state.status = state.queue.length ? 'pending' : 'synced'; state.error = ''; state.lastSync = new Date().toISOString()
      write(state, key)
      return state
    } catch (error) {
      if (identity() !== key) return null
      const state = read(key)
      state.status = error.code === 'record_conflict' ? 'conflict' : 'pending'
      state.error = error.message
      write(state, key)
      return state
    } finally { running.delete(key) }
  })()
  running.set(key, task)
  return task
}
async function resolveConflict(keepLocal) {
  const key = identity()
  const remote = await remoteRecords()
  if (identity() !== key) throw new Error('账号已切换，请重新操作。')
  const state = read(key)
  const pending = new Set(state.queue.flatMap(batch => batch.operations.map(row => row.id)))
  const remoteMap = Object.fromEntries(remote.map(row => [row.id, row]))
  if (keepLocal) {
    // 按原顺序重放原子批次。账单入账、专注回写等不能拆成单独上传。
    const revisions = Object.fromEntries(remote.map(row => [row.id, row.revision]))
    state.queue = state.queue.map(batch => ({ id: uid(), operations: batch.operations.map(previous => {
      const operation = { ...previous, expectedRevision: revisions[previous.id] || 0, mutationId: uid() }
      revisions[operation.id] = operation.expectedRevision + 1
      state.records[operation.id] = { ...operation, revision: operation.expectedRevision + 1, updated_at: new Date().toISOString() }
      return operation
    }) }))
  } else {
    state.queue = []
    for (const id of pending) { if (remoteMap[id]) state.records[id] = remoteMap[id]; else delete state.records[id] }
  }
  for (const row of remote) if (!pending.has(row.id)) state.records[row.id] = row
  state.status = 'pending'; state.error = ''; write(state, key)
  return sync()
}
function summary() {
  const state = read()
  return { status: state.status, error: state.error, pending: state.queue.reduce((sum, batch) => sum + batch.operations.length, 0), label: !api.isLoggedIn() ? '本机保存' : state.status === 'synced' ? '已同步到微信云端' : state.status === 'conflict' ? '有同步冲突待处理' : state.status === 'syncing' ? '正在同步' : '本机已保存，等待同步' }
}
function exportBackup() { return JSON.stringify({ application: 'study-life-miniprogram', schema: 1, exportedAt: new Date().toISOString(), records: all() }, null, 2) }
function restoreBackup(raw) {
  const backup = JSON.parse(raw)
  if (backup.application !== 'study-life-miniprogram' || backup.schema !== 1 || !Array.isArray(backup.records) || backup.records.length > 5000) throw new Error('请选择本小程序导出的 JSON 备份。')
  // 先完整校验，再一次落盘，不能恢复一半才报告文件错误。
  const state = read()
  const seen = new Set()
  const identities = new Map()
  const existingSettings = all('settings')[0]?.id || 'preferences'
  const rows = backup.records.map(row => {
    if (typeof row.id !== 'string' || seen.has(row.id)) throw new Error('备份中的记录编号缺失或重复。')
    seen.add(row.id)
    const values = normalize(row.kind, row)
    const id = row.kind === 'settings' ? existingSettings : row.kind === 'mood' ? `mood_${values.date}` : uid()
    if ([...identities.values()].includes(id)) throw new Error('备份中存在重复的设置或当天心情。')
    identities.set(row.id, id)
    return { id, kind: row.kind, values }
  })
  for (const row of rows) {
    if (row.values.courseId) row.values.courseId = identities.get(row.values.courseId) || ''
    if (row.values.taskId) row.values.taskId = identities.get(row.values.taskId) || ''
  }
  for (const row of rows) {
    if (JSON.stringify(row.values).length > 16000) throw new Error('备份中有过长记录。')
    const operation = { ...row, mutationId: uid(), expectedRevision: state.records[row.id]?.revision || 0, deleted: false }
    state.records[row.id] = { ...operation, revision: operation.expectedRevision + 1, updated_at: new Date().toISOString() }
    state.queue.push({ id: uid(), operations: [operation] })
  }
  state.status = api.isLoggedIn() ? 'pending' : 'local'; write(state)
  return rows.length
}
module.exports = { uid, identity, read, all, get, commit, put, remove, sync, summary, resolveConflict, exportBackup, restoreBackup }
