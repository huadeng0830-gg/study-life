import { registerSW } from 'virtual:pwa-register'
import { ref } from 'vue'
import { APP_RELEASE } from './releaseNotes.js'
import { useTaskProgress } from './taskProgress.js'

let registration = null
let updateInFlight = null
let lastSilentCheckAt = 0
let reloadScheduled = false
const SILENT_CHECK_INTERVAL = 10 * 60 * 1000
const UPDATE_FOUND_GRACE = 3000
const UPDATE_INSTALL_TIMEOUT = 30 * 1000
export const updateMessage = ref('')
export const updateChecking = ref(false)
// Service Worker does not expose package bytes or a server-side version string.
// Keep this model limited to events we can observe instead of inventing a percent.
export const appUpdateProgress = useTaskProgress()

const UPDATE_STEPS = [
  { id: 'check', label: '检查更新信息' },
  { id: 'download', label: '下载新的离线资源' },
  { id: 'prepare', label: '准备启用新版本' },
  { id: 'apply', label: '应用新版本' },
]

function startVisibleUpdateProgress() {
  if (appUpdateProgress.state.status === 'running') return
  appUpdateProgress.start({ title: '正在检查应用更新', steps: UPDATE_STEPS })
  appUpdateProgress.setStep('check', 'running', '正在向更新服务查询')
}

function updateActivity(message) {
  updateMessage.value = message
  appUpdateProgress.activity(message)
}

function reloadAfterActivation() {
  if (reloadScheduled) return
  reloadScheduled = true
  appUpdateProgress.setStep('apply', 'completed', '新的离线资源已启用')
  appUpdateProgress.finish('更新完成，即将重新打开应用')
  updateMessage.value = '更新完成，即将重新打开…'
  // 等 Service Worker 完成 clientsClaim 后再导航，避免 Safari 又读取旧控制器。
  // 保留短暂成功状态，让用户知道刷新是更新成功后的正常动作。
  window.setTimeout(() => window.location.reload(), 900)
}

registerSW({
  immediate: true,
  onRegisteredSW(_url, value) {
    registration = value
  },
})

// autoUpdate 模式下新 Service Worker 会在后台安装并激活，但已打开的页面
// 不会自动刷新，用户会一直停留在旧版本界面上。监听控制权切换：
// 页面初次被 Worker 接管（首次安装）不刷新，此后每次切换都立即重载。
let hadController = false
try {
  hadController = Boolean(navigator.serviceWorker?.controller)
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    const shouldReload = hadController
    hadController = true
    if (shouldReload && !reloadScheduled) reloadAfterActivation()
  })
} catch {}

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
      if (worker.state === 'installing') {
        appUpdateProgress.setStep('check', 'completed', '已发现新版本')
        appUpdateProgress.setStep('download', 'running', '正在下载新的离线资源')
        updateActivity('发现新版本，正在下载…')
      }
      if (worker.state === 'installed') {
        appUpdateProgress.setStep('download', 'completed', '新的离线资源已下载')
        appUpdateProgress.setStep('prepare', 'running', '正在准备启用新版本')
        updateActivity('新版已下载，正在准备启用…')
      }
      if (worker.state === 'activating') {
        appUpdateProgress.setStep('prepare', 'completed', '已准备就绪')
        appUpdateProgress.setStep('apply', 'running', '正在启用新的离线资源')
        updateActivity('正在应用新版本…')
      }
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

