import { describe, expect, it } from 'vitest'
import { onRequestPost as pullSync } from '../functions/api/sync/pull.js'
import { onRequestPost as revisionSync } from '../functions/api/sync/space/revision.js'
import { onRequestPost as verifySync } from '../functions/api/sync/space/verify.js'
import { SyncCoordinator } from '../sync-coordinator/src/index.js'

function createKv() {
  const values = new Map()
  return {
    values,
    async get(key, type) {
      const value = values.get(key)
      return type === 'json' && typeof value === 'string' ? JSON.parse(value) : value ?? null
    },
    async put(key, value) { values.set(key, value) },
  }
}

function createCoordinatorNamespace() {
  const values = new Map()
  const coordinator = new SyncCoordinator({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      deleteAlarm: async () => {},
    },
  })
  return {
    coordinator,
    idFromName: () => 'sync-space',
    get: () => ({ fetch: (url, init) => coordinator.fetch(new Request(url, init)) }),
  }
}

function createFailingCoordinatorNamespace() {
  return {
    idFromName: () => 'sync-space',
    get: () => ({ fetch: async () => new Response(JSON.stringify({ error: 'DO unavailable' }), { status: 503 }) }),
  }
}

describe('同步远端真源', () => {
  it('正式 DO 模式不可达时 fail closed，不读取旧 KV payload', async () => {
    const kv = createKv()
    await kv.put('sync:space-hash:data', JSON.stringify({ payload: 'stale-kv-payload', revision: 9 }))

    const response = await pullSync({
      env: { SYNC_REMOTE_MODE: 'do' },
      data: { kv, codeHash: 'space-hash' },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('协调') })
  })

  it('正式 DO 返回 500 时版本检查也 fail closed，而不是把错误伪装成空远端', async () => {
    const kv = createKv()
    await kv.put('sync:space-hash:data', JSON.stringify({ payload: 'stale-kv-payload', revision: 9 }))
    const response = await revisionSync({
      env: { SYNC_REMOTE_MODE: 'do', SYNC_COORDINATOR: createFailingCoordinatorNamespace() },
      data: {
        kv,
        codeHash: 'space-hash',
        spaceMeta: { id: 'AB7K-P9M2-X4DQ', devices: [] },
      },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'DO unavailable' })
  })

  it('空间验证的 metadata 失败不会返回 200 + exists=false', async () => {
    const kv = createKv()
    const response = await verifySync({
      env: { SYNC_REMOTE_MODE: 'do', SYNC_COORDINATOR: createFailingCoordinatorNamespace() },
      data: {
        kv,
        codeHash: 'space-hash',
        spaceMeta: { id: 'AB7K-P9M2-X4DQ', devices: [] },
        spaceDevice: { id: 'phone', name: 'Phone' },
      },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'DO unavailable' })
  })

  it('只在受控迁移时把 legacy KV 导入 DO，之后 DO 始终胜过陈旧 KV', async () => {
    const kv = createKv()
    await kv.put('sync:space-hash:data', JSON.stringify({ payload: 'legacy-payload', revision: 4 }))
    const namespace = createCoordinatorNamespace()
    const context = {
      env: { SYNC_REMOTE_MODE: 'do', SYNC_LEGACY_MIGRATION: 'enabled', SYNC_COORDINATOR: namespace },
      data: { kv, codeHash: 'space-hash' },
    }

    const migrated = await pullSync(context)
    expect(migrated.status).toBe(200)
    expect(await migrated.json()).toMatchObject({ data: 'legacy-payload', revision: 4 })

    await kv.put('sync:space-hash:data', JSON.stringify({ payload: 'stale-kv-payload', revision: 99 }))
    const afterMigration = await pullSync(context)
    expect(await afterMigration.json()).toMatchObject({ data: 'legacy-payload', revision: 4 })
  })
})
