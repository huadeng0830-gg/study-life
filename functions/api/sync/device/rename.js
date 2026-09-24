import { coordinatorJson, readLegacyRecord } from '../coordinator.js'
import { json, publicMetadata, writeSpaceMeta } from '../spaceUtils.js'

// POST /api/sync/device/rename { spaceId, deviceCredential, deviceName }
export async function onRequestPost(context) {
  const { request, data } = context
  let body
  try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }
  const name = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 30) : ''
  if (!name) return json({ error: '设备名称不能为空' }, 400)
  const deviceCoordinated = await coordinatorJson(context, {
    operation: 'device-rename',
    deviceId: data.spaceDevice.id,
    authEpoch: Number(data.authEpoch || data.spaceDevice.authEpoch || 1),
    deviceName: name,
    devices: data.spaceMeta.devices,
  })
  if (deviceCoordinated) {
    if (deviceCoordinated.status >= 400) return json(deviceCoordinated.body, deviceCoordinated.status)
    const next = { ...data.spaceMeta, devices: deviceCoordinated.body.devices || data.spaceMeta.devices, updatedAt: new Date().toISOString() }
    try { await writeSpaceMeta(data.kv, data.spaceHash, next) } catch {}
    const payload = await readLegacyRecord(context)
    const metadata = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
    if (metadata?.status >= 400) return json(metadata.body, metadata.status)
    return json({ ok: true, ...publicMetadata(next, metadata?.body || payload) })
  }
  const now = new Date().toISOString()
  const next = { ...data.spaceMeta, devices: data.spaceMeta.devices.map((device) => device.id === data.spaceDevice.id ? { ...device, name, lastSeenAt: now } : device), updatedAt: now }
  await writeSpaceMeta(data.kv, data.spaceHash, next)
  const payload = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
  if (coordinated?.status >= 400) return json(coordinated.body, coordinated.status)
  return json({ ok: true, ...publicMetadata(next, coordinated?.body || payload) })
}
