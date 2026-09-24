import { coordinatorJson, readLegacyRecord } from './coordinator.js'

// POST /api/sync/pull { code }
// 返回密文及轻量版本 metadata。由立即同步、自动协调器或高级手动入口调用。
export async function onRequestPost(context) {
  const stored = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, { operation: 'pull', legacyRecord: stored })
  if (coordinated) return json(coordinated.body, coordinated.status)

  if (!stored) {
    return json({
      data: null,
      exists: false,
      revision: null,
      updatedAt: null,
      updatedByDeviceId: null,
      updatedByDeviceName: null,
      minWriterSchemaVersion: 1,
      lastWriterSchemaVersion: 1,
    })
  }

  return json({
    data: stored.payload,
    exists: true,
    revision: Number.isInteger(stored.revision) ? stored.revision : null,
    updatedAt: stored.updatedAt || null,
    updatedByDeviceId: typeof stored.updatedByDeviceId === 'string' ? stored.updatedByDeviceId : null,
    updatedByDeviceName: typeof stored.updatedByDeviceName === 'string' ? stored.updatedByDeviceName : null,
    minWriterSchemaVersion: Math.max(1, Number(stored.minWriterSchemaVersion) || 1),
    lastWriterSchemaVersion: Math.max(1, Number(stored.lastWriterSchemaVersion) || 1),
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
