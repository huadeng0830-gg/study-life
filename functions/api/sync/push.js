import { coordinatorJson, readLegacyRecord } from './coordinator.js'

// POST /api/sync/push { code, data, expectedRevision, deviceId, deviceName }
// 仅在 expectedRevision 与当前版本一致时写入，防止页面打开后静默覆盖新版本。
export async function onRequestPost(context) {
  const { codeHash, kv } = context.data
  const { request } = context

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: '请求体必须是 JSON' }, 400)
  }

  if (!body.data) {
    return json({ error: '缺少 data 字段' }, 400)
  }

  if (!validRevision(body.expectedRevision)) {
    return json({ error: 'expectedRevision 格式无效' }, 400)
  }
  if (typeof body.deviceId !== 'string' || !body.deviceId.trim() || typeof body.deviceName !== 'string' || !body.deviceName.trim()) {
    return json({ error: '缺少设备信息' }, 400)
  }

  const legacyRecord = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, {
    operation: 'push',
    legacyRecord,
    data: body.data,
    expectedRevision: body.expectedRevision,
    deviceId: body.deviceId.trim().slice(0, 80),
    deviceName: body.deviceName.trim().slice(0, 30),
  })
  if (coordinated) return json(coordinated.body, coordinated.status)

  const key = `sync:${codeHash}:data`
  const previous = await kv.get(key, 'json')
  const actualRevision = Number.isInteger(previous?.revision) ? previous.revision : null
  if (actualRevision !== body.expectedRevision) {
    return json({
      error: '云端刚刚发生了变化，请重新查看后再决定是否推送',
      conflict: true,
      ...metadataOf(previous),
    }, 409)
  }
  const updatedAt = new Date().toISOString()
  const revision = (actualRevision ?? 0) + 1

  // 只有 KV 写入成功后才更新来源、时间与 revision。
  await kv.put(key, JSON.stringify({
    payload: body.data,
    revision,
    updatedAt,
    updatedByDeviceId: body.deviceId.trim().slice(0, 80),
    updatedByDeviceName: body.deviceName.trim().slice(0, 30),
  }), {
    expirationTtl: 30 * 86400, // 30 天
  })

  return json({ ok: true, revision, updatedAt, updatedByDeviceId: body.deviceId.trim().slice(0, 80), updatedByDeviceName: body.deviceName.trim().slice(0, 30) })
}

function validRevision(value) {
  return value === null || (Number.isInteger(value) && value >= 0)
}

function metadataOf(stored) {
  return {
    exists: !!stored,
    revision: Number.isInteger(stored?.revision) ? stored.revision : null,
    updatedAt: stored?.updatedAt || null,
    updatedByDeviceId: typeof stored?.updatedByDeviceId === 'string' ? stored.updatedByDeviceId : null,
    updatedByDeviceName: typeof stored?.updatedByDeviceName === 'string' ? stored.updatedByDeviceName : null,
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
