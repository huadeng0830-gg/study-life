import { registerSW } from 'virtual:pwa-register'
import { computed, ref } from 'vue'
import { APP_RELEASE } from './releaseNotes.js'
import { useTaskProgress } from './taskProgress.js'

let registration = null
let updateInFlight = null
let lastSilentCheckAt = 0
let reloadScheduled = false
const SILENT_CHECK_INTERVAL = 10 * 60 * 1000
// Safari 的 update() 会先返回、随后才触发 updatefound；这里只留一个足够短的重判窗口，
// 避免“已是最新版本”白白等 3 秒。800ms 已能覆盖 Safari 的异步 updatefound。
const UPDATE_FOUND_GRACE = 800
const UPDATE_INSTALL_TIMEOUT = 30 * 1000
const UPDATE_CHECK_TIMEOUT = 8 * 1000
const RELEASE_FETCH_TIMEOUT = 8 * 1000
const CONTROLLER_TAKEOVER_TIMEOUT = 6 * 1000
export const updateMessage = ref('')
export const updateChecking = ref(false)

/**
 * 更新流程的**显式**状态机。
 *
 * 【为什么必须有它】原来 AppUpdateSection 是拿中文文案去正则匹配语气的：
 *   if (/失败/.test(updateMessage.value)) return 'error'
 *   …
 *   v-if="updateMessage.includes('重新加载页面')"   ← 唯一的"手动重载"出口
 * 于是改一句提示文案就会改变配色，还会把**唯一的手动出口删掉**：
 * 把「请重新加载页面以完成更新」改成「请刷新页面」，用户就再也没有办法
 * 离开旧版本了。'新版仍在安装，请保持页面打开' 匹配不到任何一条，
 * 在进度状态机里是 warning，渲染出来却是最弱的 info。
 * 状态应该由流程写、由 UI 读，不该从人的句子里反推。
 *
 * 取值：idle | checking | available | downloading | ready | updating |
 *       manual-reload | latest | warning | error
 */
export const UPDATE_STAGES = Object.freeze([
  'idle', 'checking', 'available', 'downloading', 'ready', 'updating', 'manual-reload', 'latest', 'warning', 'error',
])
export const updateStage = ref('idle')
/** 需要用户自己点一下才能生效（重载 / 重启应用）。 */
export const needsManualReload = ref(false)
/** 上一次检查的结果摘要，用于「版本与更新」里如实告诉用户上次查到了什么。 */
export const lastCheckOutcome = ref('')
export const lastCheckedAt = ref(0)

function toneForStage(stage) {
  if (stage === 'error') return 'error'
  if (stage === 'warning' || stage === 'manual-reload') return 'warning'
  if (stage === 'latest' || stage === 'updating' || stage === 'ready') return 'success'
  return 'info'
}
/** UI 直接消费，不用再自己判断语气。 */
export const updateTone = computed(() => toneForStage(updateStage.value))
// Service Worker does not expose package bytes or a server-side version string.
// Keep this model limited to events we can observe instead of inventing a percent.
export const appUpdateProgress = useTaskProgress()

const UPDATE_STEPS = [
  { id: 'check', label: '检查更新信息' },
  { id: 'download', label: '下载新的离线资源' },
  { id: 'prepare', label: '准备启用新版本' },
  { id: 'apply', label: '应用新版本' },
]

function startVisibleUpdateProgress(force = false) {
  if (!force && appUpdateProgress.state.status === 'running') return
  appUpdateProgress.start({ title: '正在检查应用更新', steps: UPDATE_STEPS })
  appUpdateProgress.setStep('check', 'running', '正在向更新服务查询')
}

function updateActivity(message, run) {
  if (run?.visible) updateMessage.value = message
  appUpdateProgress.activity(message)
}

function reloadAfterActivation() {
  if (reloadScheduled) return
  reloadScheduled = true
  updateStage.value = 'updating'
  appUpdateProgress.setStep('apply', 'completed', '新的离线资源已启用')
  appUpdateProgress.finish('更新完成，即将重新打开应用')
  updateMessage.value = '更新完成，即将重新打开…'
  // 只在 controllerchange 后导航，此时当前页面已由新 Worker 接管。
  window.setTimeout(() => window.location.reload(), 900)
}

