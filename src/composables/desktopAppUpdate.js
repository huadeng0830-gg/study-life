import { ref } from 'vue'

const DESKTOP_UPDATE_STAGES = new Set([
  'idle', 'checking', 'latest', 'available', 'downloading', 'ready', 'installing', 'error', 'unavailable',
])

function desktopApi() {
  if (typeof window === 'undefined') return null
  const api = window.studyLifeDesktop
  return api?.isDesktop ? api : null
}

export const isDesktopApp = Boolean(desktopApi())
export const desktopUpdateState = ref({
  stage: isDesktopApp ? 'idle' : 'unavailable',
  currentVersion: '',
  availableVersion: '',
  percent: 0,
  lastCheckedAt: 0,
  message: '',
})

function applyState(next) {
  if (!next || typeof next !== 'object' || !DESKTOP_UPDATE_STAGES.has(next.stage)) return
  const percent = Number(next.percent)
  const lastCheckedAt = Number(next.lastCheckedAt)
  desktopUpdateState.value = {
    stage: next.stage,
    currentVersion: typeof next.currentVersion === 'string' ? next.currentVersion : '',
    availableVersion: typeof next.availableVersion === 'string' ? next.availableVersion : '',
    percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0,
    lastCheckedAt: Number.isFinite(lastCheckedAt) && lastCheckedAt > 0 ? lastCheckedAt : 0,
    message: typeof next.message === 'string' ? next.message.slice(0, 240) : '',
  }
}

export function subscribeToDesktopUpdateState() {
  const api = desktopApi()
  if (!api) return () => {}

  let active = true
  const receive = (state) => {
    if (active) applyState(state)
  }
  const unsubscribe = api.onUpdateState?.(receive)
  Promise.resolve(api.getUpdateState?.()).then(receive).catch(() => {})

  return () => {
    active = false
    if (typeof unsubscribe === 'function') unsubscribe()
  }
}

export async function checkDesktopAppUpdate() {
  const api = desktopApi()
  return api ? api.checkForUpdates() : false
}

export async function downloadDesktopAppUpdate() {
  const api = desktopApi()
  return api ? api.downloadUpdate() : false
}

export async function installDesktopAppUpdate() {
  const api = desktopApi()
  return api ? api.installUpdate() : false
}
