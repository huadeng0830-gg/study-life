import { registerSW } from 'virtual:pwa-register'
import { ref } from 'vue'

let registration = null
let updateSW = () => Promise.resolve()
let updateInFlight = null
let lastSilentCheckAt = 0
let applyingUpdate = false
let reloadScheduled = false
const SILENT_CHECK_INTERVAL = 10 * 60 * 1000
const UPDATE_FOUND_GRACE = 1200
const UPDATE_INSTALL_TIMEOUT = 30 * 1000
export const updateMessage = ref('')
export const updateChecking = ref(false)

function reloadAfterActivation() {
  if (reloadScheduled) return
  reloadScheduled = true
  applyingUpdate = true
  updateMessage.value = '新版已安装，正在重新打开…'
  // 等 Service Worker 完成 clientsClaim 后再导航，避免 Safari 又读取旧控制器。
  window.setTimeout(() => window.location.reload(), 180)
}

updateSW = registerSW({
  immediate: true,
  onNeedReload() {
    reloadAfterActivation()
  },
  onNeedRefresh() {
    if (applyingUpdate) return
    applyingUpdate = true
    updateMessage.value = '发现新版本，正在安装…'
    void updateSW(true)
  },
  onRegisteredSW(_url, value) {
    registration = value
  },
})

function timeout(ms) {
  return new Promise((resolve) => window.setTimeout(() => resolve(null), ms))
}

function waitForWorker(worker) {
  if (!worker) return Promise.resolve('missing')
  return new Promise((resolve) => {
    let timer = 0
    const finish = (state) => {
      window.clearTimeout(timer)
      worker.removeEventListener('statechange', handleState)
      resolve(state)
    }
    const handleState = () => {
      if (worker.state === 'installing') updateMessage.value = '发现新版本，正在下载…'
      if (worker.state === 'installed') updateMessage.value = '新版已下载，正在安装…'
      if (worker.state === 'activating') updateMessage.value = '新版已下载，正在启用…'
      if (worker.state === 'activated') {
        reloadAfterActivation()
        finish('activated')
      }
      if (worker.state === 'redundant') finish('redundant')
    }
    worker.addEventListener('statechange', handleState)
    timer = window.setTimeout(() => finish('timeout'), UPDATE_INSTALL_TIMEOUT)
    handleState()
  })
}

async function resolveRegistration() {
  if (registration) return registration
  if (!('serviceWorker' in navigator)) return null
  registration = await navigator.serviceWorker.getRegistration()
  if (registration) return registration
  registration = await Promise.race([navigator.serviceWorker.ready, timeout(3500)])
  return registration
}

export async function checkForAppUpdate(showResult = true) {
  if (!navigator.onLine) {
    if (showResult) updateMessage.value = '当前没有网络，暂时无法检查更新'
    return false
  }
  const activeRegistration = await resolveRegistration()
  if (!activeRegistration) {
    if (showResult) updateMessage.value = '更新服务正在准备，请稍后再试'
    return false
  }
  const now = Date.now()
  if (!showResult && now - lastSilentCheckAt < SILENT_CHECK_INTERVAL) return false
  if (updateInFlight) return updateInFlight
  updateInFlight = (async () => {
    let workerPromise = null
    let foundWorker = null
    let resolveFound = () => {}
    const updateFound = new Promise((resolve) => { resolveFound = resolve })
    const handleUpdateFound = () => {
      foundWorker = activeRegistration.installing
      updateMessage.value = '发现新版本，正在下载…'
      workerPromise = waitForWorker(foundWorker)
      resolveFound(foundWorker)
    }
    activeRegistration.addEventListener('updatefound', handleUpdateFound)
    try {
      if (showResult) updateMessage.value = '正在检查新版本…'
      updateChecking.value = true
      lastSilentCheckAt = now
      await activeRegistration.update()

      // Safari 的 update() 可能先结束，随后才触发 updatefound；短暂等待，避免误报“最新”。
      if (!foundWorker && !activeRegistration.installing && !activeRegistration.waiting) {
        await Promise.race([updateFound, timeout(UPDATE_FOUND_GRACE)])
      }

      const worker = foundWorker || activeRegistration.installing || activeRegistration.waiting
      if (worker) {
        applyingUpdate = true
        const result = await (workerPromise || waitForWorker(worker))
        if (result === 'redundant') {
          updateMessage.value = '新版安装失败，请再试一次'
          return false
        }
        if (result === 'timeout') {
          updateMessage.value = '新版仍在安装，请保持页面打开'
        }
        // else result === 'activated'，会自动重新打开，不需要额外提示
        return true
      }

      if (showResult && updateMessage.value === '正在检查新版本…') {
        updateMessage.value = '已是最新版本'
        window.setTimeout(() => {
          if (updateMessage.value === '已是最新版本') updateMessage.value = ''
        }, 3000)
      }
      return true
    } catch {
      if (showResult) updateMessage.value = '检查失败，请确认网络后重试'
      return false
    } finally {
      activeRegistration.removeEventListener('updatefound', handleUpdateFound)
      updateInFlight = null
      updateChecking.value = false
    }
  })()
  return updateInFlight
}

function silentCheck() {
  void checkForAppUpdate(false)
}

window.addEventListener('focus', silentCheck)
window.addEventListener('online', silentCheck)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') silentCheck()
})
window.setTimeout(silentCheck, 30 * 1000)
window.setInterval(silentCheck, 30 * 60 * 1000)
