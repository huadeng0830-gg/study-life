// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Windows 桌面版更新桥接', () => {
  let previousApi

  beforeEach(() => {
    vi.resetModules()
    previousApi = window.studyLifeDesktop
  })

  afterEach(() => {
    vi.resetModules()
    if (previousApi === undefined) delete window.studyLifeDesktop
    else window.studyLifeDesktop = previousApi
  })

  it('读取主进程版本状态、限制进度范围并在组件卸载后取消订阅', async () => {
    let listener
    const unsubscribe = vi.fn()
    window.studyLifeDesktop = {
      isDesktop: true,
      getUpdateState: vi.fn(async () => ({
        stage: 'available', currentVersion: '1.0.3', availableVersion: '1.0.4',
        percent: 0, lastCheckedAt: 1760000000000, message: '发现新版本。',
      })),
      onUpdateState: vi.fn((callback) => {
        listener = callback
        return unsubscribe
      }),
    }

    const update = await import('../src/composables/desktopAppUpdate.js')
    const stop = update.subscribeToDesktopUpdateState()
    await Promise.resolve()

    expect(update.isDesktopApp).toBe(true)
    expect(update.desktopUpdateState.value).toMatchObject({ stage: 'available', currentVersion: '1.0.3' })

    listener({ stage: 'downloading', currentVersion: '1.0.3', percent: 125, message: '正在下载。' })
    expect(update.desktopUpdateState.value).toMatchObject({ stage: 'downloading', percent: 100 })

    stop()
    listener({ stage: 'ready', currentVersion: '1.0.3', percent: 100, message: '完成' })
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(update.desktopUpdateState.value.stage).toBe('downloading')
  })

  it('把检查、下载和安装操作转发给主进程', async () => {
    const api = {
      isDesktop: true,
      checkForUpdates: vi.fn(async () => true),
      downloadUpdate: vi.fn(async () => true),
      installUpdate: vi.fn(async () => true),
    }
    window.studyLifeDesktop = api
    const update = await import('../src/composables/desktopAppUpdate.js')

    await expect(update.checkDesktopAppUpdate()).resolves.toBe(true)
    await expect(update.downloadDesktopAppUpdate()).resolves.toBe(true)
    await expect(update.installDesktopAppUpdate()).resolves.toBe(true)
    expect(api.checkForUpdates).toHaveBeenCalledOnce()
    expect(api.downloadUpdate).toHaveBeenCalledOnce()
    expect(api.installUpdate).toHaveBeenCalledOnce()
  })
})
