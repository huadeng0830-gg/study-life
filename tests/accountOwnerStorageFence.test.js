// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

function fakeIndexedDB({ failWrites = false } = {}) {
  const records = new Map()
  let storeCreated = false
  return {
    records,
    open: () => {
      const request = { result: null, onsuccess: null, onupgradeneeded: null }
      const db = {
        objectStoreNames: { contains: () => storeCreated },
        createObjectStore: () => { storeCreated = true },
        close: vi.fn(),
        transaction: () => {
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null }
          const finish = (error) => queueMicrotask(() => error ? tx.onerror?.() : tx.oncomplete?.())
          tx.objectStore = () => ({
            put: (record) => { if (!failWrites) records.set(record.key, structuredClone(record)); finish(failWrites) },
            delete: (key) => { records.delete(key); finish() },
            get: (key) => {
              const result = { result: undefined, onsuccess: null }
              queueMicrotask(() => { result.result = records.get(key) && structuredClone(records.get(key)); result.onsuccess?.() })
              return result
            },
            getAllKeys: () => {
              const result = { result: [], onsuccess: null }
              queueMicrotask(() => { result.result = [...records.keys()]; result.onsuccess?.() })
              return result
            },
          })
          return tx
        },
      }
      request.result = db
      queueMicrotask(() => { if (!storeCreated) request.onupgradeneeded?.(); request.onsuccess?.() })
      return request
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  window.happyDOM?.abort()
})

describe('跨标签页账号归属变更时的待写数据隔离', () => {
  it('先按旧账号隔离延迟编辑，再载入新账号值', async () => {
    vi.resetModules()
    const indexedDB = fakeIndexedDB()
    vi.stubGlobal('indexedDB', indexedDB)
    localStorage.clear()
    localStorage.setItem('study-life-data-owner', 'fictional-a')
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'a-base' }]))
    const store = await import('../src/composables/store/core.js')
    const tasks = store.useStoredRef('sl_tasks', [])
    await new Promise((resolve) => setTimeout(resolve, 140))

    tasks.value = [{ id: 'a-latest-unsaved' }]
    await nextTick()
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'b-current' }]))
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'sl_tasks', oldValue: JSON.stringify([{ id: 'a-base' }]),
      newValue: JSON.stringify([{ id: 'b-current' }]), storageArea: localStorage,
    }))
    localStorage.setItem('study-life-data-owner', 'fictional-b')
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'study-life-data-owner', oldValue: 'fictional-a', newValue: 'fictional-b', storageArea: localStorage,
    }))

    await vi.waitFor(() => {
      expect(tasks.value).toEqual([{ id: 'b-current' }])
      expect([...indexedDB.records.values()].some((record) => record.value?.key === 'sl_tasks')).toBe(true)
    })
    const draft = [...indexedDB.records.values()].find((record) => record.value?.key === 'sl_tasks')?.value
    expect(draft).toMatchObject({ ownerId: 'fictional-a', raw: '[{"id":"a-latest-unsaved"}]' })
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([{ id: 'b-current' }])
    expect(store.flushStoredWrites()).toMatchObject({ ok: true, pendingKeys: [] })
  })

  it('安全草稿写入失败时不把旧账号值写入新账号空间', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', fakeIndexedDB({ failWrites: true }))
    localStorage.clear()
    localStorage.setItem('study-life-data-owner', 'fictional-a')
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'a-base' }]))
    const store = await import('../src/composables/store/core.js')
    const tasks = store.useStoredRef('sl_tasks', [])
    await new Promise((resolve) => setTimeout(resolve, 140))
    tasks.value = [{ id: 'a-latest-unsaved' }]
    await nextTick()
    localStorage.setItem('sl_tasks', JSON.stringify([{ id: 'b-current' }]))
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'sl_tasks', oldValue: JSON.stringify([{ id: 'a-base' }]),
      newValue: JSON.stringify([{ id: 'b-current' }]), storageArea: localStorage,
    }))
    localStorage.setItem('study-life-data-owner', 'fictional-b')
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'study-life-data-owner', oldValue: 'fictional-a', newValue: 'fictional-b', storageArea: localStorage,
    }))

    await vi.waitFor(() => expect(store.persistenceWriteStates.value.sl_tasks?.source).toBe('owner-draft-failed'))
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([{ id: 'b-current' }])
    expect(tasks.value).toEqual([{ id: 'a-latest-unsaved' }])
    expect(store.persistenceState.value.message).toContain('不要刷新或关闭')
  })
})
