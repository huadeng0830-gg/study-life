// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebUpdateController, PENDING_WEB_UPDATE_KEY } from '../src/composables/webUpdateController.js'
import { compareRelease } from '../src/composables/updateProtocol.js'
import { CURRENT_TEST_VERSION as current, NEXT_TEST_VERSION as latest, TEST_BUILD_ID, TEST_SOURCE_SIGNATURE,
  makeReleaseManifest, releaseFetchResponse } from './helpers/releaseFixtures.js'

let controllers = []
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done }); return { resolve, promise } }
async function applyAndSettle(controller, repair = false) {
  const result = controller.apply(repair)
  await vi.advanceTimersByTimeAsync(450)
  return result
}
function fixture({ release = latest, fetchFn, worker = null, offline = false, noWorker = false } = {}) {
  const manifest = makeReleaseManifest(release)
  const registration = new EventTarget()
  registration.scope = 'https://fixture.invalid/'
  registration.update = vi.fn(async () => {})
  registration.unregister = vi.fn(async () => true)
  registration.active = { state: 'activated' }
  registration.waiting = worker
  registration.installing = null
  const serviceWorker = new EventTarget()
  serviceWorker.controller = { state: 'activated' }
  serviceWorker.getRegistration = vi.fn(async () => registration)
  const navigatorRef = { onLine: !offline, serviceWorker: noWorker ? null : serviceWorker }
  const fetchMock = fetchFn || vi.fn(async (path) => releaseFetchResponse(path, manifest))
  const reload = vi.fn()
  const controller = createWebUpdateController({ currentVersion: current, currentSourceSignature: TEST_SOURCE_SIGNATURE,
    currentBuildId: TEST_BUILD_ID, navigatorRef, fetchFn: fetchMock, reload })
  controllers.push(controller)
  return { controller, registration, serviceWorker, fetchMock, reload }
}
beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear() })
afterEach(() => { controllers.forEach((controller) => controller.dispose()); controllers = []; vi.clearAllTimers(); vi.useRealTimers() })