// 构建时写入 dist/version.txt 的版本号；no-store 拉取可绕过一切缓存，
// 用于核对"本地页面版本"与"服务器最新版本"是否一致。
async function fetchServerRelease() {
  try {
    const response = await fetch(`/version.txt?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return null
    const text = (await response.text()).trim()
    return text || null
  } catch {
    return null
  }
}

// 强制恢复的频率保护：同一页面会话 1 小时内最多 2 次，防止异常环境下无限刷新。
const FORCE_RECOVER_WINDOW = 60 * 60 * 1000
const FORCE_RECOVER_MAX = 2

function canForceRecover() {
  try {
    const raw = JSON.parse(sessionStorage.getItem('study_life_force_recover') || '[]')
    return raw.filter((ts) => Date.now() - ts < FORCE_RECOVER_WINDOW).length < FORCE_RECOVER_MAX
  } catch {
    return false
  }
}

function markForceRecover() {
  try {
    const raw = JSON.parse(sessionStorage.getItem('study_life_force_recover') || '[]')
    const recent = raw.filter((ts) => Date.now() - ts < FORCE_RECOVER_WINDOW)
    recent.push(Date.now())
    sessionStorage.setItem('study_life_force_recover', JSON.stringify(recent.slice(-FORCE_RECOVER_MAX)))
  } catch {}
}

// SW 更新管道被缓存卡住（sw.js 未更新、Safari 跳过检查等）时的最后手段：
// 注销 Worker、清空离线缓存后整页刷新，直接从服务器获取最新入口。
async function forceRecoverToLatest() {
  if (canForceRecover()) {
    markForceRecover()
    updateMessage.value = '发现新版本，正在同步最新资源…'
    appUpdateProgress.setStep('download', 'running', '本地版本落后，正在强制同步')
    try {
      if (navigator.serviceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((item) => item.unregister()))
      }
      if (window.caches?.keys) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {}
    window.setTimeout(() => window.location.reload(), 400)
    return true
  }
  updateMessage.value = '检测到新版本，请关闭应用后重新打开'
  appUpdateProgress.setStep('download', 'warning', '本地版本落后，请重启应用')
  return false
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
      if (showResult) {
        startVisibleUpdateProgress()
        updateMessage.value = '正在检查新版本…'
      }
      updateChecking.value = true
      lastSilentCheckAt = now
      await activeRegistration.update()

      // Safari 的 update() 可能先结束，随后才触发 updatefound；短暂等待，避免误报“最新”。
      if (!foundWorker && !activeRegistration.installing && !activeRegistration.waiting) {
        await Promise.race([updateFound, timeout(UPDATE_FOUND_GRACE)])
      }

      const worker = foundWorker || activeRegistration.installing || activeRegistration.waiting
      if (worker) {
        appUpdateProgress.setStep('check', 'completed', '已发现新版本')
        const result = await (workerPromise || waitForWorker(worker))
        if (result === 'redundant') {
          updateMessage.value = '新版安装失败，请再试一次'
          appUpdateProgress.fail('download', '新版本下载或安装失败，请重试')
          return false
        }
        if (result === 'timeout') {
          updateMessage.value = '新版仍在安装，请保持页面打开'
          appUpdateProgress.setStep('download', 'warning', '下载仍在继续，暂时没有新的状态事件')
        }
        // else result === 'activated'，会自动重新打开，不需要额外提示
        return true
      }

      // SW 报告没有新版本时，再核对服务器版本号：若本地页面版本落后，
      // 说明 sw.js 检查被缓存或跳过，直接强制同步，绝不误报“已是最新版本”。
      if (!foundWorker && !activeRegistration.installing && !activeRegistration.waiting) {
        const serverRelease = await fetchServerRelease()
        if (!serverRelease) {
          // version.txt 拉取失败（断网、CDN 抖动等）时不能断言“已是最新版本”。
          if (showResult) {
            updateMessage.value = '暂时无法确认服务器版本，请稍后再试'
            appUpdateProgress.finish('暂时无法确认服务器版本')
            window.setTimeout(() => {
              if (updateMessage.value === '暂时无法确认服务器版本，请稍后再试') updateMessage.value = ''
            }, 3000)
          }
        } else if (serverRelease !== APP_RELEASE) {
          const recovered = await forceRecoverToLatest()
          if (recovered) return true
        } else if (showResult && updateMessage.value === '正在检查新版本…') {
          updateMessage.value = '已是最新版本'
          appUpdateProgress.setStep('check', 'completed', '当前已是最新版本')
          appUpdateProgress.finish('检查完成，当前已是最新版本')
          window.setTimeout(() => {
            if (updateMessage.value === '已是最新版本') updateMessage.value = ''
          }, 3000)
        }
      }
      return true
    } catch {
      if (showResult) {
        updateMessage.value = '检查失败，请确认网络后重试'
        appUpdateProgress.fail('check', '检查更新失败，请确认网络后重试')
      }
      return false
    } finally {
      activeRegistration.removeEventListener('updatefound', handleUpdateFound)
      updateInFlight = null
      updateChecking.value = false
    }
  })()
  return updateInFlight
}

// Service Worker 的 update() 没有可安全终止的浏览器 API，因此不提供假“取消”。
// 重试会重新执行真实的更新检查；已缓存的资源由浏览器复用。
export function retryAppUpdate() {
  return checkForAppUpdate(true)
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
