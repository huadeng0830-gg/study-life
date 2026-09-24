import { constantTimeEqual, hashSecret, hashSpaceId, json, pairKey, publicMetadata, readSpaceMeta, safeDevice, safeVerifier, validSpaceId, writeSpaceMeta } from '../spaceUtils.js'
import { coordinatorJson, readLegacyRecord } from '../coordinator.js'

// POST /api/sync/pair/claim { spaceId, pairingToken, deviceId, deviceName, credentialVerifier }
// pairing token 只允许成功消费一次；新设备凭证由新设备本地生成，服务端只收 verifier。
export async function onRequestPost(context) {
  const { request, data } = context
  let body
  try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }
  const spaceId = String(body.spaceId || '').trim().toUpperCase()
  const device = safeDevice({ id: body.deviceId, name: body.deviceName, platform: body.platform })
  const credentialVerifier = safeVerifier(body.credentialVerifier)
  if (!validSpaceId(spaceId) || !device || !credentialVerifier || typeof body.pairingToken !== 'string' || body.pairingToken.length < 32) {
    return json({ error: '绑定信息不完整' }, 400)
  }
  const spaceHash = await hashSpaceId(spaceId)
  data.spaceId = spaceId
  data.spaceHash = spaceHash
  data.codeHash = spaceHash
  const meta = await readSpaceMeta(data.kv, spaceHash)
  const tokenHash = await hashSecret(body.pairingToken)
  const key = pairKey(spaceHash, tokenHash)
  const pairing = await data.kv.get(key, 'json')
  if (!meta || !pairing || pairing.usedAt || new Date(pairing.expiresAt).getTime() <= Date.now() || !constantTimeEqual(pairing.tokenHash, tokenHash) || !pairing.wrappedPayloadKey) {
    return json({ error: '绑定二维码已失效，请让电脑重新生成' }, 410)
  }
  if (meta.devices.some((item) => !item.revokedAt && constantTimeEqual(item.credentialVerifier, credentialVerifier))) {
    return json({ error: '此设备授权已存在，请重新绑定' }, 409)
  }
  const now = new Date().toISOString()
  const deviceCoordinated = await coordinatorJson(context, {
    operation: 'pair-claim',
    tokenHash,
    pairing: { tokenHash, createdAt: pairing.createdAt, expiresAt: pairing.expiresAt, wrappedPayloadKey: pairing.wrappedPayloadKey },
    device,
    credentialVerifier,
    devices: meta.devices,
  })
  if (deviceCoordinated) {
    if (deviceCoordinated.status >= 400) return json(deviceCoordinated.body, deviceCoordinated.status)
    const next = { ...meta, devices: Array.isArray(deviceCoordinated.body?.devices) ? deviceCoordinated.body.devices : meta.devices, updatedAt: now }
    try { await data.kv.put(key, JSON.stringify({ ...pairing, usedAt: now }), { expirationTtl: 60 }) } catch {}
    try { await writeSpaceMeta(data.kv, spaceHash, next) } catch {}
    const payload = await readLegacyRecord(context)
    const metadata = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
    if (metadata?.status >= 400) return json(metadata.body, metadata.status)
    return json({ ok: true, ...publicMetadata(next, metadata?.body || payload), wrappedPayloadKey: deviceCoordinated.body.wrappedPayloadKey })
  }
  const next = {
    ...meta,
    devices: [...meta.devices.filter((item) => item.id !== device.id), { id: device.id, name: device.name, platform: device.platform, credentialVerifier, createdAt: now, lastSeenAt: now, revokedAt: null }],
    updatedAt: now,
  }
  await writeSpaceMeta(data.kv, spaceHash, next)
  // 标记并缩短存留，保证没有 delete API 的测试/兼容 KV 也无法再次消费。
  await data.kv.put(key, JSON.stringify({ ...pairing, usedAt: now }), { expirationTtl: 60 })
  const payload = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
  if (coordinated?.status >= 400) return json(coordinated.body, coordinated.status)
  return json({ ok: true, ...publicMetadata(next, coordinated?.body || payload), wrappedPayloadKey: pairing.wrappedPayloadKey })
}
