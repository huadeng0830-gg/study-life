import { coordinatorJson, readLegacyRecord } from '../coordinator.js'
import { json, publicMetadata, writeSpaceMeta } from '../spaceUtils.js'

// POST /api/sync/device/revoke { spaceId, deviceCredential, deviceId }
// 设备撤销只改变空间元数据；旧设备的 credential verifier 会失效，业务 envelope 不变。
export async function onRequestPost(context) {
  const { request, data } = context
  let body
  try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }
  const targetId = typeof body.deviceId === 'string' ? body.deviceId.trim().slice(0, 80) : ''
  if (!targetId || targetId === data.spaceDevice.id) return json({ error: '不能移除当前设备' }, 400)
  const deviceCoordinated = await coordinatorJson(context, {
    operation: 'device-revoke',
    deviceId: data.spaceDevice.id,
    authEpoch: Number(data.authEpoch || data.spaceDevice.authEpoch || 1),
    targetId,
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
  const target = data.spaceMeta.devices.find((device) => device.id === targetId && !device.revokedAt)
  if (!target) return json({ error: '未找到可移除的设备' }, 404)
  const now = new Date().toISOString()
  const next = { ...data.spaceMeta, devices: data.spaceMeta.devices.map((device) => device.id === targetId ? { ...device, revokedAt: now } : device), updatedAt: now }
  await writeSpaceMeta(data.kv, data.spaceHash, next)
  const payload = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
  if (coordinated?.status >= 400) return json(coordinated.body, coordinated.status)
  return json({ ok: true, ...publicMetadata(next, coordinated?.body || payload) })
}
