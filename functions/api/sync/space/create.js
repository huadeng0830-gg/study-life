import { hashSpaceId, publicMetadata, safeDevice, safeVerifier, spaceMetaKey, validSpaceId, json } from '../spaceUtils.js'

// POST /api/sync/space/create
// 创建请求只提交 verifier；服务端不持久化 recovery secret、device credential 或业务数据明文。
export async function onRequestPost(context) {
  const { request, env } = context
  let body
  try { body = await request.json() } catch { return json({ error: '请求体必须是 JSON' }, 400) }

  const spaceId = String(body.spaceId || '').trim().toUpperCase()
  const device = safeDevice({ id: body.deviceId, name: body.deviceName, platform: body.platform })
  const credentialVerifier = safeVerifier(body.credentialVerifier)
  const recoveryVerifier = safeVerifier(body.recoveryVerifier)
  if (!validSpaceId(spaceId) || !device || !credentialVerifier || !recoveryVerifier) {
    return json({ error: '同步空间创建信息不完整' }, 400)
  }

  const spaceHash = await hashSpaceId(spaceId)
  const key = spaceMetaKey(spaceHash)
  const existing = await env.STUDY_LIFE_SYNC.get(key, 'json')
  if (existing) return json({ error: '同步空间编号已存在，请重新创建' }, 409)
  const now = new Date().toISOString()
  const meta = {
    version: 1,
    id: spaceId,
    recoveryVerifier,
    devices: [{ id: device.id, name: device.name, platform: device.platform, credentialVerifier, createdAt: now, lastSeenAt: now, revokedAt: null }],
    revision: null,
    updatedAt: null,
    updatedByDeviceId: null,
    updatedByDeviceName: null,
    createdAt: now,
  }
  await env.STUDY_LIFE_SYNC.put(key, JSON.stringify(meta))
  return json({ ok: true, ...publicMetadata(meta) }, 201)
}
