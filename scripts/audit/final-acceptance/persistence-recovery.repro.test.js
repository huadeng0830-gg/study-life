// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../../../src/composables/dataVault.js', async original => ({
  ...await original(), mirrorLocalValue: async () => true, mirrorLocalValues: async () => true,
}))
let core
afterEach(async () => {
  vi.restoreAllMocks()
  const vault = await import('../../../src/composables/dataVault.js')
  vault.cancelPendingMirrorWrites()
  window.happyDOM?.abort()
})
it('retains a failed task write so exporting current data preserves the in-memory edit', async () => {
  localStorage.clear()
  localStorage.setItem('sl_tasks', '[]')
  core = await import('../../../src/composables/store/core.js')
  const tasks = core.useStoredRef('sl_tasks', [])
  const actualSet = localStorage.setItem.bind(localStorage)
  const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === 'sl_tasks') throw new DOMException('Fictional capacity fault', 'QuotaExceededError')
    return actualSet(key, value)
  })
  tasks.value.push({ id: 'fictional-unsaved-task', title: 'Fictional unsaved task' })
  core.touchStoredRef('sl_tasks')
  core.flushStoredWrites()
  expect(core.persistenceState.value.status).toBe('error')
  expect(core.persistenceWriteStates.value.sl_tasks.status).toBe('failed')
  expect(core.flushStoredWrites()).toMatchObject({ ok: false, pendingKeys: ['sl_tasks'] })
  const archiveSnapshot = (await import('../../../src/composables/backupArchive.js')).createBackupSnapshot()
  const emergency = (await import('../../../src/composables/emergencyExport.js')).createEmergencyBackup()
  expect(archiveSnapshot.data.tasks.map(v => v.id)).toEqual(['fictional-unsaved-task'])
  expect(emergency.data.tasks.map(v => v.id)).toEqual(['fictional-unsaved-task'])
  expect(archiveSnapshot.completeness.unsavedKeys).toContain('sl_tasks')
  expect(emergency.completeness.unsavedKeys).toContain('sl_tasks')

  tasks.value.push({ id: 'fictional-unsaved-task-2', title: 'Fictional second unsaved task' })
  core.touchStoredRef('sl_tasks')
  core.flushStoredWrites()
  expect((await import('../../../src/composables/emergencyExport.js')).createEmergencyBackup().data.tasks.map(v => v.id))
    .toEqual(['fictional-unsaved-task', 'fictional-unsaved-task-2'])

  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  const theme = core.useStoredRef('sl_theme', 'blue')
  theme.value = 'green'
  core.touchStoredRef('sl_theme')
  core.flushStoredWrites()
  expect(core.persistenceState.value.status).toBe('error')
  expect(core.persistenceState.value.key).toBe('sl_tasks')
  expect(core.persistenceWriteStates.value.sl_theme.status).toBe('saved')
  expect(localStorage.getItem('sl_tasks')).toBe('[]')

  setItem.mockImplementation(actualSet)
  expect(core.flushStoredWrites()).toMatchObject({ ok: true, pendingKeys: [] })
  expect(JSON.parse(localStorage.getItem('sl_tasks')).map(v => v.id))
    .toEqual(['fictional-unsaved-task', 'fictional-unsaved-task-2'])
  expect(core.persistenceWriteStates.value.sl_tasks.status).toBe('saved')

  const actualGet = localStorage.getItem.bind(localStorage)
  vi.spyOn(localStorage, 'getItem').mockImplementation((key) => {
    if (key === 'sl_courses') throw new DOMException('Fictional blocked storage', 'SecurityError')
    return actualGet(key)
  })
  const { createEmergencyBackup, downloadEmergencyBackup } = await import('../../../src/composables/emergencyExport.js')
  const partial = createEmergencyBackup()
  expect(partial.completeness.complete).toBe(false)
  expect(partial.completeness.missingKeys).toContain('sl_courses')
  expect(partial.data.tasks.map(v => v.id)).toEqual(['fictional-unsaved-task', 'fictional-unsaved-task-2'])
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('Fictional export failure') })
  expect(() => downloadEmergencyBackup()).toThrow('Fictional export failure')
})
