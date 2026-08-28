// GET /api/sync/pull?code=xxxxxx
// 返回密文及轻量版本 metadata。此接口只在用户确认“从云端拉取”后调用。
export async function onRequestGet(context) {
  const { codeHash, kv } = context.data

  const key = `sync:${codeHash}:data`
  const stored = await kv.get(key, 'json')

  if (!stored) {
    return json({
      data: null,
      exists: false,
      revision: null,
      updatedAt: null,
      updatedByDeviceId: null,
      updatedByDeviceName: null,
    })
  }

  return json({
    data: stored.payload,
    exists: true,
    revision: Number.isInteger(stored.revision) ? stored.revision : null,
    updatedAt: stored.updatedAt || null,
    updatedByDeviceId: typeof stored.updatedByDeviceId === 'string' ? stored.updatedByDeviceId : null,
    updatedByDeviceName: typeof stored.updatedByDeviceName === 'string' ? stored.updatedByDeviceName : null,
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
