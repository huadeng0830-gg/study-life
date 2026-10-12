import { ref } from 'vue'
import { safeUpdateError, updateError, validateReleaseHistory } from './updateProtocol.js'

const STAGES = new Set(['idle', 'checking', 'latest', 'available', 'downloading', 'ready',
  'installing', 'verifying', 'completed', 'cancelled', 'error', 'unavailable'])
function desktopApi() {
  if (typeof window === 'undefined') return null
  return window.studyLifeDesktop?.isDesktop ? window.studyLifeDesktop : null
}
export const isDesktopApp = Boolean(desktopApi())
export const desktopUpdateState = ref({
  stage: isDesktopApp ? 'idle' : 'unavailable', currentVersion: '', availableVersion: '',
  percent: null, transferred: 0, total: 0, bytesPerSecond: 0, lastCheckedAt: 0,
  startedAt: 0, finishedAt: 0, taskPending: false, canCancel: false, canRetry: true,
  taskId: 0, revision: 0, error: null, timings: [], log: [], message: '',
  releaseNotes: '', releaseDate: '',
})
let subscribers = 0
let unsubscribe = null
let connection = 0
let receivedEvents = 0
let command = null
const positive = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
function applyState(next) {
  if (!next || !STAGES.has(next.stage)) return
  if (Number.isFinite(next.revision) && next.revision < desktopUpdateState.value.revision) return
  desktopUpdateState.value = {
    stage: next.stage, currentVersion: typeof next.currentVersion === 'string' ? next.currentVersion.slice(0, 120) : '',
    availableVersion: typeof next.availableVersion === 'string' ? next.availableVersion.slice(0, 120) : '',
    percent: next.percent == null || !Number.isFinite(Number(next.percent)) ? null : Math.min(100, Math.max(0, Math.round(Number(next.percent)))),
    transferred: positive(next.transferred), total: positive(next.total), bytesPerSecond: positive(next.bytesPerSecond),
    lastCheckedAt: positive(next.lastCheckedAt), startedAt: positive(next.startedAt), finishedAt: positive(next.finishedAt),
    taskId: positive(next.taskId), revision: positive(next.revision), taskPending: Boolean(next.taskPending),
    canCancel: Boolean(next.canCancel), canRetry: next.canRetry !== false,
    error: next.error ? safeUpdateError(next.error, 'BRIDGE', true) : null,
    timings: Array.isArray(next.timings) ? next.timings.slice(-24).map((item) => ({
      stage: STAGES.has(item.stage) ? item.stage : 'idle', durationMs: positive(item.durationMs) })) : [],
    log: Array.isArray(next.log) ? next.log.slice(-40).map((item) => ({
      at: positive(item.at), stage: STAGES.has(item.stage) ? item.stage : 'idle',
      code: /^[A-Z_]{1,60}$/.test(item.code) ? item.code : 'UPDATER_EVENT' })) : [],
    message: typeof next.message === 'string' ? next.message.slice(0, 300) : '',
    releaseNotes: typeof next.releaseNotes === 'string' ? next.releaseNotes.slice(0, 6000) : '',
    releaseDate: typeof next.releaseDate === 'string' ? next.releaseDate : '',
  }
}
function bridgeFailure(action) {
  const error = safeUpdateError(updateError('BRIDGE', '无法连接桌面更新进程，请重新打开应用后重试。', action), 'BRIDGE')
  const uncertainTask = desktopUpdateState.value.taskPending
  desktopUpdateState.value = { ...desktopUpdateState.value, stage: 'error', taskPending: uncertainTask,
    canRetry: !uncertainTask, error, message: error.message }
}
export function subscribeToDesktopUpdateState() {
  const api = desktopApi()
  if (!api) return () => {}
  subscribers += 1
  if (subscribers === 1) {
    const epoch = ++connection
    const eventsAtRequest = receivedEvents
    unsubscribe = api.onUpdateState?.((state) => {
      if (!subscribers || epoch !== connection) return
      receivedEvents += 1
      applyState(state)
    })
    Promise.resolve(api.getUpdateState?.()).then((state) => {
      // A later push is authoritative even when legacy snapshots lack revisions.
      if (subscribers && epoch === connection && receivedEvents === eventsAtRequest) applyState(state)
    }).catch(() => {
      if (subscribers && epoch === connection && receivedEvents === eventsAtRequest) bridgeFailure('check')
    })
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    subscribers -= 1
    if (!subscribers) { connection += 1; unsubscribe?.(); unsubscribe = null }
  }
}
function invoke(action, method, stage) {
  if (command) return command.action === action ? command.promise : Promise.resolve(false)
  const api = desktopApi()
  if (!api?.[method]) return Promise.resolve(false)
  if (desktopUpdateState.value.taskPending || ['checking', 'downloading', 'installing', 'verifying'].includes(desktopUpdateState.value.stage))
    return Promise.resolve(false)
  const token = { action, promise: null }
  const eventsAtCommand = receivedEvents
  command = token
  desktopUpdateState.value = { ...desktopUpdateState.value, stage, taskPending: true, error: null,
    startedAt: Date.now(), finishedAt: 0, message: { check: '正在检查桌面更新…', download: '正在下载桌面更新…', install: '正在退出并安装更新…' }[action] }
  token.promise = (async () => {
    try {
      const result = await api[method]()
      if (api.getUpdateState) {
        const eventsAtSnapshot = receivedEvents
        const next = await api.getUpdateState()
        if (receivedEvents === eventsAtSnapshot) applyState(next)
      }
      if (!result && desktopUpdateState.value.stage === stage) bridgeFailure(action)
      return Boolean(result)
    } catch { if (receivedEvents === eventsAtCommand) bridgeFailure(action); return false }
    finally {
      if (command === token) command = null
      if (!api.getUpdateState && desktopUpdateState.value.stage === stage)
        desktopUpdateState.value = { ...desktopUpdateState.value, stage: 'idle', taskPending: false }
    }
  })()
  return token.promise
}
export const checkDesktopAppUpdate = () => invoke('check', 'checkForUpdates', 'checking')
export const downloadDesktopAppUpdate = () => invoke('download', 'downloadUpdate', 'downloading')
export const installDesktopAppUpdate = () => invoke('install', 'installUpdate', 'installing')
export async function cancelDesktopAppUpdate() {
  try { return Boolean(await desktopApi()?.cancelUpdate?.()) }
  catch { bridgeFailure('download'); return false }
}

export async function loadDesktopReleaseHistory() {
  try {
    const value = await desktopApi()?.getReleaseHistory?.()
    return validateReleaseHistory(value, { channel: 'stable' })
  } catch { return null }
}
