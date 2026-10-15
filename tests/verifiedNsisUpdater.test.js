import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import verifiedModule from '../desktop-app/verifiedNsisUpdater.cjs'
import controllerModule from '../desktop-app/updaterController.cjs'

const require = createRequire(import.meta.url)
// NsisUpdater contains Windows-only installer behavior; Linux runs the general
// quality gate and Windows CI runs this suite with the real package installed.
const { NsisUpdater } = process.platform === 'win32'
  ? require('../desktop-app/node_modules/electron-updater/out/NsisUpdater.js')
  : {}
const { DownloadedUpdateHelper } = process.platform === 'win32'
  ? require('../desktop-app/node_modules/electron-updater/out/DownloadedUpdateHelper.js')
  : {}
const controllers = []
const installer = 'C:\\fictional-fixture\\updates\\pending\\update.exe'
function childProcess() { const child = new EventEmitter(); child.pid = 4242; child.unref = vi.fn(); return child }
async function fixture({ spawnInstaller = vi.fn(() => {
  const child = childProcess(); queueMicrotask(() => child.emit('spawn')); return child
}), hashFile = vi.fn(async () => 'fictional-hash'), admin = false } = {}) {
  const VerifiedNsisUpdater = verifiedModule.createVerifiedNsisUpdaterClass(NsisUpdater, { spawnInstaller, hashFile })
  const app = { version: '1.0.3', name: 'Fixture', isPackaged: true, quit: vi.fn() }
  const updater = new VerifiedNsisUpdater(null, app)
  updater.logger = { info() {}, warn() {}, error() {} }
  updater.configOnDisk = { value: Promise.resolve({ publisherName: 'Fixture Publisher' }) }
  updater.verifyUpdateCodeSignature = vi.fn(async () => null)
  const helper = new DownloadedUpdateHelper('C:\\fictional-fixture\\updates')
  await helper.setDownloadedFile(installer, null, { version: '1.0.4' },
    { info: { sha512: 'fictional-hash', isAdminRightsRequired: admin } }, 'update.exe', false)
  helper.clear = vi.fn(async () => {})
  updater.downloadedUpdateHelper = helper
  const savePendingInstall = vi.fn()
  const clearPendingInstall = vi.fn()
  const controller = controllerModule.createUpdaterController({ autoUpdater: updater, currentVersion: '1.0.3',
    installVerifiedUpdate: (options) => updater.quitAndInstall(true, true, options), savePendingInstall, clearPendingInstall })
  controllers.push(controller)
  updater.emit('update-downloaded', { version: '1.0.4' })
  return { updater, app, controller, helper, spawnInstaller, hashFile, savePendingInstall, clearPendingInstall }
}
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.useRealTimers() })

