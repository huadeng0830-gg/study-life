import { registerSW } from 'virtual:pwa-register'
import { isAndroidApp } from './androidRuntime.js'
import { computed, toRef, watch } from 'vue'
import { APP_RELEASE } from './releaseNotes.js'
import { APP_CHANNEL, APP_LEGACY_RELEASE, BUILD_ID, SOURCE_SIGNATURE } from './versionInfo.js'
import { useTaskProgress } from './taskProgress.js'
import { createWebUpdateController } from './webUpdateController.js'
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
export const updateStage = toRef(webUpdateState, 'stage')
export const updateMessage = toRef(webUpdateState, 'message')
export const lastCheckedAt = toRef(webUpdateState, 'lastCheckedAt')
export const lastCheckOutcome = toRef(webUpdateState, 'lastCheckOutcome')
export const updateChecking = computed(() => webUpdateState.stage === 'checking')
export const needsManualReload = computed(() => ['ready', 'manual-reload'].includes(webUpdateState.stage))
export const checkForAppUpdate = (showResult = true) => controller.check(showResult)
export const applyAppUpdate = () => controller.apply()
export const forceRecoverToLatest = () => controller.apply(true)
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
if (!desktop && !isAndroidApp) registerSW({ immediate: true,
  onRegisteredSW: (_url, registration) => controller.observeRegistration(registration),
  // The plugin must never navigate independently of version verification.
  onNeedReload: () => {},
  onNeedRefresh: () => {},
})

/**
 * 【宿主存活守卫】
 * 这里的定时器与监听器是**模块级**的：模块不是组件，没有卸载时机，
 * 所以它们会一直活到进程结束。测试环境拆除时 window 会被换掉，
 * 那一刻排好的定时器照样触发 → 抛 "window is not defined"，
 * 而错误会落到**当时正在跑的那个文件**头上，让不相干的用例一起变红
 * （CI 上就是这么红的：全绿的本地跑一遍，CI 却红在另外两个文件上）。
 *
 * 做法与 dataVault.js 的 mirrorHostAlive 同一套：首次使用时认领当时的 window，
 * 之后只在宿主还是同一个对象时继续调度。浏览器里 window 终身不变，
 * 行为完全不变；宿主被换掉（测试拆除、SSR、Worker）时安静收手。
 */
let updateHostWindow = null
function updateHostAlive() {
  if (typeof window === 'undefined') return false
  updateHostWindow ??= window
  return updateHostWindow === window
}

function silentCheck() {
  if (isAndroidApp) return
  if (!updateHostAlive()) return
  if (!updatePreferences.autoCheck) return
  if (desktop) {
    if (lastDesktopSilentCheckAt && Date.now() - lastDesktopSilentCheckAt < SILENT_CHECK_INTERVAL_MS) return
    lastDesktopSilentCheckAt = Date.now()
    void checkDesktopAppUpdate()
  }
  else void checkForAppUpdate(false)
}
function visibilityCheck() { if (typeof document !== 'undefined' && document.visibilityState === 'visible') silentCheck() }
if (updateHostAlive()) {
  window.addEventListener('focus', silentCheck)
  window.addEventListener('online', silentCheck)
  document.addEventListener('visibilitychange', visibilityCheck)
}
const stopPreferenceWatch = watch(() => updatePreferences.autoCheck, (enabled) => {
  if (enabled) silentCheck()
})
const startupTimer = updateHostAlive() ? window.setTimeout(silentCheck, 2000) : 0
const periodicTimer = updateHostAlive() ? window.setInterval(silentCheck, PERIODIC_CHECK_INTERVAL_MS) : 0
const publishReminder = (state) => {
  if (!updateHostAlive()) return
  window.dispatchEvent(new CustomEvent('study-life:update-reminder', {
    detail: { stage: state.stage, version: state.availableVersion || '' },
  }))
}
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
