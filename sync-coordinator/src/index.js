// 每个 codeHash 映射到一个对象。Durable Object 对同一对象的请求串行执行，
// 因此 expectedRevision 的比较与持久化写入天然是原子 compare-and-swap。
import { COORDINATOR_OPERATIONS, COORDINATOR_PROTOCOL_VERSION } from '../../sync-protocol.js'

const DEVICE_ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000

export class SyncCoordinator {
  constructor(state) {
    this.state = state
    this.retentionReady = false
    this.queue = Promise.resolve()
  }

  async fetch(request) {
    // Durable Objects 本身按对象串行请求；队列也让本地契约测试与非 Cloudflare
    // 兼容运行时保持同样的单空间串行语义。
    const result = this.queue.then(() => this.handle(request))
    this.queue = result.catch(() => {})
    return result
  }

  async handle(request) {
    if (request.method !== 'POST') return json({ error: '只接受 POST 请求' }, 405)
    let body
    try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }

    if (body.operation === 'capabilities') {
      return json({ ok: true, protocolVersion: COORDINATOR_PROTOCOL_VERSION, operations: COORDINATOR_OPERATIONS })
    }
    if (Number(body.protocolVersion || 1) > COORDINATOR_PROTOCOL_VERSION) {
      return json({ error: '同步协调器协议版本过低', code: 'COORDINATOR_VERSION_MISMATCH', protocolVersion: COORDINATOR_PROTOCOL_VERSION }, 426)
    }

    // 旧版本曾设置 30 天删除闹钟；新版本永久保留同步数据，并在对象唤醒时取消旧闹钟。
    if (!this.retentionReady) {
      await this.state.storage.deleteAlarm()
      this.retentionReady = true
    }
    let stored = await this.state.storage.get('record')
    // 首次调用时惰性迁移旧 KV 记录；之后只使用强一致的 DO 存储。
    if (!stored && validStoredRecord(body.legacyRecord)) {
      stored = body.legacyRecord
      await this.state.storage.put('record', stored)
    }

    if (body.operation === 'authorize') return this.authorize(body)
    if (body.operation === 'pair-create') return this.createPair(body)
    if (body.operation === 'pair-prepare') return this.preparePair(body)
    if (body.operation === 'pair-claim') return this.claimPair(body)
    if (body.operation === 'device-recover') return this.recoverDevice(body)
    if (body.operation === 'device-rename') return this.renameDevice(body)
    if (body.operation === 'device-revoke') return this.revokeDevice(body)
    if (body.operation === 'metadata') return json(metadataOf(stored))
    if (body.operation === 'pull') return json(pullOf(stored))
    if (body.operation !== 'push') return json({ error: '未知同步操作', code: 'UNKNOWN_SYNC_OPERATION', protocolVersion: COORDINATOR_PROTOCOL_VERSION }, 400)
    if (typeof body.data === 'string' && body.data.length > 8 * 1024 * 1024) return json({ error: '同步密文过大' }, 413)
    if (!validPush(body)) return json({ error: '同步请求格式无效' }, 400)
    if (body.authEpoch !== undefined) {
      const devices = await this.getDevices(body.devices)
      const actor = devices.find((item) => item.id === body.deviceId && !item.revokedAt && Number(item.authEpoch || 1) === Number(body.authEpoch))
      if (!actor) return json({ error: '此设备的同步授权已失效，请重新绑定。' }, 401)
    }

    const writerSchema = Number.isInteger(body.clientDataSchemaVersion) ? body.clientDataSchemaVersion : 1
    const minimumWriterSchema = Math.max(1, Number(stored?.minWriterSchemaVersion) || 1)
    if (writerSchema < minimumWriterSchema) {
      return json({ error: '此同步空间已经使用新版数据结构，请更新此设备后继续同步。', code: 'DATA_SCHEMA_UPGRADE_REQUIRED', minWriterSchemaVersion: minimumWriterSchema, clientDataSchemaVersion: writerSchema }, 426)
    }

    const actualRevision = Number.isInteger(stored?.revision) ? stored.revision : null
    if (actualRevision !== body.expectedRevision) {
      return json({ error: '云端刚刚发生了变化，请重新查看后再决定是否推送', conflict: true, ...metadataOf(stored) }, 409)
    }

