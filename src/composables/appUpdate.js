import { registerSW } from 'virtual:pwa-register'
import { computed, toRef } from 'vue'
import { APP_RELEASE } from './releaseNotes.js'
import { useTaskProgress } from './taskProgress.js'
import { createWebUpdateController, WEB_UPDATE_STAGES } from './webUpdateController.js'

export const appUpdateProgress = useTaskProgress()
const controller = createWebUpdateController({ currentVersion: APP_RELEASE, progress: appUpdateProgress })
export const webUpdateState = controller.state
export const UPDATE_STAGES = WEB_UPDATE_STAGES
export const updateStage = toRef(webUpdateState, 'stage')
export const updateMessage = toRef(webUpdateState, 'message')
export const lastCheckedAt = toRef(webUpdateState, 'lastCheckedAt')
export const lastCheckOutcome = toRef(webUpdateState, 'lastCheckOutcome')
export const updateChecking = computed(() => webUpdateState.stage === 'checking')
export const needsManualReload = computed(() => ['ready', 'manual-reload'].includes(webUpdateState.stage))
export const updateTone = computed(() => {
  if (webUpdateState.stage === 'error') return 'error'
  if (['warning', 'manual-reload'].includes(webUpdateState.stage)) return 'warning'
  if (['latest', 'completed'].includes(webUpdateState.stage)) return 'success'
  return 'info'
})
export const checkForAppUpdate = (showResult = true) => controller.check(showResult)
export const applyAppUpdate = () => controller.apply()
export const forceRecoverToLatest = () => controller.apply(true)
export const reloadAppToApplyUpdate = () => controller.apply()
export const reportResourceLoadFailure = () => controller.resourceFailed()
export function retryAppUpdate() {
  if (webUpdateState.error?.retryAction === 'wait') return controller.continueDownload()
  if (webUpdateState.error?.retryAction === 'repair') return forceRecoverToLatest()
  if (webUpdateState.error?.retryAction === 'apply') return applyAppUpdate()
  return checkForAppUpdate()
}

// Public seam for testing controller takeover ordering.
export function createControllerTakeoverMonitor(serviceWorker, { timeoutMs = 6000, onTakeover = () => {},
  onTimeout = () => {}, setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timer) => window.clearTimeout(timer) } = {}) {
  let hadController = Boolean(serviceWorker?.controller)
  let timer = 0
  const handle = () => {
    if (!serviceWorker?.controller) return
    const shouldReload = hadController
    hadController = true
    if (!shouldReload) return
    clearTimer(timer)
    onTakeover()
  }
  serviceWorker?.addEventListener('controllerchange', handle)
  return { get hasController() { return hadController },
    waitForTakeover() {
      if (!hadController) return false
      clearTimer(timer)
      timer = setTimer(onTimeout, timeoutMs)
      return true
    }, dispose() { clearTimer(timer); serviceWorker?.removeEventListener('controllerchange', handle) } }
}

const desktop = Boolean(window.studyLifeDesktop?.isDesktop)
if (!desktop) registerSW({ immediate: true,
  onRegisteredSW: (_url, registration) => controller.observeRegistration(registration),
  // The plugin must never navigate independently of version verification.
  onNeedReload: () => {},
  onNeedRefresh: () => {},
})
function silentCheck() { if (!desktop) void checkForAppUpdate(false) }
function visibilityCheck() { if (document.visibilityState === 'visible') silentCheck() }
window.addEventListener('focus', silentCheck)
window.addEventListener('online', silentCheck)
document.addEventListener('visibilitychange', visibilityCheck)
const startupTimer = window.setTimeout(silentCheck, 2000)
const periodicTimer = window.setInterval(silentCheck, 30 * 60 * 1000)
if (import.meta.hot) import.meta.hot.dispose(() => {
  controller.dispose()
  window.clearTimeout(startupTimer)
  window.clearInterval(periodicTimer)
  window.removeEventListener('focus', silentCheck)
  window.removeEventListener('online', silentCheck)
  document.removeEventListener('visibilitychange', visibilityCheck)
})