describe('网页更新的操作、事件和实际版本验证', () => {
  it('两个入口快速检查共用同一任务与版本请求', async () => {
    const gate = deferred()
    const { controller, fetchMock } = fixture({ fetchFn: vi.fn(() => gate.promise) })
    const first = controller.check(false)
    const second = controller.check(true)
    expect(first).toBe(second)
    expect(controller.state.stage).toBe('checking')
    gate.resolve(releaseFetchResponse('/release.json', makeReleaseManifest(current)))
    await expect(first).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(controller.state).toMatchObject({ stage: 'latest', taskPending: false })
  })

  it('断网不请求、不误报最新，并可在联网后重试', async () => {
    const { controller, fetchMock } = fixture({ offline: true })
    await expect(controller.check()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(controller.state.error.code).toBe('OFFLINE')
    expect(controller.state.taskPending).toBe(false)
  })

  it('网络失败只退避重试一次；JSON / HTML 错误页不能当版本安装', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('fictional network error'))
      .mockImplementation(async (path) => releaseFetchResponse(path, makeReleaseManifest(current)))
    const { controller } = fixture({ fetchFn: fetchMock, noWorker: true })
    const result = controller.check()
    await vi.advanceTimersByTimeAsync(250)
    await expect(result).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const malformed = fixture({ release: '<html>temporary error</html>', noWorker: true })
    await expect(malformed.controller.check()).resolves.toBe(false)
    expect(malformed.controller.state.error.code).toBe('SOURCE_INVALID')
    expect(malformed.registration.unregister).not.toHaveBeenCalled()
  })

  it('版本与 Worker 检查都不返回时按期限失败，允许重试', async () => {
    const { controller, registration } = fixture({ fetchFn: vi.fn(() => new Promise(() => {})) })
    registration.update.mockImplementation(() => new Promise(() => {}))
    const check = controller.check()
    await vi.advanceTimersByTimeAsync(8000)
    await expect(check).resolves.toBe(false)
    expect(controller.state).toMatchObject({ stage: 'error', taskPending: false, error: { code: 'TIMEOUT' } })
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('下载中两个入口都不能启动检查，超时只能等待原任务，不重复下载', async () => {
    const { controller, registration } = fixture({ fetchFn: vi.fn(() => new Promise(() => {})) })
    void controller.check()
    await vi.advanceTimersByTimeAsync(0)
    const worker = new EventTarget()
    worker.state = 'installing'
    worker.postMessage = vi.fn()
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    const task = controller.check()
    expect(controller.state.stage).toBe('downloading')
    controller.resourceFailed()
    expect(controller.state.stage).toBe('downloading')
    expect(registration.unregister).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30000)
    await expect(task).resolves.toBe(false)
    expect(controller.state).toMatchObject({ stage: 'error', taskPending: true, error: { retryAction: 'wait' } })
    await controller.continueDownload()
    expect(registration.update).toHaveBeenCalledTimes(1)
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    expect(controller.state).toMatchObject({ stage: 'warning', taskPending: false })
  })

  it('浏览器自行发现新 Worker 时重新计算任务耗时，不计入之前的空闲时间', async () => {
    const { controller, registration } = fixture({ release: current })
    await controller.check()
    const oldTask = controller.state.taskId
    await vi.advanceTimersByTimeAsync(300000)
    const worker = new EventTarget()
    worker.state = 'installing'
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    expect(controller.state.taskId).toBe(oldTask + 1)
    expect(controller.state.startedAt).toBe(Date.now())
    expect(controller.state.timings).toEqual([])
    expect(controller.state).toMatchObject({ stage: 'downloading', taskPending: true })
  })

  it('检查与下载完成都不宣告安装成功；明确应用并接管后才重载，重载后验证实际版本', async () => {
    const worker = new EventTarget()
    worker.state = 'installed'
    worker.postMessage = vi.fn()
    const { controller, serviceWorker, reload } = fixture({ worker })
    await controller.check()
    expect(controller.state.stage).toBe('ready')
    expect(worker.postMessage).not.toHaveBeenCalled()
    const firstApply = controller.apply()
    expect(controller.apply()).toBe(firstApply)
    await vi.advanceTimersByTimeAsync(450)
    await firstApply
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    worker.state = 'activated'
    worker.dispatchEvent(new Event('statechange'))
    expect(reload).not.toHaveBeenCalled()
    serviceWorker.controller = worker
    serviceWorker.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(controller.state.stage).toBe('verifying')
    controller.dispose()
    const verified = createWebUpdateController({ currentVersion: latest, currentSourceSignature: TEST_SOURCE_SIGNATURE,
      currentBuildId: TEST_BUILD_ID, navigatorRef: {}, reload: vi.fn() })
    controllers.push(verified)
    expect(verified.state).toMatchObject({ stage: 'completed', currentVersion: latest, availableVersion: '' })
    expect(sessionStorage.getItem(PENDING_WEB_UPDATE_KEY)).toBeNull()
  })

  it('缓存修复发现其他窗口仍在安装 Worker 时只订阅原任务，不注销或重载', async () => {
    const { controller, registration, reload, fetchMock } = fixture()
    const worker = new EventTarget()
    worker.state = 'installing'
    registration.installing = worker
    await expect(applyAndSettle(controller, true)).resolves.toBe(false)
    expect(registration.unregister).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/index.html'))).toBe(false)
    expect(sessionStorage.getItem(PENDING_WEB_UPDATE_KEY)).toBeNull()
    expect(controller.state).toMatchObject({ stage: 'downloading', taskPending: true })
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    expect(controller.state).toMatchObject({ stage: 'ready', taskPending: false })
  })

  it('应用前通过 BroadcastChannel 检测其他标签页并阻止影响其数据的重载', async () => {
    const peers = new Set()
    class TestChannel {
      listeners = new Set()
      constructor() { peers.add(this) }
      addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener) }
      postMessage(data) {
        for (const peer of peers) if (peer !== this)
          for (const listener of peer.listeners) listener({ data })
      }
      close() { peers.delete(this) }
    }
    const windowRef = {
      BroadcastChannel: TestChannel,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      sessionStorage,
      location: window.location,
      caches: window.caches,
    }
    const fetchFn = vi.fn(async (path) => releaseFetchResponse(path, makeReleaseManifest(latest)))
    const first = createWebUpdateController({ currentVersion: current, currentSourceSignature: TEST_SOURCE_SIGNATURE,
      navigatorRef: { onLine: true }, windowRef, fetchFn, reload: vi.fn() })
    const second = createWebUpdateController({ currentVersion: current, currentSourceSignature: TEST_SOURCE_SIGNATURE,
      navigatorRef: { onLine: true }, windowRef: { ...windowRef }, fetchFn, reload: vi.fn() })
    controllers.push(first, second)
    const applying = first.apply()
    await vi.advanceTimersByTimeAsync(450)
    await expect(applying).resolves.toBe(false)
    expect(first.state).toMatchObject({ stage: 'warning', error: { code: 'OTHER_TASK' } })
    expect(fetchFn.mock.calls.some(([url]) => String(url).startsWith('/index.html'))).toBe(false)
  })

  it('核对修复入口期间出现新 Worker，也不删除正在接收的资源', async () => {
    const entry = deferred()
    const fetchFn = vi.fn(async (url) => url.startsWith('/index.html') ? entry.promise : releaseFetchResponse(url, makeReleaseManifest(latest)))
    const { controller, registration, reload } = fixture({ fetchFn })
    const repair = controller.apply(true)
    await vi.advanceTimersByTimeAsync(450)
    await vi.advanceTimersByTimeAsync(0)
    const worker = new EventTarget()
    worker.state = 'installing'
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    entry.resolve(releaseFetchResponse('/index.html', makeReleaseManifest(latest)))
    await expect(repair).resolves.toBe(false)
    expect(registration.unregister).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(PENDING_WEB_UPDATE_KEY)).toBeNull()
    expect(controller.state).toMatchObject({ stage: 'downloading', taskPending: true })
  })

  it('重新加载仍为旧版本时明确验证失败，静默检查不能覆盖失败', async () => {
    sessionStorage.setItem(PENDING_WEB_UPDATE_KEY, JSON.stringify({ fromVersion: current, toVersion: latest, savedAt: Date.now() }))
    const { controller, fetchMock } = fixture()
    expect(controller.state.error.code).toBe('VERSION_VERIFY')
    await expect(controller.check(false)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(controller.state.stage).toBe('error')
  })

  it.each([
    ['构建编号', { currentBuildId: 'different-build', currentSourceSignature: TEST_SOURCE_SIGNATURE }],
    ['源码签名', { currentBuildId: TEST_BUILD_ID, currentSourceSignature: 'fedcba9876543210' }],
  ])('运行版本相同但%s不符时不宣告更新成功', (_label, identity) => {
    sessionStorage.setItem(PENDING_WEB_UPDATE_KEY, JSON.stringify({ fromVersion: current, toVersion: latest,
      expectedBuildId: TEST_BUILD_ID, expectedSourceSignature: TEST_SOURCE_SIGNATURE, savedAt: Date.now() }))
    const controller = createWebUpdateController({ currentVersion: latest, currentBuildId: identity.currentBuildId,
      currentSourceSignature: identity.currentSourceSignature, navigatorRef: {}, reload: vi.fn() })
    controllers.push(controller)
    expect(controller.state).toMatchObject({ stage: 'error', error: { code: 'VERSION_VERIFY' } })
    expect(controller.state.error.message).toContain('版本或构建')
    expect(sessionStorage.getItem(PENDING_WEB_UPDATE_KEY)).toBeNull()
  })

  it('目标版本发布期间被更新版本取代时允许验证更高的实际版本', () => {
    sessionStorage.setItem(PENDING_WEB_UPDATE_KEY, JSON.stringify({ fromVersion: current, toVersion: latest,
      expectedBuildId: TEST_BUILD_ID, expectedSourceSignature: TEST_SOURCE_SIGNATURE, savedAt: Date.now() }))
    const newerVersion = `${latest.slice(0, latest.lastIndexOf('.') + 1)}${Number(latest.slice(latest.lastIndexOf('.') + 1)) + 1}`
    const controller = createWebUpdateController({ currentVersion: newerVersion, currentBuildId: 'newer-build',
      currentSourceSignature: 'fedcba9876543210', navigatorRef: {}, reload: vi.fn() })
    controllers.push(controller)
    expect(controller.state).toMatchObject({ stage: 'completed', currentVersion: newerVersion })
    expect(sessionStorage.getItem(PENDING_WEB_UPDATE_KEY)).toBeNull()
  })

  it('等待接管超时给手动出口，不永久加载或误报成功', async () => {
    const worker = new EventTarget()
    worker.state = 'installed'
    worker.postMessage = vi.fn()
    const { controller } = fixture({ worker })
    await controller.check()
    await applyAndSettle(controller)
    await vi.advanceTimersByTimeAsync(6000)
    expect(controller.state).toMatchObject({ stage: 'manual-reload', taskPending: false })
  })

  it('重载抛错后的旧定时器不能覆盖后来开始的检查', async () => {
    const gate = deferred()
    const fetchFn = vi.fn(async (path) => releaseFetchResponse(path, makeReleaseManifest(latest)))
    const reload = vi.fn(() => { throw new Error('navigation rejected') })
    const controller = createWebUpdateController({ currentVersion: current, currentSourceSignature: TEST_SOURCE_SIGNATURE,
      currentBuildId: TEST_BUILD_ID, navigatorRef: {}, fetchFn, reload })
    controllers.push(controller)
    await applyAndSettle(controller)
    expect(controller.state.error.code).toBe('RELOAD_TIMEOUT')
    await vi.advanceTimersByTimeAsync(5000)
    fetchFn.mockImplementation(() => gate.promise)
    const check = controller.check()
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.state).toMatchObject({ stage: 'checking', taskPending: true, taskId: 2 })
    gate.resolve(releaseFetchResponse('/release.json', makeReleaseManifest(current)))
    await expect(check).resolves.toBe(true)
  })

  it('缓存恢复后取消导航，手动重载不再访问已注销的注册对象', async () => {
    const { controller, registration, serviceWorker, reload } = fixture()
    serviceWorker.ready = Promise.resolve(registration)
    registration.unregister.mockImplementation(async () => {
      serviceWorker.getRegistration.mockResolvedValue(undefined)
      registration.update.mockRejectedValue(new DOMException('registration gone', 'InvalidStateError'))
      return true
    })
    await applyAndSettle(controller, true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(controller.state.stage).toBe('manual-reload')
    await expect(applyAndSettle(controller)).resolves.toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
    expect(registration.update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6000)
    await expect(applyAndSettle(controller, true)).resolves.toBe(true)
    expect(registration.unregister).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('会话存储 getter 被禁止时仍建立可恢复错误状态，且不会未经验证重载', async () => {
    const windowRef = { setTimeout, clearTimeout, get sessionStorage() { throw new DOMException('denied', 'SecurityError') } }
    const reload = vi.fn()
    const controller = createWebUpdateController({ currentVersion: current, windowRef, navigatorRef: {},
      fetchFn: async (path) => releaseFetchResponse(path, makeReleaseManifest(latest)), reload })
    controllers.push(controller)
    expect(controller.state).toMatchObject({ stage: 'error', taskPending: false, error: { code: 'STORAGE' } })
    await expect(applyAndSettle(controller)).resolves.toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('恢复前入口版本不一致时不注销 Worker、不删除缓存', async () => {
    const { controller, registration } = fixture({ fetchFn: vi.fn(async (path) => path.startsWith('/index.html')
      ? { ok: true, text: async () => '<html>outdated entry</html>' }
      : releaseFetchResponse(path, makeReleaseManifest(latest))) })
    await expect(applyAndSettle(controller, true)).resolves.toBe(false)
    expect(registration.unregister).not.toHaveBeenCalled()
    expect(controller.state.error.code).toBe('SOURCE_INVALID')
    expect(controller.state.currentVersion).toBe(current)
  })

  it('缓存恢复仅处理当前应用，保留 OCR 和同源其他应用缓存', async () => {
    const previousCaches = window.caches
    const deleteCache = vi.fn(async () => true)
    Object.defineProperty(window, 'caches', { configurable: true, value: {
      keys: async () => ['study-life-lazy-assets', 'study-life-ocr-language-v1',
        'workbox-precache-v2-https://fixture.invalid/', 'workbox-precache-v2-https://fixture.invalid/other/', 'other-app-cache'],
      delete: deleteCache,
    } })
    try {
      const { controller, registration } = fixture()
      await expect(applyAndSettle(controller, true)).resolves.toBe(true)
      expect(registration.unregister).toHaveBeenCalledTimes(1)
      expect(deleteCache.mock.calls.map(([key]) => key)).toEqual(['study-life-lazy-assets', 'workbox-precache-v2-https://fixture.invalid/'])
    } finally { Object.defineProperty(window, 'caches', { configurable: true, value: previousCaches }) }
  })

  it('组件之外的控制器停止后，迟到结果不会改写状态', async () => {
    const gate = deferred()
    const { controller } = fixture({ fetchFn: vi.fn(() => gate.promise) })
    const check = controller.check()
    controller.dispose()
    gate.resolve(releaseFetchResponse('/release.json', makeReleaseManifest(latest)))
    await expect(check).resolves.toBe(false)
    expect(controller.state.stage).toBe('checking')
  })

  it('SemVer 正确处理预发布优先级，并禁止回退或非法版本', async () => {
    expect(compareRelease('2026年10月10日-版本10', '2026年10月10日-版本9')).toBe(1)
    expect(compareRelease('2026年02月30日-版本1', current)).toBeNull()
    expect(compareRelease('1.2.0-rc.2', '1.2.0-rc.1')).toBe(1)
    expect(compareRelease('1.2.0', '1.2.0-rc.9')).toBe(1)
    const { controller } = fixture({ release: '0.9.9' })
    await expect(controller.check()).resolves.toBe(false)
    expect(controller.state.error.code).toBe('SOURCE_ROLLBACK')
  })
})
