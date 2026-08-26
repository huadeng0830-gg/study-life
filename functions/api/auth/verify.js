// POST /api/auth/verify { code }
// 仅校验访问码格式 + 是否已有数据（不返回明文）
export async function onRequestPost(context) {
  const { codeHash, kv } = context.data

  const key = `sync:${codeHash}:data`
  const stored = await kv.get(key, 'json')

  return json({
    exists: !!stored,
    updatedAt: stored?.updatedAt || null,
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
