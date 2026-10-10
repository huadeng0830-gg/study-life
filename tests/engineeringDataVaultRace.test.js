// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function memoryIndexedDB(records, { holdReads = false } = {}) {
  const reads = []
  const db = {
    close() {},
    objectStoreNames: { contains: () => true },
    transaction() {
      const tx = { objectStore: () => ({
        get(key) {
          const request = {}
          const answer = () => { request.result = records.get(key); request.onsuccess?.() }
          if (holdReads) reads.push(answer)
          else queueMicrotask(answer)
          return request
        },
        put(record) { records.set(record.key, structuredClone(record)) },
      }) }
      queueMicrotask(() => tx.oncomplete?.())
      return tx
    },
  }
  return {
    open() { const request = { result: db }; queueMicrotask(() => request.onsuccess?.()); return request },
    releaseReads() { reads.splice(0).forEach((answer) => answer()) },
  }
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear() })
afterEach(async () => {
  const vault = await import('../src/composables/dataVault.js')
  vault.cancelPendingMirrorWrites()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('备份恢复与安全副本写入的竞争', () => {
  it('恢复后，先前防抖队列里的旧值不会覆盖新的安全副本', async () => {
    const records = new Map()
    vi.stubGlobal('indexedDB', memoryIndexedDB(records))
    const vault = await import('../src/composables/dataVault.js')
    const core = await import('../src/composables/store/core.js')
    const restored = [{ id: 'fictional-restored-task', title: '恢复后的虚构任务' }]
    await vault.mirrorLocalValue('sl_tasks', JSON.stringify([{ id: 'fictional-old-task' }]), { allowEmpty: true })
    await core.restoreStoredValues({ sl_tasks: restored }, { markChanged: false })
    await vi.advanceTimersByTimeAsync(250)
    expect(JSON.parse(records.get('sl_tasks').value)).toEqual(restored)
  })

  it('恢复过程中仍在等待读取的旧镜像批次不会覆盖恢复结果', async () => {
    const records = new Map()
    const idb = memoryIndexedDB(records, { holdReads: true })
    vi.stubGlobal('indexedDB', idb)
    const vault = await import('../src/composables/dataVault.js')
    const core = await import('../src/composables/store/core.js')
    const restored = [{ id: 'fictional-restored-task-2' }]
    await vault.mirrorLocalValue('sl_tasks', JSON.stringify([{ id: 'fictional-old-task-2' }]))
    await vi.advanceTimersByTimeAsync(250)
    await core.restoreStoredValues({ sl_tasks: restored }, { markChanged: false })
    idb.releaseReads()
    await vi.advanceTimersByTimeAsync(1)
    expect(JSON.parse(records.get('sl_tasks').value)).toEqual(restored)
  })
})
