import { constantTimeEqual, hashSecret, hashSpaceId, publicMetadata, readSpaceMeta, safeDevice, safeVerifier, validSpaceId, writeSpaceMeta, json } from '../spaceUtils.js'
import { coordinatorJson, readLegacyRecord } from '../coordinator.js'

// POST /api/sync/space/recover
// 恢复信息仅用于一次设备绑定验证；成功后只保存新的 device credential verifier。
export async function onRequestPost(context) {
  const { request, data } = context
  let body
  try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }
  const spaceId = String(body.spaceId || '').trim().toUpperCase()
  const device = safeDevice({ id: body.deviceId, name: body.deviceName, platform: body.platform })
  const credentialVerifier = safeVerifier(body.credentialVerifier)
  if (!validSpaceId(spaceId) || !device || !credentialVerifier || typeof body.recoverySecret !== 'string' || body.recoverySecret.length < 32) {
    return json({ error: '恢复信息或设备信息无效' }, 400)
  }
  const spaceHash = await hashSpaceId(spaceId)
  const meta = await readSpaceMeta(data.kv, spaceHash)
  if (!meta || !constantTimeEqual(meta.recoveryVerifier, await hashSecret(body.recoverySecret))) {
    return json({ error: '同步恢复信息无效' }, 401)
  }
  const now = new Date().toISOString()
  const deviceCoordinated = await coordinatorJson(context, {
    operation: 'device-recover',
    device,
    credentialVerifier,
    devices: meta.devices,
  })
  if (deviceCoordinated?.status >= 400) return json(deviceCoordinated.body, deviceCoordinated.status)
  const devices = deviceCoordinated
    ? deviceCoordinated.body.devices || meta.devices
    : [...meta.devices.filter((item) => item.id !== device.id), { id: device.id, name: device.name, platform: device.platform, credentialVerifier, createdAt: now, lastSeenAt: now, revokedAt: null }]
  const next = { ...meta, devices, updatedAt: now }
  await writeSpaceMeta(data.kv, spaceHash, next)
  const payload = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
  if (coordinated?.status >= 400) return json(coordinated.body, coordinated.status)
  return json({ ok: true, ...publicMetadata(next, coordinated?.body || payload) })
}
