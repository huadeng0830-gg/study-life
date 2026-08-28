import { describe, expect, it } from 'vitest'
import { SyncCoordinator } from '../sync-coordinator/src/index.js'

function createCoordinator() {
  const values = new Map()
  const state = {
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      setAlarm: async () => {},
      deleteAll: async () => values.clear(),
    },
  }
  return new SyncCoordinator(state)
}

function post(coordinator, body) {
  return coordinator.fetch(new Request('https://sync-coordinator.internal/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

describe('SyncCoordinator', () => {
  it('迁移旧 KV 记录后读取 metadata 和密文', async () => {
    const coordinator = createCoordinator()
    const metadata = await post(coordinator, {
      operation: 'metadata',
      legacyRecord: { payload: 'legacy-data', revision: 4, updatedAt: '2026-08-28T00:00:00.000Z' },
    })
    expect(await metadata.json()).toMatchObject({ exists: true, revision: 4 })
    const pulled = await post(coordinator, { operation: 'pull' })
    expect(await pulled.json()).toMatchObject({ data: 'legacy-data', revision: 4 })
  })

  it('原子比较 revision，拒绝过期推送', async () => {
    const coordinator = createCoordinator()
    const first = await post(coordinator, {
      operation: 'push', data: 'new-data', expectedRevision: null, deviceId: 'phone', deviceName: '手机',
    })
    expect(await first.json()).toMatchObject({ ok: true, revision: 1 })
    const stale = await post(coordinator, {
      operation: 'push', data: 'stale-data', expectedRevision: null, deviceId: 'laptop', deviceName: '电脑',
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ conflict: true, revision: 1 })
  })
})
