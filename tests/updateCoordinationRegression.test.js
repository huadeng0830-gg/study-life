// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import updaterModule from '../desktop-app/updaterController.cjs'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function setupWeb() {
  const registration = new EventTarget()
  registration.update = vi.fn(async () => {})
  registration.installing = null
  registration.waiting = null
  registration.unregister = vi.fn(async () => true)
  const serviceWorker = new EventTarget()
  serviceWorker.controller = { state: 'activated' }
  serviceWorker.getRegistration = vi.fn(async () => registration)
  serviceWorker.ready = Promise.resolve(registration)
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  return registration
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.studyLifeDesktop
})

describe('更新协调的实际竞态回归', () => {
  it('版本接口挂起时仍立即反映真实 Worker 下载状态', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const registration = setupWeb()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const update = await import('../src/composables/appUpdate.js')
    void update.checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(0)
    const worker = new EventTarget()
    worker.state = 'installing'
    worker.postMessage = vi.fn()
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update.updateStage.value).toBe('downloading')
  })

  it('静默检查保存最新结果，并节流后续 focus/online 检查', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    setupWeb()
    const { APP_RELEASE } = await import('../src/composables/releaseNotes.js')
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => APP_RELEASE }))
    vi.stubGlobal('fetch', fetchMock)
    const update = await import('../src/composables/appUpdate.js')
    await update.checkForAppUpdate(false)
    expect(update.updateStage.value).toBe('latest')
    await update.checkForAppUpdate(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('初始桌面快照迟到时不能覆盖新的下载事件', async () => {
    vi.resetModules()
    const snapshot = deferred()
    let receive
    window.studyLifeDesktop = {
      isDesktop: true,
      getUpdateState: () => snapshot.promise,
      onUpdateState: (listener) => { receive = listener; return () => {} },
    }
    const update = await import('../src/composables/desktopAppUpdate.js')
    const stop = update.subscribeToDesktopUpdateState()
    receive({ stage: 'downloading', revision: 2, currentVersion: '1.0.3', percent: 42 })
    snapshot.resolve({ stage: 'idle', revision: 1, currentVersion: '1.0.3' })
    await Promise.resolve()
    await Promise.resolve()
    expect(update.desktopUpdateState.value.stage).toBe('downloading')
    stop()
  })

  it('正在退出安装时拒绝另一入口启动检查', async () => {
    const updater = new EventEmitter()
    updater.checkForUpdates = vi.fn()
    updater.quitAndInstall = vi.fn()
    const controller = updaterModule.createUpdaterController({ autoUpdater: updater, currentVersion: '1.0.3' })
    updater.emit('update-downloaded', { version: '1.0.4' })
    controller.install()
    await controller.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.getState().stage).toBe('installing')
    controller.dispose()
  })

  it('安装器同步报错时返回失败，保留当前版本且结束加载', () => {
    const updater = new EventEmitter()
    updater.quitAndInstall = vi.fn(() => { throw Object.assign(new Error('private path or token'), { code: 'EACCES' }) })
    const controller = updaterModule.createUpdaterController({ autoUpdater: updater, currentVersion: '1.0.3' })
    updater.emit('update-downloaded', { version: '1.0.4' })
    expect(controller.install()).toBe(false)
    expect(controller.getState()).toMatchObject({ stage: 'error', currentVersion: '1.0.3' })
    controller.dispose()
  })
})
