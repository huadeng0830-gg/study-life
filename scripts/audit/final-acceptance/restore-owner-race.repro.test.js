// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { restoreError } from '../../../src/composables/dataManagerFeedback.js'
const fake = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../../../src/composables/dataVault.js', async original => ({
  ...await original(), getRestoreCheckpoint: async () => null, saveRestoreCheckpoint: (...args) => fake.save(...args),
  mirrorLocalValue: async () => true, mirrorLocalValues: async () => true,
}))
vi.mock('../../../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  return { accountUser: ref(null) }
})
let backup
afterEach(async () => {
  try { (await import('../../../src/composables/store/core.js')).flushStoredWrites() } catch {}
  backup?.backupProgress.dispose(); backup = null; fake.save.mockReset(); restoreError.value = ''
  window.happyDOM?.abort(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it('preserves the new account data when an old account restore finishes late', async () => {
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  const identity = await import('../../../src/composables/accountSyncIdentity.js')
  identity.setAccountDataOwner('fictional-a')
  localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'a-current', title: 'Fictional A current task' }]))
  const store = await import('../../../src/composables/store/index.js')
  backup = (await import('../../../src/composables/dataManagerBackup.js')).useDataManagerBackup()
  let release, entered
  const waiting = new Promise(r => { entered = r })
  fake.save.mockImplementation(() => new Promise(r => { release = r; entered() }))
  backup.restoreBackupTarget.value = {
    ownerId: 'fictional-a', providedFields: ['tasks'], selectedModules: ['tasks'],
    data: { tasks: [{ id: 'a-backup', title: 'Fictional A backup task' }] },
  }
  const restoring = backup.applyRestoreBackup()
  await vi.waitFor(() => {
    if (restoreError.value) throw new Error(restoreError.value)
    expect(fake.save).toHaveBeenCalled()
  })
  await waiting
  // A different local tab can finish switching the shared account while IDB is waiting.
  await store.restoreStoredValues({ sl_tasks: [{ id: 'b-task', title: 'Fictional B task' }] }, { markChanged: false })
  identity.setAccountDataOwner('fictional-b')
  release()
  await restoring
  expect(identity.readAccountDataOwner()).toBe('fictional-b')
  expect(JSON.parse(localStorage.getItem('sl_tasks')).map(v => v.id)).toEqual(['b-task'])
})

it('rejects an account A backup targeting account B without explicit import authorization', async () => {
  localStorage.clear()
  const identity = await import('../../../src/composables/accountSyncIdentity.js')
  identity.setAccountDataOwner('fictional-b')
  localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'b-kept', title: 'Fictional B kept task' }]))
  const store = await import('../../../src/composables/store/index.js')
  store.useStoredRef('sl_tasks', [])
  await store.restoreStoredValues({ sl_tasks: [{ id: 'b-kept', title: 'Fictional B kept task' }] }, { markChanged: false })
  backup = (await import('../../../src/composables/dataManagerBackup.js')).useDataManagerBackup()
  backup.restoreBackupTarget.value = {
    ownerId: 'fictional-a', providedFields: ['tasks'], selectedModules: ['tasks'],
    data: { tasks: [{ id: 'a-source', title: 'Fictional A source task' }] },
  }

  await backup.applyRestoreBackup()

  expect(fake.save).not.toHaveBeenCalled()
  expect(restoreError.value).toContain('独立的跨账号导入确认')
  expect(JSON.parse(localStorage.getItem('sl_tasks')).map(v => v.id)).toEqual(['b-kept'])
})

it('routes a confirmed account A to B migration through the explicit import action', async () => {
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  const identity = await import('../../../src/composables/accountSyncIdentity.js')
  identity.setAccountDataOwner('fictional-b')
  localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'b-kept', title: 'Fictional B kept task' }]))
  const store = await import('../../../src/composables/store/index.js')
  store.useStoredRef('sl_tasks', [])
  await store.restoreStoredValues({ sl_tasks: [{ id: 'b-kept', title: 'Fictional B kept task' }] }, { markChanged: false })
  backup = (await import('../../../src/composables/dataManagerBackup.js')).useDataManagerBackup()
  backup.selectedBackup.value = {
    ownerId: 'fictional-a', providedFields: ['tasks'],
    data: { courses: [], countdowns: [], tasks: [{ id: 'a-migrated', title: 'Fictional A migrated task' }] },
  }
  backup.restoreSelection.value = ['tasks']

  backup.restoreBackup()
  expect(backup.restoreBackupTarget.value).toBeNull()
  expect(backup.crossAccountImportTarget.value.ownerId).toBe('fictional-a')
  expect(backup.crossAccountImportMessage.value).toContain('导入目标：fictional-b')
  await backup.confirmCrossAccountImport()

  expect(identity.readAccountDataOwner()).toBe('fictional-b')
  expect(JSON.parse(localStorage.getItem('sl_tasks')).map(v => v.id)).toEqual(['a-migrated'])
  expect(fake.save).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'fictional-b' }), 'fictional-b')
})

it('preserves account A data when creating the pre-restore checkpoint fails', async () => {
  localStorage.clear()
  const identity = await import('../../../src/composables/accountSyncIdentity.js')
  identity.setAccountDataOwner('fictional-a')
  localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'a-kept', title: 'Fictional A kept task' }]))
  const store = await import('../../../src/composables/store/index.js')
  store.useStoredRef('sl_tasks', [])
  await store.restoreStoredValues({ sl_tasks: [{ id: 'a-kept', title: 'Fictional A kept task' }] }, { markChanged: false })
  backup = (await import('../../../src/composables/dataManagerBackup.js')).useDataManagerBackup()
  fake.save.mockRejectedValue(new Error('synthetic IndexedDB checkpoint failure'))
  backup.restoreBackupTarget.value = {
    ownerId: 'fictional-a', providedFields: ['tasks'], selectedModules: ['tasks'],
    data: { tasks: [{ id: 'a-replacement', title: 'Fictional replacement task' }] },
  }

  await backup.applyRestoreBackup()

  expect(restoreError.value).toContain('synthetic IndexedDB checkpoint failure')
  expect(JSON.parse(localStorage.getItem('sl_tasks')).map(v => v.id)).toEqual(['a-kept'])
})

it('rejects an ABA account transition even when the owner returns to its original ID', async () => {
  const identity = await import('../../../src/composables/accountSyncIdentity.js')
  identity.setAccountDataOwner('fictional-a')
  const captured = identity.captureAccountDataIdentity()
  identity.setAccountDataOwner('fictional-b')
  identity.setAccountDataOwner('fictional-a')

  expect(() => identity.assertAccountDataIdentity(captured)).toThrow('登录账号或本机数据归属已变化')
})

it('rejects a login-session change even when the local owner marker has not changed', async () => {
  const identity = await import('../../../src/composables/accountSyncIdentity.js')
  const { accountUser } = await import('../../../src/composables/accountAuth.js')
  identity.setAccountDataOwner('fictional-a')
  accountUser.value = { id: 'fictional-a' }
  const captured = identity.captureAccountDataIdentity()
  accountUser.value = { id: 'fictional-b' }

  expect(() => identity.assertAccountDataIdentity(captured)).toThrow('登录账号或本机数据归属已变化')
  accountUser.value = null
})
