// POST /api/sync/push { code, data: base64url密文 }
// 返回：{ ok: true, updatedAt: ISO }
export async function onRequestPost(context) {
  const { codeHash, kv, request } = context

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: '请求体必须是 JSON' }, 400)
  }

  if (!body.data) {
    return json({ error: '缺少 data 字段' }, 400)
  }

  const key = `sync:${codeHash}:data`
  const updatedAt = new Date().toISOString()

  // 存 KV：{ payload: base64url, updatedAt }
  await kv.put(key, JSON.stringify({ payload: body.data, updatedAt }), {
    expirationTtl: 30 * 86400, // 30 天
  })

  return json({ ok: true, updatedAt })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}