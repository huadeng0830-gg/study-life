import { registerSW } from 'virtual:pwa-register'
import { computed, toRef, watch } from 'vue'
import { APP_RELEASE } from './releaseNotes.js'
import { APP_CHANNEL, APP_LEGACY_RELEASE, BUILD_ID, SOURCE_SIGNATURE } from './versionInfo.js'
import { useTaskProgress } from './taskProgress.js'
import { createWebUpdateController, WEB_UPDATE_STAGES } from './webUpdateController.js'
import { updatePreferences } from './updatePreferences.js'
import { flushStoredWrites } from './store/core.js'
import { checkDesktopAppUpdate, desktopUpdateState, isDesktopApp } from './desktopAppUpdate.js'

// 静默检查节流。原来是 10 分钟：一次会话里几乎碰不到第二次检查，
// 只有退出重进才会立刻重查 —— 这是「退出重进才更新」的观感来源之一。
const SILENT_CHECK_INTERVAL_MS = 90000
// 周期检查间隔。节流已经限住请求量，这里只需要保证长期开着的标签页也能发现新版本。
const PERIODIC_CHECK_INTERVAL_MS = 5 * 60 * 1000

export const appUpdateProgress = useTaskProgress()
const controller = createWebUpdateController({ currentVersion: APP_RELEASE, currentSourceSignature: SOURCE_SIGNATURE,
  currentBuildId: BUILD_ID, legacyCurrentVersion: APP_LEGACY_RELEASE, channel: APP_CHANNEL, progress: appUpdateProgress,
  // 重载会丢掉尚未写入 localStorage 的改动，先把待写数据落盘。
  beforeReload: () => {
    try { return flushStoredWrites() } catch { return { ok: false, pendingKeys: [] } }
  } })
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

const desktop = isDesktopApp
let lastDesktopSilentCheckAt = 0
if (!desktop) registerSW({ immediate: true,
  onRegisteredSW: (_url, registration) => controller.observeRegistration(registration),
  // The plugin must never navigate independently of version verification.
  onNeedReload: () => {},
  onNeedRefresh: () => {},
})
function silentCheck() {
  if (!updatePreferences.autoCheck) return
  if (desktop) {
    if (lastDesktopSilentCheckAt && Date.now() - lastDesktopSilentCheckAt < SILENT_CHECK_INTERVAL_MS) return
    lastDesktopSilentCheckAt = Date.now()
    void checkDesktopAppUpdate()
  }
  else void checkForAppUpdate(false)
}
function visibilityCheck() { if (document.visibilityState === 'visible') silentCheck() }
window.addEventListener('focus', silentCheck)
window.addEventListener('online', silentCheck)
document.addEventListener('visibilitychange', visibilityCheck)
const stopPreferenceWatch = watch(() => updatePreferences.autoCheck, (enabled) => {
  if (enabled) silentCheck()
})
const startupTimer = window.setTimeout(silentCheck, 2000)
const periodicTimer = window.setInterval(silentCheck, PERIODIC_CHECK_INTERVAL_MS)
const publishReminder = (state) => window.dispatchEvent(new CustomEvent('study-life:update-reminder', {
  detail: { stage: state.stage, version: state.availableVersion || '' },
}))
const stopWebReminderWatch = watch(() => [webUpdateState.stage, webUpdateState.availableVersion], () => publishReminder(webUpdateState), { immediate: true })
const stopDesktopReminderWatch = watch(() => [desktopUpdateState.value.stage, desktopUpdateState.value.availableVersion],
  () => publishReminder(desktopUpdateState.value), { immediate: true })
if (import.meta.hot) import.meta.hot.dispose(() => {
  controller.dispose()
  window.clearTimeout(startupTimer)
  window.clearInterval(periodicTimer)
  window.removeEventListener('focus', silentCheck)
  window.removeEventListener('online', silentCheck)
  document.removeEventListener('visibilitychange', visibilityCheck)
  stopPreferenceWatch()
  stopWebReminderWatch()
  stopDesktopReminderWatch()
})
