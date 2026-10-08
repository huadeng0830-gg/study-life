'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createUpdaterController } = require('./updaterController.cjs')
const { routeWindowsCachePaths } = require('./cachePaths.cjs')

const APP_SCHEME = 'app'
const APP_HOST = 'study-life'
const APP_ORIGIN = APP_SCHEME + '://' + APP_HOST
const INSTALL_ROOT_MARKER = 'study-life.install-root'
const isWindows = process.platform === 'win32'
let updaterController = null

app.setAppUserModelId('com.study-life.desktop')
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    codeCache: true,
    stream: true,
  },
}])

function readInstallRoot() {
  if (!app.isPackaged) return path.resolve(__dirname, '..', 'desktop-app-data')

  const markerPath = path.join(process.resourcesPath, INSTALL_ROOT_MARKER)
  try {
    const configuredRoot = fs.readFileSync(markerPath, 'utf8').trim()
    if (configuredRoot) return path.resolve(configuredRoot)
  } catch {
    // A missing marker is handled with the parent of the packaged executable.
  }
  return path.resolve(path.dirname(process.execPath), '..')
}

const installRoot = readInstallRoot()
const appPaths = {
  root: installRoot,
  data: path.join(installRoot, 'data'),
  profile: path.join(installRoot, 'data', 'profile'),
  session: path.join(installRoot, 'data', 'profile', 'session'),
  backups: path.join(installRoot, 'data', 'backups'),
  cache: path.join(installRoot, 'cache'),
  codeCache: path.join(installRoot, 'cache', 'code'),
  updates: path.join(installRoot, 'updates'),
  logs: path.join(installRoot, 'logs'),
  crashDumps: path.join(installRoot, 'crash-dumps'),
  temp: path.join(installRoot, 'temp'),
}

try {
  for (const directory of Object.values(appPaths)) fs.mkdirSync(directory, { recursive: true })
  routeWindowsCachePaths(appPaths, process.env, isWindows)
  app.setPath('userData', appPaths.profile)
  app.setPath('sessionData', appPaths.session)
  app.setPath('downloads', appPaths.backups)
  app.setPath('logs', appPaths.logs)
  app.setPath('crashDumps', appPaths.crashDumps)
  app.setPath('temp', appPaths.temp)
} catch (error) {
  dialog.showErrorBox(
    '无法使用所选的安装目录',
    '三两事无法在这里保存本机资料：\n' + installRoot + '\n\n请重新安装到当前 Windows 用户可写入的目录。',
  )
  app.exit(1)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}

const rendererRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'dist-desktop')
  : path.resolve(__dirname, '..', 'dist-desktop')

function isLocalAppUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === APP_SCHEME + ':' && url.hostname === APP_HOST
  } catch {
    return false
  }
}

function isTrustedUpdateSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || ''
  return isLocalAppUrl(senderUrl)
}

function updateState() {
  return updaterController?.getState() || {
    stage: 'unavailable',
    currentVersion: app.getVersion(),
    availableVersion: '',
    percent: 0,
    lastCheckedAt: 0,
    message: app.isPackaged
      ? '桌面更新服务暂不可用，请稍后重试。'
      : '开发环境不连接桌面更新服务。',
  }
}

function publishUpdateState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !isLocalAppUrl(window.webContents.getURL())) continue
    window.webContents.send('study-life:update-state', state)
  }
}

function initializeDesktopUpdater() {
  if (!app.isPackaged || !isWindows) return false
  try {
    const { autoUpdater } = require('electron-updater')
    updaterController = createUpdaterController({
      autoUpdater,
      currentVersion: app.getVersion(),
      publish: publishUpdateState,
    })
    return true
  } catch (error) {
    console.error('[desktop] updater unavailable', error)
    return false
  }
}

ipcMain.handle('study-life:update-state', (event) => {
  if (!isTrustedUpdateSender(event)) throw new Error('Untrusted update request')
  return updateState()
})
ipcMain.handle('study-life:update-check', async (event) => {
  if (!isTrustedUpdateSender(event)) throw new Error('Untrusted update request')
  return updaterController ? updaterController.check() : false
})
ipcMain.handle('study-life:update-download', async (event) => {
  if (!isTrustedUpdateSender(event)) throw new Error('Untrusted update request')
  return updaterController ? updaterController.download() : false
})
ipcMain.handle('study-life:update-install', (event) => {
  if (!isTrustedUpdateSender(event)) throw new Error('Untrusted update request')
  return updaterController ? updaterController.install() : false
})

function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function response(status, message = '') {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

async function registerLocalAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== APP_HOST || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return response(404, 'Not found')
    }

    let pathname
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return response(400, 'Invalid path')
    }

    const requestedPath = path.resolve(rendererRoot, '.' + (pathname || '/'))
    const relativePath = path.relative(rendererRoot, requestedPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return response(403, 'Forbidden')
    }

    let filePath = requestedPath
    try {
      if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html')
    } catch {
      // Unknown extensionless URLs receive the app shell; asset misses remain 404.
      if (!path.extname(filePath)) filePath = path.join(rendererRoot, 'index.html')
    }

    try {
      await fs.promises.access(filePath, fs.constants.R_OK)
    } catch {
      return response(404, 'Not found')
    }

    return net.fetch(pathToFileURL(filePath).href, { method: request.method })
  })
}

function configureSession() {
  const defaultSession = session.defaultSession
  defaultSession.setCodeCachePath(appPaths.codeCache)
  defaultSession.setDownloadPath(appPaths.backups)
  defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'notifications' && isLocalAppUrl(contents.getURL()))
  })
  defaultSession.setPermissionCheckHandler((contents, permission) => (
    permission === 'notifications' && isLocalAppUrl(contents?.getURL() || '')
  ))
}

function installNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url)
    if (external) void shell.openExternal(external)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (isLocalAppUrl(target)) return
    event.preventDefault()
    const external = safeExternalUrl(target)
    if (external) void shell.openExternal(external)
  })
}

async function createMainWindow() {
  await registerLocalAppProtocol()
  configureSession()
  Menu.setApplicationMenu(null)

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6fa',
    ...(isWindows ? { icon: path.join(rendererRoot, 'pwa-v2-512x512.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })

  installNavigationGuards(window)
  window.once('ready-to-show', () => window.show())
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[desktop] renderer stopped', details.reason, details.exitCode)
  })
  await window.loadURL(APP_ORIGIN + '/index.html')
}

if (gotLock) {
  app.whenReady().then(async () => {
    const updaterReady = initializeDesktopUpdater()
    await createMainWindow()
    if (updaterReady) {
      const timer = setTimeout(() => void updaterController?.check(), 4000)
      timer.unref?.()
    }
  }).catch((error) => {
    console.error('[desktop] startup failed', error)
    dialog.showErrorBox('三两事启动失败', '应用资源未能打开。请重新安装，或联系维护者检查安装文件。')
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
