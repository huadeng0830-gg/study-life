// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }))
vi.mock('../../../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  return { accountUser: ref(null) }
})
vi.mock('../../../src/composables/accountLocalData.js', () => ({
  accountLocalSnapshot: (...args) => fake.read(...args), accountDefaultValues: () => ({}), ACCOUNT_DATA_LOCK: 'fictional-account-lock',
}))
vi.mock('../../../src/services/accountSync.js', () => ({ requestAccountSync: (...args) => fake.request(...args) }))
vi.mock('../../../src/composables/accountSyncData.js', () => ({
  SYNC_DEFAULTS: {}, SYNC_KEYS: [], assertValidSyncPayload: v => v, validateSyncPayload: v => v,
  cloneValue: v => v === undefined ? undefined : JSON.parse(JSON.stringify(v)),
}))
let engine
afterEach(async () => { await engine?.stopAccountSync(); vi.restoreAllMocks() })
it('keeps the logged-out state when the previous conflict read finishes late', async () => {
  localStorage.clear()
  const auth = await import('../../../src/composables/accountAuth.js')
  const identity = await import('../../../src/composables/accountSyncIdentity.js')
  const state = await import('../../../src/composables/accountSyncState.js')
  engine = await import('../../../src/composables/accountSyncEngine.js')
  let release, entered
  const waiting = new Promise(r => { entered = r })
  fake.read.mockImplementation(id => id.startsWith('conflict:') ? new Promise(r => { release = r; entered() }) : Promise.resolve(undefined))
  auth.accountUser.value = { id: 'fictional-a' }
  identity.setAccountDataOwner('fictional-a')
  const starting = engine.startAccountSync('fictional-a').catch(error => {
    expect(error.code).toBe('ACCOUNT_SYNC_STALE')
  })
  await waiting
  auth.accountUser.value = null
  await engine.stopAccountSync()
  expect(state.accountSyncStatus.value).toBe('signed-out')
  const eventBindings = vi.spyOn(window, 'addEventListener')
  const documentBindings = vi.spyOn(document, 'addEventListener')
  const polls = vi.spyOn(window, 'setInterval')
  release({ signature: 'fictional-signature', conflicts: [{ key: 'sl_tasks', local: { title: 'Fictional A conflict' } }] })
  await starting
  console.log(JSON.stringify({ statusAfterLogoutAndLateRead: state.accountSyncStatus.value, oldConflictCount: state.accountSyncConflicts.value.length, networkRequests: fake.request.mock.calls.length }))
  expect(fake.request).not.toHaveBeenCalled()
  expect(state.accountSyncStatus.value).toBe('signed-out')
  expect(state.accountSyncConflicts.value).toEqual([])
  expect(eventBindings).not.toHaveBeenCalled()
  expect(documentBindings).not.toHaveBeenCalled()
  expect(polls).not.toHaveBeenCalled()
})
