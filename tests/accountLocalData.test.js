// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ records: new Map(), values: {}, failWrites: false, drafts: [], restore: vi.fn() }))
vi.mock('../src/composables/store/cloudAccess.js', () => ({ restoreStoredValues: (...args) => fake.restore(...args) }))
vi.mock('../src/composables/dataVault.js', async original => ({
  ...await original(),
  getPendingRecoveryDrafts: async ownerId => fake.drafts.filter(draft => draft.ownerId === ownerId),
  clearPendingRecoveryDraft: async (ownerId, key, token) => {
    fake.drafts = fake.drafts.filter(draft => draft.ownerId !== ownerId || draft.key !== key || draft.token !== token)
    return true
  },
}))
import { accountDefaultValues, clearRetiredNotesFromAccountRecord, mergeRetiredQuickNotes, prepareAccountLocalData, recoverAccountDataSwitch, withAccountDataLock } from '../src/composables/accountLocalData.js'
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
  fake.drafts = []
  fake.values = accountDefaultValues(); fake.values.sl_tasks = [{ id: 'private-a', title: '虚构账号 A 的记录' }]
  fake.restore.mockReset(); fake.restore.mockImplementation(async values => { fake.values = structuredClone(values) })
  vi.stubGlobal('indexedDB', fakeIndexedDB())
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
})
afterEach(() => { setAccountDataOwner(''); vi.unstubAllGlobals() })
describe('本机账号切换隔离和持久化保护', () => {
  it('退役笔记和待处理 Note 冲突会保留到独立归档集合', () => {
    const notes = [
      { id: 'note-local', title: '本机笔记', content: '本机正文' },
      { id: 'note-remote', title: '云端笔记', content: '云端正文' },
    ]
    expect(mergeRetiredQuickNotes(notes, [{ ...notes[0], content: '本机新版正文' }])).toEqual([
      { ...notes[0], content: '本机新版正文' },
      notes[1],
    ])
    const record = {
      id: 'conflict:notes',
      values: {
        sl_quick_notes: [notes[0]],
        conflicts: [{ key: 'sl_quick_notes', local: [notes[0]], remote: [notes[1]], base: [] }],
        signature: 'old-signature',
      },
    }

    expect(clearRetiredNotesFromAccountRecord(record)).toBe(true)
    expect(record.values.sl_archived_quick_notes).toEqual(notes)
    expect(record.values).not.toHaveProperty('sl_quick_notes')
    expect(record.values.conflicts).toEqual([])
    expect(record.values.signature).toBe('')
  })

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
  it('返回账号 A 时只在快照基线未变的情况下恢复隔离的最新草稿', async () => {
    setAccountDataOwner('fictional-a')
    await prepareAccountLocalData('fictional-b', () => fake.values)
    fake.values.sl_tasks = [{ id: 'private-b', title: '虚构账号 B 的记录' }]
    fake.drafts.push({ ownerId: 'fictional-a', key: 'sl_tasks', token: 'draft-a',
      previousKnown: true, previousRaw: JSON.stringify(fake.records.get('fictional-a').values.sl_tasks),
      raw: JSON.stringify([{ id: 'private-a-latest', title: '虚构账号 A 的未保存记录' }]) })

    await prepareAccountLocalData('fictional-a', () => fake.values)

    expect(fake.values.sl_tasks).toEqual([{ id: 'private-a-latest', title: '虚构账号 A 的未保存记录' }])
    expect(fake.records.get('fictional-b').values.sl_tasks).toEqual([{ id: 'private-b', title: '虚构账号 B 的记录' }])
    expect(fake.drafts).toEqual([])
  })
  it('返回账号 A 时快照基线已变化则保留草稿并拒绝静默合并', async () => {
    setAccountDataOwner('fictional-a')
    await prepareAccountLocalData('fictional-b', () => fake.values)
    fake.values.sl_tasks = [{ id: 'private-b', title: '虚构账号 B 的记录' }]
    const savedA = fake.records.get('fictional-a')
    fake.records.set('fictional-a', { ...savedA, values: { ...savedA.values, sl_tasks: [{ id: 'a-newer-device' }] } })
    fake.drafts.push({ ownerId: 'fictional-a', key: 'sl_tasks', token: 'draft-a', previousKnown: true,
      previousRaw: JSON.stringify([{ id: 'private-a' }]), raw: JSON.stringify([{ id: 'private-a-latest' }]) })

    await expect(prepareAccountLocalData('fictional-a', () => fake.values)).rejects.toThrow('存在冲突')

    expect(fake.values.sl_tasks).toEqual([{ id: 'private-b', title: '虚构账号 B 的记录' }])
    expect(fake.drafts).toHaveLength(1)
    expect(readAccountDataOwner()).toBe('fictional-b')
  })
  it('恢复与账号切换共用 Web Lock，第二个标签页不会同时进入数据临界区', async () => {
    let held = false
    let release
    let entered
    const enteredPromise = new Promise((resolve) => { entered = resolve })
    const firstOperation = new Promise((resolve) => { release = resolve })
    const request = vi.fn(async (_name, _options, action) => {
      if (held) return action(null)
      held = true
      try { return await action({}) } finally { held = false }
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const first = withAccountDataLock(async () => { entered(); await firstOperation })
    await enteredPromise

    await expect(withAccountDataLock(async () => 'unsafe'))
      .rejects.toThrow('其他页面正在处理账号数据')
    release()
    await first
    expect(request).toHaveBeenCalledTimes(2)
  })
})