    const record = {
      payload: body.data,
      revision: (actualRevision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      updatedByDeviceId: body.deviceId,
      updatedByDeviceName: body.deviceName,
      minWriterSchemaVersion: Math.max(minimumWriterSchema, writerSchema),
      lastWriterSchemaVersion: writerSchema,
    }
    await this.state.storage.put('record', record)
    return json({ ok: true, ...metadataOf(record) })
  }

  async alarm() {
    // 兼容旧版本已经排队的闹钟：不再删除用户数据。
  }

  async getDevices(seed = []) {
    let devices = await this.state.storage.get('devices')
    if (!Array.isArray(devices)) {
      devices = normalizeDevices(seed)
      await this.state.storage.put('devices', devices)
    }
    return devices
  }

  async authorize(body) {
    let devices = await this.getDevices(body.devices)
    const device = devices.find((item) => !item.revokedAt && item.credentialVerifier === body.credentialVerifier)
    if (!device) return json({ error: '此设备的同步授权已失效，请重新绑定。' }, 401)
    const lastSeenMs = Date.parse(device.lastSeenAt || '')
    if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= DEVICE_ACTIVITY_UPDATE_INTERVAL_MS) {
      const now = new Date().toISOString()
      devices = devices.map((item) => item.id === device.id ? { ...item, lastSeenAt: now } : item)
      await this.state.storage.put('devices', devices)
    }
    const authorizedDevice = devices.find((item) => item.id === device.id) || device
    return json({ ok: true, device: authorizedDevice, devices })
  }

  async createPair(body) {
    if (!validPair(body?.pairing)) return json({ error: '绑定信息无效' }, 400)
    const key = `pair:${body.pairing.tokenHash}`
    const existing = await this.state.storage.get(key)
    if (existing) return json({ error: '绑定二维码已存在，请重新生成' }, 409)
    await this.state.storage.put(key, { ...body.pairing, usedAt: null })
    return json({ ok: true })
  }

  async preparePair(body) {
    const key = `pair:${body.tokenHash}`
    const pairing = await this.state.storage.get(key)
    if (!validPair(pairing) || pairing.usedAt || isExpired(pairing)) return json({ error: '绑定二维码已失效，请重新生成' }, 410)
    await this.state.storage.put(key, { ...pairing, wrappedPayloadKey: body.wrappedPayloadKey })
    return json({ ok: true, expiresAt: pairing.expiresAt })
  }

  async claimPair(body) {
    const key = `pair:${body.tokenHash}`
    let pairing = await this.state.storage.get(key)
    if (!pairing && validPair(body.pairing)) {
      pairing = { ...body.pairing, usedAt: null }
      await this.state.storage.put(key, pairing)
    }
    if (!validPair(pairing) || pairing.usedAt || isExpired(pairing) || !pairing.wrappedPayloadKey) {
      return json({ error: '绑定二维码已失效，请让电脑重新生成' }, 410)
    }
    const devices = await this.getDevices(body.devices)
    if (devices.some((item) => !item.revokedAt && item.credentialVerifier === body.credentialVerifier)) {
      return json({ error: '此设备授权已存在，请重新绑定' }, 409)
    }
    const now = new Date().toISOString()
    const nextDevices = [
      ...devices.filter((item) => item.id !== body.device?.id),
      { ...body.device, credentialVerifier: body.credentialVerifier, createdAt: now, lastSeenAt: now, revokedAt: null, authEpoch: 1 },
    ]
    await this.state.storage.put(key, { ...pairing, usedAt: now })
    await this.state.storage.put('devices', nextDevices)
    return json({ ok: true, wrappedPayloadKey: pairing.wrappedPayloadKey, devices: nextDevices })
  }

  async recoverDevice(body) {
    if (!body?.device?.id || !body?.device?.name || typeof body.credentialVerifier !== 'string') {
      return json({ error: '恢复设备信息无效' }, 400)
    }
    const devices = await this.getDevices(body.devices)
    const previous = devices.find((item) => item.id === body.device.id)
    const now = new Date().toISOString()
    const nextDevices = [
      ...devices.filter((item) => item.id !== body.device.id && item.credentialVerifier !== body.credentialVerifier),
      {
        ...body.device,
        credentialVerifier: body.credentialVerifier,
        createdAt: now,
        lastSeenAt: now,
        revokedAt: null,
        authEpoch: Number(previous?.authEpoch || 0) + 1,
      },
    ]
    await this.state.storage.put('devices', nextDevices)
    return json({ ok: true, devices: nextDevices })
  }

  async renameDevice(body) {
    const devices = await this.getDevices(body.devices)
    const actor = devices.find((item) => item.id === body.deviceId && !item.revokedAt && Number(item.authEpoch || 1) === Number(body.authEpoch || 1))
    if (!actor) return json({ error: '此设备的同步授权已失效，请重新绑定。' }, 401)
    const now = new Date().toISOString()
    const nextDevices = devices.map((item) => item.id === actor.id ? { ...item, name: body.deviceName, lastSeenAt: now } : item)
    await this.state.storage.put('devices', nextDevices)
    return json({ ok: true, devices: nextDevices })
  }

  async revokeDevice(body) {
    const devices = await this.getDevices(body.devices)
    const actor = devices.find((item) => item.id === body.deviceId && !item.revokedAt && Number(item.authEpoch || 1) === Number(body.authEpoch || 1))
    if (!actor) return json({ error: '此设备的同步授权已失效，请重新绑定。' }, 401)
    if (!body.targetId || body.targetId === actor.id) return json({ error: '不能移除当前设备' }, 400)
    const target = devices.find((item) => item.id === body.targetId && !item.revokedAt)
    if (!target) return json({ error: '未找到可移除的设备' }, 404)
    const now = new Date().toISOString()
    const nextDevices = devices.map((item) => item.id === target.id ? { ...item, revokedAt: now, authEpoch: Number(item.authEpoch || 1) + 1 } : item)
    await this.state.storage.put('devices', nextDevices)
    return json({ ok: true, devices: nextDevices })
  }
}

