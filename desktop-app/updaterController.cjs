'use strict'

const INITIAL_STAGE = 'idle'

function safeVersion(value, fallback = '') {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : fallback
}

function createUpdaterController({
  autoUpdater,
  currentVersion,
  publish = () => {},
  enabled = true,
  disabledStage = INITIAL_STAGE,
  disabledMessage = '桌面更新仅在已安装的 Windows 版本中可用。',
}) {
  if (!autoUpdater || typeof autoUpdater.on !== 'function') {
    throw new TypeError('autoUpdater must be an event emitter')
  }

  const state = {
    stage: enabled ? INITIAL_STAGE : disabledStage,
    currentVersion: safeVersion(currentVersion),
    availableVersion: '',
    percent: 0,
    lastCheckedAt: 0,
    message: enabled ? '启动和联网时自动检查；也可以手动检查。' : disabledMessage,
  }

  let checking = false
  let checkInFlight = false
  let downloading = false

  function setState(patch) {
    Object.assign(state, patch)
    publish({ ...state })
    return { ...state }
  }

  const handlers = {
    'checking-for-update': () => {
      checking = true
      setState({
        stage: 'checking',
        lastCheckedAt: Date.now(),
        message: '正在连接桌面更新服务…',
      })
    },
    'update-available': (info = {}) => {
      checking = false
      downloading = false
      const availableVersion = safeVersion(info.version)
      setState({
        stage: 'available',
        availableVersion,
        percent: 0,
        message: availableVersion ? `发现新版本 ${availableVersion}，可下载并在应用内安装。` : '发现新版本，可下载并在应用内安装。',
      })
    },
    'update-not-available': () => {
      checking = false
      downloading = false
      setState({
        stage: 'latest',
        availableVersion: '',
        percent: 0,
        lastCheckedAt: Date.now(),
        message: '当前已是最新版本。',
      })
    },
    'download-progress': (progress = {}) => {
      downloading = true
      const percent = Number(progress.percent)
      setState({
        stage: 'downloading',
        percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : state.percent,
        message: '正在下载桌面更新…',
      })
    },
    'update-downloaded': (info = {}) => {
      checking = false
      downloading = false
      const availableVersion = safeVersion(info.version, state.availableVersion)
      setState({
        stage: 'ready',
        availableVersion,
        percent: 100,
        message: availableVersion ? `版本 ${availableVersion} 已下载，重启应用即可安装。` : '新版本已下载，重启应用即可安装。',
      })
    },
    'update-cancelled': () => {
      checking = false
      downloading = false
      setState({ stage: 'available', percent: 0, message: '下载已取消，可以稍后重试。' })
    },
    error: () => {
      checking = false
      downloading = false
      setState({ stage: 'error', percent: 0, lastCheckedAt: Date.now(), message: '连接更新服务失败，请检查网络后重试。' })
    },
  }

  for (const [event, handler] of Object.entries(handlers)) autoUpdater.on(event, handler)

  // Hold on to update artifacts until the user chooses “restart and install”.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  async function check() {
    if (!enabled) return false
    if (checking || checkInFlight || downloading || state.stage === 'ready') return true
    checkInFlight = true
    checking = true
    setState({ stage: 'checking', lastCheckedAt: Date.now(), message: '正在连接桌面更新服务…' })
    try {
      await autoUpdater.checkForUpdates()
      return true
    } catch {
      handlers.error()
      return false
    } finally {
      checkInFlight = false
      checking = false
    }
  }

  async function download() {
    if (!enabled || state.stage !== 'available' || downloading) return false
    downloading = true
    setState({ stage: 'downloading', percent: 0, message: '正在下载桌面更新…' })
    try {
      await autoUpdater.downloadUpdate()
      return true
    } catch {
      handlers.error()
      return false
    }
  }

  function install() {
    if (!enabled || state.stage !== 'ready') return false
    setState({ stage: 'installing', message: '正在退出并安装更新…' })
    autoUpdater.quitAndInstall(true, true)
    return true
  }

  function dispose() {
    for (const [event, handler] of Object.entries(handlers)) autoUpdater.removeListener?.(event, handler)
  }

  return {
    check,
    download,
    install,
    getState: () => ({ ...state }),
    dispose,
  }
}

module.exports = { createUpdaterController }