/** 用户需要自己动手才能离开旧版本时置位（UI 据此渲染手动出口）。 */
function requireManualReload(message) {
  needsManualReload.value = true
  updateStage.value = 'manual-reload'
  updateMessage.value = message
}

/** 让"现在需要刷新"这个判断只由这一处写，UI 不要再去匹配中文文案。 */
function setUpdateStage(stage, message = '') {
  updateStage.value = stage
  if (message) updateMessage.value = message
}

/**
 * 新 Worker 进入 activated 后，页面仍可能由旧 Worker 控制一段时间。
 * 只有收到 controllerchange 才自动刷新；超时则保留当前页面并给手动入口。
 * 抽成小接口，便于用延迟的 Worker 接管事件复现更新时序。
 */
export function createControllerTakeoverMonitor(serviceWorker, {
  timeoutMs = CONTROLLER_TAKEOVER_TIMEOUT,
  onTakeover = () => {},
  onTimeout = () => {},
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timer) => window.clearTimeout(timer),
} = {}) {
  let hadController = Boolean(serviceWorker?.controller)
  let timer = 0
  const handleControllerChange = () => {
    // 【注销也会触发 controllerchange，且 controller 会变成 null】
    // forceRecoverToLatest 与 pwaStartupRecovery 都会 unregister 全部 Worker，
    // 那条路径同样会走到这里。原来只要 hadController 为真就判定"新版本接管"，
    // 于是用户看到「更新完成，即将重新打开…」，900ms 后在**恢复流程之上**又叠一次刷新。
    // 取向：只有真的换上来一个新控制器才算接管。
    if (!serviceWorker?.controller) return
    const shouldReload = hadController
    hadController = true
    if (!shouldReload) return
    clearTimer(timer)
    timer = 0
    onTakeover()
  }
  serviceWorker?.addEventListener('controllerchange', handleControllerChange)

  return {
    get hasController() { return hadController },
    waitForTakeover() {
      if (!hadController) return false
      clearTimer(timer)
      timer = setTimer(() => {
        timer = 0
        onTimeout()
      }, timeoutMs)
      return true
    },
    dispose() {
      clearTimer(timer)
      timer = 0
      serviceWorker?.removeEventListener('controllerchange', handleControllerChange)
    },
  }
}

// 必须先装控制权切换监听，再注册 Worker，避免安装很快时漏掉 controllerchange。
const controllerTakeoverMonitor = createControllerTakeoverMonitor(
  typeof navigator === 'undefined' ? null : navigator.serviceWorker,
  {
    onTakeover: () => {
      if (!reloadScheduled) reloadAfterActivation()
    },
    onTimeout: () => {
      if (reloadScheduled) return
      requireManualReload('新版本已安装，请重新加载页面以完成更新')
      appUpdateProgress.setStep('apply', 'warning', '浏览器还没有切换到新版本')
      appUpdateProgress.finish('新版本已安装，请重新加载页面以完成更新', 'warning')
    },
  },
)

registerSW({
  immediate: true,
  onRegisteredSW(_url, value) {
    registration = value
  },
  // 【必须显式接管，否则插件会替我们直接 reload()】
  // registerType 是 'autoUpdate'，而我们没有传 onNeedReload，
  // 于是 vite-plugin-pwa 生成的 shim 在 'activated' 时自己调 window.location.reload()。
  // 后果有三个，都很实际：
  //   1. 早于 clientsClaim 完成就刷新 → 入口重新由旧 Worker 提供（正是本文件
  //      想修的那个问题）；
  //   2. 一次静默检查可能在用户打字中途把页面刷掉，输入直接丢失；
  //   3. 与下面的 controllerchange 重载路径互相竞争。
  // 接过来之后，"什么时候刷新"只剩 reloadAfterActivation 一个决定点。
  onNeedReload: () => reloadAfterActivation(),
})

function timeout(ms) {
  return new Promise((resolve) => window.setTimeout(() => resolve(null), ms))
}

