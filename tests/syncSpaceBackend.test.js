import { describe, expect, it, vi } from 'vitest'
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js'
import { onRequestPost as createSpace } from '../functions/api/sync/space/create.js'
import { onRequestPost as recoverSpace } from '../functions/api/sync/space/recover.js'
import { onRequestPost as createPair } from '../functions/api/sync/pair/create.js'
import { onRequestPost as preparePair } from '../functions/api/sync/pair/prepare.js'
import { onRequestPost as claimPair } from '../functions/api/sync/pair/claim.js'
import { onRequestPost as revokeDevice } from '../functions/api/sync/device/revoke.js'
import { onRequestPost as renameDevice } from '../functions/api/sync/device/rename.js'
import { onRequestPost as syncHealth } from '../functions/api/sync/health.js'
import { hashSecret, hashSpaceId, MAX_SYNC_REQUEST_BODY_BYTES, pairKey, spaceMetaKey } from '../functions/api/sync/spaceUtils.js'
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
    async delete(key) { values.delete(key) },
  }
}

function request(path, body) {
  return new Request(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function coordinatorReturning(body, status = 200) {
  return {
    idFromName: vi.fn(() => 'space-object'),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })),
    })),
  }
}

function statefulCoordinator(seedDevices = []) {
  const values = new Map()
  if (seedDevices.length) values.set('devices', seedDevices)
  const coordinator = new SyncCoordinator({
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      deleteAlarm: async () => {},
    },
  })
  return {
    values,
    namespace: {
      idFromName: () => 'space-object',
      get: () => ({ fetch: (url, init) => coordinator.fetch(new Request(url, init)) }),
    },
  }
}

