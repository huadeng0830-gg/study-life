// 每个 codeHash 映射到一个对象。Durable Object 对同一对象的请求串行执行，
// 因此 expectedRevision 的比较与持久化写入天然是原子 compare-and-swap。
export class SyncCoordinator {
  constructor(state) {
    this.state = state
    this.retentionReady = false
  }

  async fetch(request) {
    if (request.method !== 'POST') return json({ error: '只接受 POST 请求' }, 405)
    let body
    try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }

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

    if (body.operation === 'metadata') return json(metadataOf(stored))
    if (body.operation === 'pull') return json(pullOf(stored))
    if (body.operation !== 'push') return json({ error: '未知同步操作' }, 400)
    if (!validPush(body)) return json({ error: '同步请求格式无效' }, 400)

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
    }
    await this.state.storage.put('record', record)
    return json({ ok: true, ...metadataOf(record) })
  }

  async alarm() {
    // 兼容旧版本已经排队的闹钟：不再删除用户数据。
  }
}

function validPush(value) {
  return typeof value?.data === 'string' &&
    (value.expectedRevision === null || (Number.isInteger(value.expectedRevision) && value.expectedRevision >= 0)) &&
    typeof value.deviceId === 'string' && value.deviceId &&
    typeof value.deviceName === 'string' && value.deviceName
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
  }
}

function pullOf(stored) {
  return { data: stored?.payload || null, ...metadataOf(stored) }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export default { fetch: () => new Response('Not found', { status: 404 }) }