function validPush(value) {
  return typeof value?.data === 'string' &&
    value.data.length <= 8 * 1024 * 1024 &&
    (value.expectedRevision === null || (Number.isInteger(value.expectedRevision) && value.expectedRevision >= 0)) &&
    typeof value.deviceId === 'string' && value.deviceId &&
    typeof value.deviceName === 'string' && value.deviceName &&
    (value.authEpoch === undefined || (Number.isInteger(value.authEpoch) && value.authEpoch >= 1)) &&
    (value.clientDataSchemaVersion === undefined || (Number.isInteger(value.clientDataSchemaVersion) && value.clientDataSchemaVersion >= 1))
}

function validPair(value) {
  return value && typeof value.tokenHash === 'string' && value.tokenHash.length >= 32
    && typeof value.expiresAt === 'string' && typeof value.wrappedPayloadKey === 'string'
}

function isExpired(value) {
  return !Number.isFinite(new Date(value.expiresAt).getTime()) || new Date(value.expiresAt).getTime() <= Date.now()
}

function normalizeDevices(devices) {
  return (Array.isArray(devices) ? devices : []).filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
    .map((item) => ({ ...item, authEpoch: Number(item.authEpoch || 1) }))
}

function validStoredRecord(value) {
  return value && typeof value.payload === 'string'
}

function metadataOf(stored) {
  return {
    exists: Boolean(stored),
    revision: Number.isInteger(stored?.revision) ? stored.revision : null,
    updatedAt: stored?.updatedAt || null,
    updatedByDeviceId: typeof stored?.updatedByDeviceId === 'string' ? stored.updatedByDeviceId : null,
    updatedByDeviceName: typeof stored?.updatedByDeviceName === 'string' ? stored.updatedByDeviceName : null,
    minWriterSchemaVersion: Math.max(1, Number(stored?.minWriterSchemaVersion) || 1),
    lastWriterSchemaVersion: Math.max(1, Number(stored?.lastWriterSchemaVersion) || 1),
  }
}

function pullOf(stored) {
  return { data: stored?.payload || null, ...metadataOf(stored) }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export default { fetch: () => new Response('Not found', { status: 404 }) }
