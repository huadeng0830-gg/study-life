// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ records: new Map(), values: {}, failWrites: false, restore: vi.fn() }))
vi.mock('../src/composables/store/cloudAccess.js', () => ({ restoreStoredValues: (...args) => fake.restore(...args) }))
import { accountDefaultValues, prepareAccountLocalData, recoverAccountDataSwitch } from '../src/composables/accountLocalData.js'
import { ACCOUNT_SWITCH_MARKER_KEY, readAccountDataOwner, setAccountDataOwner } from '../src/composables/accountSyncIdentity.js'
function fakeIndexedDB() {
  let initialized = false
  return { open: () => {
    const request = { result: null, onsuccess: null, onupgradeneeded: null }
    request.result = {
      createObjectStore: vi.fn(), close: vi.fn(),
      transaction: () => {
        const tx = { oncomplete: null, onerror: null, onabort: null, abort: vi.fn() }
        tx.objectStore = () => ({
          get: id => ({ result: fake.records.get(id) && structuredClone(fake.records.get(id)) }),
          put: value => { if (!fake.failWrites) fake.records.set(value.id, structuredClone(value)); return { result: value.id } },
        })
        setTimeout(() => fake.failWrites ? tx.onerror?.() : tx.oncomplete?.(), 0)
        return tx
      },
    }
    setTimeout(() => { if (!initialized) { request.onupgradeneeded?.(); initialized = true } request.onsuccess?.() }, 0)
    return request
  } }
}
beforeEach(() => {
  localStorage.clear(); setAccountDataOwner(''); fake.records.clear(); fake.failWrites = false
  fake.values = accountDefaultValues(); fake.values.sl_tasks = [{ id: 'private-a', title: '虚构账号 A 的记录' }]
  fake.restore.mockReset(); fake.restore.mockImplementation(async values => { fake.values = structuredClone(values) })
  vi.stubGlobal('indexedDB', fakeIndexedDB())
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
})
afterEach(() => { setAccountDataOwner(''); vi.unstubAllGlobals() })
describe('本机账号切换隔离和持久化保护', () => {
  it('第一次登录接管本机访客记录，不清空内容', async () => {
    expect(await prepareAccountLocalData('fictional-a', () => fake.values)).toBe(true)
    expect(readAccountDataOwner()).toBe('fictional-a')
    expect(fake.values.sl_tasks[0].id).toBe('private-a')
    expect(fake.restore).not.toHaveBeenCalled()
  })
  it('切换账号先保存旧记录，新账号看不到旧数据，返回时恢复离线修改', async () => {
    setAccountDataOwner('fictional-a')
    await prepareAccountLocalData('fictional-b', () => fake.values)
    expect(fake.values.sl_tasks).toEqual([])
    expect(fake.records.get('fictional-a').values.sl_tasks[0].id).toBe('private-a')
    fake.values.sl_tasks = [{ id: 'private-b', title: '虚构账号 B 的记录' }]
    await prepareAccountLocalData('fictional-a', () => fake.values)
    expect(fake.values.sl_tasks[0].id).toBe('private-a')
    expect(fake.records.get('fictional-b').values.sl_tasks[0].id).toBe('private-b')
  })
  it('无法保存旧账号副本时拒绝切换，不覆盖记录或归属', async () => {
    setAccountDataOwner('fictional-a'); fake.failWrites = true
    await expect(prepareAccountLocalData('fictional-b', () => fake.values)).rejects.toThrow('本机记录已保留')
    expect(fake.values.sl_tasks[0].id).toBe('private-a')
    expect(readAccountDataOwner()).toBe('fictional-a')
    expect(fake.restore).not.toHaveBeenCalled()
  })
  it('网络或登录状态变化导致准备失效时不开始数据切换', async () => {
    setAccountDataOwner('fictional-a')
    expect(await prepareAccountLocalData('fictional-b', () => fake.values, () => false)).toBe(false)
    expect(readAccountDataOwner()).toBe('fictional-a')
    expect(fake.restore).not.toHaveBeenCalled()
  })
  it('账号切换中断后从已保存副本恢复原账号数据', async () => {
    setAccountDataOwner('fictional-a')
    fake.records.set('fictional-a', { id: 'fictional-a', values: structuredClone(fake.values) })
    localStorage.setItem(ACCOUNT_SWITCH_MARKER_KEY, JSON.stringify({ from: 'fictional-a', to: 'fictional-b' }))
    fake.values = accountDefaultValues()
    expect((await recoverAccountDataSwitch()).ok).toBe(true)
    expect(fake.values.sl_tasks[0].id).toBe('private-a')
    expect(localStorage.getItem(ACCOUNT_SWITCH_MARKER_KEY)).toBeNull()
  })
  it('切换已经提交时不会恢复旧账号覆盖新账号', async () => {
    setAccountDataOwner('fictional-b')
    localStorage.setItem(ACCOUNT_SWITCH_MARKER_KEY, JSON.stringify({ from: 'fictional-a', to: 'fictional-b' }))
    expect((await recoverAccountDataSwitch()).ok).toBe(true)
    expect(fake.restore).not.toHaveBeenCalled()
  })
  it('支持 Web Locks 的浏览器在同一把数据锁内切换', async () => {
    // 【三参形式是规范本身，不是实现细节】navigator.locks.request 的签名是
    // (name, options, callback)，options 里可以带 ifAvailable。账户数据锁**必须**
    // 用 ifAvailable：排队等待会让准备阶段在别的上下文持有锁时永远挂着
    // （accountSyncPreparing 一直是 true，连重试按钮都会跟着卡死）。
    // 所以这里连 options 一起断言 —— 只断言锁名的话，一个退回排队的实现照样绿。
    const request = vi.fn(async (name, options, action) => action({ name }))
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    setAccountDataOwner('fictional-a')
    await prepareAccountLocalData('fictional-b', () => fake.values)
    expect(readAccountDataOwner()).toBe('fictional-b')
    expect(request.mock.calls[0][0]).toBe('study-life-account-data')
    expect(request.mock.calls[0][1]).toEqual({ ifAvailable: true })
  })
  it('锁被别人持有时立刻放弃，而不是排队等一把拿不到的锁', async () => {
    // ifAvailable 拿不到锁时 callback 会收到 null。必须立刻失败：
    // 排队等待在手机上等于"永远卡在准备中"，没有任何出路。
    const request = vi.fn(async (_name, _options, action) => action(null))
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    setAccountDataOwner('fictional-a')
    await expect(prepareAccountLocalData('fictional-b', () => fake.values))
      .rejects.toThrow('其他页面')
    expect(readAccountDataOwner()).toBe('fictional-a')
    expect(fake.restore).not.toHaveBeenCalled()
  })
})
