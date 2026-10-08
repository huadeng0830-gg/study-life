// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
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
})
