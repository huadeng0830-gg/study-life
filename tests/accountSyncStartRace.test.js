// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }))
vi.mock('../src/composables/accountLocalData.js', async original => ({
  ...await original(), accountLocalSnapshot: (...args) => fake.read(...args),
}))
vi.mock('../src/services/accountSync.js', () => ({ requestAccountSync: (...args) => fake.request(...args) }))
import { accountUser } from '../src/composables/accountAuth.js'
import { setAccountDataOwner } from '../src/composables/accountSyncIdentity.js'
import { accountSyncConflicts, accountSyncStatus } from '../src/composables/accountSyncState.js'
import { startAccountSync, stopAccountSync } from '../src/composables/accountSyncEngine.js'
import { localSafeMode } from '../src/composables/localSafeMode.js'

beforeEach(async () => {
  await stopAccountSync(); localStorage.clear(); localSafeMode.value = false
  fake.read.mockReset(); fake.request.mockReset()
  accountUser.value = { id: 'fictional-a', email: 'a@example.test' }
  setAccountDataOwner('fictional-a')
})
afterEach(async () => {
  await stopAccountSync(); accountUser.value = null; setAccountDataOwner(''); vi.restoreAllMocks()
})
describe('同步启动读取的身份边界', () => {
  it.each(['logout', 'switch', 'stop'])('冲突读取等待时 %s，迟到结果不能恢复冲突或绑定轮询', async action => {
    let release, entered
    const waiting = new Promise(resolve => { entered = resolve })
    fake.read.mockImplementation(id => id.startsWith('conflict:')
      ? new Promise(resolve => { release = resolve; entered() }) : Promise.resolve(undefined))
    const starting = startAccountSync('fictional-a').then(() => null, error => error)
    await waiting
    if (action === 'logout') accountUser.value = null
    if (action === 'switch') { accountUser.value = { id: 'fictional-b' }; setAccountDataOwner('fictional-b') }
    await stopAccountSync()
    const bindings = vi.spyOn(window, 'addEventListener')
    const poll = vi.spyOn(window, 'setInterval')
    release({ signature: 'fictional-signature', conflicts: [{ key: 'sl_tasks', local: { title: 'fictional' } }] })
    const error = await starting
    expect(error?.code).toBe('ACCOUNT_SYNC_STALE')
    expect(accountSyncStatus.value).toBe('signed-out')
    expect(accountSyncConflicts.value).toEqual([])
    expect(bindings).not.toHaveBeenCalled()
    expect(poll).not.toHaveBeenCalled()
    expect(fake.request).not.toHaveBeenCalled()
  })
})
