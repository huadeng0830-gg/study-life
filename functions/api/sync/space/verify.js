import { publicMetadata, json } from '../spaceUtils.js'
import { coordinatorJson, readLegacyRecord } from '../coordinator.js'

// POST /api/sync/space/verify { spaceId, deviceCredential }
// 中间件已完成 verifier 校验，这里只返回空间/设备轻量 metadata。
export async function onRequestPost(context) {
  const { data } = context
  const payload = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
  if (coordinated?.status >= 400) return json(coordinated.body, coordinated.status)
  return json({ ok: true, ...publicMetadata(data.spaceMeta, coordinated?.body || payload), device: data.spaceDevice ? { id: data.spaceDevice.id, name: data.spaceDevice.name, platform: data.spaceDevice.platform || '' } : null })
}
