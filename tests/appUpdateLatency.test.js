// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function setupRegistration(update) {
  const registration = new EventTarget()
  registration.installing = null
  registration.waiting = null
  registration.update = vi.fn(update)
  const serviceWorker = new EventTarget()
  serviceWorker.controller = { state: 'activated' }
  serviceWorker.ready = Promise.resolve(registration)
  serviceWorker.getRegistration = vi.fn().mockResolvedValue(registration)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
  return registration
}

function installWorker(registration, state = 'redundant') {
  const worker = new EventTarget()
  worker.state = state
  worker.postMessage = vi.fn()
  registration.installing = worker
  registration.dispatchEvent(new Event('updatefound'))
  return worker
}

describe('应用更新检查延迟', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('无更新时并行核对服务器版本，不把两个网络请求串行相加', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const updateGate = deferred()
    let updateSettled = false
    const registration = new EventTarget()
    registration.installing = null
    registration.waiting = null
    registration.update = vi.fn(() => updateGate.promise.finally(() => { updateSettled = true }))

    const serviceWorker = new EventTarget()
    serviceWorker.controller = { state: 'activated' }
    serviceWorker.ready = Promise.resolve(registration)
    serviceWorker.getRegistration = vi.fn().mockResolvedValue(registration)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })

    const { APP_RELEASE } = await import('../src/composables/releaseNotes.js')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => APP_RELEASE })
    vi.stubGlobal('fetch', fetchMock)

    const { checkForAppUpdate } = await import('../src/composables/appUpdate.js')
    const check = checkForAppUpdate()
    let checkSettled = false
    void check.then(() => { checkSettled = true })
    await vi.advanceTimersByTimeAsync(0)

    const fetchedWhileWorkerCheckPending = fetchMock.mock.calls.length > 0 && !updateSettled
    updateGate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const completedBeforeSafariGrace = checkSettled
    await vi.advanceTimersByTimeAsync(800)
    await check

    expect(registration.update).toHaveBeenCalledOnce()
    expect(fetchedWhileWorkerCheckPending).toBe(true)
    expect(completedBeforeSafariGrace).toBe(true)
  })

  it('版本号请求失败时仍等待 Safari 的延迟 updatefound 事件', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const worker = new EventTarget()
    worker.state = 'redundant'
    worker.postMessage = vi.fn()

    const registration = new EventTarget()
    registration.installing = null
    registration.waiting = null
    registration.update = vi.fn().mockResolvedValue(undefined)

    const serviceWorker = new EventTarget()
    serviceWorker.controller = { state: 'activated' }
    serviceWorker.ready = Promise.resolve(registration)
    serviceWorker.getRegistration = vi.fn().mockResolvedValue(registration)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { checkForAppUpdate, updateStage } = await import('../src/composables/appUpdate.js')
    window.setTimeout(() => {
      registration.installing = worker
      registration.dispatchEvent(new Event('updatefound'))
    }, 500)
    const check = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(500)

    await expect(check).resolves.toBe(false)
    expect(updateStage.value).toBe('error')
  })

  it('发现新版后不再等待尚未返回的 Worker 检查请求', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const updateGate = deferred()
    const registration = setupRegistration(() => updateGate.promise)
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { checkForAppUpdate, updateChecking } = await import('../src/composables/appUpdate.js')
    const check = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(0)
    installWorker(registration)
    await vi.advanceTimersByTimeAsync(0)
    expect(updateChecking.value).toBe(false)
    await expect(check).resolves.toBe(false)
    updateGate.resolve()
  })

  it('服务器版本请求缓慢时也能立即接入下载状态事件', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const registration = setupRegistration(async () => {})
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { checkForAppUpdate, updateChecking } = await import('../src/composables/appUpdate.js')
    const check = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(0)
    installWorker(registration)
    await vi.advanceTimersByTimeAsync(0)
    expect(updateChecking.value).toBe(false)
    await expect(check).resolves.toBe(false)
  })

  it('已安装的新版本直接启用，不重复发起检查', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const registration = setupRegistration(() => new Promise(() => {}))
    const worker = new EventTarget()
    worker.state = 'installed'
    worker.postMessage = vi.fn(() => {
      queueMicrotask(() => {
        worker.state = 'activated'
        worker.dispatchEvent(new Event('statechange'))
      })
    })
    registration.waiting = worker
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { checkForAppUpdate } = await import('../src/composables/appUpdate.js')
    const check = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(0)
    await expect(check).resolves.toBe(true)
    expect(registration.update).not.toHaveBeenCalled()
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('检查服务无响应时结束等待，允许重试且不误报最新', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const updateGate = deferred()
    const registration = setupRegistration(() => updateGate.promise)
    const { APP_RELEASE } = await import('../src/composables/releaseNotes.js')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => APP_RELEASE }))
    const { checkForAppUpdate, updateChecking, updateStage } = await import('../src/composables/appUpdate.js')
    const check = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(8000)
    await expect(check).resolves.toBe(false)
    expect(updateChecking.value).toBe(false)
    expect(updateStage.value).toBe('warning')
    registration.update.mockResolvedValue(undefined)
    await expect(checkForAppUpdate()).resolves.toBe(true)
    updateGate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(updateStage.value).toBe('latest')
  })

  it('首次打开仍在安装离线缓存时，当前页面已是最新版就立即结束检查', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const registration = setupRegistration(() => new Promise(() => {}))
    navigator.serviceWorker.controller = null
    installWorker(registration, 'installing')
    const { APP_RELEASE } = await import('../src/composables/releaseNotes.js')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => APP_RELEASE }))
    const { checkForAppUpdate, updateChecking, updateStage, needsManualReload } = await import('../src/composables/appUpdate.js')
    const check = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(0)
    expect(updateChecking.value).toBe(false)
    await expect(check).resolves.toBe(true)
    expect(updateStage.value).toBe('latest')
    expect(needsManualReload.value).toBe(false)
    expect(registration.update).not.toHaveBeenCalled()
  })

  it('未受 Worker 控制的页面在新版资源激活后保留手动应用入口', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const registration = setupRegistration(() => new Promise(() => {}))
    navigator.serviceWorker.controller = null
    registration.active = { state: 'activated' }
    const worker = new EventTarget()
    worker.state = 'installed'
    worker.postMessage = vi.fn(() => {
      queueMicrotask(() => {
        worker.state = 'activated'
        worker.dispatchEvent(new Event('statechange'))
      })
    })
    registration.waiting = worker
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { checkForAppUpdate, updateChecking, updateStage, needsManualReload, appUpdateProgress } = await import('../src/composables/appUpdate.js')
    const check = checkForAppUpdate()
    await vi.advanceTimersByTimeAsync(0)
    await expect(check).resolves.toBe(true)
    expect(updateChecking.value).toBe(false)
    expect(updateStage.value).toBe('manual-reload')
    expect(needsManualReload.value).toBe(true)
    expect(appUpdateProgress.state.active).toBe(false)
  })
})
