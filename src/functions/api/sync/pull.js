// GET /api/sync/pull?code=xxxxxx
// 返回：{ data: base64url密文, updatedAt: ISO } 或 { data: null, updatedAt: null }
export async function onRequestGet(context) {
  const { codeHash, kv } = context

  const key = `sync:${codeHash}:data`
  const stored = await kv.get(key, 'json')

  if (!stored) {
    return json({ data: null, updatedAt: null })
  }

  return json({ data: stored.payload, updatedAt: stored.updatedAt })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}