describe('SyncSpace Worker metadata and pairing', () => {
  it('旧版协调器不认识配对操作时返回可诊断的版本错误，而不是未知同步操作', async () => {
    const kv = createKv()
    const coordinator = coordinatorReturning({ error: '未知同步操作' }, 400)
    const response = await createPair({
      env: { SYNC_COORDINATOR: coordinator, SYNC_REMOTE_MODE: 'do' },
      data: {
        kv,
        codeHash: 'space-hash',
        spaceHash: 'space-hash',
        spaceId: 'AB7K-P9M2-X4DQ',
        spaceDevice: { id: 'device-a' },
      },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('版本') })
  })

  it('中间件授权遇到旧版协调器时也返回版本错误，不伪装成凭据失效', async () => {
    const kv = createKv()
    const spaceId = 'AB7K-P9M2-X4DQ'
    const spaceHash = await hashSpaceId(spaceId)
    const credential = 'device-credential-' + 'a'.repeat(32)
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({
      version: 1,
      id: spaceId,
      devices: [{ id: 'device-a', name: 'Windows PC', credentialVerifier: await hashSecret(credential) }],
    }))
    const response = await apiMiddleware({
      request: request('/api/sync/pair/create', { spaceId, deviceCredential: credential }),
      env: {
        STUDY_LIFE_SYNC: kv,
        SYNC_COORDINATOR: coordinatorReturning({ error: '未知同步操作' }, 400),
        SYNC_REMOTE_MODE: 'do',
      },
      data: {},
      next: vi.fn(),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'COORDINATOR_VERSION_MISMATCH',
      error: expect.stringContaining('版本'),
    })
  })

  it('同步健康检查验证 Pages 与协调器协议一致且不需要用户凭据', async () => {
    const response = await syncHealth({
      env: {
        SYNC_COORDINATOR: coordinatorReturning({
          ok: true,
          protocolVersion: 2,
          operations: ['authorize', 'pair-create', 'pair-prepare', 'pair-claim', 'metadata', 'pull', 'push'],
        }),
      },
      data: {},
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, mode: 'do', protocolVersion: 2 })
  })

  it('创建空间只保存 verifier，并能用设备 credential 通过中间层验证', async () => {
    const kv = createKv()
    const credential = 'device-credential-' + 'a'.repeat(32)
    const recovery = 'recovery-secret-' + 'b'.repeat(32)
    const createResponse = await createSpace({
      request: request('/api/sync/space/create', { spaceId: 'AB7K-P9M2-X4DQ', deviceId: 'device-a', deviceName: 'Windows PC', platform: 'Windows', credentialVerifier: await hashSecret(credential), recoveryVerifier: await hashSecret(recovery) }),
      env: { STUDY_LIFE_SYNC: kv },
      data: {},
    })
    expect(createResponse.status).toBe(201)
    const created = await createResponse.json()
    expect(created).not.toHaveProperty('credentialVerifier')
    expect(created).not.toHaveProperty('recoveryVerifier')

    const context = {
      request: request('/api/sync/space/verify', { spaceId: created.spaceId, deviceCredential: credential }),
      env: { STUDY_LIFE_SYNC: kv },
      data: {},
      next: vi.fn(async () => new Response(null, { status: 204 })),
    }
    const response = await apiMiddleware(context)
    expect(response.status).toBe(204)
    expect(context.data.spaceHash).toBe(await hashSpaceId(created.spaceId))
    expect(context.data.spaceDevice).toMatchObject({ id: 'device-a', name: 'Windows PC', platform: 'Windows' })
  })

  it('pairing token 过期/消费后不可重复使用，且服务端只转发 opaque wrapped key', async () => {
    const kv = createKv()
    const spaceHash = await hashSpaceId('AB7K-P9M2-X4DQ')
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: 'AB7K-P9M2-X4DQ', recoveryVerifier: await hashSecret('r'.repeat(40)), devices: [{ id: 'a', name: 'PC', credentialVerifier: await hashSecret('c'.repeat(40)) }] }))
    const pairResponse = await createPair({ data: { kv, spaceHash, spaceId: 'AB7K-P9M2-X4DQ', spaceDevice: { id: 'a' } } })
    const pair = await pairResponse.json()
    const wrapped = 'opaque-encrypted-payload-key'
    const prepareResponse = await preparePair({ request: request('/api/sync/pair/prepare', { pairingToken: pair.pairingToken, wrappedPayloadKey: wrapped }), data: { kv, spaceHash, spaceId: 'AB7K-P9M2-X4DQ' } })
    expect(prepareResponse.status).toBe(200)
    const claimBody = { spaceId: 'AB7K-P9M2-X4DQ', pairingToken: pair.pairingToken, deviceId: 'b', deviceName: 'iPhone', platform: 'iPhone', credentialVerifier: await hashSecret('new-credential-' + 'd'.repeat(32)) }
    const claimData = { request: request('/api/sync/pair/claim', claimBody), data: { kv } }
    const claimed = await claimPair(claimData)
    expect(claimed.status).toBe(200)
    expect(await claimed.json()).toMatchObject({ wrappedPayloadKey: wrapped, spaceId: 'AB7K-P9M2-X4DQ' })
    expect(JSON.parse(kv.values.get(spaceMetaKey(spaceHash))).devices).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b', platform: 'iPhone' })]))
    const repeated = await claimPair({ request: request('/api/sync/pair/claim', claimBody), data: { kv } })
    expect(repeated.status).toBe(410)
    expect((await repeated.json()).error).toContain('失效')
    expect(kv.values.has(pairKey(spaceHash, await hashSecret(pair.pairingToken)))).toBe(true)
  })

  it('DO 模式完整配对后新设备立即可授权，且 KV 镜像包含设备平台', async () => {
    const kv = createKv()
    const spaceId = 'AB7K-P9M2-X4DQ'
    const spaceHash = await hashSpaceId(spaceId)
    const existingDevices = [{ id: 'pc', name: '电脑', platform: 'Windows', credentialVerifier: await hashSecret('pc-' + 'p'.repeat(40)), authEpoch: 1, revokedAt: null }]
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: spaceId, devices: existingDevices }))
    const coordinated = statefulCoordinator(existingDevices)

    const created = await createPair({
      env: { SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data: { kv, codeHash: spaceHash, spaceHash, spaceId, spaceDevice: existingDevices[0] },
    })
    expect(created.status).toBe(200)
    const pair = await created.json()
    const prepared = await preparePair({
      request: request('/api/sync/pair/prepare', { pairingToken: pair.pairingToken, wrappedPayloadKey: 'opaque-key' }),
      env: { SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data: { kv, codeHash: spaceHash, spaceHash, spaceId },
    })
    expect(prepared.status).toBe(200)

    const phoneCredential = 'phone-' + 'c'.repeat(40)
    const claimed = await claimPair({
      request: request('/api/sync/pair/claim', { spaceId, pairingToken: pair.pairingToken, deviceId: 'phone', deviceName: '手机', platform: 'Android', credentialVerifier: await hashSecret(phoneCredential) }),
      env: { SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data: { kv },
    })
    expect(claimed.status).toBe(200)
    expect(JSON.parse(kv.values.get(spaceMetaKey(spaceHash))).devices).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'phone', platform: 'Android' })]))

    const authContext = {
      request: request('/api/sync/space/verify', { spaceId, deviceCredential: phoneCredential }),
      env: { STUDY_LIFE_SYNC: kv, SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data: {},
      next: vi.fn(async () => new Response(null, { status: 204 })),
    }
    expect((await apiMiddleware(authContext)).status).toBe(204)

    const replayed = await claimPair({
      request: request('/api/sync/pair/claim', { spaceId, pairingToken: pair.pairingToken, deviceId: 'phone', deviceName: '手机', platform: 'Android', credentialVerifier: await hashSecret(phoneCredential) }),
      env: { SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data: { kv },
    })
    expect(replayed.status).toBe(410)
  })

  it('恢复密钥可只用于加入新设备，错误恢复密钥不会写入设备列表', async () => {
    const kv = createKv()
    const spaceHash = await hashSpaceId('AB7K-P9M2-X4DQ')
    const recovery = 'recovery-secret-' + 'x'.repeat(32)
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: 'AB7K-P9M2-X4DQ', recoveryVerifier: await hashSecret(recovery), devices: [] }))
    const response = await recoverSpace({ request: request('/api/sync/space/recover', { spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: recovery, credentialVerifier: await hashSecret('device-secret-' + 'z'.repeat(32)), deviceId: 'new-device', deviceName: 'Android', platform: 'Android' }), data: { kv } })
    expect(response.status).toBe(200)
    const meta = JSON.parse(kv.values.get(spaceMetaKey(spaceHash)))
    expect(meta.devices).toHaveLength(1)
    expect(meta.devices[0]).toMatchObject({ id: 'new-device', platform: 'Android' })
    const invalid = await recoverSpace({ request: request('/api/sync/space/recover', { spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: 'wrong-' + 'q'.repeat(40), credentialVerifier: await hashSecret('other-' + 'z'.repeat(32)), deviceId: 'other', deviceName: 'Other' }), data: { kv } })
    expect(invalid.status).toBe(401)
    expect(JSON.parse(kv.values.get(spaceMetaKey(spaceHash))).devices).toHaveLength(1)
  })

  it('恢复密钥加入的新设备会写入 DO 权威注册表并可立即通过授权', async () => {
    const kv = createKv()
    const spaceId = 'AB7K-P9M2-X4DQ'
    const spaceHash = await hashSpaceId(spaceId)
    const recovery = 'recovery-secret-' + 'x'.repeat(32)
    const existingDevices = [{ id: 'pc', name: '电脑', platform: 'Windows', credentialVerifier: await hashSecret('pc-' + 'p'.repeat(40)), authEpoch: 1, revokedAt: null }]
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: spaceId, recoveryVerifier: await hashSecret(recovery), devices: existingDevices }))
    const coordinated = statefulCoordinator(existingDevices)
    const newCredential = 'new-device-' + 'n'.repeat(40)

    const recovered = await recoverSpace({
      request: request('/api/sync/space/recover', { spaceId, recoverySecret: recovery, credentialVerifier: await hashSecret(newCredential), deviceId: 'phone', deviceName: '手机', platform: 'Android' }),
      env: { SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data: { kv },
    })
    expect(recovered.status).toBe(200)

    const authContext = {
      request: request('/api/sync/space/verify', { spaceId, deviceCredential: newCredential }),
      env: { STUDY_LIFE_SYNC: kv, SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data: {},
      next: vi.fn(async () => new Response(null, { status: 204 })),
    }
    expect((await apiMiddleware(authContext)).status).toBe(204)
    expect(authContext.data.spaceDevice).toMatchObject({ id: 'phone', platform: 'Android' })
  })

  it('DO 模式的设备改名与撤销会镜像回 KV 元数据', async () => {
    const kv = createKv()
    const spaceHash = await hashSpaceId('AB7K-P9M2-X4DQ')
    const devices = [
      { id: 'pc', name: '电脑', platform: 'Windows', credentialVerifier: 'pc-verifier', authEpoch: 1, revokedAt: null },
      { id: 'phone', name: '手机', platform: 'Android', credentialVerifier: 'phone-verifier', authEpoch: 1, revokedAt: null },
    ]
    const meta = { version: 1, id: 'AB7K-P9M2-X4DQ', devices }
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify(meta))
    const coordinated = statefulCoordinator(devices)
    const data = { kv, codeHash: spaceHash, spaceHash, spaceDevice: devices[0], spaceMeta: meta, authEpoch: 1 }

    const renamed = await renameDevice({
      request: request('/api/sync/device/rename', { deviceName: '主电脑' }),
      env: { SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data,
    })
    expect(renamed.status).toBe(200)
    expect(JSON.parse(kv.values.get(spaceMetaKey(spaceHash))).devices.find((device) => device.id === 'pc').name).toBe('主电脑')

    data.spaceMeta = JSON.parse(kv.values.get(spaceMetaKey(spaceHash)))
    data.spaceDevice = data.spaceMeta.devices.find((device) => device.id === 'pc')
    const revoked = await revokeDevice({
      request: request('/api/sync/device/revoke', { deviceId: 'phone' }),
      env: { SYNC_COORDINATOR: coordinated.namespace, SYNC_REMOTE_MODE: 'do' },
      data,
    })
    expect(revoked.status).toBe(200)
    expect(JSON.parse(kv.values.get(spaceMetaKey(spaceHash))).devices.find((device) => device.id === 'phone').revokedAt).toEqual(expect.any(String))
  })

  it('设备撤销只失效目标 credential，不删除空间 payload 或本设备', async () => {
    const kv = createKv()
    const spaceHash = await hashSpaceId('AB7K-P9M2-X4DQ')
    const currentCredential = 'current-' + 'a'.repeat(40)
    const targetCredential = 'target-' + 'b'.repeat(40)
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: 'AB7K-P9M2-X4DQ', recoveryVerifier: await hashSecret('r'.repeat(40)), devices: [
      { id: 'current', name: 'PC', credentialVerifier: await hashSecret(currentCredential) },
      { id: 'target', name: 'Phone', credentialVerifier: await hashSecret(targetCredential) },
    ] }))
    await kv.put(`sync:${spaceHash}:data`, JSON.stringify({ payload: 'ciphertext', revision: 4 }))
    const response = await revokeDevice({ request: request('/api/sync/device/revoke', { deviceId: 'target' }), data: { kv, spaceHash, spaceDevice: { id: 'current' }, spaceMeta: JSON.parse(kv.values.get(spaceMetaKey(spaceHash))) } })
    expect(response.status).toBe(200)
    const meta = JSON.parse(kv.values.get(spaceMetaKey(spaceHash)))
    expect(meta.devices.find((device) => device.id === 'target').revokedAt).toBeTruthy()
    expect(meta.devices.find((device) => device.id === 'current').revokedAt).toBeFalsy()
    expect(JSON.parse(kv.values.get(`sync:${spaceHash}:data`)).payload).toBe('ciphertext')
  })

  it('同一校园 NAT 下 20 台不同设备的正常 revision check 不共享单一 IP 配额', async () => {
    const kv = createKv()
    const spaceId = 'AB7K-P9M2-X4DQ'
    const spaceHash = await hashSpaceId(spaceId)
    const devices = []
    for (let index = 0; index < 20; index++) {
      const credential = `device-${index}-` + 'x'.repeat(40)
      devices.push({ id: `device-${index}`, name: `设备 ${index}`, credentialVerifier: await hashSecret(credential), credential })
    }
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: spaceId, devices }))

    const responses = await Promise.all(devices.map((device) => apiMiddleware({
      request: new Request(`https://example.com/api/sync/space/revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'campus-nat' },
        body: JSON.stringify({ spaceId, deviceCredential: device.credential }),
      }),
      env: { STUDY_LIFE_SYNC: kv },
      data: {},
      next: vi.fn(async () => new Response(null, { status: 204 })),
    })))

    expect(responses.every((response) => response.status === 204)).toBe(true)
  })

  it('revision 配额按 device + space 隔离，同一 NAT 下两个设备各自可完成正常 burst', async () => {
    const kv = createKv()
    const spaceId = 'AB7K-P9M2-X4DQ'
    const spaceHash = await hashSpaceId(spaceId)
    const devices = []
    for (let index = 0; index < 2; index++) {
      const credential = `burst-device-${index}-` + 'x'.repeat(40)
      devices.push({ id: `burst-device-${index}`, name: `Burst ${index}`, credentialVerifier: await hashSecret(credential), credential })
    }
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: spaceId, devices }))

    const responses = await Promise.all(devices.flatMap((device) => Array.from({ length: 61 }, () => apiMiddleware({
      request: new Request(`https://example.com/api/sync/space/revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'campus-nat-burst' },
        body: JSON.stringify({ spaceId, deviceCredential: device.credential }),
      }),
      env: { STUDY_LIFE_SYNC: kv },
      data: {},
      next: vi.fn(async () => new Response(null, { status: 204 })),
    }))))

    expect(responses.every((response) => response.status === 204)).toBe(true)
  })

  it('space verify 的错误凭据按 IP + space + endpoint 严格限流', async () => {
    const kv = createKv()
    const spaceId = 'AB7K-P9M2-X4DQ'
    const spaceHash = await hashSpaceId(spaceId)
    await kv.put(spaceMetaKey(spaceHash), JSON.stringify({ version: 1, id: spaceId, recoveryVerifier: await hashSecret('r'.repeat(40)), devices: [] }))

    const responses = await Promise.all(Array.from({ length: 13 }, () => apiMiddleware({
      request: new Request('https://example.com/api/sync/space/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': 'same-client' },
        body: JSON.stringify({ spaceId, deviceCredential: 'invalid-' + 'x'.repeat(40) }),
      }),
      env: { STUDY_LIFE_SYNC: kv },
      data: {},
      next: vi.fn(async () => new Response(null, { status: 204 })),
    })))

    expect(responses.filter((response) => response.status === 429)).toHaveLength(1)
    expect(responses.filter((response) => response.status === 401)).toHaveLength(12)
  })

  it('在 JSON.parse 前按原始 body 字节数拒绝超大请求', async () => {
    const oversized = JSON.stringify({ data: 'x'.repeat(MAX_SYNC_REQUEST_BODY_BYTES) })
    const response = await apiMiddleware({
      request: new Request('https://example.com/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversized,
      }),
      env: { STUDY_LIFE_SYNC: createKv() },
      data: {},
      next: vi.fn(),
    })

    expect(response.status).toBe(413)
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })
})
