import { reactive } from 'vue'
import { compareRelease, safeUpdateError, updateError } from './updateProtocol.js'

export const WEB_UPDATE_STAGES = Object.freeze(['idle', 'checking', 'latest', 'available', 'downloading',
  'ready', 'installing', 'verifying', 'manual-reload', 'completed', 'warning', 'error'])
export const PENDING_WEB_UPDATE_KEY = 'study_life_pending_update_v1'

export function createWebUpdateController({ currentVersion, navigatorRef = navigator, windowRef = window,
  fetchFn = (...args) => fetch(...args), storage, now = () => Date.now(),
  reload = () => windowRef.location.reload(), progress = null, checkTimeoutMs = 8000,
  downloadTimeoutMs = 30000, takeoverTimeoutMs = 6000 } = {}) {
  const state = reactive({ stage: 'idle', currentVersion, availableVersion: '', message: '',
    lastCheckedAt: 0, lastAttemptAt: 0, lastCheckOutcome: '', startedAt: 0, finishedAt: 0,
    phaseStartedAt: 0, taskId: 0, revision: 0, taskPending: false, error: null,
    percent: null, timings: [], log: [] })
  let registration = null
  let registrationListener = null
  let registrationPromise = null
  const invalidRegistrations = new WeakSet()
  let registrationInvalidated = false
  let swCheckPromise = null
  let checkPromise = null
  let applyPromise = null
  let generation = 0
  let lastSilentCheckAt = 0
  let observedWorker = null
  let workerListener = null
  let workerPromise = null
  let resolveWorker = null
  let downloadTimer = 0
  let reloadTimer = 0
  let takeoverTimer = 0
  let applying = false
  let disposed = false
  let notifyWorkerFound = () => {}

  function log(code) {
    if (disposed) return
    state.log.push({ at: now(), stage: state.stage, code })
    state.log = state.log.slice(-40)
  }
  function transition(stage, message, patch = {}) {
    if (disposed) return
    if (state.stage !== stage) {
      if (state.phaseStartedAt && ['checking', 'downloading', 'installing', 'verifying'].includes(state.stage))
        state.timings.push({ stage: state.stage, durationMs: Math.max(0, now() - state.phaseStartedAt) })
      state.timings = state.timings.slice(-24)
      state.phaseStartedAt = now()
      state.stage = stage
      log('STAGE_CHANGED')
    }
    Object.assign(state, { message, revision: state.revision + 1 }, patch)
    if (!state.taskPending) state.finishedAt = now()
    if (progress?.state.status === 'running') {
      const step = { checking: 'check', downloading: 'download', ready: 'prepare', installing: 'apply', verifying: 'apply' }[stage]
      if (step) progress.setStep(step, 'running', message)
      else if (stage === 'error' || stage === 'warning') progress.fail(null, message)
      else progress.finish(message, stage === 'manual-reload' ? 'warning' : 'completed')
      if (stage === 'ready') progress.finish(message, 'warning')
    }
  }
  function fail(error, taskPending = false) {
    const safe = safeUpdateError(error)
    transition(['OFFLINE', 'OTHER_TASK'].includes(safe.code) ? 'warning' : 'error', safe.message, { error: safe, taskPending })
    log(safe.code)
    return false
  }
  function begin() {
    windowRef.clearTimeout(reloadTimer)
    windowRef.clearTimeout(takeoverTimer)
    applying = false
    generation += 1
    Object.assign(state, { taskId: state.taskId + 1, startedAt: now(), finishedAt: 0, error: null, timings: [], log: [] })
    progress?.start({ title: '应用更新', steps: [
      { id: 'check', label: '检查版本' }, { id: 'download', label: '下载资源' },
      { id: 'prepare', label: '准备启用' }, { id: 'apply', label: '验证实际版本' },
    ] })
    return generation
  }
  function bounded(promise, ms, code = 'TIMEOUT', action = 'check') {
    let timer
    return Promise.race([promise, new Promise((_, reject) => {
      timer = windowRef.setTimeout(() => reject(updateError(code, '更新服务响应超时，请稍后重试。', action)), ms)
    })]).finally(() => windowRef.clearTimeout(timer))
  }
  async function requestText(path, ms) {
    const abort = new AbortController()
    try {
      return await bounded((async () => {
        const response = await fetchFn(`${path}?update=${now()}`, { cache: 'no-store', signal: abort.signal })
        if (!response.ok) throw updateError('SOURCE_HTTP', '更新资源暂不可用，请稍后重试。')
        return (await response.text()).trim()
      })(), ms)
    } finally { abort.abort() }
  }
  async function readRelease() {
    const start = now()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const release = await requestText('/version.txt', Math.min(3800, Math.max(1, checkTimeoutMs - (now() - start))))
        if (compareRelease(release, currentVersion) === null) throw updateError('SOURCE_INVALID', '服务器版本信息格式异常，请稍后重试。')
        log('VERSION_RECEIVED')
        return release
      } catch (error) {
        if (attempt || !['TIMEOUT', 'NETWORK'].includes(safeUpdateError(error).code)) throw error
        log('NETWORK_RETRY')
        await new Promise((resolve) => windowRef.setTimeout(resolve, 250))
      }
    }
  }
  async function originLock(action) {
    if (!navigatorRef.locks?.request) return action()
    return navigatorRef.locks.request('study-life-app-update', { ifAvailable: true }, (lock) => {
      if (!lock) throw updateError('OTHER_TASK', '另一个窗口正在处理更新，请稍后重试。')
      return action()
    })
  }
  function workerTimedOut() {
    resolveWorker?.('timeout')
    fail(updateError('SW_TIMEOUT', '资源下载仍未结束。可以继续使用应用，或继续等待下载。', 'wait'), true)
  }
  function observeWorker(worker) {
    if (!worker || disposed) return null
    // An initial offline-cache install is not an application upgrade.
    if (!navigatorRef.serviceWorker?.controller && !registration?.active && !state.availableVersion) return null
    if (observedWorker === worker) return workerPromise
    if (!checkPromise && !applyPromise && !state.taskPending) begin()
    if (observedWorker && workerListener) observedWorker.removeEventListener('statechange', workerListener)
    windowRef.clearTimeout(downloadTimer)
    observedWorker = worker
    workerPromise = new Promise((resolve) => { resolveWorker = resolve })
    workerListener = () => {
      if (disposed || observedWorker !== worker) return
      if (worker.state === 'installing') {
        transition('downloading', '正在下载新的离线资源，浏览器未提供可计算的下载大小。', { taskPending: true, error: null })
      } else if (worker.state === 'installed') {
        windowRef.clearTimeout(downloadTimer)
        transition('ready', '新版离线资源已准备，重新加载后启用。', { taskPending: false, error: null })
        resolveWorker?.('installed')
      } else if (worker.state === 'activating') {
        transition('installing', '正在启用新资源，等待浏览器切换控制权。', { taskPending: true })
      } else if (worker.state === 'activated') {
        windowRef.clearTimeout(downloadTimer)
        if (!applying) transition('manual-reload', '新资源已启用，请重新加载以验证应用版本。', { taskPending: false })
        resolveWorker?.('activated')
      } else if (worker.state === 'redundant') {
        windowRef.clearTimeout(downloadTimer)
        fail(updateError('SW_DOWNLOAD', '新资源下载或安装失败，当前版本仍可使用，请重试。'))
        resolveWorker?.('redundant')
      }
    }
    worker.addEventListener('statechange', workerListener)
    downloadTimer = windowRef.setTimeout(workerTimedOut, downloadTimeoutMs)
    workerListener()
    notifyWorkerFound(worker)
    return workerPromise
  }
  function observeRegistration(value) {
    if (!value || disposed || invalidRegistrations.has(value)) return
    registrationInvalidated = false
    if (registration !== value) {
      registration?.removeEventListener('updatefound', registrationListener)
      registration = value
      registrationListener = () => observeWorker(registration.installing || registration.waiting)
      registration.addEventListener('updatefound', registrationListener)
    }
    observeWorker(registration.installing || registration.waiting)
  }
  function getRegistration() {
    if (registration) return Promise.resolve(registration)
    if (!navigatorRef.serviceWorker) return Promise.resolve(null)
    if (!registrationPromise) registrationPromise = bounded(
      Promise.resolve(navigatorRef.serviceWorker.getRegistration?.()).then((value) => value ||
        (!registrationInvalidated && navigatorRef.serviceWorker.ready ? bounded(navigatorRef.serviceWorker.ready, 3500).catch(() => null) : null)),
      3500).catch(() => null).then((value) => {
        registrationPromise = null
        if (value && invalidRegistrations.has(value)) return null
        if (value) observeRegistration(value)
        return value
      })
    return registrationPromise
  }
  function updateWorker(value) {
    if (!value || value.installing || value.waiting) return Promise.resolve()
    if (!swCheckPromise) {
      swCheckPromise = Promise.resolve().then(() => value.update()).finally(() => { swCheckPromise = null })
      // update() cannot be aborted. Retain its identity until it settles.
      swCheckPromise.catch(() => { log('SW_CHECK_ERROR') })
    }
    return swCheckPromise
  }
  async function performCheck(id) {
    if (navigatorRef.onLine === false) return fail(updateError('OFFLINE', '当前没有网络，联网后可以重新检查。'))
    state.lastAttemptAt = now()
    transition('checking', '正在核对发布版本…', { taskPending: true })
    let deadline
    const found = new Promise((resolve) => { notifyWorkerFound = (worker) => resolve({ kind: 'worker', worker }) })
    const release = readRelease().then((version) => ({ kind: 'release', version }), (error) => ({ kind: 'release-error', error }))
    // Subscribe before awaiting metadata. Neither response blocks the other.
    const registered = getRegistration().then((value) => {
      if (value && !value.installing && !value.waiting) void updateWorker(value).catch(() => {})
      return value
    })
    try {
      const timeout = new Promise((resolve) => {
        deadline = windowRef.setTimeout(() => resolve({ kind: 'timeout' }), checkTimeoutMs)
      })
      let result = await Promise.race([found, release, timeout])
      if (disposed || id !== generation) return false
      if (result.kind === 'release-error') {
        const value = await registered
        if (!value) return fail(result.error)
        const error = result.error
        // Safari may emit updatefound after update() resolves.
        const updated = updateWorker(value).then(() => new Promise((resolve) => {
          windowRef.setTimeout(() => resolve({ kind: 'release-error', error }), 800)
        }), () => ({ kind: 'release-error', error }))
        result = await Promise.race([found, updated, timeout])
      }
      if (result.kind === 'worker') {
        const outcome = await observeWorker(result.worker)
        if (id !== generation || disposed) return false
        if (outcome === 'redundant' || outcome === 'timeout') return false
        state.lastCheckedAt = now()
        state.lastCheckOutcome = '新版本资源已准备'
        return true
      }
      if (result.kind === 'timeout') return fail(updateError('TIMEOUT', '更新服务响应较慢，请稍后重试。'))
      if (result.kind === 'release-error') return fail(result.error)
      const comparison = compareRelease(result.version, currentVersion)
      state.lastCheckedAt = now()
      if (comparison < 0) return fail(updateError('SOURCE_ROLLBACK', '服务器发布版本早于当前版本，已保留当前应用。'))
      if (comparison > 0) state.availableVersion = result.version
      if (['downloading', 'ready', 'installing', 'error'].includes(state.stage)) return state.stage !== 'error'
      state.lastCheckOutcome = comparison === 0 ? '已是最新版本' : '检测到新版本'
      transition(comparison === 0 ? 'latest' : 'available', comparison === 0 ? '已是最新版本' : `发现新版本 ${result.version}。`,
        { availableVersion: comparison === 0 ? '' : result.version, taskPending: false, error: null })
      return true
    } finally {
      windowRef.clearTimeout(deadline)
      notifyWorkerFound = () => {}
    }
  }
  function check(showResult = true) {
    if (disposed) return Promise.resolve(false)
    if (checkPromise) return checkPromise
    if (applyPromise || state.taskPending || ['ready', 'manual-reload'].includes(state.stage)) return Promise.resolve(false)
    if (!showResult && state.error?.code === 'VERSION_VERIFY') return Promise.resolve(false)
    if (!showResult && lastSilentCheckAt && now() - lastSilentCheckAt < 600000) return Promise.resolve(false)
    lastSilentCheckAt = now()
    const id = begin()
    checkPromise = originLock(() => performCheck(id)).catch((error) => fail(error)).finally(() => { checkPromise = null })
    return checkPromise
  }
  function savePending(version) {
    const pending = { fromVersion: currentVersion, toVersion: version, startedAt: state.startedAt, savedAt: now(), timings: [...state.timings] }
    try { storage.setItem(PENDING_WEB_UPDATE_KEY, JSON.stringify(pending)) }
    catch { throw updateError('STORAGE', '无法记录更新验证状态，请允许会话存储后重试。', 'apply') }
  }
  function scheduleReload() {
    if (disposed || state.stage === 'verifying') return
    windowRef.clearTimeout(takeoverTimer)
    transition('verifying', '新资源已启用，重新加载后核对实际运行版本…', { taskPending: true })
    const id = generation
    windowRef.clearTimeout(reloadTimer)
    reloadTimer = windowRef.setTimeout(() => {
      if (disposed || id !== generation || state.stage !== 'verifying') return
      applying = false
      transition('manual-reload', '浏览器尚未重新加载，请点击重新加载完成验证。', { taskPending: false })
    }, takeoverTimeoutMs)
    try { reload() } catch {
      windowRef.clearTimeout(reloadTimer)
      applying = false
      fail(updateError('RELOAD_TIMEOUT', '自动重新加载失败，请手动重新加载。', 'apply'))
    }
  }
  const takeover = () => {
    if (!applying || !navigatorRef.serviceWorker?.controller) return
    if (observedWorker && navigatorRef.serviceWorker.controller !== observedWorker) return
    scheduleReload()
  }
  navigatorRef.serviceWorker?.addEventListener('controllerchange', takeover)
  async function preflightEntry(version) {
    transition('downloading', '正在获取并核对新版本入口…', { taskPending: true })
    const html = await requestText('/index.html', checkTimeoutMs)
    const document = new DOMParser().parseFromString(html, 'text/html')
    if (document.querySelector('meta[name="study-life-release"]')?.getAttribute('content') !== version)
      throw updateError('SOURCE_INVALID', '发布版本与入口资源不一致，请稍后重试。')
    log('ENTRY_VERIFIED')
  }
  function deferRecoveryForWorker(value) {
    const worker = value?.installing || [value?.waiting, value?.active].find((item) => item?.state === 'activating')
    if (!worker) return false
    // The browser may still be installing after another window's UI timeout.
    observeWorker(worker)
    if (worker.state === 'installing') void continueDownload()
    log('SW_RECOVERY_DEFERRED')
    return true
  }
  async function performApply(repair, manualReload) {
    if (navigatorRef.onLine === false) return fail(updateError('OFFLINE', '当前没有网络，联网后再应用更新。', 'apply'))
    const version = await readRelease()
    if (compareRelease(version, currentVersion) < 0) throw updateError('SOURCE_ROLLBACK', '服务器版本较旧，已保留当前应用。')
    if (!repair && state.availableVersion && state.availableVersion !== version && observedWorker)
      throw updateError('SOURCE_CHANGED', '发布版本在下载后发生变化，请重新获取资源后再应用。', 'repair')
    state.availableVersion = version
    const value = await getRegistration()
    if (repair || manualReload || !value) {
      if (deferRecoveryForWorker(value)) return false
      await preflightEntry(version)
      if (deferRecoveryForWorker(value)) return false
      savePending(version)
      if (repair) {
        transition('installing', '正在重建当前应用的离线资源缓存…', { taskPending: true })
        if (value) {
          // false also means it was already unregistered: recovery is idempotent.
          await bounded(value.unregister(), checkTimeoutMs, 'CACHE_REPAIR', 'repair')
          invalidRegistrations.add(value)
          registrationInvalidated = true
          value.removeEventListener('updatefound', registrationListener)
          registration = null
          registrationPromise = null
          observedWorker?.removeEventListener('statechange', workerListener)
          windowRef.clearTimeout(downloadTimer)
          resolveWorker?.('unregistered')
          observedWorker = null
          workerPromise = null
        }
        const cacheStorage = windowRef.caches
        if (cacheStorage?.keys) {
          const keys = await bounded(cacheStorage.keys(), checkTimeoutMs, 'CACHE_REPAIR', 'repair')
          const appKeys = keys.filter((key) => key === 'study-life-lazy-assets' ||
            (key.startsWith('workbox-precache-') && value?.scope && key.endsWith(value.scope)))
          const deleted = await bounded(Promise.all(appKeys.map((key) => cacheStorage.delete(key))), checkTimeoutMs, 'CACHE_REPAIR', 'repair')
          if (deleted.some((ok) => !ok)) throw updateError('CACHE_REPAIR', '部分离线缓存无法重建，请关闭应用后重试。', 'repair')
        }
      }
      applying = true
      scheduleReload()
      return true
    }
    if (!value.installing && !value.waiting) await bounded(updateWorker(value), checkTimeoutMs, 'SW_NO_UPDATE', 'repair')
    const worker = value.waiting || value.installing || observedWorker
    if (!worker || worker.state === 'redundant') throw updateError('SW_NO_UPDATE', '新版本离线资源尚未就绪，请稍后重试或修复更新缓存。', 'repair')
    if (worker.state === 'installing') {
      const outcome = await observeWorker(worker)
      if (outcome === 'redundant' || outcome === 'timeout') return false
    }
    savePending(version)
    applying = true
    transition('installing', '正在启用新版本资源…', { taskPending: true, error: null })
    if (worker.state === 'activated') { scheduleReload(); return true }
    const id = generation
    takeoverTimer = windowRef.setTimeout(() => {
      if (disposed || id !== generation || !applying) return
      applying = false
      transition('manual-reload', '新资源已准备，浏览器未切换控制权，请重新加载完成验证。', { taskPending: false })
    }, takeoverTimeoutMs)
    try { worker.postMessage({ type: 'SKIP_WAITING' }) }
    catch { throw updateError('SW_ACTIVATION', '浏览器无法启用新资源，请关闭应用后重新打开。', 'apply') }
    return true
  }
  function apply(repair = false) {
    if (disposed) return Promise.resolve(false)
    if (applyPromise) return applyPromise
    if (checkPromise || state.taskPending) return Promise.resolve(false)
    const manualReload = state.stage === 'manual-reload' || state.error?.code === 'RELOAD_TIMEOUT'
    begin()
    transition('checking', repair ? '正在检查缓存恢复条件…' : '正在确认待应用版本…', { taskPending: true })
    applyPromise = originLock(() => performApply(repair, manualReload)).catch((error) => {
      applying = false
      windowRef.clearTimeout(takeoverTimer)
      windowRef.clearTimeout(reloadTimer)
      return fail(error)
    }).finally(() => { applyPromise = null })
    return applyPromise
  }
  function continueDownload() {
    if (observedWorker?.state !== 'installing') return check()
    windowRef.clearTimeout(downloadTimer)
    transition('downloading', '继续等待浏览器下载离线资源…', { taskPending: true, error: null })
    downloadTimer = windowRef.setTimeout(workerTimedOut, downloadTimeoutMs)
    return Promise.resolve(true)
  }
  function resourceFailed() {
    log('RESOURCE_LOAD_FAILED')
    if (state.taskPending || ['ready', 'manual-reload'].includes(state.stage)) return false
    return fail(updateError('SW_DOWNLOAD', '部分应用资源未能加载，当前页面仍可使用。请在版本与更新中修复缓存。', 'repair'))
  }
  function verifyPending() {
    try {
      const saved = JSON.parse(storage.getItem(PENDING_WEB_UPDATE_KEY) || 'null')
      if (!saved || typeof saved.toVersion !== 'string' || !Number.isFinite(Number(saved.savedAt)) || now() - Number(saved.savedAt) > 86400000) return
      storage.removeItem(PENDING_WEB_UPDATE_KEY)
      if (compareRelease(saved.toVersion, currentVersion) === null) return
      if (compareRelease(currentVersion, saved.toVersion) >= 0) {
        transition('completed', `更新成功，已验证运行版本 ${currentVersion}。`, { availableVersion: '', taskPending: false })
        log('RUNNING_VERSION_VERIFIED')
        lastSilentCheckAt = now()
      } else fail(updateError('VERSION_VERIFY', '重新加载后仍在运行旧版本。当前数据已保留，请修复更新缓存。', 'repair'))
    } catch { fail(updateError('STORAGE', '无法读取更新验证记录，可以重新检查版本。')) }
  }
  try { if (storage === undefined) storage = windowRef.sessionStorage }
  catch { storage = null }
  if (storage) verifyPending()
  else fail(updateError('STORAGE', '无法记录更新验证状态，请允许会话存储后重试。'))
  return { state, check, apply, observeRegistration, continueDownload, resourceFailed,
    dispose() {
      disposed = true
      windowRef.clearTimeout(downloadTimer)
      windowRef.clearTimeout(takeoverTimer)
      windowRef.clearTimeout(reloadTimer)
      registration?.removeEventListener('updatefound', registrationListener)
      observedWorker?.removeEventListener('statechange', workerListener)
      navigatorRef.serviceWorker?.removeEventListener('controllerchange', takeover)
      progress?.dispose()
    } }
}