function waitForWorker(worker, run) {
  if (!worker) return Promise.resolve('missing')
  // 【waiting 是安装完成但还没接管的 Worker，必须让它接手】
  // 原来没有这一步：handleState() 一进来看到 installed 就把 UI 更新好，
  // 然后一路等到 30 秒超时。而 registerType 是 autoUpdate，插件又不会替我们
  // 发 SKIP_WAITING（那条路径要等它自己的 onNeedReload，而我们把重载统一收口到
  // reloadAfterActivation 了）。结果：用户被告知"新版仍在安装，请保持页面打开"，
  // 30 秒后什么也没发生，也没有出口。
  // 显式发一次 SKIP_WAITING，配上 workbox 的 skipWaiting+clientsClaim 就会立刻接管。
  if (worker.state === 'installed') activateWaitingWorker(worker)
  return new Promise((resolve) => {
    let timer = 0
    const finish = (state) => {
      window.clearTimeout(timer)
      worker.removeEventListener('statechange', handleState)
      resolve(state)
    }
    const handleState = () => {
      if (worker.state === 'installing') {
        setUpdateStage('downloading')
        if (run.visible) {
          appUpdateProgress.setStep('check', 'completed', '已发现新版本')
          appUpdateProgress.setStep('download', 'running', '正在下载新的离线资源')
          updateActivity('发现新版本，正在下载…', run)
        }
      }
      if (worker.state === 'installed') {
        activateWaitingWorker(worker)
        setUpdateStage('ready')
        if (run.visible) {
          appUpdateProgress.setStep('download', 'completed', '新的离线资源已下载')
          appUpdateProgress.setStep('prepare', 'running', '正在准备启用新版本')
          updateActivity('新版已下载，正在准备启用…', run)
        }
      }
      if (worker.state === 'activating') {
        setUpdateStage('ready')
        if (run.visible) {
          appUpdateProgress.setStep('prepare', 'completed', '已准备就绪')
          appUpdateProgress.setStep('apply', 'running', '正在启用新的离线资源')
          updateActivity('正在应用新版本…', run)
        }
      }
      if (worker.state === 'activated') {
        // activated 不等于当前页面已经换到新控制器。之前固定等 900ms 就刷新，
        // 在 Safari/慢设备上可能早于 clientsClaim，让首页重新由旧 Worker 提供。
        // 真正的重载只由 controllerchange 触发；超过等待上限则保留旧页面并给出手动入口。
        if (run.visible && !run.hadController && !reloadScheduled) {
          requireManualReload('新版本资源已准备，请重新加载页面以完成更新')
          appUpdateProgress.setStep('apply', 'warning', '重新加载后即可使用已准备的资源')
          appUpdateProgress.finish('新版本资源已准备，可以重新加载页面', 'warning')
        } else if (run.visible && controllerTakeoverMonitor.hasController && !reloadScheduled) {
          setUpdateStage('updating', '新版已启用，正在等待页面切换…')
          appUpdateProgress.setStep('apply', 'running', '等待新版本接管当前页面')
          controllerTakeoverMonitor.waitForTakeover()
        }
        finish('activated')
      }
      if (worker.state === 'redundant') finish('redundant')
    }
    worker.addEventListener('statechange', handleState)
    timer = window.setTimeout(() => finish('timeout'), UPDATE_INSTALL_TIMEOUT)
    handleState()
  })
}

