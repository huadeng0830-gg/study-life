import { describe, expect, it } from 'vitest'
import { SyncCoordinator } from '../sync-coordinator/src/index.js'

function createCoordinator() {
  const values = new Map()
  const state = {
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
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
  it('公开协议能力供无数据写入的发布健康检查使用', async () => {
    const coordinator = createCoordinator()
    const response = await post(coordinator, { operation: 'capabilities', protocolVersion: 2 })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      protocolVersion: 2,
      operations: expect.arrayContaining(['authorize', 'pair-create', 'pair-prepare', 'pair-claim', 'metadata', 'pull', 'push']),
    })
  })

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

  it('promotes the minimum writer schema and rejects an old client before commit', async () => {
    const coordinator = createCoordinator()
    const first = await post(coordinator, {
      operation: 'push', data: 'package-payload', expectedRevision: null, deviceId: 'new', deviceName: '新设备', clientDataSchemaVersion: 2,
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ minWriterSchemaVersion: 2 })
    const old = await post(coordinator, {
      operation: 'push', data: 'old-food-payload', expectedRevision: 1, deviceId: 'old', deviceName: '旧设备', clientDataSchemaVersion: 1,
    })
    expect(old.status).toBe(426)
    expect(await old.json()).toMatchObject({ code: 'DATA_SCHEMA_UPGRADE_REQUIRED', minWriterSchemaVersion: 2 })
    const pulled = await post(coordinator, { operation: 'pull' })
    expect(await pulled.json()).toMatchObject({ data: 'package-payload', revision: 1 })
  })

  it('同一个 pairing token 20 路并发 claim 只能成功消费一次', async () => {
    const coordinator = createCoordinator()
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    await post(coordinator, {
      operation: 'pair-create',
      pairing: { tokenHash: 'a'.repeat(64), createdAt: new Date().toISOString(), expiresAt, wrappedPayloadKey: 'wrapped-key' },
    })
    const claim = () => post(coordinator, {
      operation: 'pair-claim',
      tokenHash: 'a'.repeat(64),
      device: { id: `phone-${Math.random()}`, name: '手机' },
      credentialVerifier: 'credential-verifier',
      devices: [{ id: 'pc', name: '电脑', credentialVerifier: 'pc-verifier', authEpoch: 1, revokedAt: null }],
    })

    const results = await Promise.all(Array.from({ length: 20 }, claim))
    expect(results.filter((response) => response.status === 200)).toHaveLength(1)
    expect(results.filter((response) => response.status === 410)).toHaveLength(19)
  })

  it('设备撤销与改名在同一空间串行，且旧 epoch 的 in-flight push 被拒绝', async () => {
    const coordinator = createCoordinator()
    const devices = [
      { id: 'pc', name: '电脑', credentialVerifier: 'pc-verifier', authEpoch: 1, revokedAt: null },
      { id: 'phone', name: '手机', credentialVerifier: 'phone-verifier', authEpoch: 1, revokedAt: null },
    ]
    const [renamed, revoked] = await Promise.all([
      post(coordinator, { operation: 'device-rename', deviceId: 'pc', authEpoch: 1, deviceName: '新电脑', devices }),
      post(coordinator, { operation: 'device-revoke', deviceId: 'pc', authEpoch: 1, targetId: 'phone', devices }),
    ])
    expect(renamed.status).toBe(200)
    expect(revoked.status).toBe(200)
    const push = await post(coordinator, { operation: 'push', data: 'old-phone-push', expectedRevision: null, deviceId: 'phone', deviceName: '手机', authEpoch: 1, devices })
    expect(push.status).toBe(401)
    const authorized = await post(coordinator, { operation: 'authorize', credentialVerifier: 'pc-verifier', devices })
    expect(await authorized.json()).toMatchObject({ device: { id: 'pc', name: '新电脑' } })
  })

  it('Durable Object 拒绝超过资源上限的密文 push', async () => {
    const coordinator = createCoordinator()
    const response = await post(coordinator, {
      operation: 'push', data: 'x'.repeat(8 * 1024 * 1024 + 1), expectedRevision: null, deviceId: 'pc', deviceName: '电脑',
    })
    expect(response.status).toBe(413)
  })

  it('授权检查更新 lastSeenAt，但五分钟内的轮询不会反复写设备注册表', async () => {
    const coordinator = createCoordinator()
    const devices = [{ id: 'pc', name: '电脑', credentialVerifier: 'pc-verifier', authEpoch: 1, revokedAt: null, lastSeenAt: null }]
    const first = await post(coordinator, { operation: 'authorize', credentialVerifier: 'pc-verifier', devices })
    const firstBody = await first.json()
    expect(firstBody.device.lastSeenAt).toEqual(expect.any(String))

    const second = await post(coordinator, { operation: 'authorize', credentialVerifier: 'pc-verifier', devices })
    const secondBody = await second.json()
    expect(secondBody.device.lastSeenAt).toBe(firstBody.device.lastSeenAt)
  })
})
