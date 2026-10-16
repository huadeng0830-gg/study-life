// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), read: vi.fn(), prepare: vi.fn(), recover: vi.fn(),
}))
vi.mock('../src/composables/accountRestrictions.js', async () => {
  const { ref } = await import('vue')
  return { accountCloudRestricted: ref(false) }
})
vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref, shallowRef } = await import('vue')
  return { accountAvailable: ref(true), accountReady: ref(false), accountUser: shallowRef(null) }
})
vi.mock('../src/composables/accountLocalData.js', () => ({ prepareAccountLocalData: fake.prepare, recoverAccountDataSwitch: fake.recover }))
vi.mock('../src/composables/accountSyncEngine.js', () => ({ startAccountSync: fake.start, stopAccountSync: fake.stop, readAccountLocalValues: fake.read, recoverAccountSyncCommit: fake.recover }))
let auth, identity, lifecycle
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear()
  auth = await import('../src/composables/accountAuth.js')
  auth.accountReady.value = false; auth.accountUser.value = null; auth.accountAvailable.value = true
  const moderation = await import('../src/composables/accountRestrictions.js')
  moderation.accountCloudRestricted.value = false
  identity = await import('../src/composables/accountSyncIdentity.js')
  identity.setAccountDataOwner('')
  lifecycle = await import('../src/composables/accountSyncLifecycle.js')
  fake.start.mockResolvedValue(undefined)
  fake.stop.mockResolvedValue(undefined)
  fake.recover.mockResolvedValue({ ok: true })
  fake.prepare.mockImplementation(async (id, _read, current) => {
    if (!current()) return false
    identity.setAccountDataOwner(id)
    return true
  })
})
afterEach(async () => { lifecycle.stopAccountSyncLifecycle(); await lifecycle.waitForAccountSyncPreparation(); vi.restoreAllMocks() })
async function login(id = 'fictional-a') {
  auth.accountUser.value = { id }
  auth.accountReady.value = true
  await lifecycle.waitForAccountSyncPreparation()
}
describe('账号同步生命周期', () => {
  it('封禁等待引擎停止后保留暂停说明，解除时恢复原同步配置', async () => {
    const { accountCloudRestricted } = await import('../src/composables/accountRestrictions.js')
    const { accountSyncError, accountSyncStatus } = await import('../src/composables/accountSyncState.js')
    lifecycle.startAccountSyncLifecycle(); await login()
    fake.stop.mockImplementationOnce(async () => { await Promise.resolve(); accountSyncStatus.value = 'signed-out'; accountSyncError.value = '' })
    accountCloudRestricted.value = true
    await lifecycle.waitForAccountSyncPreparation()
    expect(accountSyncStatus.value).toBe('error')
    expect(accountSyncError.value).toContain('账号已封禁')
    expect(fake.start).toHaveBeenCalledTimes(1)
    accountCloudRestricted.value = false
    await lifecycle.waitForAccountSyncPreparation()
    expect(fake.start).toHaveBeenCalledTimes(2)
  })
  it('等待会话恢复后开始同步，令牌刷新不重启账号数据', async () => {
    lifecycle.startAccountSyncLifecycle()
    await lifecycle.waitForAccountSyncPreparation()
    expect(fake.start).not.toHaveBeenCalled()
    await login()
    expect(fake.prepare).toHaveBeenCalledWith('fictional-a', fake.read, expect.any(Function))
    expect(fake.start).toHaveBeenCalledExactlyOnceWith('fictional-a')
    expect(identity.accountSyncPreparing.value).toBe(false)
    auth.accountUser.value = { id: 'fictional-a', email: 'student@example.test' }
    await lifecycle.waitForAccountSyncPreparation()
    expect(fake.start).toHaveBeenCalledTimes(1)
  })
  it('退出停止账号同步并保留本机数据归属', async () => {
    lifecycle.startAccountSyncLifecycle(); await login()
    fake.stop.mockClear()
    auth.accountUser.value = null
    await lifecycle.waitForAccountSyncPreparation()
    expect(fake.stop).toHaveBeenCalled()
    expect(fake.start).toHaveBeenCalledTimes(1)
    expect(identity.accountDataOwner.value).toBe('fictional-a')
  })
  it('快速连续切换只准备最终账号，并等待上一次同步停止', async () => {
    lifecycle.startAccountSyncLifecycle(); await login()
    let releaseStop
    fake.stop.mockImplementationOnce(() => new Promise(resolve => { releaseStop = resolve }))
    fake.start.mockClear(); fake.prepare.mockClear()
    auth.accountUser.value = { id: 'fictional-b' }
    auth.accountUser.value = { id: 'fictional-c' }
    await Promise.resolve()
    expect(fake.start).not.toHaveBeenCalled()
    releaseStop()
    await lifecycle.waitForAccountSyncPreparation()
    expect(fake.prepare).toHaveBeenCalledExactlyOnceWith('fictional-c', fake.read, expect.any(Function))
    expect(fake.start).toHaveBeenCalledExactlyOnceWith('fictional-c')
  })
  it('本机恢复失败暂停同步，修复后可以重试', async () => {
    fake.recover.mockResolvedValueOnce({ ok: false, error: new Error('虚构恢复故障') })
    lifecycle.startAccountSyncLifecycle(); await login()
    expect(fake.start).not.toHaveBeenCalled()
    expect(identity.accountSyncPreparationError.value).toBe('虚构恢复故障')
    await lifecycle.retryAccountSyncPreparation()
    await lifecycle.waitForAccountSyncPreparation()
    expect(fake.start).toHaveBeenCalledExactlyOnceWith('fictional-a')
    expect(identity.accountSyncPreparationError.value).toBe('')
  })
})
