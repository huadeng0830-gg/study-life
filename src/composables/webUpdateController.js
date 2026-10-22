import { reactive } from 'vue'
import { collectReleaseChanges, compareRelease, safeUpdateError, updateError,
  validateReleaseHistory, validateReleaseManifest } from './updateProtocol.js'

export const PENDING_WEB_UPDATE_KEY = 'study_life_pending_update_v1'

/** @param {any} [options] */
export function createWebUpdateController({ currentVersion, currentSourceSignature = '', currentBuildId = 'development',
  legacyCurrentVersion = '', channel = 'stable', navigatorRef = navigator, windowRef = window,
  fetchFn = (input, init) => fetch(input, init), storage, now = () => Date.now(),
  reload = () => windowRef.location.reload(), progress = null, checkTimeoutMs = 8000,
  downloadTimeoutMs = 30000, takeoverTimeoutMs = 6000, beforeReload = null } = {}) {
  /** @type {any} */
  const state = reactive({ stage: 'idle', currentVersion, currentBuildId, availableVersion: '', message: '', releaseManifest: null, updateReleases: [],
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
  /** @type {(worker: ServiceWorker) => void} */
  let notifyWorkerFound = () => {}
  let workerUpdateAllowed = false
  const BroadcastChannelCtor = windowRef.BroadcastChannel || globalThis.BroadcastChannel
  let updateChannel = null
  let peerReloadPending = false
  const tabId = `${now()}-${Math.random().toString(36).slice(2, 10)}`
  try {
    if (typeof BroadcastChannelCtor === 'function') {
      updateChannel = new BroadcastChannelCtor('study-life-update-coordination-v1')
      updateChannel.addEventListener('message', (event) => {
        const data = event?.data
        if (!data || typeof data !== 'object' || data.sender === tabId) return
        if (data.type === 'apply-notice') onPeerApplyNotice(typeof data.version === 'string' ? data.version : '')
      })
    }
  } catch { updateChannel = null }

  function log(code) {
    if (disposed) return
    state.log.push({ at: now(), stage: state.stage, code })
    state.log = state.log.slice(-40)
  }
  function transition(stage, message, patch = {}, { silentProgress = false } = {}) {
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
    if (!silentProgress && progress?.state.status === 'running') {
      const step = { checking: 'check', downloading: 'download', ready: 'prepare', installing: 'apply', verifying: 'apply' }[stage]
      if (step) progress.setStep(step, 'running', message)
      else if (stage === 'error' || stage === 'warning') progress.fail(null, message)
      else progress.finish(message, stage === 'manual-reload' ? 'warning' : 'completed')
      if (stage === 'ready') progress.finish(message, 'warning')
    }
  }
  function fail(error, taskPending = false) {
    const safe = safeUpdateError(error)
    if (['SOURCE_INVALID', 'SOURCE_CHANGED', 'SOURCE_ROLLBACK', 'VERSION_VERIFY'].includes(safe.code)) workerUpdateAllowed = false
    transition(['OFFLINE', 'OTHER_TASK', 'SW_TIMEOUT'].includes(safe.code) ? 'warning' : 'error', safe.message, { error: safe, taskPending })
    log(safe.code)
    return false
  }
  function begin() {
    const previouslyVerifiedRelease = Boolean(state.releaseManifest && state.availableVersion === state.releaseManifest.version)
    windowRef.clearTimeout(reloadTimer)
    windowRef.clearTimeout(takeoverTimer)
    applying = false
    workerUpdateAllowed = previouslyVerifiedRelease
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
  async function requestJson(path, ms) {
    const text = await requestText(path, ms)
    try { return JSON.parse(text) }
    catch { throw updateError('SOURCE_INVALID', '发布信息格式无效，请稍后重试。') }
  }
  async function readRelease() {
    const start = now()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await requestJson('/release.json', Math.min(3800, Math.max(1, checkTimeoutMs - (now() - start))))
        const manifest = validateReleaseManifest(raw, { channel })
        if (!manifest) throw updateError('SOURCE_INVALID', '服务器版本信息格式异常，请稍后重试。')
        if (manifest.version === currentVersion && currentSourceSignature && manifest.sourceSignature !== currentSourceSignature)
          throw updateError('SOURCE_CHANGED', '同一正式版本的构建内容不一致，已阻止刷新。请等待维护者发布修正版。')
        log('VERSION_RECEIVED')
        return manifest
      } catch (error) {
        if (attempt || !['TIMEOUT', 'NETWORK'].includes(safeUpdateError(error).code)) throw error
        log('NETWORK_RETRY')
        await new Promise((resolve) => windowRef.setTimeout(resolve, 250))
      }
    }
    throw updateError('SOURCE_INVALID', '无法读取可信发布信息，请稍后重试。')
  }
  async function readReleaseHistory() {
    try {
      const raw = await requestJson('/release-history.json', Math.min(3500, checkTimeoutMs))
      const history = validateReleaseHistory(raw, { channel })
      if (!history) throw updateError('SOURCE_INVALID', '版本历史格式无效。')
      return history
    } catch {
      log('HISTORY_UNAVAILABLE')
      return []
    }
  }
  async function originLock(action) {
    if (!navigatorRef.locks?.request) return action()
    return navigatorRef.locks.request('study-life-app-update', { ifAvailable: true }, (lock) => {
      if (!lock) throw updateError('OTHER_TASK', '另一个窗口正在处理更新，请稍后重试。')
      return action()
    })
  }
  /**
   * 把「本页要应用更新」告诉其他标签页。
   *
   * 【为什么不再阻止更新】旧实现在这里探测到任何一个同伴就 throw OTHER_TASK，
   * 要求用户「先保存并关闭其他窗口，再应用更新」。结果是：只要浏览器里还开着
   * 第二个标签页，应用内更新就永远点不动，用户只剩「全部退出再进来」一条路 ——
   * 这正是长期抱怨的来源。
   *
   * 新规则：本页继续应用，同时通知同伴先落盘再刷新。这比阻止更安全：
   * skipWaiting 之后新 Worker 会 clientsClaim 接管**所有**标签页，旧分包 URL
   * 随即失效，留在旧页面上的同伴只会撞上「部分资源加载失败」，并不能保住数据。
   */
  function announceApplyToPeers(version) {
    if (!updateChannel) return
    try {
      updateChannel.postMessage({ type: 'apply-notice', version: typeof version === 'string' ? version : '', sender: tabId })
    } catch { log('PEER_NOTICE_FAILED') }
  }
  function beforeReloadResult() {
    try {
      const result = beforeReload?.()
      if (result && typeof result === 'object' && 'ok' in result) return result.ok === true
      return result !== false
    } catch { return false }
  }
  function pauseForUnsavedChanges() {
    applying = false
    transition('manual-reload', '本页修改尚未成功保存，已暂停刷新。请先处理保存提示，再手动完成更新。', { taskPending: false })
    log('RELOAD_BLOCKED_UNSAVED')
  }
  function peerReload() {
    if (disposed) return
    if (!beforeReloadResult()) {
      peerReloadPending = true
      pauseForUnsavedChanges()
      return
    }
    peerReloadPending = false
    try { reload() } catch {
      transition('manual-reload', '新版本已启用，请手动重新加载本页。', { taskPending: false })
    }
  }
  function retryPeerReloadAfterSave() {
    if (peerReloadPending) peerReload()
  }
  function onPeerApplyNotice(version) {
    if (disposed || applying) return
    log('PEER_APPLY_NOTICE')
    transition('manual-reload', `另一个标签页正在应用更新${version ? `（${version}）` : ''}，本页保存后会一起刷新。`,
      { taskPending: false, availableVersion: version || state.availableVersion })
    peerReload()
  }
  function workerTimedOut() {
    // A background download timer must never overwrite a later trust failure.
    if (state.stage === 'error' && state.error && !['TIMEOUT', 'NETWORK', 'SW_TIMEOUT'].includes(state.error.code)) return
    resolveWorker?.('timeout')
    fail(updateError('SW_TIMEOUT', '资源下载仍未结束。可以继续使用应用，或继续等待下载。', 'wait'), true)
  }
  function observeWorker(worker) {
    if (!worker || disposed) return null
    if (!checkPromise && !applyPromise && state.stage === 'error' && state.error) return null
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
      if (state.stage === 'error' && state.error) return
      if (worker.state === 'installing') {
        transition('downloading', '正在下载新的离线资源，浏览器未提供可计算的下载大小。', { taskPending: true, error: null })
      } else if (worker.state === 'installed') {
        windowRef.clearTimeout(downloadTimer)
        resolveWorker?.('installed')
        if (!workerUpdateAllowed) {
          transition('warning', '浏览器已下载离线资源，需先核对可信版本信息后才能启用。',
            { taskPending: false, error: null }, { silentProgress: true })
          return
        }
        transition('ready', '新版离线资源已准备，重新加载后启用。', { taskPending: false, error: null })
      } else if (worker.state === 'activating') {
        transition('installing', '正在启用新资源，等待浏览器切换控制权。', { taskPending: true })
      } else if (worker.state === 'activated') {
        windowRef.clearTimeout(downloadTimer)
        if (!applying) transition('manual-reload', '新资源已启用，请重新加载以验证应用版本。', { taskPending: false })
        resolveWorker?.('activated')
      } else if (worker.state === 'redundant') {
        windowRef.clearTimeout(downloadTimer)
        if (!workerUpdateAllowed) {
          transition('warning', '浏览器未完成离线资源下载，当前应用仍可使用。核对版本后可重试。',
            { taskPending: false, error: null }, { silentProgress: true })
        } else fail(updateError('SW_DOWNLOAD', '新资源下载或安装失败，当前版本仍可使用，请重试。'))
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
    const release = readRelease().then((manifest) => ({ kind: 'release', manifest }), (error) => ({ kind: 'release-error', error }))
    // Subscribe before awaiting metadata. Neither response blocks the other.
    void getRegistration().then((value) => {
      if (value && !value.installing && !value.waiting) void updateWorker(value).catch(() => {})
      return value
    }).catch(() => log('SW_CHECK_ERROR'))
    try {
      const timeout = new Promise((resolve) => {
        deadline = windowRef.setTimeout(() => resolve({ kind: 'timeout' }), checkTimeoutMs)
      })
      let result = await Promise.race([found, release, timeout])
      if (disposed || id !== generation) return false
      if (result.kind === 'worker') {
        void observeWorker(result.worker)
        result = await Promise.race([release, timeout])
      }
      if (result.kind === 'timeout') return fail(updateError('TIMEOUT', '更新服务响应较慢，请稍后重试。'))
      if (result.kind === 'release-error') return fail(result.error)
      if (disposed || id !== generation) return false
      const manifest = result.manifest
      const comparison = compareRelease(manifest.version, currentVersion)
      if (comparison === null) return fail(updateError('SOURCE_INVALID', '当前版本与服务器版本不兼容，已保留现有应用。'))
      state.lastCheckedAt = now()
      if (comparison < 0) return fail(updateError('SOURCE_ROLLBACK', '服务器发布版本早于当前版本，已保留当前应用。'))
      state.releaseManifest = manifest
      state.availableVersion = comparison === 0 ? '' : manifest.version
      state.updateReleases = []
      if (comparison > 0 && manifest.minimumSupportedVersion && compareRelease(currentVersion, manifest.minimumSupportedVersion) < 0) {
        workerUpdateAllowed = true
        transition('blocked', `此版本至少需要 ${manifest.minimumSupportedVersion}，请应用更新后继续使用。`,
          { availableVersion: manifest.version, taskPending: false, error: null })
        return true
      }
      if (comparison > 0) {
        workerUpdateAllowed = true
        state.updateReleases = [{
          version: manifest.version, channel: manifest.channel, title: manifest.title, summary: manifest.summary,
          publishedAt: manifest.publishedAt, changes: manifest.changes, notes: manifest.notes,
        }]
        // Release notes are optional enrichment, never a gate for installing a
        // validated release. Ignore a late response after another operation.
        void readReleaseHistory().then((history) => {
          if (disposed || id !== generation || state.releaseManifest?.sourceSignature !== manifest.sourceSignature) return
          const updates = collectReleaseChanges(history, currentVersion, manifest.version, channel)
          if (updates.length) state.updateReleases = updates
        })
      }
      state.lastCheckOutcome = comparison === 0 ? '已是最新版本' : '检测到新版本'
      if (comparison === 0) {
        transition('latest', '当前版本已是最新版本。', { availableVersion: '', taskPending: false, error: null })
      } else if (observedWorker && ['installing', 'installed', 'activating'].includes(observedWorker.state)) {
        if (observedWorker.state === 'installed') transition('ready', '新版离线资源已准备，重新加载后启用。', { taskPending: false, error: null })
        else transition('downloading', '正在下载新的离线资源，浏览器未提供可计算的下载大小。', { taskPending: true, error: null })
      } else {
        transition('available', `发现新版本 ${manifest.version}。`, { taskPending: false, error: null })
      }
      return true
    } finally {
      windowRef.clearTimeout(deadline)
      notifyWorkerFound = () => {}
    }
  }
  function check(showResult = true) {
    if (disposed) return Promise.resolve(false)
    if (checkPromise) return checkPromise
    const validatingDownloadedWorker = state.stage === 'downloading' && Boolean(observedWorker)
    if (applyPromise || (state.taskPending && !validatingDownloadedWorker) || ['ready', 'manual-reload'].includes(state.stage)) return Promise.resolve(false)
    if (!showResult && state.error?.code === 'VERSION_VERIFY') return Promise.resolve(false)
    // 静默检查节流 90 秒：原来是 10 分钟，用户在一次会话里几乎碰不到第二次检查，
    // 只有退出重进才会立刻重查 —— 这也是「退出重进才更新」的观感来源之一。
    if (!showResult && lastSilentCheckAt && now() - lastSilentCheckAt < 90000) return Promise.resolve(false)
    lastSilentCheckAt = now()
    const id = begin()
    checkPromise = originLock(() => performCheck(id)).catch((error) => fail(error)).finally(() => { checkPromise = null })
    return checkPromise
  }
  function savePending(manifest, action = 'update') {
    const pending = { fromVersion: currentVersion, toVersion: manifest.version,
      expectedBuildId: manifest.buildId, expectedSourceSignature: manifest.sourceSignature,
      action, startedAt: state.startedAt, savedAt: now(), timings: [...state.timings] }
    try { storage.setItem(PENDING_WEB_UPDATE_KEY, JSON.stringify(pending)) }
    catch { throw updateError('STORAGE', '无法记录更新验证状态，请允许会话存储后重试。', 'apply') }
  }
  function scheduleReload() {
    if (disposed || state.stage === 'verifying') return
    windowRef.clearTimeout(reloadTimer)
    if (!beforeReloadResult()) { pauseForUnsavedChanges(); return }
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
  // 本页是否**原本就**由某个 Worker 控制。首次安装（进来时没有控制器）
// 触发的 controllerchange 不是「版本接管」，沿用原行为不重载。
  const hadControllerAtStart = Boolean(navigatorRef.serviceWorker?.controller)
  const startController = navigatorRef.serviceWorker?.controller || null
  const takeover = () => {
    const controller = navigatorRef.serviceWorker?.controller
    if (!controller) return
    if (applying) {
      if (observedWorker && controller !== observedWorker) return
      scheduleReload()
      return
    }
    // 本页没有发起更新，但控制权已被新 Worker 换掉：说明其他标签页应用了更新
    // （或浏览器自行更新了 Worker）。旧分包 URL 已经失效，必须跟着刷新，
    // 否则只会在下一次懒加载时撞上「部分资源加载失败」。
    if (!hadControllerAtStart || controller === startController) return
    log('PEER_CONTROLLER_TAKEOVER')
    peerReload()
  }
  windowRef.addEventListener?.('study-life:storage-updated', retryPeerReloadAfterSave)
  navigatorRef.serviceWorker?.addEventListener('controllerchange', takeover)
  async function preflightEntry(manifest) {
    transition('downloading', '正在获取并核对新版本入口…', { taskPending: true })
    const html = await requestText('/index.html', checkTimeoutMs)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || ''
    if (meta('study-life-app-version') !== manifest.version ||
      meta('study-life-source-signature') !== manifest.sourceSignature ||
      (manifest.legacyVersion && meta('study-life-release') !== manifest.legacyVersion))
      throw updateError('SOURCE_INVALID', '发布版本与入口资源不一致，请稍后重试。')
    const documentUrl = windowRef.location?.href || 'https://localhost/'
    const origin = new URL(documentUrl).origin
    const liveManifest = validateReleaseManifest(await requestJson('/release.json', checkTimeoutMs), { channel })
    if (!liveManifest || liveManifest.version !== manifest.version ||
      liveManifest.sourceSignature !== manifest.sourceSignature)
      throw updateError('SOURCE_CHANGED', '检查期间发布内容发生变化，请重新检查后再更新。', 'check')
    const entryAssets = [...document.querySelectorAll('script[src],link[rel="stylesheet"][href]')]
      .map((element) => /** @type {HTMLScriptElement | HTMLLinkElement} */ (element).src ||
        /** @type {HTMLScriptElement | HTMLLinkElement} */ (element).href).filter(Boolean)
    const preflightStartedAt = now()
    for (const asset of entryAssets) {
      const url = new URL(asset, documentUrl)
      if (url.origin !== origin) throw updateError('SOURCE_INVALID', '应用入口包含不可信的资源地址，已阻止刷新。')
      const remainingMs = Math.max(1, checkTimeoutMs - (now() - preflightStartedAt))
      const abort = new AbortController()
      let response
      try {
        response = await bounded(fetchFn(url.href, { cache: 'no-store', method: 'GET', signal: abort.signal }), remainingMs)
      } finally { abort.abort() }
      if (!response?.ok) throw updateError('SOURCE_HTTP', '新版本入口资源尚未完整部署，请稍后重试。')
      await response.body?.cancel?.().catch(() => {})
    }
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
  async function performApply(repair, manualReload, sessionVerified) {
    // 本会话已经核对过、且离线资源已就绪（ready / manual-reload）时，应用更新
    // **不需要再联网**：资源已在本机，重新加载只是让等待中的 Worker 接管。
    // 旧实现无论什么状态都先要求联网重取 release.json 并逐个预检入口资源，
    // 于是弱网/离线点「立即重新加载」必然失败，而「退出再进来」不需要网络 ——
    // 用户因此被训练成每次都退出重进。
    const offline = navigatorRef.onLine === false
    if (offline && !sessionVerified)
      return fail(updateError('OFFLINE',
        '当前没有网络，无法核对新版本。联网后重试即可；如果浏览器已经下载好新版本，关闭并重新打开应用也会启用它。', 'apply'))
    let trustedSession = sessionVerified
    let manifest = sessionVerified ? state.releaseManifest : null
    if (manifest) {
      log('APPLY_SESSION_VERIFIED')
    } else {
      try {
        manifest = await readRelease()
      } catch (error) {
        // 弱网抖动：已经核对过并下载完成时，不该把用户挡回去。
        if (!sessionVerified || !['NETWORK', 'TIMEOUT'].includes(safeUpdateError(error).code)) throw error
        trustedSession = true
        manifest = state.releaseManifest
        log('APPLY_TRUSTED_SESSION')
      }
    }
    const comparison = compareRelease(manifest.version, currentVersion)
    if (comparison === null) throw updateError('SOURCE_INVALID', '当前版本与服务器版本不兼容，已保留现有应用。')
    if (comparison < 0) throw updateError('SOURCE_ROLLBACK', '服务器版本较旧，已保留当前应用。')
    if (comparison === 0 && currentSourceSignature && manifest.sourceSignature !== currentSourceSignature)
      throw updateError('SOURCE_CHANGED', '同一正式版本的构建内容不一致，已阻止刷新。')
    if (!repair && state.availableVersion && state.availableVersion !== manifest.version && observedWorker)
      throw updateError('SOURCE_CHANGED', '发布版本在下载后发生变化，请重新获取资源后再应用。', 'repair')
    // 内容是否变化看**源码签名**。buildId 是部署标识（Pages 部署主机名 / CI 运行号），
    // 同一份内容重新部署也会变，用它会一次重新部署就把更新误判成
    // 「检查期间发布构建发生变化」，表现为「更新成功却报失败」。
    if (!repair && state.releaseManifest && state.releaseManifest.sourceSignature !== manifest.sourceSignature)
      throw updateError('SOURCE_CHANGED', '检查期间发布内容发生变化，请重新检查后再应用。', 'check')
    state.availableVersion = comparison > 0 ? manifest.version : ''
    state.releaseManifest = manifest
    workerUpdateAllowed = true
    const value = await getRegistration()
    if (deferRecoveryForWorker(value)) return false
    // 只有必须联网核对时才预检部署入口；本会话已核对过就直接用本机已下载的资源。
    if (!trustedSession) await preflightEntry(manifest)
    if (deferRecoveryForWorker(value)) return false
    if (repair || manualReload || !value) {
      savePending(manifest, repair ? 'repair' : 'update')
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
      // 通知同伴的时刻要贴近真正的重载：修复流程会先注销 Worker 并清空缓存，
      // 过早通知会让同伴在缓存被清空的同时重建注册。
      announceApplyToPeers(manifest.version)
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
    savePending(manifest, 'update')
    announceApplyToPeers(manifest.version)
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
    // 在 begin()/transition 把 stage 改成 checking 之前先把「资源已就绪且本会话已核对」
    // 这个事实记下来：它决定应用更新时是否还需要联网。
    const sessionVerified = Boolean(state.releaseManifest) &&
      state.availableVersion === state.releaseManifest.version &&
      ['ready', 'manual-reload'].includes(state.stage)
    begin()
    transition('checking', repair ? '正在检查缓存恢复条件…' : '正在确认待应用版本…', { taskPending: true })
    applyPromise = originLock(() => performApply(repair, manualReload, sessionVerified)).catch((error) => {
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
      const versionComparison = compareRelease(currentVersion, saved.toVersion)
      const legacyComparison = compareRelease(legacyCurrentVersion, saved.toVersion)
      // 身份判定只看**源码签名**（内容身份）。buildId 是部署标识：同一份内容
      // 重新部署也会变（Pages 用部署主机名），拿它判定会把一次成功的更新
      // 判成 VERSION_VERIFY 失败，用户看到「更新成功却报失败」。
      const hasExpectedIdentity = Object.prototype.hasOwnProperty.call(saved, 'expectedSourceSignature')
      const identityMatches = !hasExpectedIdentity ||
        (typeof saved.expectedSourceSignature === 'string' && saved.expectedSourceSignature === currentSourceSignature)
      const targetWasSuperseded = versionComparison !== null && versionComparison > 0
      const versionReached = versionComparison !== null ? versionComparison >= 0 : legacyComparison !== null && legacyComparison >= 0
      const verified = versionReached && (!hasExpectedIdentity || targetWasSuperseded || identityMatches)
      if (versionComparison === null && legacyComparison === null) return
      if (verified) {
        transition('completed', saved.action === 'repair'
          ? `应用资源已恢复，当前运行版本 ${currentVersion}。`
          : `更新成功，已验证运行版本 ${currentVersion}。`, { availableVersion: '', taskPending: false })
        log('RUNNING_VERSION_VERIFIED')
        lastSilentCheckAt = now()
      } else fail(updateError('VERSION_VERIFY', '重新加载后的版本或构建与目标更新不一致。当前数据已保留，请检查网络后重试或修复更新缓存。', 'repair'))
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
      windowRef.removeEventListener?.('study-life:storage-updated', retryPeerReloadAfterSave)
      updateChannel?.close()
      progress?.dispose()
    } }
}
