const TTL_MS = 30 * 86400 * 1000

// 每个 codeHash 映射到一个对象。Durable Object 对同一对象的请求串行执行，
// 因此 expectedRevision 的比较与持久化写入天然是原子 compare-and-swap。
export class SyncCoordinator {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    if (request.method !== 'POST') return json({ error: '只接受 POST 请求' }, 405)
    let body
    try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }

    let stored = await this.state.storage.get('record')
    // 首次调用时惰性迁移旧 KV 记录；之后只使用强一致的 DO 存储。
    if (!stored && validStoredRecord(body.legacyRecord)) {
      stored = body.legacyRecord
      await this.state.storage.put('record', stored)
      await this.state.storage.setAlarm(Date.now() + TTL_MS)
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
    await this.state.storage.setAlarm(Date.now() + TTL_MS)
    return json({ ok: true, ...metadataOf(record) })
  }

  async alarm() {
    await this.state.storage.deleteAll()
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
