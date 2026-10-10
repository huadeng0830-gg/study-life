// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../src/composables/dataVault.js', () => ({
  clearDataVault: vi.fn(async () => true),
  mirrorLocalValue: vi.fn(async () => true),
  mirrorLocalValues: vi.fn(async () => true),
  setMirrorErrorHandler: vi.fn(),
  setMirrorTimingHandler: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function storageEvent(key, newValue, storageArea = localStorage) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea }))
}

describe('跨标签页数据变更与持久化异常', () => {
  it('损坏的跨页值不会取消刚创建待办的待写队列', async () => {
    const core = await import('../src/composables/store/core.js')
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(150)
    const task = domain.createTask({ title: '虚构待办：保留本页编辑' })
    await nextTick()
    storageEvent('sl_tasks', '{invalid-json')
    core.flushStoredWrites()
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([
      expect.objectContaining({ id: task.id, title: task.title }),
    ])
  })

  it('合法 JSON 的错误顶层形状不会把待办集合替换为字符串', async () => {
    const core = await import('../src/composables/store/core.js')
    const tasks = core.useStoredRef('sl_tasks', [])
    await vi.advanceTimersByTimeAsync(150)
    storageEvent('sl_tasks', '"invalid collection"')
    expect(tasks.value).toEqual([])
  })

  it('跨页删除会清理内存和待写队列，避免旧账号任务再次写回', async () => {
    const core = await import('../src/composables/store/core.js')
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(150)
    domain.createTask({ title: '虚构账号 A 的待办' })
    await nextTick()
    localStorage.removeItem('sl_tasks')
    storageEvent('sl_tasks', null)
    await nextTick()
    core.flushStoredWrites()
    expect(core.useStoredRef('sl_tasks', []).value).toEqual([])
    expect(localStorage.getItem('sl_tasks')).toBeNull()
  })

  it('批量冲刷的读取异常保留内存修改并显示保存失败，而不会抛到全局', async () => {
    const core = await import('../src/composables/store/core.js')
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(150)
    const task = domain.createTask({ title: '虚构待办：存储被限制' })
    await nextTick()
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    expect(() => core.flushStoredWrites()).not.toThrow()
    expect(core.useStoredRef('sl_tasks', []).value[0].id).toBe(task.id)
    expect(core.persistenceState.value).toMatchObject({ status: 'error', key: 'sl_tasks', source: 'local' })
    getItem.mockRestore()
  })

  it('关闭账号同步的跨页事件立即更新本页同步策略', async () => {
    const mode = await import('../src/composables/accountSyncMode.js')
    expect(mode.accountSyncViaAccount.value).toBe(true)
    localStorage.setItem(mode.ACCOUNT_SYNC_MODE_KEY, 'off')
    storageEvent(mode.ACCOUNT_SYNC_MODE_KEY, 'off')
    expect(mode.accountSyncViaAccount.value).toBe(false)
    localStorage.setItem(mode.ACCOUNT_SYNC_MODE_KEY, 'account')
    storageEvent(mode.ACCOUNT_SYNC_MODE_KEY, 'account')
    expect(mode.accountSyncViaAccount.value).toBe(true)
  })

  it('会话存储事件不会改变本机账号同步策略', async () => {
    const mode = await import('../src/composables/accountSyncMode.js')
    storageEvent(mode.ACCOUNT_SYNC_MODE_KEY, 'off', sessionStorage)
    expect(mode.accountSyncViaAccount.value).toBe(true)
  })
})
