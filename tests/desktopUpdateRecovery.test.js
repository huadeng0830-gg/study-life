import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import updaterModule from '../desktop-app/updaterController.cjs'

const controllers = []
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
function fixture(options = {}, overrides = {}) {
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async function () { this.emit('update-available', { version: '1.0.4' }) }),
    downloadUpdate: vi.fn(async function () { this.emit('update-downloaded', { version: '1.0.4' }) }),
    quitAndInstall: vi.fn(),
  }, overrides)
  const controller = updaterModule.createUpdaterController({ autoUpdater: updater, currentVersion: '1.0.3', ...options })
  controllers.push(controller)
  return { updater, controller }
}
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.useRealTimers() })

describe('桌面更新的物理任务锁、异常恢复与实际版本验证', () => {
  it('快速点击检查共用一个物理请求，不允许另一入口下载', async () => {
    const gate = deferred()
    const { updater, controller } = fixture({}, { checkForUpdates: vi.fn(() => gate.promise) })
    const first = controller.check()
    expect(controller.check()).toBe(first)
    await expect(controller.download()).resolves.toBe(false)
    gate.resolve({ updateInfo: { version: '1.0.4' } })
    await expect(first).resolves.toBe(true)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ stage: 'available', taskPending: false })
  })

  it('检查超时退出加载，保留锁直到原请求结束，并拒绝迟到结果', async () => {
    vi.useFakeTimers()
    const gate = deferred()
    const { updater, controller } = fixture({ checkTimeoutMs: 1000 }, { checkForUpdates: vi.fn(() => gate.promise) })
    const check = controller.check()
    await vi.advanceTimersByTimeAsync(1000)
    await expect(check).resolves.toBe(false)
    updater.emit('update-available', { version: '1.0.4' })
    expect(controller.getState()).toMatchObject({ stage: 'error', taskPending: true, error: { code: 'TIMEOUT' } })
    await controller.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    gate.resolve({ updateInfo: { version: '1.0.4' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getState()).toMatchObject({ stage: 'error', taskPending: false, canRetry: true })
  })

  it('相同进度不能掩盖下载卡死，结束原下载后允许真正重试', async () => {
    vi.useFakeTimers()
    const gate = deferred()
    const cancellation = { cancel: vi.fn() }
    const { updater, controller } = fixture({ downloadTimeoutMs: 1000, createCancellationToken: () => cancellation },
      { downloadUpdate: vi.fn(() => gate.promise) })
    await controller.check()
    const download = controller.download()
    updater.emit('download-progress', { percent: 20, transferred: 200, total: 1000 })
    await vi.advanceTimersByTimeAsync(800)
    updater.emit('download-progress', { percent: 20, transferred: 200, total: 1000 })
    await vi.advanceTimersByTimeAsync(200)
    await expect(download).resolves.toBe(false)
    expect(cancellation.cancel).toHaveBeenCalledTimes(1)
    updater.emit('update-downloaded', { version: '1.0.4' })
    expect(controller.getState()).toMatchObject({ stage: 'error', taskPending: true })
    await controller.download()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    gate.reject(new Error('cancelled transport'))
    await vi.advanceTimersByTimeAsync(0)
    updater.downloadUpdate.mockImplementation(async () => updater.emit('update-downloaded', { version: '1.0.4' }))
    await expect(controller.download()).resolves.toBe(true)
    expect(controller.getState()).toMatchObject({ stage: 'ready', taskPending: false })
  })

  it('用户取消下载后只取消一次，物理请求结束前不能重新启动', async () => {
    const gate = deferred()
    const cancellation = { cancel: vi.fn() }
    const { updater, controller } = fixture({ createCancellationToken: () => cancellation },
      { downloadUpdate: vi.fn(() => gate.promise) })
    await controller.check()
    const download = controller.download()
    expect(controller.cancel()).toBe(true)
    expect(controller.cancel()).toBe(false)
    updater.emit('update-downloaded', { version: '1.0.4' })
    expect(controller.download()).toBe(download)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ stage: 'cancelled', taskPending: true, canCancel: false })
    gate.resolve([])
    await expect(download).resolves.toBe(false)
    expect(cancellation.cancel).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ stage: 'cancelled', taskPending: false })
  })

  it('返回文件路径但没有已校验下载事件不能变为待安装', async () => {
    const { controller } = fixture({}, { downloadUpdate: vi.fn(async () => ['fictional-update.exe']) })
    await controller.check()
    await expect(controller.download()).resolves.toBe(false)
    expect(controller.getState()).toMatchObject({ stage: 'error', error: { code: 'VERSION_VERIFY' } })
    expect(controller.install()).toBe(false)
  })

  it('下载目标发生变化或版本格式异常时不能被后续下载事件覆盖', async () => {
    const { updater, controller } = fixture({}, { downloadUpdate: vi.fn(async function () {
      this.emit('update-downloaded', { version: '1.0.5' })
      this.emit('update-downloaded', { version: '1.0.4' })
    }) })
    await controller.check()
    await expect(controller.download()).resolves.toBe(false)
    expect(controller.getState().stage).toBe('error')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it.each([
    ['ENOSPC', 'DISK_FULL'], ['EACCES', 'PERMISSION'], ['EIO', 'FILE_WRITE'],
    ['ERR_UPDATER_INVALID_SIGNATURE', 'INTEGRITY'], ['404', 'SOURCE_HTTP'], ['ERR_UPDATER_INVALID_UPDATE_INFO', 'SOURCE_INVALID'],
  ])('下载失败 %s 给出 %s，并允许符合条件的下载重试', async (code, type) => {
    const { controller } = fixture({}, { downloadUpdate: vi.fn(async () => {
      throw Object.assign(new Error('fictional private-path token=fixture-only'), { code })
    }) })
    await controller.check()
    await expect(controller.download()).resolves.toBe(false)
    const state = controller.getState()
    expect(state).toMatchObject({ stage: 'error', currentVersion: '1.0.3', taskPending: false, canRetry: true,
      error: { code: type, retryAction: 'download' } })
    expect(JSON.stringify(state)).not.toContain('private-path')
  })

  it('安装器一直未退出时提示恢复途径，不能启动第二个安装器', async () => {
    vi.useFakeTimers()
    const { updater, controller } = fixture({ installTimeoutMs: 1000 })
    await controller.check()
    await controller.download()
    expect(controller.install()).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.getState()).toMatchObject({ stage: 'error', taskPending: true, canRetry: false })
    expect(controller.install()).toBe(false)
    await expect(controller.check()).resolves.toBe(false)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it.each([['1.0.4', 'completed'], ['1.0.3', 'error']])('重启后用实际版本 %s 验证目标，结果为 %s', (version, stage) => {
    const clearPendingInstall = vi.fn()
    const { controller } = fixture({ currentVersion: version, pendingInstall: { toVersion: '1.0.4' }, clearPendingInstall })
    expect(controller.getState()).toMatchObject({ stage, currentVersion: version, availableVersion: '' })
    expect(clearPendingInstall).toHaveBeenCalledTimes(1)
  })
})