describe.skipIf(process.platform !== 'win32')('已固定版本的真实 NsisUpdater 安装启动边界（进程为可控执行器）', () => {
  it('进程有 pid 但未触发 spawn 时不能退出；启动后仍需重启验证版本', async () => {
    const child = childProcess()
    const { controller, updater, app, spawnInstaller } = await fixture({ spawnInstaller: vi.fn(() => child) })
    const install = controller.install()
    await vi.waitFor(() => expect(spawnInstaller).toHaveBeenCalledTimes(1))
    expect(app.quit).not.toHaveBeenCalled()
    expect(controller.getState().stage).toBe('installing')
    expect(controller.install()).toBe(false)
    child.emit('spawn')
    await expect(install).resolves.toBe(true)
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ stage: 'verifying', currentVersion: '1.0.3', taskPending: true })
    expect(updater.quitAndInstallCalled).toBe(true)
    expect(spawnInstaller).toHaveBeenCalledWith(installer, ['--updated', '/S', '--force-run'],
      { detached: true, stdio: 'ignore', shell: false, windowsHide: true })
  })

  it('异步 EPERM 启动失败不退出、不遗留上游安装锁，第二次安装真实可执行', async () => {
    let fail = true
    const spawnInstaller = vi.fn(() => {
      const child = childProcess()
      queueMicrotask(() => fail ? child.emit('error', Object.assign(new Error('fictional error'), { code: 'EPERM' })) : child.emit('spawn'))
      return child
    })
    const { controller, updater, app, clearPendingInstall } = await fixture({ spawnInstaller })
    await expect(controller.install()).resolves.toBe(false)
    expect(app.quit).not.toHaveBeenCalled()
    expect(updater.quitAndInstallCalled).toBe(false)
    expect(clearPendingInstall).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ stage: 'error', taskPending: false, canRetry: true, error: { code: 'PERMISSION' } })
    fail = false
    await expect(controller.install()).resolves.toBe(true)
    expect(spawnInstaller).toHaveBeenCalledTimes(2)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('EACCES 与需要管理员权限的包不触发 elevate.exe 或 shell 回退', async () => {
    const spawnInstaller = vi.fn(() => {
      const child = childProcess()
      queueMicrotask(() => child.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' })))
      return child
    })
    const denied = await fixture({ spawnInstaller })
    await expect(denied.controller.install()).resolves.toBe(false)
    expect(spawnInstaller).toHaveBeenCalledTimes(1)
    expect(denied.app.quit).not.toHaveBeenCalled()
    const admin = await fixture({ admin: true })
    await expect(admin.controller.install()).resolves.toBe(false)
    expect(admin.spawnInstaller).not.toHaveBeenCalled()
    expect(admin.controller.getState().error.code).toBe('PERMISSION')
  })

  it('启动前重新核对 SHA512 与原发布者签名，异常不执行并清除损坏的更新缓存', async () => {
    const corrupted = await fixture({ hashFile: vi.fn(async () => 'different-hash') })
    await expect(corrupted.controller.install()).resolves.toBe(false)
    expect(corrupted.spawnInstaller).not.toHaveBeenCalled()
    expect(corrupted.helper.clear).toHaveBeenCalledTimes(1)
    expect(corrupted.controller.getState().error).toMatchObject({ code: 'INTEGRITY', retryAction: 'check' })
    const signature = await fixture()
    signature.updater.verifyUpdateCodeSignature.mockResolvedValue('untrusted publisher')
    await expect(signature.controller.install()).resolves.toBe(false)
    expect(signature.spawnInstaller).not.toHaveBeenCalled()
    expect(signature.helper.clear).toHaveBeenCalledTimes(1)
  })

  it('校验超时会取消后续启动，不会因迟到校验而执行安装器', async () => {
    vi.useFakeTimers()
    let finishHash
    const item = await fixture({ hashFile: vi.fn(() => new Promise((resolve) => { finishHash = resolve })) })
    const install = item.controller.install()
    await vi.advanceTimersByTimeAsync(20000)
    await expect(install).resolves.toBe(false)
    expect(item.controller.getState().stage).toBe('error')
    finishHash('fictional-hash')
    await vi.advanceTimersByTimeAsync(0)
    expect(item.spawnInstaller).not.toHaveBeenCalled()
    expect(item.app.quit).not.toHaveBeenCalled()
    expect(item.controller.getState()).toMatchObject({ stage: 'error', taskPending: false, canRetry: true })
  })

  it('安装器已启动但应用退出失败时保留验证记录与物理锁，不重复安装', async () => {
    const item = await fixture()
    item.app.quit.mockImplementation(() => { throw new Error('quit blocked') })
    await expect(item.controller.install()).resolves.toBe(false)
    expect(item.controller.getState()).toMatchObject({ stage: 'error', taskPending: true, canRetry: false })
    expect(item.controller.install()).toBe(false)
    expect(item.clearPendingInstall).not.toHaveBeenCalled()
    expect(item.spawnInstaller).toHaveBeenCalledTimes(1)
  })
})
