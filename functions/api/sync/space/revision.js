import { publicMetadata, json } from '../spaceUtils.js'
import { coordinatorJson, readLegacyRecord } from '../coordinator.js'

// POST /api/sync/space/revision { spaceId, deviceCredential }
// 自动轮询只需要这两个字段，绝不下载加密 envelope。
export async function onRequestPost(context) {
  const { data } = context
  const payload = await readLegacyRecord(context)
  const coordinated = await coordinatorJson(context, { operation: 'metadata', legacyRecord: payload })
  if (coordinated?.status >= 400) return json(coordinated.body, coordinated.status)
  return json(publicMetadata(data.spaceMeta, coordinated?.body || payload))
}
