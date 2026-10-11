'use strict'

const semver = require('semver')
const BUSY_STAGES = new Set(['checking', 'downloading', 'installing', 'verifying'])
const safeVersion = (value) => typeof value === 'string' && semver.valid(value) ? value : ''
const snapshot = (state) => JSON.parse(JSON.stringify(state))

function classifyError(error, action = 'check') {
  const code = String(error?.code || '')
  const text = String(error?.message || '')
  let type = 'NETWORK'
  let message = '连接更新服务失败，请检查网络后重试。'
  if (/ENOSPC/.test(code + text)) { type = 'DISK_FULL'; message = '磁盘空间不足，请清理更新缓存所在磁盘后重试。' }
  else if (/EACCES|EPERM/.test(code + text)) { type = 'PERMISSION'; message = '没有写入或安装权限，请使用有权限的安装目录后重试。' }
  else if (/EIO|EROFS|EDQUOT/.test(code + text)) { type = 'FILE_WRITE'; message = '更新资源无法写入磁盘，请检查安装目录后重试。' }
  else if (/checksum|sha512|signature|ERR_UPDATER_INVALID_SIGNATURE/i.test(code + text)) {
    type = 'INTEGRITY'; message = '更新包完整性或发布者签名验证失败，已停止安装。'
  } else if (/TIMEOUT|ETIMEDOUT|timed out/i.test(code + text)) { type = 'TIMEOUT'; message = '更新服务响应超时，请稍后重试。' }
  else if (/404|ENOENT/i.test(code + text)) { type = 'SOURCE_HTTP'; message = '更新资源不存在或暂不可用，请稍后重试。' }
  else if (/ERR_UPDATER_NO_DOWNLOAD|ERR_UPDATER_NO_RESULT/.test(code)) { type = 'VERSION_VERIFY'; message = '更新器没有返回已验证的结果，已停止本次更新。' }
  else if (/ERR_UPDATER_NO|ERR_UPDATER_INVALID|parse|yaml|json/i.test(code + text)) {
    type = 'SOURCE_INVALID'; message = '更新资源或版本信息不完整，请稍后重试。'
  } else if (action === 'install') { type = 'INSTALL'; message = '安装进程未能启动，当前版本已保留，请重试安装。' }
  return { code: type, message, retryAction: action }
}

