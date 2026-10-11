import { ref } from 'vue'
import { recordSilentError } from '../globalError.js'
import { setMirrorErrorHandler, setMirrorSuccessHandler } from '../dataVault.js'

export const persistenceState = ref({ status: 'idle', key: '', source: '', message: '', at: 0 })
export const persistenceWriteStates = ref({})
const persistenceIssues = new Map()
const dismissedPersistenceIssues = new Set()

function issueId(key, source) { return `${source}:${key}` }

export function setPersistenceWriteState(key, status, source = 'local', error = '', details = {}) {
  if (!key) return
  persistenceWriteStates.value = {
    ...persistenceWriteStates.value,
    [key]: { status, source, error, ...details, at: Date.now() },
  }
}

function refreshPersistenceSummary({ recovered = false } = {}) {
  const remaining = [...persistenceIssues.entries()].filter(([id]) => !dismissedPersistenceIssues.has(id))
  if (remaining.length) {
    persistenceState.value = { ...remaining.at(-1)[1] }
    return
  }
  if (['error', 'conflict'].includes(persistenceState.value.status)) {
    persistenceState.value = recovered
      ? { status: 'recovered', key: '', source: '', message: '本机保存已恢复。', at: Date.now() }
      : { status: 'idle', key: '', source: '', message: '', at: 0 }
  }
}

export function reportPersistenceFailure(error, key = '', source = 'local', details = {}) {
  const conflict = source === 'conflict'
  const message = conflict
    ? '其他页面也修改了这项数据；本页修改已保留，请先导出当前数据并处理冲突。'
    : source === 'mirror'
      ? '本机主数据已写入，但安全副本未能更新；建议立即导出当前数据。'
      : source === 'owner-draft'
        ? '账号已切换；旧账号未保存修改已另存为隔离恢复草稿，没有写入当前账号。切回原账号后可恢复。'
        : source === 'owner-draft-failed'
          ? '账号已切换，但旧账号未保存修改无法写入安全恢复草稿；内容仍留在此页内存中，请立即导出并不要刷新或关闭。'
      : '本次修改未能保存到本机；刷新或关闭页面前请先导出当前数据。'
  const issue = { status: conflict ? 'conflict' : 'error', key, source, message, at: Date.now() }
  const id = issueId(key, source)
  persistenceIssues.set(id, issue)
  dismissedPersistenceIssues.delete(id)
  setPersistenceWriteState(key, conflict ? 'conflict' : 'failed', source, message, details)
  refreshPersistenceSummary()
  recordSilentError(`storage-${source}`, error)
}

export function dismissPersistenceNotice() {
  for (const id of persistenceIssues.keys()) dismissedPersistenceIssues.add(id)
  persistenceState.value = { status: 'idle', key: '', source: '', message: '', at: 0 }
}

export function markPersistenceSuccess(key, source = 'local') {
  if (key) {
    setPersistenceWriteState(key, 'saved', source)
    const id = issueId(key, source)
    persistenceIssues.delete(id)
    dismissedPersistenceIssues.delete(id)
  }
  refreshPersistenceSummary({ recovered: true })
}

setMirrorErrorHandler((error, keys = []) => reportPersistenceFailure(error, keys[0] || '', 'mirror'))
setMirrorSuccessHandler((keys = []) => keys.forEach((key) => markPersistenceSuccess(key, 'mirror')))
