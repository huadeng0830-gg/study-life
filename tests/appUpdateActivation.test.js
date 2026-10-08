// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

import { createControllerTakeoverMonitor } from '../src/composables/appUpdate.js'

class FakeServiceWorkerContainer extends EventTarget {
  constructor(hasController) {
    super()
    this.controller = hasController ? { state: 'activated' } : null
  }
  /**
   * 真实浏览器里，`controllerchange` 派发时 `controller` **已经**换成新 Worker 了；
   * unregister 则是反过来的 —— 它也派发 controllerchange，但 controller 变成 null。
   * 夹具必须区分这两种，否则测不出"注销被误当成接管"这个缺陷。
   */
  takeover(newController = { state: 'activated' }) {
    this.controller = newController
    this.dispatchEvent(new Event('controllerchange'))
  }
  unregisterAll() {
    this.controller = null
    this.dispatchEvent(new Event('controllerchange'))
  }
}

describe('Service Worker 更新切换', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('activated 后不按固定延时刷新，等旧页面控制权切换', () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorkerContainer(true)
    const onTakeover = vi.fn()
    const onTimeout = vi.fn()
    const monitor = createControllerTakeoverMonitor(serviceWorker, {
      timeoutMs: 6000,
      onTakeover,
      onTimeout,
    })

    expect(monitor.waitForTakeover()).toBe(true)
    vi.advanceTimersByTime(900)
    expect(onTakeover).not.toHaveBeenCalled()
    expect(onTimeout).not.toHaveBeenCalled()

    serviceWorker.takeover()
    expect(onTakeover).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(6000)
    expect(onTimeout).not.toHaveBeenCalled()
    monitor.dispose()
  })

  it('首次被 Worker 接管不重载；迟迟未接管时进入可恢复超时状态', () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorkerContainer(false)
    const onTakeover = vi.fn()
    const onTimeout = vi.fn()
    const monitor = createControllerTakeoverMonitor(serviceWorker, {
      timeoutMs: 6000,
      onTakeover,
      onTimeout,
    })

    expect(monitor.waitForTakeover()).toBe(false)
    serviceWorker.takeover()
    expect(onTakeover).not.toHaveBeenCalled()

    monitor.waitForTakeover()
    vi.advanceTimersByTime(6000)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(onTakeover).not.toHaveBeenCalled()
    monitor.dispose()
  })

  it('注销 Worker 引起的 controllerchange 不算"新版本接管"', () => {
    // forceRecoverToLatest 与启动恢复都会 unregister 全部 Worker，那条路径同样
    // 会派发 controllerchange。原来只看"之前有没有过控制器"，于是注销被当成
    // 接管成功：用户看到「更新完成，即将重新打开…」，900ms 后在恢复刷新之上
    // 又叠一次重载。判据必须是 controller 确实换成了新的那个。
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorkerContainer(true)
    const onTakeover = vi.fn()
    const onTimeout = vi.fn()
    const monitor = createControllerTakeoverMonitor(serviceWorker, {
      timeoutMs: 6000,
      onTakeover,
      onTimeout,
    })

    monitor.waitForTakeover()
    serviceWorker.unregisterAll()
    expect(onTakeover, '注销不应触发重载').not.toHaveBeenCalled()

    // 注销之后若真的来了新控制器，仍然要正常接管。
    serviceWorker.takeover()
    expect(onTakeover).toHaveBeenCalledOnce()
    monitor.dispose()
  })
})