/** 让已安装待命的 Worker 立刻接管。postMessage 失败不能影响后续流程。 */
function activateWaitingWorker(worker) {
  try { worker.postMessage({ type: 'SKIP_WAITING' }) } catch { /* 不支持就退回超时提示 */ }
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
function startServerReleaseCheck() {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), RELEASE_FETCH_TIMEOUT)
  const promise = (async () => {
    try {
      const response = await fetch(`/version.txt?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) return null
      const text = (await response.text()).trim()
      return text || null
    } catch {
      return null
    } finally {
      window.clearTimeout(timer)
    }
  })()
  return {
    promise,
    cancel() {
      window.clearTimeout(timer)
      controller.abort()
    },
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
export async function forceRecoverToLatest() {
  if (canForceRecover()) {
    markForceRecover()
    setUpdateStage('downloading', '发现新版本，正在同步最新资源…')
    appUpdateProgress.setStep('download', 'running', '本地版本落后，正在强制同步')
    try {
      if (navigator.serviceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((item) => item.unregister()))
      }
      if (window.caches?.keys) {
        // 【不要连 OCR 语言模型一起删】那是 3.8MB 的中英文识别模型，
        // 缓存期一年、maxEntries 只有 4。原来的 for 循环把所有 Cache Storage
        // 一律清空，于是每次强制恢复都让用户在移动网络下重下 3.8MB，
        // 而它跟"入口资源过期"毫无关系。
        const keys = (await caches.keys()).filter((key) => !key.startsWith(PRESERVED_CACHE_PREFIXES))
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {}
    window.setTimeout(() => window.location.reload(), 400)
    return true
  }
  // 【原来这里既不 finish() 也不 fail()】
  // 于是 appUpdateProgress.state.status 永远停在 'running'：面板一直显示进度卡，
  // 15 秒后触发"这一步比预期更久"，但 canCancel / canRetry 都是 false，
  // 唯一能点的「继续等待」只是把警告消音 —— 用户除了关掉弹窗没有别的出路。
  requireManualReload('检测到新版本，请关闭应用后重新打开')
  appUpdateProgress.setStep('download', 'warning', '本地版本落后，请重启应用')
  appUpdateProgress.finish('检测到新版本，请关闭应用后重新打开后重试', 'warning')
  return false
}

// 强制恢复时**保留**的缓存前缀。识别语言模型体积大、复用期长，
// 与"应用入口过期"无关，删掉纯属让用户白下 3.8MB。
const PRESERVED_CACHE_PREFIXES = 'study-life-ocr'

function syncVisibleWorkerProgress(run) {
  const worker = run.worker || run.registration?.installing || run.registration?.waiting
  if (!worker || !run.visible || appUpdateProgress.state.status !== 'running') return
  run.worker = worker
  if (worker.state === 'installing') {
    setUpdateStage('downloading', '发现新版本，正在下载…')
    appUpdateProgress.setStep('check', 'completed', '已发现新版本')
    appUpdateProgress.setStep('download', 'running', '正在下载新的离线资源')
  } else if (worker.state === 'installed') {
    activateWaitingWorker(worker)
    setUpdateStage('ready', '新版已下载，正在准备启用…')
    appUpdateProgress.setStep('check', 'completed', '已发现新版本')
    appUpdateProgress.setStep('download', 'completed', '新的离线资源已下载')
    appUpdateProgress.setStep('prepare', 'running', '正在准备启用新版本')
  } else if (worker.state === 'activating') {
    setUpdateStage('ready', '正在应用新版本…')
    appUpdateProgress.setStep('check', 'completed', '已发现新版本')
    appUpdateProgress.setStep('download', 'completed', '新的离线资源已下载')
    appUpdateProgress.setStep('prepare', 'completed', '已准备就绪')
    appUpdateProgress.setStep('apply', 'running', '正在启用新的离线资源')
  }
}

function showUnavailableResult(run, message) {
  if (!run.visible) return
  setUpdateStage('warning', message)
  lastCheckOutcome.value = message
  appUpdateProgress.setStep('check', 'warning', message)
  appUpdateProgress.finish(message, 'warning')
}

function showLatestReleaseResult(run) {
  if (!run.visible || updateStage.value !== 'checking') return
  setUpdateStage('latest', '已是最新版本')
  lastCheckOutcome.value = '已是最新版本'
  appUpdateProgress.setStep('check', 'completed', '当前已是最新版本')
  appUpdateProgress.finish('检查完成，当前已是最新版本')
  window.setTimeout(() => {
    if (updateStage.value === 'latest') { updateMessage.value = ''; updateStage.value = 'idle' }
  }, 3000)
}

async function performAppUpdateCheck(run, now) {
  let releaseCheck = null
  let serverRelease = null
  let serverReleaseChecked = false
  let workerPromise = null
  let foundWorker = null
  let resolveFound = () => {}
  const updateFound = new Promise((resolve) => { resolveFound = resolve })
  let handleUpdateFound = null
  let checkTimer = 0
  const checkTimeoutError = new Error('update-check-timeout')
  try {
    if (!navigator.onLine) {
      showUnavailableResult(run, '当前没有网络，暂时无法检查更新')
      return false
    }

    // 获取注册信息时就核对版本，两个网络等待不用相加。
    releaseCheck = startServerReleaseCheck()
    const checkDeadline = new Promise((_, reject) => {
      checkTimer = window.setTimeout(() => reject(checkTimeoutError), UPDATE_CHECK_TIMEOUT)
    })
    const activeRegistration = await Promise.race([resolveRegistration(), checkDeadline])
    run.registration = activeRegistration
    if (!activeRegistration) {
      showUnavailableResult(run, '更新服务正在准备，请稍后再试')
      return false
    }

    // 首次打开的 Worker 在安装离线缓存，不代表页面版本落后。
    // 版本号一致时直接结束检查，离线资源继续在后台准备。
    if (!run.hadController && !activeRegistration.active) {
      const initialRelease = await Promise.race([releaseCheck.promise, checkDeadline])
      if (initialRelease === APP_RELEASE) {
        showLatestReleaseResult(run)
        return true
      }
    }

    handleUpdateFound = () => {
      const worker = activeRegistration.installing || activeRegistration.waiting
      if (!worker || foundWorker) return
      releaseCheck?.cancel()
      foundWorker = worker
      run.worker = foundWorker
      setUpdateStage('downloading', '发现新版本，正在下载…')
      workerPromise = waitForWorker(foundWorker, run)
      resolveFound(foundWorker)
    }
    activeRegistration.addEventListener('updatefound', handleUpdateFound)
    lastSilentCheckAt = now
    if (activeRegistration.installing || activeRegistration.waiting) {
      // 已有新版在下载或待启用，直接接入进度，不再重复检查。
      handleUpdateFound()
    } else {
      // updatefound 可先于 update() 完成；发现新版就继续安装，避免多等一次请求。
      await Promise.race([activeRegistration.update(), updateFound, checkDeadline])
    }
    window.clearTimeout(checkTimer)

    // version.txt 是无缓存的发布版本真值。能读到它时可直接区分「已是最新」与
    // 「Worker 检查漏报」；不必再固定等 Safari 的 updatefound 宽限窗口。
    // 版本请求失败时仍保留完整宽限时间，照顾 Safari 的延迟事件。
    if (!foundWorker && !activeRegistration.installing && !activeRegistration.waiting && releaseCheck) {
      serverRelease = await Promise.race([releaseCheck.promise, updateFound.then(() => null)])
      if (!foundWorker && !activeRegistration.installing && !activeRegistration.waiting && serverRelease) {
        serverReleaseChecked = true
        if (serverRelease === APP_RELEASE) {
          showLatestReleaseResult(run)
          return true
        }
        const recovered = await forceRecoverToLatest()
        lastCheckOutcome.value = '检测到新版本'
        return recovered
      }
    }

    // Safari 的 update() 可能先返回，随后才触发 updatefound；短暂等待，避免误报“最新”。
    if (!foundWorker && !activeRegistration.installing && !activeRegistration.waiting) {
      await Promise.race([updateFound, timeout(UPDATE_FOUND_GRACE)])
    }

    const worker = foundWorker || activeRegistration.installing || activeRegistration.waiting
    if (worker) {
      run.worker = worker
      if (run.visible) appUpdateProgress.setStep('check', 'completed', '已发现新版本')
      const result = await (workerPromise || waitForWorker(worker, run))
      if (result === 'redundant') {
        if (run.visible) {
          setUpdateStage('error', '新版安装失败，请再试一次')
          lastCheckOutcome.value = '新版安装失败'
          appUpdateProgress.fail('download', '新版本下载或安装失败，请重试')
        }
        return false
      }
      if (result === 'timeout') {
        // 【原来只 setStep，没有 finish】状态停在 'running'：进度卡一直转，
        // 没有重试、没有取消。若新 Worker 装好了却迟迟不接管，用户就卡在这里。
        // 收成 warning 终态，并明确告诉用户可以先继续用 —— 反正下一次
        // 检查或手动重载还会再走一遍。
        setUpdateStage('warning', '新版仍在安装，请保持页面打开')
        if (run.visible) {
          lastCheckOutcome.value = '新版仍在安装中'
          appUpdateProgress.setStep('download', 'warning', '下载仍在继续，暂时没有新的状态事件')
          appUpdateProgress.finish('新版仍在安装，请保持页面打开；也可以先继续使用', 'warning')
        }
        return true
      }
      // else result === 'activated'，会自动重新打开，不需要额外提示
      return true
    }

    // SW 报告没有新版本时，读取与 Worker 检查并行发出的版本号：若本地页面版本
    // 落后，说明 sw.js 检查被缓存或跳过，直接强制同步，绝不误报“已是最新版本”。
    if (!foundWorker && !activeRegistration.installing && !activeRegistration.waiting) {
      if (!serverReleaseChecked) {
        releaseCheck ||= startServerReleaseCheck()
        serverRelease = await releaseCheck.promise
      }
      if (!serverRelease) {
        // version.txt 拉取失败（断网、CDN 抖动等）时不能断言“已是最新版本”。
        showUnavailableResult(run, '暂时无法确认服务器版本，请稍后再试')
        return false
      } else if (serverRelease !== APP_RELEASE) {
        const recovered = await forceRecoverToLatest()
        lastCheckOutcome.value = '检测到新版本'
        return recovered
      } else if (updateStage.value === 'checking') {
        // "已是最新版本"只保留 3 秒就自动消失，于是"版本与更新"面板在
        // 用户打开时已经什么都不剩，看起来像"这个功能没反应"。
        // 结果另存一份，面板里长期显示"上次检查"（见 AppUpdateSection）。
        showLatestReleaseResult(run)
      }
    }
    return true
  } catch (error) {
    if (error === checkTimeoutError) {
      showUnavailableResult(run, '更新服务响应较慢，请稍后重试')
      return false
    }
    if (run.visible) {
      setUpdateStage('error', '检查失败，请确认网络后重试')
      lastCheckOutcome.value = '检查失败'
      appUpdateProgress.fail('check', '检查更新失败，请确认网络后重试')
    }
    return false
  } finally {
    window.clearTimeout(checkTimer)
    releaseCheck?.cancel()
    if (handleUpdateFound && run.registration) run.registration.removeEventListener('updatefound', handleUpdateFound)
    if (updateInFlight === run) updateInFlight = null
    updateChecking.value = false
    lastCheckedAt.value = now
  }
}

export function checkForAppUpdate(showResult = true) {
  const now = Date.now()
  if (!showResult && now - lastSilentCheckAt < SILENT_CHECK_INTERVAL) return Promise.resolve(false)
  // 每次新的检查都从干净状态开始：上一轮的 manual-reload / error 若不清掉，
  // 面板会一直挂着上一轮的出口按钮和语气色。
  needsManualReload.value = false
  if (updateInFlight) {
    if (showResult) {
      const promote = !updateInFlight.visible
      updateInFlight.visible = true
      updateChecking.value = true
      if (promote) startVisibleUpdateProgress(true)
      setUpdateStage('checking', '正在检查新版本…')
      syncVisibleWorkerProgress(updateInFlight)
    }
    return updateInFlight.promise
  }

  const run = { visible: Boolean(showResult), promise: null, registration: null, worker: null,
    hadController: Boolean(navigator.serviceWorker?.controller) }
  updateInFlight = run
  // 仅把用户主动检查显示为按钮忙碌态；静默检查保留按钮，让用户可以点按并提升为可见检查。
  updateChecking.value = run.visible
  if (run.visible) {
    startVisibleUpdateProgress(true)
    setUpdateStage('checking', '正在检查新版本…')
  }
  run.promise = performAppUpdateCheck(run, now)
  return run.promise
}

// Service Worker 的 update() 没有可安全终止的浏览器 API，因此不提供假“取消”。
// 重试会重新执行真实的更新检查；已缓存的资源由浏览器复用。
export function retryAppUpdate() {
  return checkForAppUpdate(true)
}

export function reloadAppToApplyUpdate() {
  window.location.reload()
}

function silentCheck() {
  void checkForAppUpdate(false)
}

window.addEventListener('focus', silentCheck)
window.addEventListener('online', silentCheck)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') silentCheck()
})
// 应用打开后尽快做一次静默更新检查（2 秒），不等 30 秒；命中即触发 SW 更新+刷新，
// 避免手机 PWA 打开后长时间停留在旧版本、懒加载分包 hash 错位导致入口打不开。
window.setTimeout(silentCheck, 2000)
window.setInterval(silentCheck, 30 * 60 * 1000)
