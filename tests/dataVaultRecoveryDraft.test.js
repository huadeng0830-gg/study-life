// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

function fakeIndexedDB({ deferTaskRead = false } = {}) {
  const records = new Map()
  let storeCreated = false
  let deferredReadUsed = false
  let finishDeferredRead = null
  let announceDeferredRead
  const deferredReadStarted = new Promise((resolve) => { announceDeferredRead = resolve })
  return {
    records,
    deferredReadStarted,
    releaseDeferredRead() { finishDeferredRead?.() },
    open: () => {
      const request = { result: null, onsuccess: null, onupgradeneeded: null }
      const db = {
        objectStoreNames: { contains: () => storeCreated },
        createObjectStore: () => { storeCreated = true },
        close: vi.fn(),
        transaction: () => {
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null }
          const finish = () => queueMicrotask(() => tx.oncomplete?.())
          tx.objectStore = () => ({
            put: (record) => { records.set(record.key, structuredClone(record)); finish() },
            delete: (key) => { records.delete(key); finish() },
            get: (key) => {
              const result = { result: undefined, onsuccess: null, onerror: null }
              const finishRead = () => {
                result.result = records.get(key) && structuredClone(records.get(key))
                result.onsuccess?.()
              }
              if (deferTaskRead && key === 'sl_tasks' && !deferredReadUsed) {
                deferredReadUsed = true
                finishDeferredRead = finishRead
                announceDeferredRead()
              } else queueMicrotask(finishRead)
              return result
            },
            getAllKeys: () => {
              const result = { result: [], onsuccess: null, onerror: null }
              queueMicrotask(() => { result.result = [...records.keys()]; result.onsuccess?.() })
              return result
            },
          })
          return tx
        },
      }
      request.result = db
      queueMicrotask(() => {
        if (!storeCreated) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  const vault = await import('../src/composables/dataVault.js')
  vault.cancelPendingMirrorWrites()
  window.happyDOM?.abort()
})

describe('账号隔离的未保存草稿恢复', () => {
  it('重启恢复只还原同一归属的最新草稿，不把 A 的草稿写到 B', async () => {
    vi.resetModules()
    const indexedDB = fakeIndexedDB()
    vi.stubGlobal('indexedDB', indexedDB)
    localStorage.clear()
    localStorage.setItem('study-life-data-owner', 'fictional-a')
    localStorage.setItem('sl_tasks', '[]')
    const vault = await import('../src/composables/dataVault.js')

    await vault.savePendingRecoveryDraft('fictional-a', 'sl_tasks', '[{"id":"a-latest"}]', 'token-a', '[]')
    const wrongOwner = await vault.restorePendingRecoveryDrafts('fictional-b')
    expect(wrongOwner.restored).toEqual([])
    expect(localStorage.getItem('sl_tasks')).toBe('[]')

    const restored = await vault.initializeDataVault()
    expect(restored).toContain('sl_tasks')
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([{ id: 'a-latest' }])
    expect(indexedDB.records.size).toBe(0)
  })

  it('keeps a recovery draft when the stored base changed in another tab', async () => {
    vi.resetModules()
    const indexedDB = fakeIndexedDB()
    vi.stubGlobal('indexedDB', indexedDB)
    localStorage.clear()
    localStorage.setItem('sl_tasks', '[{"id":"b-newer"}]')
    const vault = await import('../src/composables/dataVault.js')
    await vault.savePendingRecoveryDraft('fictional-a', 'sl_tasks', '[{"id":"a-draft"}]', 'token-a', '[]')

    const result = await vault.restorePendingRecoveryDrafts('fictional-a')

    expect(result.conflicts).toEqual(['sl_tasks'])
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([{ id: 'b-newer' }])
    expect(indexedDB.records.size).toBe(1)
    expect(await vault.getPendingRecoveryDrafts('fictional-b')).toEqual([])
    expect(await vault.getPendingRecoveryDrafts('fictional-a')).toMatchObject([
      { ownerId: 'fictional-a', key: 'sl_tasks', raw: '[{"id":"a-draft"}]', previousRaw: '[]', token: 'token-a' },
    ])
    const afterRestart = await vault.restorePendingRecoveryDrafts('fictional-a')
    expect(afterRestart.conflicts).toEqual(['sl_tasks'])
    expect(indexedDB.records.size).toBe(1)
  })
})

describe('安全副本异步版本顺序', () => {
  it('旧安全副本读取迟到时不会覆盖稍后提交的新值', async () => {
    vi.resetModules()
    const indexedDB = fakeIndexedDB({ deferTaskRead: true })
    vi.stubGlobal('indexedDB', indexedDB)
    const vault = await import('../src/composables/dataVault.js')
    const older = '[{"id":"fictional-older"}]'
    const newer = '[{"id":"fictional-newer"}]'

    vault.mirrorLocalValue('sl_tasks', older)
    await indexedDB.deferredReadStarted
    vault.mirrorLocalValue('sl_tasks', newer)
    indexedDB.releaseDeferredRead()

    await vi.waitFor(() => expect(indexedDB.records.get('sl_tasks')?.value).toBe(newer), { timeout: 3000 })
    expect(indexedDB.records.get('sl_tasks').value).toBe(newer)
  })
})
