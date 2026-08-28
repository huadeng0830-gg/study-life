// POST /api/auth/verify { code }
// 仅校验访问码并返回轻量版本 metadata，绝不返回业务数据。
export async function onRequestPost(context) {
  const { codeHash, kv } = context.data

  const key = `sync:${codeHash}:data`
  const stored = await kv.get(key, 'json')

  return json(metadataOf(stored))
}

function metadataOf(stored) {
  if (!stored) {
    return {
      exists: false,
      revision: null,
      updatedAt: null,
      updatedByDeviceId: null,
      updatedByDeviceName: null,
    }
  }
  return {
    exists: true,
    // 旧记录没有 metadata 时保持 null，客户端会安全降级为“来源设备未知”。
    revision: Number.isInteger(stored.revision) ? stored.revision : null,
    updatedAt: stored.updatedAt || null,
    updatedByDeviceId: typeof stored.updatedByDeviceId === 'string' ? stored.updatedByDeviceId : null,
    updatedByDeviceName: typeof stored.updatedByDeviceName === 'string' ? stored.updatedByDeviceName : null,
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
