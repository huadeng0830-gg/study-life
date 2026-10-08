import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import updaterControllerModule from '../desktop-app/updaterController.cjs'

const { createUpdaterController } = updaterControllerModule

function makeUpdater(overrides = {}) {
  const updater = new EventEmitter()
  updater.checkForUpdates = vi.fn(async () => {})
  updater.downloadUpdate = vi.fn(async () => {})
  updater.quitAndInstall = vi.fn()
  Object.assign(updater, overrides)
  return updater
}

describe('Windows 桌面自动更新控制器', () => {
  it('检查发现新版后等待用户下载，展示进度并在确认后安装', async () => {
    const updater = makeUpdater({
      checkForUpdates: vi.fn(async function check() {
        this.emit('update-available', { version: '1.0.4' })
      }),
      downloadUpdate: vi.fn(async function download() {
        this.emit('download-progress', { percent: 41.6 })
        this.emit('update-downloaded', { version: '1.0.4' })
      }),
    })
    const sent = []
    const controller = createUpdaterController({
      autoUpdater: updater,
      currentVersion: '1.0.3',
      publish: (state) => sent.push(state),
    })

    await controller.check()
    expect(controller.getState()).toMatchObject({ stage: 'available', availableVersion: '1.0.4' })
    expect(updater.autoDownload).toBe(false)
    expect(updater.downloadUpdate).not.toHaveBeenCalled()

    await controller.download()
    expect(sent.some((state) => state.stage === 'downloading' && state.percent === 42)).toBe(true)
    expect(controller.getState()).toMatchObject({ stage: 'ready', percent: 100, availableVersion: '1.0.4' })
    expect(controller.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('不连接更新服务时提供可读状态且不会调用更新器', async () => {
    const updater = makeUpdater()
    const controller = createUpdaterController({
      autoUpdater: updater,
      currentVersion: '1.0.3',
      enabled: false,
    })

    expect(await controller.check()).toBe(false)
    expect(await controller.download()).toBe(false)
    expect(controller.install()).toBe(false)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ stage: 'idle', currentVersion: '1.0.3' })
  })

  it('更新服务异常时不把网络或本地错误详情透出到界面', async () => {
    const updater = makeUpdater({ checkForUpdates: vi.fn(async () => { throw new Error('private path or token') }) })
    const controller = createUpdaterController({ autoUpdater: updater, currentVersion: '1.0.3' })

    expect(await controller.check()).toBe(false)
    expect(controller.getState()).toMatchObject({
      stage: 'error',
      message: '连接更新服务失败，请检查网络后重试。',
    })
    expect(controller.getState().message).not.toContain('private path')
  })
})
