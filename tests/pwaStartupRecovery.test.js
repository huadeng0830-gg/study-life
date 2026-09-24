import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  STARTUP_RECOVERY_WINDOW_MS,
  STARTUP_RESOURCE_RECOVERY_KEY,
  canRecoverPwaStartupResources,
  recoverPwaStartupResources,
} from '../src/composables/pwaStartupRecovery.js'

function memoryStorage(store = new Map()) {
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  }
}

function sessionLike() {
  return memoryStorage()
}

describe('PWA 启动资源恢复', () => {
  it('首次启动资源错误会注销 Service Worker、清理 Cache Storage 并只刷新一次', async () => {
    const session = new Map()
    const firstWorker = { unregister: vi.fn(async () => true) }
    const secondWorker = { unregister: vi.fn(async () => true) }
    const cacheStorage = {
      keys: vi.fn(async () => ['workbox-precache-old', 'study-life-lazy-assets']),
      delete: vi.fn(async () => true),
    }
    const reload = vi.fn()

    const first = await recoverPwaStartupResources({
      session: { getItem: (key) => session.get(key) || null, setItem: (key, value) => session.set(key, value) },
      navigatorRef: { serviceWorker: { getRegistrations: vi.fn(async () => [firstWorker, secondWorker]) } },
      cachesRef: cacheStorage,
      reload,
    })
    const second = await recoverPwaStartupResources({
      session: { getItem: (key) => session.get(key) || null, setItem: (key, value) => session.set(key, value) },
      navigatorRef: { serviceWorker: { getRegistrations: vi.fn(async () => []) } },
      cachesRef: cacheStorage,
      reload,
    })

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(session.get(STARTUP_RESOURCE_RECOVERY_KEY)).toBe('1')
    expect(firstWorker.unregister).toHaveBeenCalledOnce()
    expect(secondWorker.unregister).toHaveBeenCalledOnce()
    expect(cacheStorage.delete).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledOnce()
  })

  // 这是手机端「打不开、一直在刷新首页」的回归测试。
  // 故障形态：分包持续 404，而 App 依然挂载得起来（路由把失败兜成错误界面）。
  // 旧实现会在挂载成功后清空恢复预算，于是每次重载都能再恢复一次 —— 无限刷新。
  // 现在预算记在 localStorage 的时间窗里，重载清不掉，用完就必须停下来显示失败界面。
  it('分包持续失败时最多自动重载两次就停下（不再无限刷新）', async () => {
    const storage = memoryStorage()
    const now = 1_700_000_000_000
    const reload = vi.fn()
    const worker = { unregister: vi.fn(async () => true) }
    const cachesRef = { keys: vi.fn(async () => []), delete: vi.fn(async () => true) }
    const attempt = () => recoverPwaStartupResources({
      // 每次重载都是「新页面」：会话标记为空，模拟旧实现在挂载后清零的效果。
      session: sessionLike(),
      navigatorRef: { serviceWorker: { getRegistrations: vi.fn(async () => [worker]) } },
      cachesRef,
      reload,
      storage,
      now: () => now,
    })

    expect(await attempt()).toBe(true)
    expect(await attempt()).toBe(true)
    // 第三次必须拒绝：这正是原来缺失的那道上限。
    expect(await attempt()).toBe(false)
    expect(await attempt()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(2)
    expect(canRecoverPwaStartupResources({ storage, now: () => now })).toBe(false)
  })

  it('超出时间窗后允许再次自动恢复（长会话不会被一次故障永久锁死）', async () => {
    const storage = memoryStorage()
    let now = 1_700_000_000_000
    const reload = vi.fn()
    const options = () => ({
      session: sessionLike(),
      navigatorRef: { serviceWorker: { getRegistrations: vi.fn(async () => []) } },
      cachesRef: { keys: vi.fn(async () => []), delete: vi.fn(async () => true) },
      reload,
      storage,
      now: () => now,
    })

    await recoverPwaStartupResources(options())
    await recoverPwaStartupResources(options())
    expect(canRecoverPwaStartupResources({ storage, now: () => now })).toBe(false)

    now += STARTUP_RECOVERY_WINDOW_MS + 1
    expect(canRecoverPwaStartupResources({ storage, now: () => now })).toBe(true)
    expect(await recoverPwaStartupResources(options())).toBe(true)
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('没有 localStorage（隐私模式）时退回每会话一次，仍然不会无限刷新', async () => {
    const session = sessionLike()
    const reload = vi.fn()
    const run = () => recoverPwaStartupResources({
      session,
      navigatorRef: { serviceWorker: { getRegistrations: vi.fn(async () => []) } },
      cachesRef: { keys: vi.fn(async () => []), delete: vi.fn(async () => true) },
      reload,
      storage: null,
    })

    expect(await run()).toBe(true)
    expect(await run()).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  // 上面三条守的是「模块自己的上限」。这条守的是**调用方**：预算只能在用户显式重试时清空。
  // 一旦有人在挂载成功的路径上又加一次清空，无限刷新就会复活——而单靠模块测试看不出来。
  it('启动流程只在用户显式重试时清空预算，挂载成功不碰它', () => {
    const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    const calls = withoutComments.match(/clearPwaStartupRecovery\(/g) || []

    expect(calls).toHaveLength(1)
    // 那唯一一次必须出现在「重新加载」按钮的回调里，紧跟着真正的恢复调用。
    expect(withoutComments).toMatch(/clearPwaStartupRecovery\(\)\s*\n\s*recoverStartupResources\(\)/)
  })
})