function createUpdaterController({ autoUpdater, currentVersion, publish = () => {}, enabled = true,
  disabledStage = 'idle', disabledMessage = '桌面更新仅在已安装的 Windows 版本中可用。',
  now = () => Date.now(), checkTimeoutMs = 20000, downloadTimeoutMs = 120000, installTimeoutMs = 20000,
  createCancellationToken = null, pendingInstall = null, savePendingInstall = () => {},
  installVerifiedUpdate = null,
  clearPendingInstall = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!autoUpdater || typeof autoUpdater.on !== 'function') throw new TypeError('autoUpdater must be an event emitter')
  const state = { stage: enabled ? 'idle' : disabledStage, currentVersion: safeVersion(currentVersion),
    availableVersion: '', percent: null, transferred: 0, total: 0, bytesPerSecond: 0, lastCheckedAt: 0,
    lastAttemptAt: 0, startedAt: 0, finishedAt: 0, phaseStartedAt: 0, taskId: 0, revision: 0,
    taskPending: false, canCancel: false, canRetry: true, error: null, timings: [], log: [],
    releaseNotes: '', releaseDate: '', message: enabled ? '启动时自动检查；也可以手动检查。' : disabledMessage }
  let operation = null
  let sequence = 0
  let timer = null
  let downloadedVersion = ''
  let disposed = false

  function log(code) {
    state.log.push({ at: now(), stage: state.stage, code })
    state.log = state.log.slice(-40)
  }
  function getState() { return snapshot(state) }
  function setState(patch) {
    if (disposed) return getState()
    if (patch.stage && patch.stage !== state.stage) {
      if (state.phaseStartedAt && BUSY_STAGES.has(state.stage))
        state.timings.push({ stage: state.stage, durationMs: Math.max(0, now() - state.phaseStartedAt) })
      state.timings = state.timings.slice(-24)
      state.phaseStartedAt = now()
      log('STAGE_CHANGED')
    }
    Object.assign(state, patch, { revision: state.revision + 1 })
    try { publish(getState()) } catch { log('STATE_PUBLISH_FAILED') }
    return getState()
  }
  function fail(error, action, patch = {}) {
    if (operation) operation.failed = true
    const safe = classifyError(error, action)
    log(safe.code)
    setState({ stage: 'error', message: safe.message, error: safe, canCancel: false,
      canRetry: !operation, taskPending: Boolean(operation), finishedAt: now(), ...patch })
    return false
  }
  function armTimeout(token, delay) {
    clearTimer(timer)
    if (token.kind === 'download') delay = Math.min(delay, Math.max(1, 1800000 - (now() - token.startedAt)))
    timer = setTimer(() => {
      if (operation !== token || disposed) return
      token.timedOut = true
      token.cancel?.cancel()
      if (!token.started) token.abort?.abort()
      const install = token.kind === 'install'
      fail({ code: 'ETIMEDOUT' }, token.kind, { message: install
        ? '安装未能退出应用，请关闭应用后重新打开以验证结果。'
        : '更新请求超时，正在结束后台任务。若一直没有结束，请重启应用后重试。' })
      token.resolveTimeout?.(false)
      // An installer cannot be cancelled safely; do not launch another one.
    }, delay)
    timer?.unref?.()
  }
  function start(kind) {
    const token = { id: ++sequence, kind, startedAt: now(), timedOut: false, downloaded: false, cancel: null }
    operation = token
    setState({ stage: kind === 'check' ? 'checking' : 'downloading', taskId: token.id,
      startedAt: now(), finishedAt: 0, taskPending: true, canRetry: false, error: null,
      ...(kind === 'check' ? { lastAttemptAt: now(), timings: [], log: [] } : {}),
      message: kind === 'check' ? '正在连接桌面更新服务…' : '正在下载桌面更新…' })
    return token
  }
  function accepts(kind) {
    return !disposed && ((!operation && state.stage === 'idle') ||
      (operation?.kind === kind && !operation.timedOut && !operation.failed && !operation.cancelled))
  }
  function applyAvailable(info = {}) {
    if (!accepts('check') || ['downloading', 'ready', 'installing'].includes(state.stage)) return
    const version = safeVersion(info.version)
    if (!version || !state.currentVersion || !semver.gt(version, state.currentVersion))
      return fail({ code: 'ERR_UPDATER_INVALID_VERSION' }, 'check')
    setState({ stage: 'available', availableVersion: version, percent: null, error: null,
      lastCheckedAt: now(), releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 6000) : '',
      releaseDate: typeof info.releaseDate === 'string' && Number.isFinite(Date.parse(info.releaseDate)) ? info.releaseDate : '',
      message: `发现新版本 ${version}，可以下载更新。` })
  }
  const handlers = {
    'checking-for-update': () => {
      if (accepts('check') && state.stage === 'checking') setState({ message: '正在连接桌面更新服务…' })
    },
    'update-available': applyAvailable,
    'update-not-available': () => {
      if (!accepts('check') || ['downloading', 'ready', 'installing'].includes(state.stage)) return
      setState({ stage: 'latest', availableVersion: '', percent: null, lastCheckedAt: now(),
        error: null, message: '当前已是最新版本。' })
    },
    'download-progress': (progress = {}) => {
      if (!accepts('download') || !['downloading', 'available'].includes(state.stage)) return
      const percent = Number(progress.percent)
      const transferred = Number(progress.transferred)
      const total = Number(progress.total)
      const previousBytes = state.transferred
      const previousPercent = state.percent || 0
      setState({ stage: 'downloading', percent: Number.isFinite(percent) ? Math.max(state.percent || 0, Math.min(100, Math.max(0, Math.round(percent)))) : state.percent,
        transferred: Number.isFinite(transferred) ? Math.max(previousBytes, transferred) : previousBytes,
        total: Number.isFinite(total) && total > 0 ? total : state.total,
        bytesPerSecond: Math.max(0, Number(progress.bytesPerSecond) || 0), message: '正在下载桌面更新…' })
      if (operation && (transferred > previousBytes || state.percent > previousPercent)) armTimeout(operation, downloadTimeoutMs)
    },
    'update-downloaded': (info = {}) => {
      if (!accepts('download')) return
      const version = safeVersion(info.version || state.availableVersion)
      if (!version || !state.currentVersion || !semver.gt(version, state.currentVersion) ||
        (state.availableVersion && state.availableVersion !== version))
        return fail({ code: 'ERR_UPDATER_INVALID_VERSION' }, 'download')
      downloadedVersion = version
      if (operation) operation.downloaded = true
      setState({ stage: 'ready', availableVersion: version, percent: 100, transferred: state.total || state.transferred,
        error: null, canCancel: false, message: `版本 ${version} 已下载并通过更新器校验，重启后安装。` })
    },
    'update-cancelled': () => {
      if (!operation || operation.kind !== 'download') return
      operation.cancelled = true
      setState({ stage: 'cancelled', error: null, canCancel: false, message: '下载已取消，可以稍后重新下载。' })
    },
    error: (error) => {
      if (disposed || !operation || operation.timedOut) return
      const action = operation?.kind || (state.stage === 'installing' ? 'install' : 'check')
      if (operation) operation.failed = true
      fail(error, action)
      if (action === 'install' && !installVerifiedUpdate) {
        clearTimer(timer)
        operation = null
        try { clearPendingInstall() } catch { log('PENDING_RECORD_CLEAR_FAILED') }
        setState({ taskPending: false, canRetry: true })
      }
    },
  }
  for (const [event, handler] of Object.entries(handlers)) autoUpdater.on(event, handler)
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  function execute(token, action) {
    const timeout = new Promise((resolve) => { token.resolveTimeout = resolve })
    armTimeout(token, token.kind === 'check' ? checkTimeoutMs : downloadTimeoutMs)
    let result
    try { result = action() } catch (error) { result = Promise.reject(error) }
    const work = Promise.resolve(result).then((value) => {
      if (disposed || operation !== token || token.timedOut || token.failed || token.cancelled) return false
      if (token.kind === 'check' && state.stage === 'checking') {
        if (value?.updateInfo) {
          const version = safeVersion(value.updateInfo.version)
          if (version && semver.gt(version, state.currentVersion)) applyAvailable(value.updateInfo)
          else if (version) handlers['update-not-available']()
          else fail({ code: 'ERR_UPDATER_INVALID_VERSION' }, 'check')
        } else fail({ code: 'ERR_UPDATER_NO_RESULT' }, 'check')
      }
      if (token.kind === 'download' && !token.downloaded)
        return fail({ code: 'ERR_UPDATER_NO_DOWNLOAD' }, 'download')
      return state.stage !== 'error'
    }, (error) => {
      if (disposed || operation !== token || token.timedOut) return false
      if (token.cancelled) return false
      return fail(error, token.kind)
    }).finally(() => {
      if (operation !== token) return
      clearTimer(timer)
      operation = null
      setState({ taskPending: false, canCancel: false, canRetry: true, finishedAt: now() })
    })
    token.promise = Promise.race([work, timeout])
    return token.promise
  }
  function check() {
    if (!enabled || disposed) return Promise.resolve(false)
    if (operation) return operation.kind === 'check' ? operation.promise : Promise.resolve(false)
    if (['ready', 'installing'].includes(state.stage)) return Promise.resolve(false)
    const token = start('check')
    return execute(token, () => autoUpdater.checkForUpdates())
  }
  function download() {
    if (!enabled || disposed) return Promise.resolve(false)
    if (operation) return operation.kind === 'download' ? operation.promise : Promise.resolve(false)
    if (!['available', 'cancelled'].includes(state.stage) && !(state.stage === 'error' && state.error?.retryAction === 'download'))
      return Promise.resolve(false)
    if (!safeVersion(state.availableVersion)) return Promise.resolve(false)
    const token = start('download')
    token.cancel = createCancellationToken?.() || null
    setState({ percent: null, transferred: 0, total: 0, bytesPerSecond: 0, canCancel: Boolean(token.cancel) })
    return execute(token, () => autoUpdater.downloadUpdate(token.cancel || undefined))
  }
  function cancel() {
    if (!operation || operation.kind !== 'download' || !operation.cancel || operation.cancelled) return false
    operation.cancelled = true
    operation.cancel.cancel()
    setState({ stage: 'cancelled', canCancel: false, message: '正在结束下载，请稍候。' })
    return true
  }
  function install() {
    if (!enabled || disposed || operation || !downloadedVersion ||
      (state.stage !== 'ready' && !(state.stage === 'error' && state.error?.retryAction === 'install'))) return false
    const token = { id: ++sequence, kind: 'install', timedOut: false, started: false, abort: new AbortController() }
    operation = token
    try {
      savePendingInstall({ fromVersion: state.currentVersion, toVersion: downloadedVersion, savedAt: now() })
      setState({ stage: 'installing', taskId: token.id, startedAt: now(), finishedAt: 0,
        taskPending: true, canCancel: false, canRetry: false, error: null, message: '正在退出应用并启动已验证的安装包…' })
      armTimeout(token, installTimeoutMs)
      if (installVerifiedUpdate) {
        const timeout = new Promise((resolve) => { token.resolveTimeout = resolve })
        const work = Promise.resolve().then(() => installVerifiedUpdate({ signal: token.abort.signal,
          version: downloadedVersion, onStarted: () => {
            token.started = true
            if (disposed || operation !== token || token.timedOut) return
            setState({ stage: 'verifying', message: '安装器已启动，应用即将退出；重启后核对实际运行版本。' })
          } })).then((started) => {
          if (!started && !token.timedOut) throw Object.assign(new Error('Installer did not start'), { code: 'ERR_UPDATER_NO_RESULT' })
          return Boolean(started && !token.timedOut)
        }).catch((error) => {
          if (disposed || operation !== token) return false
          clearTimer(timer)
          if (token.started || error.installerStarted) return fail(error, 'install', {
            taskPending: true, canRetry: false, message: '安装器已经启动，应用未能正常退出。请关闭应用后重新打开以验证结果。' })
          operation = null
          try { clearPendingInstall() } catch { log('PENDING_RECORD_CLEAR_FAILED') }
          return fail(error, 'install', { taskPending: false, canRetry: true,
            ...(token.timedOut ? { message: '安装器启动超时，已停止启动；当前版本已保留，可以重试。' } : {}),
            ...(classifyError(error, 'install').code === 'INTEGRITY'
              ? { error: { ...classifyError(error, 'install'), retryAction: 'check' } } : {}) })
        })
        token.promise = Promise.race([work, timeout])
        return token.promise
      }
      autoUpdater.quitAndInstall(true, true)
      return state.stage === 'installing'
    } catch (error) {
      clearTimer(timer)
      operation = null
      try { clearPendingInstall() } catch { log('PENDING_RECORD_CLEAR_FAILED') }
      return fail(error, 'install', { taskPending: false, canRetry: true })
    }
  }
  if (pendingInstall && safeVersion(pendingInstall.toVersion) && state.currentVersion) {
    if (semver.gte(state.currentVersion, pendingInstall.toVersion)) {
      setState({ stage: 'completed', message: `更新成功，已验证运行版本 ${state.currentVersion}。` })
      log('RUNNING_VERSION_VERIFIED')
    } else {
      setState({ stage: 'error', error: { code: 'VERSION_VERIFY', retryAction: 'check',
        message: '重启后仍在运行旧版本，请重新检查并安装；当前数据已保留。' },
        message: '重启后仍在运行旧版本，请重新检查并安装；当前数据已保留。' })
    }
    try { clearPendingInstall() } catch { log('PENDING_RECORD_CLEAR_FAILED') }
  }
  function dispose() {
    disposed = true
    clearTimer(timer)
    operation?.cancel?.cancel()
    for (const [event, handler] of Object.entries(handlers)) autoUpdater.removeListener?.(event, handler)
  }
  return { check, download, install, cancel, getState, dispose }
}
module.exports = { createUpdaterController, classifyError }
